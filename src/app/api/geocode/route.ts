import { NextRequest, NextResponse } from 'next/server';
import { parseBody, GeocodeSchema } from '@/lib/api-validation';
import { FALLBACK_TABS } from '@/lib/conferences';
import { getConferenceTabs } from '@/lib/get-conferences';
import type { TabConfig } from '@/lib/conferences';

// Static fallback proximity entries for common city name matches
const STATIC_PROXIMITY: Record<string, { lat: number; lng: number; suffix: string }> = {
  Denver: { lat: 39.7392, lng: -104.9903, suffix: 'Denver, CO' },
  'Hong Kong': { lat: 22.3193, lng: 114.1694, suffix: 'Hong Kong' },
  Paris: { lat: 48.8566, lng: 2.3522, suffix: 'Paris, France' },
  'Las Vegas': { lat: 36.1699, lng: -115.1398, suffix: 'Las Vegas, NV' },
  Miami: { lat: 25.7617, lng: -80.1918, suffix: 'Miami, FL' },
};

function buildProximityMap(tabs: TabConfig[]): Record<string, { lat: number; lng: number; suffix: string }> {
  // Build proximity entries from dynamic conference data
  // Use conference name and slug as keys
  const map: Record<string, { lat: number; lng: number; suffix: string }> = { ...STATIC_PROXIMITY };
  for (const tab of tabs) {
    // Use conference name as key (fuzzy matching via includes in getProximity)
    map[tab.name] = { lat: tab.center.lat, lng: tab.center.lng, suffix: '' };
    map[tab.slug] = { lat: tab.center.lat, lng: tab.center.lng, suffix: '' };
  }
  return map;
}

function getProximity(conference: string, proximityMap: Record<string, { lat: number; lng: number; suffix: string }>) {
  // Direct match first
  if (proximityMap[conference]) return proximityMap[conference];
  // Fuzzy match — check if conference name contains any key
  for (const [key, val] of Object.entries(proximityMap)) {
    if (conference.includes(key)) return val;
  }
  return STATIC_PROXIMITY.Denver;
}

export async function POST(req: NextRequest) {
  const token = process.env.MAPBOX_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) {
    return NextResponse.json({ error: 'Mapbox token not configured' }, { status: 500 });
  }

  const { data, error } = await parseBody(req, GeocodeSchema);
  if (error) return error;

  const { addresses } = data;

  // Fetch dynamic conferences for proximity data
  let tabs = FALLBACK_TABS;
  try {
    tabs = await getConferenceTabs();
  } catch {
    // Use fallback
  }
  const proximityMap = buildProximityMap(tabs);

  // Cap at 25 addresses per request to avoid abuse
  const batch = addresses.slice(0, 25);
  const results: Record<string, { lat: number; lng: number }> = {};

  for (const { normalized, raw, conference } of batch) {
    try {
      const prox = getProximity(conference, proximityMap);
      const query = prox.suffix && !raw.includes(prox.suffix) ? `${raw}, ${prox.suffix}` : raw;
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${token}&proximity=${prox.lng},${prox.lat}&limit=1`;

      const res = await fetch(url);
      const data = await res.json();

      if (data.features?.length > 0) {
        const [lng, lat] = data.features[0].center;
        results[normalized] = { lat, lng };
      }

      // Small delay to respect rate limits
      await new Promise((r) => setTimeout(r, 50));
    } catch {
      // Skip failed geocodes silently
    }
  }

  return NextResponse.json({ results });
}
