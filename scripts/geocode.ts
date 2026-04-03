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
import { SHEET_ID, FALLBACK_TABS } from '../src/lib/constants';
import type { TabConfig } from '../src/lib/conferences';
import type { ConferenceConfig } from '../src/lib/types';
import { getActiveConferences, conferenceToTab } from '../src/lib/conferences';
import * as fs from 'fs';
import * as path from 'path';

const CACHE_FILE = path.join(__dirname, '..', 'src', 'data', 'geocoded-addresses.json');
const MAPBOX_TOKEN = process.env.MAPBOX_SECRET_TOKEN;

const STATIC_PROXIMITY: Record<string, { lat: number; lng: number; suffix: string }> = {
  'Denver':        { lat: 39.7392, lng: -104.9903, suffix: 'Denver, CO' },
  'Hong Kong':     { lat: 22.3193, lng: 114.1694, suffix: 'Hong Kong' },
  'San Francisco': { lat: 37.7749, lng: -122.4194, suffix: 'San Francisco, CA' },
  'GDC':           { lat: 37.7749, lng: -122.4194, suffix: 'San Francisco, CA' },
  'SXSW':          { lat: 30.2672, lng: -97.7431, suffix: 'Austin, TX' },
  'ETHCC':         { lat: 43.5528, lng: 7.0174,   suffix: 'Cannes, France' },
  'Paris':         { lat: 48.8566, lng: 2.3522,    suffix: 'Paris, France' },
  'PBW':           { lat: 48.8566, lng: 2.3522,    suffix: 'Paris, France' },
  'Las Vegas':     { lat: 36.1699, lng: -115.1398, suffix: 'Las Vegas, NV' },
  'Bitcoin':       { lat: 36.1699, lng: -115.1398, suffix: 'Las Vegas, NV' },
  'Miami':         { lat: 25.7617, lng: -80.1918,  suffix: 'Miami, FL' },
  'Consensus':     { lat: 25.7617, lng: -80.1918,  suffix: 'Miami, FL' },
};

function buildProximityCenters(tabs: TabConfig[]): Record<string, { lat: number; lng: number; suffix: string }> {
  const centers = { ...STATIC_PROXIMITY };
  for (const tab of tabs) {
    centers[tab.name] = { lat: tab.center.lat, lng: tab.center.lng, suffix: '' };
    centers[tab.slug] = { lat: tab.center.lat, lng: tab.center.lng, suffix: '' };
  }
  return centers;
}

function getProximity(tabName: string, proximityCenters: Record<string, { lat: number; lng: number; suffix: string }>) {
  if (proximityCenters[tabName]) return proximityCenters[tabName];
  for (const [key, val] of Object.entries(proximityCenters)) {
    if (tabName.includes(key)) return val;
  }
  return STATIC_PROXIMITY['Denver']; // fallback
}

interface GeocodedEntry {
  lat: number;
  lng: number;
  matchedAddress: string;
}

interface GeocodeCache {
  generatedAt: string;
  addresses: Record<string, GeocodedEntry>;
}

async function fetchConferenceTabs(): Promise<TabConfig[]> {
  // Try to fetch from Supabase
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.log('No Supabase credentials, using FALLBACK_TABS');
    return FALLBACK_TABS;
  }

  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/admin_config?key=eq.conferences&select=value`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
      }
    );

    if (!res.ok) {
      console.log('Supabase fetch failed, using FALLBACK_TABS');
      return FALLBACK_TABS;
    }

    const data = await res.json();
    if (!data[0]?.value) {
      console.log('No conferences config in Supabase, using FALLBACK_TABS');
      return FALLBACK_TABS;
    }

    const allConfs = data[0].value as ConferenceConfig[];
    const active = getActiveConferences(allConfs);
    const tabs = active.map(conferenceToTab);
    return tabs.length > 0 ? tabs : FALLBACK_TABS;
  } catch (err) {
    console.log('Failed to fetch from Supabase:', err);
    return FALLBACK_TABS;
  }
}

async function main() {
  if (!MAPBOX_TOKEN) {
    console.warn('Warning: MAPBOX_SECRET_TOKEN not set, skipping geocoding');
    process.exit(0);
  }

  // Fetch dynamic conferences
  const tabs = await fetchConferenceTabs();
  console.log(`Using ${tabs.length} conference tabs: ${tabs.map(t => t.name).join(', ')}`);
  const proximityCenters = buildProximityCenters(tabs);

  // 1. Fetch events from all tabs, tracking which tab each address came from
  console.log('Fetching events from Google Sheet...');
  const addressMap = new Map<string, string>(); // address -> tabName

  for (const tab of tabs) {
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
        if (address && !addressMap.has(address)) addressMap.set(address, tab.name);
      }
      if (table.rows.length < 500) break;
    }
  }

  console.log(`Found ${addressMap.size} unique addresses`);

  // 3. Load existing cache
  let cache: GeocodeCache = { generatedAt: '', addresses: {} };
  if (fs.existsSync(CACHE_FILE)) {
    cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    console.log(`Loaded ${Object.keys(cache.addresses).length} cached addresses`);
  }

  // 4. Geocode new addresses
  let geocoded = 0;
  let failed = 0;

  for (const [address, tabName] of addressMap) {
    const normalized = normalizeAddress(address);
    if (cache.addresses[normalized]) continue;

    const proximity = getProximity(tabName, proximityCenters);

    try {
      const query = proximity.suffix && !address.includes(proximity.suffix) ? `${address}, ${proximity.suffix}` : address;

      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${MAPBOX_TOKEN}&proximity=${proximity.lng},${proximity.lat}&limit=1`;

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

  console.log(`\nDone! New: ${geocoded}, Failed: ${failed}, Total cached: ${Object.keys(cache.addresses).length}`);
}

main();
