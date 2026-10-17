// Forward-geocode missing addresses for every active conference and write
// the results to the shared `geocoded_addresses` table, so `fetchEvents()`
// (via `fetchEventsCached` -> `getRuntimeGeocodedAddresses`) picks them up
// on its very next read -- no redeploy, no prebuild bake required.
//
// Original version of this route (audit findings, fixed in the first pass):
//   - Only looked at the hardcoded EVENT_TABS fallback, never any
//     conference actually in Supabase's admin_config.
//   - `getProximity()` fell back to Denver proximity bias for every
//     conference that didn't match a few hardcoded city keywords -- i.e.
//     every current one.
//   - Geocoding results were only logged, never written anywhere.
//   - Depended on the unset `VERCEL_DEPLOY_HOOK`.
//   - Compared the cron secret with plain `!==` instead of timing-safe.
//
// Second pass (PR review findings, HIGH):
//   - Every upsert into `geocoded_addresses` sent a `conference` column
//     prod's table didn't actually have (migration drift -- see
//     supabase/migrations/20261018130000_geocoded_addresses_add_conference.sql).
//     Supabase's client doesn't throw on a PostgREST error, so the
//     write's failure was completely silent: this cron re-geocoded every
//     missing address every 30 minutes, forever, and stored nothing.
//     Fixed by writeGeocodedAddress() (src/lib/geocoded-addresses.ts),
//     which checks `{ error }` and logs on failure.
//   - No cap on Mapbox calls per run, and no backoff for an address that
//     genuinely can't be geocoded (a "TBA" placeholder, a URL left in the
//     address field, ...) -- every such address was retried every run
//     forever. Fixed with MAX_MAPBOX_CALLS_PER_RUN and a negative-result
//     cache (geocode_failures table) with a retry-after window.
import { NextResponse, NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isCronSecret } from '@/lib/admin-auth';
import { getConferenceTabs } from '@/lib/get-conferences';
import { fetchEvents } from '@/lib/fetch-events';
import { getRuntimeGeocodedAddresses, writeGeocodedAddress } from '@/lib/geocoded-addresses';
import { selectAddressesToAttempt, type MissingAddress } from '@/lib/geocode-selection';
import { normalizeAddress } from '@/lib/utils';

export const runtime = 'nodejs';
export const maxDuration = 120;

/** Stay well under Vercel's function timeout and Mapbox's own rate limit. */
const MAX_MAPBOX_CALLS_PER_RUN = 40;

/**
 * How long to leave a failed address alone before retrying it. Most
 * failures here are permanent (a placeholder like "TBA", a URL
 * accidentally left in the address field) -- retrying every 30 minutes
 * forever wastes Mapbox calls for addresses that will never resolve.
 */
const GEOCODE_FAILURE_RETRY_AFTER_MS = 24 * 60 * 60 * 1000; // 24h

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(req: NextRequest) {
  if (!isCronSecret(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Local/manual testing only (not how Vercel Cron invokes this route): still
  // calls Mapbox for real so the response reports real geocode results, but
  // skips the `geocoded_addresses`/`geocode_failures` writes.
  const dryRun = req.nextUrl.searchParams.get('dryRun') === '1';

  const token = process.env.MAPBOX_SECRET_TOKEN || process.env.MAPBOX_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) {
    return NextResponse.json({ error: 'No Mapbox token configured' }, { status: 500 });
  }

  // 1. Every active conference (not hidden, not past) and every event for
  //    them, with whatever coordinates they already have (static JSON bake
  //    + the runtime `geocoded_addresses` cache both merged by
  //    `fetchEvents`).
  const [tabs, runtimeAddresses] = await Promise.all([
    getConferenceTabs(),
    getRuntimeGeocodedAddresses(),
  ]);
  const tabByName = new Map(tabs.map((t) => [t.name, t]));
  const events = await fetchEvents(runtimeAddresses, tabs);

  // 2. Events with an address but no coordinates. Dedupe by (conference,
  //    normalized address) so a venue reused across many events only costs
  //    one Mapbox call.
  const missing = new Map<string, MissingAddress>();
  for (const event of events) {
    if (!event.address?.trim() || event.lat != null) continue;
    const tab = tabByName.get(event.conference);
    if (!tab) continue;
    const normalized = normalizeAddress(event.address);
    const key = `${event.conference}|${normalized}`;
    if (!missing.has(key)) {
      missing.set(key, { raw: event.address, normalized, conference: event.conference, center: tab.center });
    }
  }

  if (missing.size === 0) {
    return NextResponse.json({ totalEvents: events.length, missingAddresses: 0, geocoded: 0, failed: 0, writeErrors: 0, skippedCooldown: 0, dryRun });
  }

  const supabase = getSupabase();

  // 3. Skip any address that failed recently (within the retry-after
  //    window) instead of re-calling Mapbox for it every run.
  const normalizedAddresses = [...new Set([...missing.values()].map((m) => m.normalized))];
  const cooldownCutoff = new Date(Date.now() - GEOCODE_FAILURE_RETRY_AFTER_MS).toISOString();
  const skip = new Set<string>();
  {
    const { data: recentFailures, error } = await supabase
      .from('geocode_failures')
      .select('normalized_address')
      .in('normalized_address', normalizedAddresses)
      .gt('last_attempt_at', cooldownCutoff);
    if (error) {
      console.error('Failed to read geocode_failures cooldown:', error.message);
    } else {
      for (const row of recentFailures ?? []) skip.add(row.normalized_address);
    }
  }

  const { attempted, skippedCooldown } = selectAddressesToAttempt([...missing.values()], skip, MAX_MAPBOX_CALLS_PER_RUN);

  const geocoded: string[] = [];
  const failed: string[] = [];
  let writeErrors = 0;

  for (const { raw, normalized, conference, center } of attempted) {
    try {
      // Bias toward THIS conference's own center, not a hardcoded default --
      // the root cause of the old Denver bias.
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(raw)}.json?access_token=${token}&proximity=${center.lng},${center.lat}&limit=1`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) {
        failed.push(raw);
        if (!dryRun) await recordFailure(supabase, normalized, conference);
        continue;
      }
      const data = await res.json();
      const feature = data?.features?.[0];
      const coords = feature?.geometry?.coordinates;

      if (Array.isArray(coords) && coords.length >= 2) {
        const [lng, lat] = coords;
        geocoded.push(raw);
        if (!dryRun) {
          const result = await writeGeocodedAddress(supabase, {
            address: raw,
            lat,
            lng,
            conference,
            matchedAddress: feature?.place_name || raw,
          });
          if (!result.ok) writeErrors++;
          // Clean up any stale failure row now that this address resolved.
          await supabase.from('geocode_failures').delete().eq('normalized_address', normalized);
        }
      } else {
        failed.push(raw);
        if (!dryRun) await recordFailure(supabase, normalized, conference);
      }

      // Stay well under Mapbox's rate limit.
      await new Promise((r) => setTimeout(r, 100));
    } catch {
      failed.push(raw);
      if (!dryRun) await recordFailure(supabase, normalized, conference);
    }
  }

  return NextResponse.json({
    totalEvents: events.length,
    missingAddresses: missing.size,
    skippedCooldown,
    attempted: attempted.length,
    geocoded: geocoded.length,
    failed: failed.length,
    writeErrors,
    dryRun,
  });
}

/** Best-effort negative-result cache write; logs on failure rather than throwing. */
async function recordFailure(
  supabase: ReturnType<typeof getSupabase>,
  normalizedAddress: string,
  conference: string
): Promise<void> {
  const { error } = await supabase.from('geocode_failures').upsert({
    normalized_address: normalizedAddress,
    conference,
    last_attempt_at: new Date().toISOString(),
  });
  if (error) {
    console.error(`Failed to record geocode_failures for "${normalizedAddress}":`, error.message);
  }
}
