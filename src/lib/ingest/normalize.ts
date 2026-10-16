// Build a `NormalizedEvent` (§5.1) from a parsed Luma iCal VEVENT, optionally
// enriched with the full Luma event payload (`fetchLumaEvent`). Phase 1b only
// has one source (Luma iCal), but this module's shape is source-agnostic so
// later phases (Telegram/X links, sponsor pages) can reuse it.
import { createHash } from 'node:crypto';
import { formatCost } from '../event-format';
import { sheetDateShort, sheetDateShortFromISODate, sheetTime12Hour, time12FromTime24 } from '../event-format';
import { extractMirrorText, normalizeHandle, type LumaEventPayload } from '../luma';
import type { EventResult, Platform } from '../event-extractors';
import type { VEvent } from './ical';
import type { NormalizedEvent } from './types';

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Content hash (§5.5 "re-classify only when content_hash changes"): name +
 *  description + hosts + date. Anything else changing (e.g. a typo fix in
 *  the venue) doesn't need a fresh LLM call. */
export function computeContentHash(event: Pick<NormalizedEvent, 'name' | 'descriptionText' | 'dateISO'> & { hosts: { name: string }[] }): string {
  const hostsKey = event.hosts.map((h) => h.name.toLowerCase()).sort().join(',');
  return sha256Hex(`${event.name.trim().toLowerCase()}|${event.descriptionText.trim().toLowerCase()}|${hostsKey}|${event.dateISO}`);
}

export interface NormalizeLumaOptions {
  vevent: VEvent;
  timezone: string;
  /** Full Luma event payload, if enrichment succeeded (§5.1, §5.3). */
  enrichment?: LumaEventPayload | null;
  calendar?: { apiId: string; name: string } | null;
  /** Fallback slug parsed from the iCal DESCRIPTION stub, used only to build
   *  a canonical link when enrichment didn't return one. */
  fallbackSlug?: string | null;
}

/** Address text from a Luma event detail payload's `geo_address_json` /
 *  `geo_address_info` fields — same extraction `parseLuma`
 *  (`event-extractors.ts`) does for the `/api/fetch-event` route, pulled out
 *  here so the Phase 3 discovered-Luma-link normalizer (below) doesn't
 *  duplicate it. These fields aren't on the narrow `LumaEventPayload.event`
 *  type (only what Phase 1b's enrichment needed), so this takes a loosely
 *  typed subset rather than widening that interface. */
export function addressFromLumaGeoFields(event: Record<string, unknown>): string {
  const parseMaybeJson = (v: unknown): Record<string, unknown> | null => {
    if (!v) return null;
    if (typeof v === 'string') {
      try {
        return JSON.parse(v);
      } catch {
        return null;
      }
    }
    return v as Record<string, unknown>;
  };
  const json = parseMaybeJson(event.geo_address_json);
  if (json) {
    const addr = (json.full_address as string) || (json.address as string) || '';
    if (addr) return addr;
  }
  const info = parseMaybeJson(event.geo_address_info);
  if (info) {
    return (info.full_address as string) || (info.city_state as string) || (info.city as string) || '';
  }
  return '';
}

/** True if `text` looks like a real, displayable address/venue string
 *  rather than a URL or placeholder (Bug: "addresses are always empty" —
 *  priority 2 of the address resolution order: "use iCal LOCATION if it's
 *  a real address, not a URL, not empty"). Luma's iCal LOCATION field is
 *  sometimes a bare link (an online event, or a venue-hidden event that
 *  only ever exposes its own event URL there) — those are exactly as
 *  useless as an empty address, and `normalizeLumaEvent` already falls
 *  back to `vevent.location` as the event LINK in that case, so treating
 *  it as an address too would just duplicate the link in two columns. */
export function looksLikeRealAddress(text: string | null | undefined): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  return !/^https?:\/\//i.test(trimmed);
}

function priceCentsFromTicketTypes(payload: LumaEventPayload): number | null {
  const types = (payload as { ticket_types?: { cost?: number | null; price?: number | null }[] }).ticket_types;
  if (!types || types.length === 0) return null;
  const prices = types.map((t) => (typeof t.cost === 'number' ? t.cost : typeof t.price === 'number' ? t.price : null));
  const numeric = prices.filter((p): p is number => p !== null);
  if (numeric.length === 0) return null;
  return Math.min(...numeric);
}

/** Normalize a Luma iCal VEVENT (optionally enriched) into a `NormalizedEvent`. */
export function normalizeLumaEvent(opts: NormalizeLumaOptions): NormalizedEvent {
  const { vevent, timezone, enrichment, calendar } = opts;

  const name = (enrichment?.event?.name || vevent.summary || '').trim();
  const isAllDay = vevent.dtstartIsDateOnly;
  const startAt = isAllDay ? `${vevent.dtstart}T00:00:00.000Z` : vevent.dtstart;
  const endAt = vevent.dtend ?? null;

  const dateISO = isAllDay ? vevent.dtstart : startAt.slice(0, 10);
  const sheetDate = isAllDay ? sheetDateShortFromISODate(vevent.dtstart) : sheetDateShort(startAt, timezone);
  const startTime = isAllDay ? 'All Day' : sheetTime12Hour(startAt, timezone);
  const endTime = !isAllDay && endAt ? sheetTime12Hour(endAt, timezone) : '';

  const hosts = (enrichment?.hosts ?? [])
    .filter((h) => h && typeof h.api_id === 'string')
    .map((h) => ({
      apiId: h.api_id,
      name: h.name || h.username || h.api_id,
      username: h.username ?? null,
      twitter: normalizeHandle(h.twitter_handle),
    }));

  const organizer = hosts[0]?.name || calendar?.name || '';

  const descriptionFromMirror = enrichment?.description_mirror ? extractMirrorText(enrichment.description_mirror) : '';
  const descriptionFromIcal = vevent.description || '';
  const descriptionText = (descriptionFromMirror || descriptionFromIcal).slice(0, 4000);

  const priceCents = enrichment ? priceCentsFromTicketTypes(enrichment) : null;
  const cost = priceCents !== null ? formatCost(priceCents) : 'Free';

  const apiId = enrichment?.event?.api_id || enrichment?.api_id || null;
  const link = apiId
    ? `https://luma.com/event/${apiId}`
    : vevent.location || (opts.fallbackSlug ? `https://luma.com/${opts.fallbackSlug}` : '');

  const geo = vevent.geo;

  // Address resolution order (Bug: "addresses are always empty" — Luma
  // often hides the venue until registration, and enrichment is
  // rate-limited, so most candidates never get an enriched address):
  //   1. The enriched Luma payload's own address fields, if present.
  //   2. The iCal LOCATION field, if it looks like a real address (not a
  //      URL, not empty) — Luma sometimes DOES put the plain venue text
  //      there even when enrichment is skipped/fails.
  //   3/4 (lat/lng-based reverse-geocode fallback, then a conference-city
  //      fallback) happen one level up, in `pipeline.ts` — this function
  //      has no Mapbox client/cache/conference context to do that here.
  const enrichedAddress = enrichment?.event ? addressFromLumaGeoFields(enrichment.event as Record<string, unknown>) : '';
  const icalAddress = looksLikeRealAddress(vevent.location) ? (vevent.location as string).trim() : '';
  const address = enrichedAddress || icalAddress || '';

  return {
    name,
    startAt,
    endAt,
    timezone,
    dateISO,
    sheetDate,
    startTime,
    endTime,
    address,
    lat: geo?.lat ?? null,
    lng: geo?.lng ?? null,
    isOnline: !geo && !vevent.location,
    organizer,
    hosts,
    calendar: calendar ?? null,
    cost,
    link,
    descriptionText,
    imageUrl: null,
    platform: 'luma',
  };
}

/* ------------------------------------------------------------------ */
/* Phase 3: discovered links (Telegram, host submissions, descriptions of  */
/* curated events — plans/event-ingestion.md §3.2/§7 "Discovered Luma      */
/* links"). Unlike the Luma iCal path above, there is no VEVENT — the only  */
/* inputs are a URL and, for Luma, a full `fetchLumaEvent` payload.        */
/* ------------------------------------------------------------------ */

/** The subset of a full Luma event-detail payload (`GET api.lu.ma/event/get`
 *  or `/url`) this normalizer reads. Not part of the narrow `LumaEventPayload`
 *  type (which only covers what Phase 1b's iCal-enrichment needed) — a
 *  discovered Luma link has no iCal VEVENT to supply `start_at`/`end_at`/
 *  `timezone`/address at all, so this normalizer must read them straight off
 *  the detail payload instead. */
interface LumaEventDetailFields {
  api_id?: string;
  name?: string;
  start_at?: string;
  end_at?: string | null;
  timezone?: string;
  ticket_price_cents?: number | null;
  geo_address_json?: string | Record<string, unknown> | null;
  geo_address_info?: string | Record<string, unknown> | null;
}

export interface NormalizeDiscoveredLumaOptions {
  /** Full payload from `fetchLumaEvent({slug|apiId})`. */
  payload: LumaEventPayload;
  /** The link this was discovered as (used only if the payload itself
   *  doesn't resolve to a stable `evt-` api id). */
  fallbackLink: string;
}

/**
 * Normalize a Luma event discovered as a bare link (Telegram, a curated
 * event's description, a host submission) — enriched through the SAME
 * `fetchLumaEvent`/rate limiter every other Luma lookup uses (§3.2: "goes
 * through the same `fetchLumaEvent` enricher under the same rate limits").
 *
 * No iCal GEO is available here, so `lat`/`lng` are always null and
 * `isOnline` is conservatively false (never true) — callers run the same
 * Mapbox geocoding fallback (`filters.ts#geocodeAddressCached`) the Luma
 * iCal path uses when GEO is missing, and a still-unresolved address falls
 * through to the `no_geo` filter outcome (caps the route at review, never
 * silently treated as an online event that only needs `allow_online`).
 *
 * Returns null if the payload doesn't look like a real, dated event (no
 * name, or no `start_at`) — callers should treat that the same as "fetch/
 * enrichment failed" and not create a candidate at all.
 */
export function normalizeDiscoveredLumaEvent(opts: NormalizeDiscoveredLumaOptions): NormalizedEvent | null {
  const { payload, fallbackLink } = opts;
  const detail = (payload.event ?? {}) as LumaEventDetailFields;
  const name = (detail.name || '').trim();
  if (!name || !detail.start_at) return null;

  const timezone = detail.timezone || 'UTC';
  const startDate = new Date(detail.start_at);
  if (isNaN(startDate.getTime())) return null;
  const startAt = startDate.toISOString();
  const endDate = detail.end_at ? new Date(detail.end_at) : null;
  const endAt = endDate && !isNaN(endDate.getTime()) ? endDate.toISOString() : null;

  const dateISO = formatDateISOInTimezone(startAt, timezone);
  const sheetDate = sheetDateShort(startAt, timezone);
  const startTime = sheetTime12Hour(startAt, timezone);
  const endTime = endAt ? sheetTime12Hour(endAt, timezone) : '';

  const hosts = (payload.hosts ?? [])
    .filter((h) => h && typeof h.api_id === 'string')
    .map((h) => ({
      apiId: h.api_id,
      name: h.name || h.username || h.api_id,
      username: h.username ?? null,
      twitter: normalizeHandle(h.twitter_handle),
    }));
  const organizer = hosts[0]?.name || '';

  const descriptionText = (payload.description_mirror ? extractMirrorText(payload.description_mirror) : '').slice(0, 4000);
  const priceCents = typeof detail.ticket_price_cents === 'number' ? detail.ticket_price_cents : priceCentsFromTicketTypes(payload);
  const cost = priceCents !== null ? formatCost(priceCents) : 'Free';

  const apiId = detail.api_id || payload.api_id || null;
  const link = apiId ? `https://luma.com/event/${apiId}` : fallbackLink;
  const address = addressFromLumaGeoFields(detail as unknown as Record<string, unknown>);

  return {
    name,
    startAt,
    endAt,
    timezone,
    dateISO,
    sheetDate,
    startTime,
    endTime,
    address,
    lat: null,
    lng: null,
    isOnline: false,
    organizer,
    hosts,
    calendar: null,
    cost,
    link,
    descriptionText,
    imageUrl: null,
    platform: 'luma',
  };
}

/** "YYYY-MM-DD" for a UTC instant, in `timezone` — same conversion
 *  `sheetDateShort` uses internally, exposed here because the discovered-
 *  link normalizer needs the raw ISO date (for `dateISO`/date-window
 *  filtering), not just the sheet's short display string. */
function formatDateISOInTimezone(isoInstant: string, timezone: string): string {
  const d = new Date(isoInstant);
  return d.toLocaleDateString('en-CA', { timeZone: timezone });
}

export interface NormalizeExtractedOptions {
  platform: Platform;
  /** Output of `parseEventbrite`/`parsePartiful`/`parseMeetup`/`parsePosh`
   *  (`event-extractors.ts`) — already-localized date/time strings, not a
   *  raw UTC instant (those extractors resolve a guessed/declared timezone
   *  internally and never return it). */
  result: EventResult;
}

/**
 * Normalize a non-Luma discovered link (Partiful/Eventbrite/Meetup/Posh)
 * using the SAME extractors `/api/fetch-event` already uses — moved to
 * `event-extractors.ts` in Phase 1a precisely so the ingestion pipeline
 * could reuse them (§3.2: "Non-Luma links ... go through the moved
 * fetch-event extractors").
 *
 * `startAt`/`endAt` are approximated as the UTC-literal reading of the
 * already-localized wall-clock time, because `EventResult` only exposes
 * `dateISO`/`startTime24` (already converted to the event's own guessed
 * timezone) — not a UTC instant or the timezone name itself. This can skew
 * `startAt` by the event's UTC offset, which only matters for the
 * is-this-past ordering check; `dateISO` (what date-window filtering keys
 * on) is exact. Documented limitation, acceptable for a discovery source.
 *
 * Returns null if the extractor didn't find a name or a date (nothing to
 * place on a calendar).
 */
export function normalizeExtractedEvent(opts: NormalizeExtractedOptions): NormalizedEvent | null {
  const { platform, result } = opts;
  if (!result.name || !result.dateISO) return null;

  const sheetDate = sheetDateShortFromISODate(result.dateISO);
  const startTime = result.startTime24 ? time12FromTime24(result.startTime24) : '';
  const endTime = result.endTime24 ? time12FromTime24(result.endTime24) : '';
  const startAt = `${result.dateISO}T${result.startTime24 || '00:00'}:00.000Z`;
  const endAt = result.endTime24 ? `${result.dateISO}T${result.endTime24}:00.000Z` : null;

  return {
    name: result.name,
    startAt,
    endAt,
    timezone: 'UTC',
    dateISO: result.dateISO,
    sheetDate,
    startTime,
    endTime,
    address: result.address || '',
    lat: null,
    lng: null,
    isOnline: false,
    organizer: result.organizer || '',
    hosts: [],
    calendar: null,
    cost: result.cost || '',
    link: result.link,
    descriptionText: '',
    imageUrl: null,
    platform,
  };
}
