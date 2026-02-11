/**
 * Build-time geocoding script
 * Fetches events, deduplicates addresses, geocodes via Mapbox, caches results
 *
 * Usage: npx tsx scripts/geocode.ts
 *
 * Requires MAPBOX_SECRET_TOKEN environment variable
 */

import { parseGVizResponse, getCellValue } from '../src/lib/gviz';
import { normalizeAddress } from '../src/lib/utils';
import { SHEET_ID, EVENT_TABS } from '../src/lib/constants';
import * as fs from 'fs';
import * as path from 'path';

const CACHE_FILE = path.join(__dirname, '..', 'src', 'data', 'geocoded-addresses.json');
const MAPBOX_TOKEN = process.env.MAPBOX_SECRET_TOKEN;
const DENVER_CENTER = { lat: 39.7392, lng: -104.9903 };

interface GeocodedEntry {
  lat: number;
  lng: number;
  matchedAddress: string;
}

interface GeocodeCache {
  generatedAt: string;
  addresses: Record<string, GeocodedEntry>;
}

async function main() {
  if (!MAPBOX_TOKEN) {
    console.error('Error: MAPBOX_SECRET_TOKEN environment variable is required');
    process.exit(1);
  }

  // 1. Fetch events from all tabs
  console.log('Fetching events from Google Sheet...');
  const addresses = new Set<string>();

  for (const tab of EVENT_TABS) {
    console.log(`  Fetching ${tab.name} (gid=${tab.gid})...`);
    for (let offset = 0; offset < 5000; offset += 500) {
      const tq = encodeURIComponent(`select * limit 500 offset ${offset}`);
      const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&gid=${tab.gid}&headers=1&tq=${tq}`;
      const response = await fetch(url);
      const text = await response.text();
      const table = parseGVizResponse(text);
      if (table.rows.length === 0) break;
      for (const row of table.rows) {
        if (!row.c) continue;
        const address = getCellValue(row.c[5]);
        if (address) addresses.add(address);
      }
      if (table.rows.length < 500) break;
    }
  }

  console.log(`Found ${addresses.size} unique addresses`);

  // 3. Load existing cache
  let cache: GeocodeCache = { generatedAt: '', addresses: {} };
  if (fs.existsSync(CACHE_FILE)) {
    cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    console.log(`Loaded ${Object.keys(cache.addresses).length} cached addresses`);
  }

  // 4. Geocode new addresses
  let geocoded = 0;
  let failed = 0;

  for (const address of addresses) {
    const normalized = normalizeAddress(address);
    if (cache.addresses[normalized]) continue;

    try {
      const query = address.includes('Denver') || address.includes('CO')
        ? address
        : `${address}, Denver, CO`;

      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${MAPBOX_TOKEN}&proximity=${DENVER_CENTER.lng},${DENVER_CENTER.lat}&limit=1`;

      const res = await fetch(url);
      const data = await res.json();

      if (data.features && data.features.length > 0) {
        const [lng, lat] = data.features[0].center;
        cache.addresses[normalized] = {
          lat,
          lng,
          matchedAddress: data.features[0].place_name,
        };
        geocoded++;
        console.log(`  + ${address} -> ${data.features[0].place_name}`);
      } else {
        failed++;
        console.log(`  x ${address} -> no results`);
      }

      // Rate limiting: 10 requests per second for Mapbox free tier
      await new Promise(r => setTimeout(r, 100));
    } catch (err) {
      failed++;
      console.error(`  x ${address} -> error: ${err}`);
    }
  }

  // 5. Save cache
  cache.generatedAt = new Date().toISOString();

  // Ensure directory exists
  const dir = path.dirname(CACHE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));

  console.log(`\nDone! Geocoded: ${geocoded}, Failed: ${failed}, Total cached: ${Object.keys(cache.addresses).length}`);
}

main();
