import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { GeoAddressMap } from './fetch-events';
import { normalizeAddress } from './utils';

const PAGE_SIZE = 1000;

/**
 * Server-side: read the full `geocoded_addresses` table -- the shared
 * "runtime" cache that ingestion, submission approval, and the
 * `/api/cron/geocode` cron all write exact coordinates to (see
 * `writeGeocodedAddress` below, used by `src/lib/ingest/filters.ts` and
 * `src/app/api/admin/submissions/route.ts`) -- as a `GeoAddressMap` keyed
 * by normalized address, in exactly the shape `fetchEvents()` expects for
 * its `runtimeAddresses` parameter.
 *
 * `fetchEvents()` already prefers `runtimeAddresses` over the baked
 * `geocoded-addresses.json` static cache, but nothing was ever calling it
 * with this table's data -- every address geocoded since the last
 * `npm run build` (prebuild bakes the static file) was effectively
 * discarded for map-pin purposes. This is the fix: `fetchEventsCached()`
 * and the geocode cron both call this and pass the result through.
 *
 * Paginates past PostgREST's default 1000-row page size (review finding,
 * LOW) -- the table already has hundreds of rows, so a single
 * unpaginated `select` would silently drop addresses once it grows past
 * 1000.
 *
 * Service-role client: this only ever runs server-side.
 */
export async function getRuntimeGeocodedAddresses(): Promise<GeoAddressMap> {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const map: GeoAddressMap = {};
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await supabase
        .from('geocoded_addresses')
        .select('normalized_address, lat, lng, matched_address')
        .range(offset, offset + PAGE_SIZE - 1);

      if (error) break;
      if (!data || data.length === 0) break;

      for (const row of data) {
        map[row.normalized_address] = {
          lat: row.lat,
          lng: row.lng,
          matchedAddress: row.matched_address || undefined,
        };
      }

      if (data.length < PAGE_SIZE) break;
    }
    return map;
  } catch {
    return {};
  }
}

export interface GeocodedAddressWrite {
  address: string;
  lat: number;
  lng: number;
  conference: string;
  matchedAddress?: string;
}

/**
 * Upsert one row into the shared `geocoded_addresses` runtime cache.
 *
 * Checks `{ error }` on the write (review finding, HIGH). Supabase's JS
 * client does NOT throw on a PostgREST error (e.g. PGRST204, "column does
 * not exist") -- it resolves normally with `{ data: null, error }` -- so
 * every prior caller here only wrapped the call in try/catch, which never
 * fires for this class of failure. That's exactly how prod ended up with
 * zero new rows for months: the original migration never actually added
 * a `conference` column in prod, every upsert sent one anyway, PostgREST
 * rejected it, and nothing noticed. Logs on failure so a future schema
 * drift is loud instead of silent.
 *
 * Returns whether the write succeeded; every current caller treats this
 * as best-effort (a bad map pin is not worth failing a publish/approve or
 * a cron run over), but now at least logs instead of swallowing the
 * error. Never throws/rejects -- a thrown error (e.g. a network failure)
 * is caught and reported the same way as a returned `{ error }`, so every
 * caller can safely treat this as a non-throwing best-effort write without
 * its own try/catch.
 */
export async function writeGeocodedAddress(
  supabase: SupabaseClient,
  write: GeocodedAddressWrite
): Promise<{ ok: true } | { ok: false; error: string }> {
  const trimmed = write.address.trim();
  if (!trimmed) return { ok: false, error: 'empty address' };

  try {
    const { error } = await supabase.from('geocoded_addresses').upsert({
      normalized_address: normalizeAddress(trimmed),
      lat: write.lat,
      lng: write.lng,
      matched_address: write.matchedAddress || trimmed,
      conference: write.conference,
    });

    if (error) {
      console.error(`writeGeocodedAddress failed for "${trimmed}":`, error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`writeGeocodedAddress threw for "${trimmed}":`, message);
    return { ok: false, error: message };
  }
}
