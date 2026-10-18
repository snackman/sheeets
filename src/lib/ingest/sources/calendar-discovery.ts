// Calendar auto-discovery (daily job, plan item 3): for each active
// conference, look at the Luma events we've already ingested (from ANY
// source — Telegram, sponsor pages, Mira, a sheet tracker, or the
// conference's own curated Luma calendar feed) and ask "which OTHER,
// not-yet-configured Luma calendar hosts this event?" A calendar that keeps
// showing up with several in-window events is worth proposing as a new
// curated `luma_ical` source.
//
// Verified live against the real Luma API (2026-10-17):
//   - `GET api.lu.ma/event/get?event_api_id=evt-…` (already wrapped by
//     `fetchLumaEvent`) returns a top-level `calendar` object with
//     `api_id`, `name`, `is_personal`, `personal_user_api_id` — e.g. an
//     event discovered via ETHDenver's own community calendar
//     (`cal-VFzfuxD…`) had `calendar.api_id` = a DIFFERENT calendar
//     (`cal-FU1X0TNBTO8ti2F`, "The Best Event") — i.e. the calendar that
//     actually HOSTS an event is not always the feed we happened to find
//     it through, which is the whole premise of this feature.
//   - `GET api.lu.ma/calendar/get-items?calendar_api_id=cal-…&period=
//     upcoming&pagination_limit=50` returns `{entries: [{event: {api_id,
//     name, start_at, url, geo_address_info: {city, ...}, coordinate:
//     {latitude, longitude}, ...}, calendar: {...}, ...}], has_more}`.
import { safeFetch, SafeFetchError } from '../../safe-fetch';
import { LUMA_CALENDAR_ID_RE } from './luma-ical';
import { LUMA_EVENT_API_ID_RE, lumaApiIdFromUrl, getLumaShortSlug } from '../../luma';
import type { EnrichLimiter, EnrichOutcome } from '../enrich';
import { dateWindowFilter, geoFilter } from '../filters';
import type { IngestCandidateRow } from '../types';

const CALENDAR_ITEMS_TIMEOUT_MS = 10_000;
const CALENDAR_ITEMS_MAX_BYTES = 3 * 1024 * 1024;
const CALENDAR_ITEMS_USER_AGENT = 'plan.wtf event-ingest (+https://plan.wtf)';

export class CalendarDiscoveryError extends Error {}

export interface ResolvedEventCalendar {
  apiId: string;
  name: string | null;
  isPersonal: boolean;
}

/**
 * `resolveCandidateCalendar`'s outcome, distinguishing a DEFINITIVE answer
 * (safe to cache forever in `event.hostCalendar` — review finding, HIGH
 * item B) from "we genuinely don't know yet" (never cache):
 *   - `'resolved'`: Luma gave a confirmed answer — `calendar` is the
 *     resolved calendar, or `null` if the payload had no usable calendar
 *     field. Cache this, even when `calendar` is null.
 *   - `'not_applicable'`: the candidate's own canonical key isn't a
 *     resolvable Luma `evt-…` id — can never change, cache as `null`.
 *   - `'unavailable'`: the shared limiter was exhausted, or the live
 *     lookup hit a transient error (NOT a confirmed Luma 404) — the exact
 *     same "don't poison the cache" distinction `enrich.ts#EnrichOutcome`
 *     already makes for `ingest_link_cache`. Never cache this outcome;
 *     try again on a later run.
 */
export interface ResolveCandidateCalendarResult {
  status: 'resolved' | 'not_applicable' | 'unavailable';
  calendar: ResolvedEventCalendar | null;
}

/**
 * Resolve one Luma candidate's TRUE hosting calendar via one rate-limited
 * `/event/get` call through the shared `limiter`.
 *
 * Review finding, MEDIUM item 3 ("use the true hosting calendar"): this
 * used to short-circuit on the candidate's STORED `event.calendar.apiId`
 * when present, reasoning that it was "cheap" — but for a `luma_ical`
 * candidate, that stored field is always the calendar the CURATED FEED
 * fetched the event FROM (`normalize.ts#normalizeLumaEvent` sets it to the
 * source calendar, not anything Luma itself returns), which is by
 * definition already a configured `ingest_sources` row. Trusting it meant
 * a `luma_ical` candidate's event could NEVER surface a different, real
 * host calendar — exactly the case this feature exists for (verified
 * live: an event found via ETHDenver's own community calendar had its OWN
 * `calendar.api_id` pointing at a completely different calendar, "The
 * Best Event"). Always resolving live is the only way to see the event's
 * actual calendar, for every candidate regardless of how it was first
 * discovered. The CALLER (`discover-calendars.ts`) is responsible for
 * caching a `'resolved'`/`'not_applicable'` outcome into `event.hostCalendar`
 * so it's never resolved live again — this function itself stays
 * cache-agnostic.
 */
export async function resolveCandidateCalendar(
  candidate: Pick<IngestCandidateRow, 'canonical_key'> & Partial<Pick<IngestCandidateRow, 'event' | 'alt_keys'>>,
  limiter: EnrichLimiter
): Promise<ResolveCandidateCalendarResult> {
  const key = candidate.canonical_key;
  const keyId = key?.startsWith('luma:') ? key.slice('luma:'.length) : null;
  if (!keyId || !LUMA_EVENT_API_ID_RE.test(keyId)) {
    return { status: 'not_applicable', calendar: null };
  }

  // 2026-10-18: canonical keys are LOWERCASED, but Luma's `event/get` is
  // case-sensitive — querying the key's id 404'd and cached
  // `hostCalendar = null` forever. Use the original-case id from the
  // event's own link (or a key that still carries case), else the short
  // slug (Luma resolves those case-insensitively).
  const fromLink = lumaApiIdFromUrl(candidate.event?.link ?? '');
  const apiId = fromLink && fromLink.toLowerCase() === keyId.toLowerCase() ? fromLink : keyId !== keyId.toLowerCase() ? keyId : null;
  const slug =
    getLumaShortSlug(candidate.event?.link) ??
    (candidate.alt_keys ?? []).map((k) => (k.startsWith('luma:') ? k.slice('luma:'.length) : '')).find((s) => s && !LUMA_EVENT_API_ID_RE.test(s)) ??
    null;

  let result: EnrichOutcome | null = null;
  if (apiId) result = await limiter.enrichResult({ apiId });
  if ((!result || result.status === 'not_found') && slug) result = await limiter.enrichResult({ slug });
  // Only a lowercased id and no slug: a 404 on it would prove nothing, so
  // don't ask — and never let the caller cache a negative.
  if (!result) return { status: 'unavailable', calendar: null };
  if (result.status === 'unavailable') return { status: 'unavailable', calendar: null };
  if (result.status === 'not_found') return { status: 'resolved', calendar: null }; // confirmed gone — never re-check.

  // result.status === 'ok'
  const raw = result.payload as unknown as {
    calendar?: { api_id?: string; name?: string; is_personal?: boolean; personal_user_api_id?: string | null } | null;
  };
  const cal = raw.calendar;
  if (!cal?.api_id || !LUMA_CALENDAR_ID_RE.test(cal.api_id)) return { status: 'resolved', calendar: null };
  return {
    status: 'resolved',
    calendar: { apiId: cal.api_id, name: cal.name ?? null, isPersonal: !!cal.is_personal || !!cal.personal_user_api_id },
  };
}

export interface LumaCalendarItem {
  apiId: string | null;
  name: string;
  link: string | null;
  /** "YYYY-MM-DD", taken from `start_at` — UTC-day approximation (good
   *  enough for this counting heuristic; unlike the main pipeline, nothing
   *  here is shown to a user as a specific displayed date). */
  dateISO: string | null;
  lat: number | null;
  lng: number | null;
}

function toLumaCalendarItem(entry: unknown): LumaCalendarItem | null {
  if (!entry || typeof entry !== 'object') return null;
  const ev = (entry as { event?: unknown }).event;
  if (!ev || typeof ev !== 'object') return null;
  const e = ev as Record<string, unknown>;
  const name = typeof e.name === 'string' ? e.name.trim() : '';
  if (!name) return null;
  const apiId = typeof e.api_id === 'string' && LUMA_EVENT_API_ID_RE.test(e.api_id) ? e.api_id : null;
  const slug = typeof e.url === 'string' ? e.url : null;
  const link = apiId ? `https://luma.com/event/${apiId}` : slug ? `https://luma.com/${slug}` : null;
  const startAt = typeof e.start_at === 'string' ? e.start_at : null;
  const dateISO = startAt && !Number.isNaN(Date.parse(startAt)) ? startAt.slice(0, 10) : null;
  const coord = e.coordinate as { latitude?: number; longitude?: number } | undefined;
  const lat = typeof coord?.latitude === 'number' ? coord.latitude : null;
  const lng = typeof coord?.longitude === 'number' ? coord.longitude : null;
  return { apiId, name, link, dateISO, lat, lng };
}

/**
 * One `calendar/get-items` call (plan item 3: "call calendar/get-items
 * once") for `calendarApiId` — no pagination beyond the first page even
 * when `has_more` is true, so this stays a single, cheap request per
 * candidate calendar per run.
 */
export async function fetchLumaCalendarItems(calendarApiId: string): Promise<LumaCalendarItem[]> {
  if (!LUMA_CALENDAR_ID_RE.test(calendarApiId)) {
    throw new CalendarDiscoveryError(`Invalid Luma calendar id: ${calendarApiId}`);
  }
  const url = `https://api.lu.ma/calendar/get-items?calendar_api_id=${encodeURIComponent(calendarApiId)}&period=upcoming&pagination_limit=50`;
  let res;
  try {
    res = await safeFetch(url, {
      timeoutMs: CALENDAR_ITEMS_TIMEOUT_MS,
      maxBytes: CALENDAR_ITEMS_MAX_BYTES,
      maxRedirects: 2,
      headers: { Accept: 'application/json', 'User-Agent': CALENDAR_ITEMS_USER_AGENT },
    });
  } catch (err) {
    throw new CalendarDiscoveryError(err instanceof SafeFetchError ? err.message : 'Could not reach Luma.');
  }
  if (!res.ok) throw new CalendarDiscoveryError(`Luma calendar/get-items returned ${res.status} for ${calendarApiId}.`);

  let json: unknown;
  try {
    json = JSON.parse(res.text);
  } catch {
    throw new CalendarDiscoveryError('Luma calendar/get-items returned an unexpected response.');
  }
  const entries = (json as { entries?: unknown })?.entries;
  if (!Array.isArray(entries)) return [];
  return entries.map(toLumaCalendarItem).filter((e): e is LumaCalendarItem => e !== null);
}

/** Keep a calendar only with >= 2 in-window events that aren't already a
 *  candidate, OR >= 3 in-window events total (review finding, MEDIUM item
 *  2 — raised from the original 1-new-or-2-total thresholds, which
 *  proposed a calendar too eagerly off a single coincidental in-window
 *  event). */
export const MIN_NEW_IN_WINDOW_EVENTS = 2;
export const MIN_TOTAL_IN_WINDOW_EVENTS = 3;
/** Cap how many sample events are stored as evidence per proposal. */
const MAX_EVIDENCE_SAMPLES = 5;

export interface CalendarEvaluation {
  eligible: boolean;
  inWindowCount: number;
  newCount: number;
  sample: { name: string; link: string | null }[];
}

export interface CalendarEvaluationWindow {
  startDate: string;
  endDate: string;
  windowPreDays: number;
  windowPostDays: number;
  center: { lat: number; lng: number };
  radiusKm: number;
}

/**
 * Evaluate one calendar's `get-items` entries against the conference's
 * date window and area. "In the conference's city" is operationalized the
 * same way every other filter in this pipeline determines locality — a
 * radius around the conference's own map center (`geoFilter`'s existing
 * `radius_km`) — rather than a new, separate text-based city matcher;
 * Mira/Luma's own `city` strings are free text and not reliably comparable
 * to one canonical conference city name. An item with no coordinates at
 * all is dropped rather than guessed at (consistent with "no_geo" being
 * treated conservatively elsewhere in this pipeline).
 */
export function evaluateCalendarItems(
  items: LumaCalendarItem[],
  window: CalendarEvaluationWindow,
  existingCandidateKeys: Set<string>
): CalendarEvaluation {
  const inWindow = items.filter((item) => {
    if (!item.dateISO || item.lat == null || item.lng == null) return false;
    const dateCheck = dateWindowFilter(
      { dateISO: item.dateISO },
      { startDate: window.startDate, endDate: window.endDate },
      { window_pre_days: window.windowPreDays, window_post_days: window.windowPostDays }
    );
    if (!dateCheck.pass) return false;
    const geoCheck = geoFilter(
      { lat: item.lat, lng: item.lng, isOnline: false },
      window.center,
      { radius_km: window.radiusKm, allow_online: false }
    );
    return geoCheck.pass === true;
  });

  // Review finding, MEDIUM item 2: an item with no parseable api id can
  // never be CONFIRMED new (we have no key to check against
  // `existingCandidateKeys` at all) — it must not count toward `newCount`
  // just because it's unmatchable. It still counts toward `inWindowCount`.
  const newItems = inWindow.filter((item) => item.apiId && !existingCandidateKeys.has(`luma:${item.apiId.toLowerCase()}`));

  return {
    eligible: newItems.length >= MIN_NEW_IN_WINDOW_EVENTS || inWindow.length >= MIN_TOTAL_IN_WINDOW_EVENTS,
    inWindowCount: inWindow.length,
    newCount: newItems.length,
    sample: inWindow.slice(0, MAX_EVIDENCE_SAMPLES).map((item) => ({ name: item.name, link: item.link })),
  };
}
