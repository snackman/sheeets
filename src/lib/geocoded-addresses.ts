import { createClient } from '@supabase/supabase-js';
import type { GeoAddressMap } from './fetch-events';

/**
 * Server-side: read the full `geocoded_addresses` table -- the shared
 * "runtime" cache that ingestion, submission approval, and the
 * `/api/cron/geocode` cron all write exact coordinates to (see
 * `src/lib/ingest/filters.ts`'s `upsertGeocodedAddress`/
 * `geocodeAddressCached`, and `src/app/api/admin/submissions/route.ts`) --
 * as a `GeoAddressMap` keyed by normalized address, in exactly the shape
 * `fetchEvents()` expects for its `runtimeAddresses` parameter.
 *
 * `fetchEvents()` already prefers `runtimeAddresses` over the baked
 * `geocoded-addresses.json` static cache, but nothing was ever calling it
 * with this table's data -- every address geocoded since the last
 * `npm run build` (prebuild bakes the static file) was effectively
 * discarded for map-pin purposes. This is the fix: `fetchEventsCached()`
 * and the geocode cron both call this and pass the result through.
 *
 * Service-role client: this only ever runs server-side.
 */
export async function getRuntimeGeocodedAddresses(): Promise<GeoAddressMap> {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const { data, error } = await supabase
      .from('geocoded_addresses')
      .select('normalized_address, lat, lng, matched_address');

    if (error || !data) return {};

    const map: GeoAddressMap = {};
    for (const row of data) {
      map[row.normalized_address] = {
        lat: row.lat,
        lng: row.lng,
        matchedAddress: row.matched_address || undefined,
      };
    }
    return map;
  } catch {
    return {};
  }
}
