// Geo + date-window filter (§5.3). Runs before any LLM call — the main cost
// control, since a curated Luma calendar's iCal feed returns years of
// history (the plan's EthCC example: 226 VEVENTs, mostly past).
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeAddress } from '../utils';
import { haversineKm } from './geo';
import type { NormalizedEvent } from './types';

/** Add `days` (may be negative) to a "YYYY-MM-DD" string, returning "YYYY-MM-DD". */
function addDaysISO(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export interface DateWindowProfile {
  window_pre_days: number;
  window_post_days: number;
}

export interface ConferenceWindow {
  startDate: string; // ISO date
  endDate: string; // ISO date
}

export type FilterOutcome = { pass: true } | { pass: false; reason: string };

/** True once `startAt` is in the past relative to `now` (default: real now).
 *  Past candidates are filtered silently — only counted, never logged
 *  individually (§5.3). */
export function isPastEvent(event: Pick<NormalizedEvent, 'startAt'>, now: Date = new Date()): boolean {
  const t = new Date(event.startAt).getTime();
  return Number.isFinite(t) && t < now.getTime();
}

/** Event's local `dateISO` must fall in `[startDate - pre, endDate + post]`. */
export function dateWindowFilter(
  event: Pick<NormalizedEvent, 'dateISO'>,
  conference: ConferenceWindow,
  profile: DateWindowProfile
): FilterOutcome {
  const windowStart = addDaysISO(conference.startDate, -Math.abs(profile.window_pre_days));
  const windowEnd = addDaysISO(conference.endDate, Math.abs(profile.window_post_days));
  if (event.dateISO < windowStart || event.dateISO > windowEnd) {
    return { pass: false, reason: `outside_date_window(${windowStart}..${windowEnd})` };
  }
  return { pass: true };
}

export interface GeoFilterProfile {
  radius_km: number;
  allow_online: boolean;
}

/** Radius + online-only check. `no_geo` is a distinct outcome: the caller
 *  routes those to review (capped, never auto-rejected) rather than dropping
 *  them, per §5.3 / §5.4 (`no_geo` caps the route at review). */
export function geoFilter(
  event: Pick<NormalizedEvent, 'lat' | 'lng' | 'isOnline'>,
  center: { lat: number; lng: number },
  profile: GeoFilterProfile
): FilterOutcome | { pass: 'no_geo' } {
  if (event.isOnline) {
    return profile.allow_online ? { pass: true } : { pass: false, reason: 'online_not_allowed' };
  }
  if (event.lat == null || event.lng == null) {
    return { pass: 'no_geo' };
  }
  const distanceKm = haversineKm(center, { lat: event.lat, lng: event.lng });
  if (distanceKm > profile.radius_km) {
    return { pass: false, reason: `outside_radius(${distanceKm.toFixed(1)}km > ${profile.radius_km}km)` };
  }
  return { pass: true };
}

/* ------------------------------------------------------------------ */
/* Geocoding fallback (§5.3: "If there are no coordinates, geocode the
 * address via the existing Mapbox proximity logic, cached in
 * geocoded_addresses. If that fails, route to review with no_geo.")
 *
 * Luma events carry GEO directly in the iCal feed, so this is a fallback
 * for the rare case a feed omits it. Reuses the same Mapbox proximity
 * pattern as `/api/cron/geocode` and the submission flow, with the
 * `geocoded_addresses` table as a shared cache (keyed by normalized
 * address, same as the rest of the app).
 * ------------------------------------------------------------------ */

export async function geocodeAddressCached(
  supabase: SupabaseClient,
  address: string,
  center: { lat: number; lng: number },
  conference: string
): Promise<{ lat: number; lng: number } | null> {
  const trimmed = address.trim();
  if (!trimmed) return null;
  const normalized = normalizeAddress(trimmed);

  const { data: cached } = await supabase
    .from('geocoded_addresses')
    .select('lat,lng')
    .eq('normalized_address', normalized)
    .maybeSingle();
  if (cached) return { lat: cached.lat, lng: cached.lng };

  const token = process.env.MAPBOX_SECRET_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) return null;

  try {
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(trimmed)}.json?access_token=${token}&proximity=${center.lng},${center.lat}&limit=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const json = await res.json();
    const feature = json?.features?.[0];
    const coords = feature?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) return null;
    const [lng, lat] = coords;
    await supabase.from('geocoded_addresses').upsert({
      normalized_address: normalized,
      lat,
      lng,
      matched_address: trimmed,
      conference,
    });
    return { lat, lng };
  } catch {
    return null;
  }
}

/**
 * Cache an address's exact coordinates in the shared `geocoded_addresses`
 * table — the SAME cache `geocodeAddressCached` (above) reads, and that
 * `fetch-events.ts` prefers over the static `geocoded-addresses.json` bake
 * (it calls these the "runtime addresses"). Used when a candidate is
 * published/approved with BOTH an address string and real coordinates (iCal
 * GEO, or a reverse-geocode hit — see `ReverseGeocodeLimiter` below): this
 * way the map pin uses those exact coordinates immediately, rather than
 * waiting for `/api/cron/geocode` to forward-geocode our own constructed
 * "Neighborhood, City" text to a less precise point later.
 *
 * Best-effort, like every other writer of this table (`admin/submissions`,
 * the pipeline's own forward-geocode fallback above) — a failure here must
 * never fail the publish/approve it's attached to.
 */
export async function upsertGeocodedAddress(
  supabase: SupabaseClient,
  address: string,
  lat: number,
  lng: number,
  conference: string
): Promise<void> {
  const trimmed = address.trim();
  if (!trimmed) return;
  try {
    await supabase.from('geocoded_addresses').upsert({
      normalized_address: normalizeAddress(trimmed),
      lat,
      lng,
      matched_address: trimmed,
      conference,
    });
  } catch {
    // Swallow — the cron job will eventually forward-geocode this address
    // itself if this best-effort write fails.
  }
}

/* ------------------------------------------------------------------ */
/* Reverse geocoding (Bug: "addresses are always empty" — priority 3/4 of
 * the address resolution order in `pipeline.ts`'s Luma iCal path): when a
 * candidate has coordinates (iCal GEO) but no usable address text (Luma
 * hides the venue until registration, or enrichment never ran), reverse-
 * geocode a short "Neighborhood, City" label instead of leaving the Address
 * column blank. Capped and cached PER RUN (not persisted across runs, since
 * many candidates in the same feed/conference round to the same nearby
 * point — e.g. Devcon 8's own venue cluster).
 * ------------------------------------------------------------------ */

export interface ReverseGeocodeResult {
  /** "Neighborhood, City", or just "City" when Mapbox has no neighborhood
   *  for this point. */
  label: string;
  /** The city/place component alone (for the conference-level fallback —
   *  §priority 4, "<conference city> (venue on event page)"). */
  city: string | null;
}

/** Default per-run cap on actual Mapbox reverse-geocode calls (cache hits
 *  don't count) — generous enough for one conference's worth of distinct
 *  venues, cheap enough to never meaningfully affect run time/cost. */
const DEFAULT_MAX_REVERSE_GEOCODE_CALLS_PER_RUN = 40;

export class ReverseGeocodeLimiter {
  private readonly cache = new Map<string, ReverseGeocodeResult | null>();
  private calls = 0;

  constructor(private readonly maxCallsPerRun = DEFAULT_MAX_REVERSE_GEOCODE_CALLS_PER_RUN) {}

  get used(): number {
    return this.calls;
  }

  /** Round to ~1km so nearby venues (e.g. a conference center's several
   *  side rooms/stages) share one cached Mapbox call. */
  private key(lat: number, lng: number): string {
    return `${lat.toFixed(2)},${lng.toFixed(2)}`;
  }

  /** Resolve a short place label for `(lat, lng)`, or `null` if unresolvable,
   *  capped, or unconfigured (no Mapbox token). Never throws. */
  async resolve(lat: number, lng: number): Promise<ReverseGeocodeResult | null> {
    const key = this.key(lat, lng);
    if (this.cache.has(key)) return this.cache.get(key) ?? null;

    if (this.calls >= this.maxCallsPerRun) return null;
    const token = process.env.MAPBOX_SECRET_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) return null;

    this.calls++;
    try {
      const url =
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json` +
        `?access_token=${token}&types=neighborhood,place`; // no `limit`: Mapbox rejects limit with multiple types; without it, returns one feature per type
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) {
        this.cache.set(key, null);
        return null;
      }
      const json = await res.json();
      const features: { place_type?: string[]; text?: string }[] = Array.isArray(json?.features) ? json.features : [];
      const neighborhood = features.find((f) => f.place_type?.includes('neighborhood'))?.text || null;
      const city = features.find((f) => f.place_type?.includes('place'))?.text || null;
      const label = neighborhood && city ? `${neighborhood}, ${city}` : city || neighborhood;
      const result: ReverseGeocodeResult | null = label ? { label, city } : null;
      this.cache.set(key, result);
      return result;
    } catch {
      this.cache.set(key, null);
      return null;
    }
  }
}
