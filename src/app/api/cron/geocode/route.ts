// Forward-geocode missing addresses for every active conference and write
// the results to the shared `geocoded_addresses` table, so `fetchEvents()`
// (via `fetchEventsCached` -> `getRuntimeGeocodedAddresses`) picks them up
// on its very next read -- no redeploy, no prebuild bake required.
//
// Previous version of this route (audit findings, fixed here):
//   - Only looked at the hardcoded EVENT_TABS fallback (PBW/Bitcoin/
//     Consensus, all long past), never any conference actually in
//     Supabase's admin_config.
//   - `getProximity()` matched a tab's name against a few hardcoded city
//     keywords (Denver/Hong Kong/SF/SXSW/ETHCC) and fell back to Denver for
//     everything else -- i.e. every current conference, since none of them
//     match those keywords -- biasing every geocode toward Denver.
//   - Geocoding results were only logged, never written anywhere (not the
//     static JSON -- can't write to a file at runtime -- nor the
//     `geocoded_addresses` table), so the work was discarded every run.
//   - Depended on `VERCEL_DEPLOY_HOOK`, which isn't set, to even have a
//     chance of the (never-written) results reaching production.
//   - Compared the cron secret with plain `!==` instead of a timing-safe
//     comparison.
import { NextResponse, NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isCronSecret } from '@/lib/admin-auth';
import { getConferenceTabs } from '@/lib/get-conferences';
import { fetchEvents } from '@/lib/fetch-events';
import { getRuntimeGeocodedAddresses } from '@/lib/geocoded-addresses';
import { normalizeAddress } from '@/lib/utils';

export const runtime = 'nodejs';
export const maxDuration = 120;

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

interface MissingAddress {
  raw: string;
  normalized: string;
  conference: string;
  center: { lat: number; lng: number };
}

export async function GET(req: NextRequest) {
  if (!isCronSecret(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Local/manual testing only (not how Vercel Cron invokes this route): still
  // calls Mapbox for real so the response reports real geocode results, but
  // skips the `geocoded_addresses` write.
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
    return NextResponse.json({ totalEvents: events.length, missingAddresses: 0, geocoded: 0, failed: 0, dryRun });
  }

  const supabase = dryRun ? null : getSupabase();
  const geocoded: string[] = [];
  const failed: string[] = [];

  for (const { raw, normalized, conference, center } of missing.values()) {
    try {
      // Bias toward THIS conference's own center, not a hardcoded default --
      // the root cause of the old Denver bias.
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(raw)}.json?access_token=${token}&proximity=${center.lng},${center.lat}&limit=1`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) {
        failed.push(raw);
        continue;
      }
      const data = await res.json();
      const feature = data?.features?.[0];
      const coords = feature?.geometry?.coordinates;

      if (Array.isArray(coords) && coords.length >= 2) {
        const [lng, lat] = coords;
        geocoded.push(raw);
        if (supabase) {
          await supabase.from('geocoded_addresses').upsert({
            normalized_address: normalized,
            lat,
            lng,
            matched_address: feature?.place_name || raw,
            conference,
          });
        }
      } else {
        failed.push(raw);
      }

      // Stay well under Mapbox's rate limit.
      await new Promise((r) => setTimeout(r, 100));
    } catch {
      failed.push(raw);
    }
  }

  return NextResponse.json({
    totalEvents: events.length,
    missingAddresses: missing.size,
    geocoded: geocoded.length,
    failed: failed.length,
    dryRun,
  });
}
