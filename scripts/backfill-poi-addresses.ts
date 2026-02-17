/**
 * One-time backfill script to reverse-geocode existing POIs that have
 * incomplete addresses (missing street number).
 *
 * Usage:
 *   npx tsx scripts/backfill-poi-addresses.ts
 *
 * Required env vars:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   MAPBOX_SECRET_TOKEN  (or MAPBOX_TOKEN)
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MAPBOX_TOKEN = process.env.MAPBOX_SECRET_TOKEN || process.env.MAPBOX_TOKEN;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
if (!MAPBOX_TOKEN) {
  console.error('Missing MAPBOX_SECRET_TOKEN or MAPBOX_TOKEN');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/** Simple heuristic: address looks incomplete if it does NOT start with a digit. */
function looksIncomplete(address: string | null | undefined): boolean {
  if (!address || address.trim().length === 0) return true;
  return !/^\d/.test(address.trim());
}

/** Rate-limit helper: sleep for the given ms. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`  Mapbox returned ${res.status} for (${lat}, ${lng})`);
    return null;
  }
  const data = await res.json();
  const placeName: string | undefined = data.features?.[0]?.place_name;
  return placeName ?? null;
}

async function main() {
  console.log('Fetching POIs with lat/lng...');

  const { data: pois, error } = await supabase
    .from('pois')
    .select('id, name, lat, lng, address')
    .not('lat', 'is', null)
    .not('lng', 'is', null);

  if (error) {
    console.error('Error fetching POIs:', error.message);
    process.exit(1);
  }

  if (!pois || pois.length === 0) {
    console.log('No POIs found.');
    return;
  }

  console.log(`Found ${pois.length} POIs total.`);

  const toUpdate = pois.filter((p) => looksIncomplete(p.address));
  console.log(`${toUpdate.length} POIs have incomplete addresses and will be backfilled.\n`);

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const poi of toUpdate) {
    console.log(`[${updated + skipped + failed + 1}/${toUpdate.length}] ${poi.name} (id=${poi.id})`);
    console.log(`  Current address: ${poi.address || '(empty)'}`);

    const fullAddress = await reverseGeocode(poi.lat, poi.lng);

    if (!fullAddress) {
      console.log('  Could not reverse-geocode. Skipping.');
      failed++;
      await sleep(200);
      continue;
    }

    // Only update if the new address actually starts with a digit (has a street number)
    if (!/^\d/.test(fullAddress.trim())) {
      console.log(`  Reverse-geocoded address also lacks street number: "${fullAddress}". Skipping.`);
      skipped++;
      await sleep(200);
      continue;
    }

    console.log(`  New address: ${fullAddress}`);

    const { error: updateError } = await supabase
      .from('pois')
      .update({ address: fullAddress })
      .eq('id', poi.id);

    if (updateError) {
      console.error(`  Failed to update: ${updateError.message}`);
      failed++;
    } else {
      console.log('  Updated successfully.');
      updated++;
    }

    // Rate limit: wait 200ms between Mapbox requests
    await sleep(200);
  }

  console.log(`\nDone! Updated: ${updated}, Skipped: ${skipped}, Failed: ${failed}`);
}

main();
