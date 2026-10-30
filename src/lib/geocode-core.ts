/**
 * Shared forward-geocoding logic (Mapbox) used by the prebuild script,
 * `/api/cron/geocode`, `/api/geocode` and the ingest pipeline.
 *
 * Why this exists: free-text sheet addresses like "Jio World Centre" or
 * "The Peninsula London" were resolving to same-named places on the other
 * side of the world (Fort Worth, Dallas) because `proximity` is only a soft
 * bias. Every result is now validated against the conference's city center;
 * a result that is too far gets one bounded retry, and if it is still not
 * trustworthy we return null -- no pin beats a wrong pin.
 */

/** Geocode-time threshold: a result further than this from the center is suspect. */
export const MAX_DISTANCE_KM = 50;

/**
 * Read-time sanity radius for already-cached coordinates. Looser than the
 * geocode-time threshold so regional side events (e.g. Pune for Devcon in
 * Mumbai, ~120 km) keep their pins while wrong-continent pins are dropped.
 */
export const SANITY_RADIUS_KM = 300;

export interface LatLng {
  lat: number;
  lng: number;
}

export interface GeocodeHit extends LatLng {
  matchedAddress: string;
}

/** Great-circle distance in km (haversine). */
export function distanceKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** True when `point` is within `maxKm` of `center` (and is a real coordinate). */
export function isNearCenter(point: LatLng, center: LatLng, maxKm = MAX_DISTANCE_KM): boolean {
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return false;
  return distanceKm(point, center) <= maxKm;
}

/** Read-time check: is this cached point plausibly near the conference? */
export function isSaneForConference(point: LatLng, center: LatLng): boolean {
  return isNearCenter(point, center, SANITY_RADIUS_KM);
}

const URL_RE = /^\s*(https?:\/\/|www\.)/i;
// Phrases that describe where the address is rather than being one.
const PLACEHOLDER_PHRASE =
  /\b(rsvp|exact location|location (will be )?(shared|revealed|announced)|revealed|secret location|venue on event page|event page|see (event|link|details)|tba|tbd|tbc|to be (announced|determined|confirmed))\b/i;
const PAREN_RE = /\s*\([^)]*\)/g;
const BARE_PLACEHOLDER_RE = /^(n\/a|none|online|virtual|-+)$/i;

/** True when `raw` contained placeholder text (parenthesized or not). */
export function hasPlaceholder(raw: string): boolean {
  return PLACEHOLDER_PHRASE.test(raw ?? '');
}

/**
 * Prepare a raw sheet address for geocoding. Returns null when it is not a
 * geocodable address (a URL, or only a placeholder like "RSVP to see exact
 * location"); otherwise the string with placeholder phrases stripped.
 */
export function cleanAddressForGeocoding(raw: string): string | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed || URL_RE.test(trimmed)) return null;
  let text = trimmed.replace(PAREN_RE, (m) => (PLACEHOLDER_PHRASE.test(m) ? '' : m));
  // Unparenthesized placeholders: drop comma/dash separated segments that are one.
  text = text
    .split(/\s*(?:,|;|\||\s[-–—]\s)\s*/)
    .filter((seg) => seg && !PLACEHOLDER_PHRASE.test(seg))
    .join(', ');
  text = text.replace(/\s+/g, ' ').trim();
  if (!text || BARE_PLACEHOLDER_RE.test(text)) return null;
  return text;
}

type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

export interface GeocodeOptions {
  token: string;
  center: LatLng;
  /** City display name, used for the retry. Looked up from `center` when absent. */
  city?: string;
  maxKm?: number;
  fetchImpl?: FetchLike;
}

const cityCache = new Map<string, string | null>();

/** Name of the city at `center` (Mapbox reverse geocode, memoized). */
export async function resolveCityName(
  center: LatLng,
  token: string,
  fetchImpl: FetchLike = fetch as unknown as FetchLike
): Promise<string | null> {
  const key = `${center.lat.toFixed(2)},${center.lng.toFixed(2)}`;
  if (cityCache.has(key)) return cityCache.get(key) ?? null;
  let city: string | null = null;
  try {
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${center.lng},${center.lat}.json?access_token=${token}&types=place&limit=1`;
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const data = (await res.json()) as { features?: { text?: string }[] };
      city = data?.features?.[0]?.text ?? null;
    }
  } catch {
    // leave null; not cached so a later call can retry
    return null;
  }
  cityCache.set(key, city);
  return city;
}

interface MapboxHit extends GeocodeHit {
  placeTypes: string[];
  /** The feature's own text (e.g. "Pune" for a place feature). */
  text: string;
  /** Place/locality/district names the result sits in (context + itself). */
  areaNames: string[];
}

/** Bounding box [minLng, minLat, maxLng, maxLat], ~55 km around the center. */
export function cityBbox(center: LatLng): [number, number, number, number] {
  const dLat = 0.5;
  const dLng = 0.5 / Math.max(Math.cos((center.lat * Math.PI) / 180), 0.2);
  return [center.lng - dLng, center.lat - dLat, center.lng + dLng, center.lat + dLat];
}

async function queryMapbox(query: string, opts: GeocodeOptions, bounded: boolean): Promise<MapboxHit | null> {
  const { token, center } = opts;
  const fetchImpl = opts.fetchImpl ?? (fetch as unknown as FetchLike);
  let url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${token}&proximity=${center.lng},${center.lat}&limit=1`;
  if (bounded) url += `&bbox=${cityBbox(center).join(',')}`;
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    features?: {
      center?: number[];
      geometry?: { coordinates?: number[] };
      place_name?: string;
      place_type?: string[];
      text?: string;
      context?: { id?: string; text?: string }[];
    }[];
  };
  const feature = data?.features?.[0];
  const coords = feature?.geometry?.coordinates ?? feature?.center;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const [lng, lat] = coords;
  const placeTypes = feature?.place_type ?? [];
  const areaNames = (feature?.context ?? [])
    .filter((c) => /^(place|locality|district|neighborhood)\./.test(c.id ?? ''))
    .map((c) => c.text ?? '');
  if (placeTypes.some((t) => t === 'place' || t === 'locality' || t === 'district')) {
    areaNames.push(feature?.text ?? '');
  }
  return {
    lat,
    lng,
    matchedAddress: feature?.place_name || query,
    placeTypes,
    text: feature?.text ?? '',
    areaNames: areaNames.filter(Boolean),
  };
}

const COARSE_TYPES = new Set(['place', 'region', 'country', 'district', 'locality', 'postcode']);

function containsWord(haystack: string, needle: string): boolean {
  const esc = needle.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return !!esc && new RegExp(`(^|[^\\p{L}\\p{N}])${esc}($|[^\\p{L}\\p{N}])`, 'iu').test(haystack);
}

function firstSegment(text: string): string {
  return text.split(',')[0].trim().toLowerCase();
}

/**
 * Geocode one address for a conference. Returns null for non-addresses,
 * unresolvable addresses, and results that cannot be trusted.
 *
 *  1. Query biased toward the center. In range -> accept.
 *  2. Too far, but the result's own city/locality is named in the address
 *     (a real out-of-town side event, e.g. Pune for a Mumbai conference)
 *     and it is within the sanity radius -> accept; no city retry.
 *  3. Otherwise retry once, bounded to a ~55 km box around the city
 *     (appending ", <City>" unless the address already has it). City-level
 *     or coarser results are rejected on the retry unless the input is
 *     itself just that city/area -- no pin beats a centroid pin.
 */
export async function geocodeNearCenter(raw: string, opts: GeocodeOptions): Promise<GeocodeHit | null> {
  const cleaned = cleanAddressForGeocoding(raw);
  if (!cleaned) {
    console.log(`  - skip non-address: ${raw}`);
    return null;
  }
  const maxKm = opts.maxKm ?? MAX_DISTANCE_KM;
  const city = opts.city?.trim() || (await resolveCityName(opts.center, opts.token, opts.fetchImpl));
  const cityPresent = !!city && containsWord(cleaned, city);
  const seg = firstSegment(cleaned);
  const bareCity = !!city && seg === city.toLowerCase();

  // "Mumbai (venue on event page)": the real venue is unknown; a city
  // centroid would be a misleading pin.
  if (hasPlaceholder(raw) && bareCity) {
    console.log(`  - skip placeholder-only address: ${raw}`);
    return null;
  }

  const first = await queryMapbox(cleaned, opts, false);
  if (first && isNearCenter(first, opts.center, maxKm)) return first;
  if (first) {
    const km = distanceKm(first, opts.center);
    if (km <= SANITY_RADIUS_KM && first.areaNames.some((n) => containsWord(cleaned, n))) {
      return first; // the address itself names the (different) city it matched
    }
    console.warn(`  ! "${raw}" -> "${first.matchedAddress}" is ${km.toFixed(0)} km from the conference center`);
  }

  if (!city) {
    if (first) console.warn(`  ! dropping "${raw}": out of range and no city to retry with`);
    return null;
  }
  const retryQuery = cityPresent ? cleaned : `${cleaned}, ${city}`;
  const retry = await queryMapbox(retryQuery, opts, true);
  if (!retry) return null;
  const coarse = retry.placeTypes.some((t) => COARSE_TYPES.has(t));
  const inputIsArea = bareCity || retry.text.toLowerCase() === seg;
  if (coarse && !inputIsArea) {
    console.warn(`  ! retry for "${raw}" only found "${retry.matchedAddress}" (area-level); dropping`);
    return null;
  }
  if (!isNearCenter(retry, opts.center, maxKm)) {
    console.warn(`  ! retry for "${raw}" still too far (${retry.matchedAddress}); dropping`);
    return null;
  }
  return retry;
}
