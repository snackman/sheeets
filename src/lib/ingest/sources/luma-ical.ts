// Luma calendar iCal source (§3.1, §7). Feed URLs are built ONLY from a
// validated `cal-` id, never from a stored raw URL (§10 SSRF).
import { safeFetch } from '../../safe-fetch';
import { LUMA_SLUG_RE } from '../../luma';
import { parseICalFeed, isCancelled, lumaEventApiIdFromUid, lumaSlugFromDescription } from '../ical';
import type { VEvent } from '../ical';

export const LUMA_CALENDAR_ID_RE = /^cal-[A-Za-z0-9]{1,40}$/;

const INGEST_USER_AGENT = 'plan.wtf event-ingest (+https://plan.wtf)';

export class LumaCalendarError extends Error {}

/** Fetch and parse a Luma calendar's iCal feed. `calendarApiId` must already
 *  be a validated `cal-…` id (§10). Cancelled VEVENTs are dropped here. */
export async function fetchLumaIcalFeed(calendarApiId: string): Promise<VEvent[]> {
  if (!LUMA_CALENDAR_ID_RE.test(calendarApiId)) {
    throw new LumaCalendarError('Invalid Luma calendar id.');
  }
  const url = `https://api.lu.ma/ics/get?entity=calendar&id=${encodeURIComponent(calendarApiId)}`;
  let res;
  try {
    res = await safeFetch(url, {
      timeoutMs: 15000,
      maxBytes: 5 * 1024 * 1024,
      maxRedirects: 2,
      headers: { Accept: 'text/calendar', 'User-Agent': INGEST_USER_AGENT },
    });
  } catch (err) {
    throw new LumaCalendarError(err instanceof Error ? err.message : 'Could not reach Luma.');
  }
  if (!res.ok) throw new LumaCalendarError(`Luma ics feed returned ${res.status}.`);

  const events = parseICalFeed(res.text);
  return events.filter((e) => !isCancelled(e));
}

export interface LumaIcalCandidate {
  vevent: VEvent;
  /** Stable Luma event api id, derived from the VEVENT UID. */
  apiId: string | null;
  /** Slug parsed from the DESCRIPTION stub, used as an enrichment fallback. */
  slug: string | null;
}

/** Pair each VEVENT with the identifiers needed for enrichment (§5, §5.2). */
export function toIcalCandidates(events: VEvent[]): LumaIcalCandidate[] {
  return events.map((vevent) => ({
    vevent,
    apiId: lumaEventApiIdFromUid(vevent.uid),
    slug: lumaSlugFromDescription(vevent.description),
  }));
}

export interface ResolvedLumaCalendar {
  apiId: string;
  name: string | null;
  slug: string | null;
}

/** Resolve a `luma.com/<slug>` URL, a bare slug, or an already-valid `cal-…`
 *  id into `{apiId, name, slug}` for the Config UI's "add a Luma calendar"
 *  flow (§9.1). Uses the same undocumented-but-public `api.lu.ma/url`
 *  endpoint the app already calls for events (`luma-server.ts`). */
export async function resolveLumaCalendar(input: string): Promise<ResolvedLumaCalendar> {
  const trimmed = input.trim();
  if (!trimmed) throw new LumaCalendarError('Enter a Luma calendar URL or id.');

  if (LUMA_CALENDAR_ID_RE.test(trimmed)) {
    return { apiId: trimmed, name: null, slug: null };
  }

  let slug = trimmed;
  if (/^https?:\/\//i.test(trimmed)) {
    let u: URL;
    try {
      u = new URL(trimmed);
    } catch {
      throw new LumaCalendarError('Invalid URL.');
    }
    slug = u.pathname.split('/').filter(Boolean)[0] || '';
  }
  if (!LUMA_SLUG_RE.test(slug)) {
    throw new LumaCalendarError('Could not parse a Luma calendar slug from that input.');
  }

  let res;
  try {
    res = await safeFetch(`https://api.lu.ma/url?url=${encodeURIComponent(slug)}`, {
      timeoutMs: 10000,
      maxBytes: 256 * 1024,
      maxRedirects: 2,
      headers: { Accept: 'application/json', 'User-Agent': INGEST_USER_AGENT },
    });
  } catch (err) {
    throw new LumaCalendarError(err instanceof Error ? err.message : 'Could not reach Luma.');
  }
  if (!res.ok) throw new LumaCalendarError(`Could not resolve that Luma calendar (${res.status}).`);

  let json: unknown;
  try {
    json = JSON.parse(res.text);
  } catch {
    throw new LumaCalendarError('Luma returned an unexpected response.');
  }
  const obj = json as { kind?: string; data?: { calendar?: { api_id?: string; name?: string } } };
  const apiId = obj?.data?.calendar?.api_id;
  if (obj?.kind !== 'calendar' || !apiId || !LUMA_CALENDAR_ID_RE.test(apiId)) {
    throw new LumaCalendarError('That link is not a Luma calendar.');
  }
  return { apiId, name: obj.data?.calendar?.name ?? null, slug };
}
