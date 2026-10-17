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
import { LUMA_EVENT_API_ID_RE } from '../../luma';
import type { EnrichLimiter } from '../enrich';
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
 * Resolve one Luma candidate's true hosting calendar. Cheap path first:
 * `event->'calendar'->'apiId'` (the stored `NormalizedEvent.calendar`
 * field) when present — this is always the calendar a `luma_ical` source
 * fetched the event FROM (`normalize.ts#normalizeLumaEvent`), so it's only
 * ever an already-configured calendar, but checking it first means we
 * never spend a live call just to rediscover something we already know.
 * Every OTHER case (discovery-sourced candidates always have
 * `calendar: null` — `normalize.ts`'s discovered-link normalizers — and a
 * `luma_ical` candidate's event may genuinely be HOSTED by a different
 * calendar than the one we found it through) falls back to one
 * rate-limited `/event/get` call via the shared `limiter`.
 */
export async function resolveCandidateCalendar(
  candidate: Pick<IngestCandidateRow, 'canonical_key' | 'event'>,
  limiter: EnrichLimiter
): Promise<ResolvedEventCalendar | null> {
  const storedApiId = candidate.event?.calendar?.apiId;
  if (storedApiId && LUMA_CALENDAR_ID_RE.test(storedApiId)) {
    return { apiId: storedApiId, name: candidate.event.calendar?.name ?? null, isPersonal: false };
  }

  const key = candidate.canonical_key;
  const evtApiId = key?.startsWith('luma:') ? key.slice('luma:'.length) : null;
  if (!evtApiId || !LUMA_EVENT_API_ID_RE.test(evtApiId)) return null;

  const payload = await limiter.enrich({ apiId: evtApiId });
  if (!payload) return null;
  const raw = payload as unknown as {
    calendar?: { api_id?: string; name?: string; is_personal?: boolean; personal_user_api_id?: string | null } | null;
  };
  const cal = raw.calendar;
  if (!cal?.api_id || !LUMA_CALENDAR_ID_RE.test(cal.api_id)) return null;
  return { apiId: cal.api_id, name: cal.name ?? null, isPersonal: !!cal.is_personal || !!cal.personal_user_api_id };
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

/** Keep a calendar only with >= 1 in-window event that isn't already a
 *  candidate, OR >= 2 in-window events total (plan item 3's threshold). */
export const MIN_NEW_IN_WINDOW_EVENTS = 1;
export const MIN_TOTAL_IN_WINDOW_EVENTS = 2;
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

  const newItems = inWindow.filter((item) => !item.apiId || !existingCandidateKeys.has(`luma:${item.apiId.toLowerCase()}`));

  return {
    eligible: newItems.length >= MIN_NEW_IN_WINDOW_EVENTS || inWindow.length >= MIN_TOTAL_IN_WINDOW_EVENTS,
    inWindowCount: inWindow.length,
    newCount: newItems.length,
    sample: inWindow.slice(0, MAX_EVIDENCE_SAMPLES).map((item) => ({ name: item.name, link: item.link })),
  };
}
