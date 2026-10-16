// Minimal RFC 5545 parser (§7): just enough to read VEVENT blocks out of a
// single well-formed producer (Luma's calendar iCal feed). Not a general
// iCalendar library — no RRULE expansion, no VTIMEZONE resolution. Luma's
// feed uses UTC `Z` timestamps for DTSTART/DTEND (verified live, see the
// plan's §3.1), so that's the only timed form handled; `VALUE=DATE` (all-day)
// is also handled. A `TZID=` param on DTSTART/DTEND is not resolved — it's
// kept as a raw string and the caller is expected to treat it as UTC-ish
// best-effort (Luma doesn't emit this form today, but failing open rather
// than throwing keeps a future bad feed from producing zero events run).

export interface VEvent {
  uid: string;
  summary: string;
  description: string;
  /** UTC ISO instant, or a plain "YYYY-MM-DD" for all-day/VALUE=DATE events. */
  dtstart: string;
  dtstartIsDateOnly: boolean;
  dtend: string | null;
  location: string | null;
  geo: { lat: number; lng: number } | null;
  sequence: number;
  status: string | null;
  dtstamp: string | null;
  /** The `ORGANIZER` property's `CN=` param (display name), if the feed
   *  sets one — organizer priority fallback, see `normalize.ts`'s
   *  `resolveLumaOrganizer` (Bug: "Organizer column shows the source
   *  calendar name"). `null` when there's no ORGANIZER line or no CN. */
  organizerName: string | null;
}

/**
 * Unfold lines per RFC 5545 §3.1: a line break followed by a single space or
 * tab is a continuation of the previous line, and must be removed (not
 * replaced with a space — the fold can land mid-word).
 */
function unfoldLines(ics: string): string[] {
  const raw = ics.split(/\r\n|\r|\n/);
  const out: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

/** Unescape §3.3.11 TEXT value: `\\` `\;` `\,` `\N`/`\n` -> literal chars. */
function unescapeText(s: string): string {
  return s.replace(/\\([\\;,nN])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c));
}

/** Strip one layer of surrounding double quotes from a §3.2 param-value
 *  (e.g. `CN="Jane Doe, Esq."`), if both are present. */
function stripQuotes(s: string): string {
  return s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s;
}

/** Split "NAME;PARAM=X;PARAM2=Y:VALUE" into { name, params, value }. Value may
 *  itself contain ':' (e.g. a URL in LOCATION), so only the first ':' splits. */
function splitContentLine(line: string): { name: string; params: Record<string, string>; value: string } | null {
  const colonIdx = line.indexOf(':');
  if (colonIdx === -1) return null;
  const head = line.slice(0, colonIdx);
  const value = line.slice(colonIdx + 1);
  const parts = head.split(';');
  const name = parts[0].toUpperCase();
  const params: Record<string, string> = {};
  for (let i = 1; i < parts.length; i++) {
    const eq = parts[i].indexOf('=');
    if (eq === -1) continue;
    params[parts[i].slice(0, eq).toUpperCase()] = parts[i].slice(eq + 1);
  }
  return { name, params, value };
}

/** Parse a DATE-TIME value. Returns an ISO UTC instant for `Z` / naive-UTC
 *  forms, or the raw "YYYYMMDD" date (as "YYYY-MM-DD") for VALUE=DATE. */
function parseDateTimeValue(value: string, params: Record<string, string>): { iso: string; isDateOnly: boolean } | null {
  if (params.VALUE === 'DATE' || /^\d{8}$/.test(value)) {
    const m = value.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (!m) return null;
    return { iso: `${m[1]}-${m[2]}-${m[3]}`, isDateOnly: true };
  }
  // 20260310T180000Z or 20260310T180000 (naive -> treated as UTC; Luma always
  // sends Z, but failing open here is cheap insurance against a feed change).
  const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return { iso: `${y}-${mo}-${d}T${h}:${mi}:${s}.000Z`, isDateOnly: false };
}

function parseGeo(value: string): { lat: number; lng: number } | null {
  const parts = value.split(';');
  if (parts.length !== 2) return null;
  const lat = Number(parts[0]);
  const lng = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

/** Parse a calendar's VEVENT blocks. Malformed/unterminated blocks are
 *  skipped rather than throwing, so one bad event doesn't drop the feed. */
export function parseICalFeed(ics: string): VEvent[] {
  const lines = unfoldLines(ics);
  const events: VEvent[] = [];

  let inEvent = false;
  let cur: Partial<VEvent> & { summaryRaw?: string; descriptionRaw?: string; locationRaw?: string } = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === 'BEGIN:VEVENT') {
      inEvent = true;
      cur = { sequence: 0, status: null, geo: null, dtend: null, location: null, dtstamp: null, organizerName: null };
      continue;
    }
    if (trimmed === 'END:VEVENT') {
      if (inEvent && cur.uid && cur.dtstart) {
        events.push({
          uid: cur.uid,
          summary: cur.summaryRaw ? unescapeText(cur.summaryRaw) : '',
          description: cur.descriptionRaw ? unescapeText(cur.descriptionRaw) : '',
          dtstart: cur.dtstart,
          dtstartIsDateOnly: !!cur.dtstartIsDateOnly,
          dtend: cur.dtend ?? null,
          location: cur.locationRaw ? unescapeText(cur.locationRaw) : null,
          geo: cur.geo ?? null,
          sequence: cur.sequence ?? 0,
          status: cur.status ?? null,
          dtstamp: cur.dtstamp ?? null,
          organizerName: cur.organizerName ?? null,
        });
      }
      inEvent = false;
      cur = {};
      continue;
    }
    if (!inEvent) continue;

    const parsed = splitContentLine(line);
    if (!parsed) continue;
    const { name, params, value } = parsed;

    switch (name) {
      case 'UID':
        cur.uid = value.trim();
        break;
      case 'SUMMARY':
        cur.summaryRaw = value;
        break;
      case 'DESCRIPTION':
        cur.descriptionRaw = value;
        break;
      case 'LOCATION':
        cur.locationRaw = value;
        break;
      case 'GEO':
        cur.geo = parseGeo(value);
        break;
      case 'SEQUENCE': {
        const n = parseInt(value, 10);
        cur.sequence = Number.isFinite(n) ? n : 0;
        break;
      }
      case 'STATUS':
        cur.status = value.trim().toUpperCase();
        break;
      case 'ORGANIZER': {
        const cn = params.CN ? unescapeText(stripQuotes(params.CN)).trim() : '';
        cur.organizerName = cn || null;
        break;
      }
      case 'DTSTART': {
        const parsedDt = parseDateTimeValue(value.trim(), params);
        if (parsedDt) {
          cur.dtstart = parsedDt.iso;
          cur.dtstartIsDateOnly = parsedDt.isDateOnly;
        }
        break;
      }
      case 'DTEND': {
        const parsedDt = parseDateTimeValue(value.trim(), params);
        if (parsedDt) cur.dtend = parsedDt.iso;
        break;
      }
      case 'DTSTAMP': {
        const parsedDt = parseDateTimeValue(value.trim(), params);
        if (parsedDt) cur.dtstamp = parsedDt.iso;
        break;
      }
      default:
        break;
    }
  }

  return events;
}

/** True if a VEVENT is cancelled and should never become a candidate. */
export function isCancelled(ev: VEvent): boolean {
  return ev.status === 'CANCELLED';
}

/**
 * Luma's DESCRIPTION is only a stub ("Get up-to-date information at:
 * https://luma.com/<slug> ... Hosted by A, B & C") — extract the slug so the
 * caller can enrich via `fetchLumaEvent({slug})` when the UID's api id isn't
 * directly derivable (it is: see `lumaEventApiIdFromUid`), and so hosts can
 * be read as a fallback when enrichment is skipped/fails.
 */
export function lumaSlugFromDescription(description: string): string | null {
  const m = description.match(/luma\.com\/([A-Za-z0-9_-]{1,100})/i);
  return m ? m[1] : null;
}

/** Luma's VEVENT UID is `evt-XXXX@events.lu.ma` — the stable event api id. */
export function lumaEventApiIdFromUid(uid: string): string | null {
  const m = uid.match(/^(evt-[A-Za-z0-9]{1,40})@events\.lu\.ma$/i);
  return m ? m[1] : null;
}
