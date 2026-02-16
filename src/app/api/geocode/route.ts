import { NextRequest, NextResponse } from 'next/server';

const PROXIMITY: Record<string, { lat: number; lng: number; suffix: string }> = {
  Denver: { lat: 39.7392, lng: -104.9903, suffix: 'Denver, CO' },
  'Hong Kong': { lat: 22.3193, lng: 114.1694, suffix: 'Hong Kong' },
};

function getProximity(conference: string) {
  for (const [key, val] of Object.entries(PROXIMITY)) {
    if (conference.includes(key)) return val;
  }
  return PROXIMITY.Denver;
}

export async function POST(req: NextRequest) {
  const token = process.env.MAPBOX_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) {
    return NextResponse.json({ error: 'Mapbox token not configured' }, { status: 500 });
  }

  const { addresses } = (await req.json()) as {
    addresses: Array<{ normalized: string; raw: string; conference: string }>;
  };

  if (!addresses || !Array.isArray(addresses)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  // Cap at 25 addresses per request to avoid abuse
  const batch = addresses.slice(0, 25);
  const results: Record<string, { lat: number; lng: number }> = {};

  for (const { normalized, raw, conference } of batch) {
    try {
      const prox = getProximity(conference);
      const query = raw.includes(prox.suffix) ? raw : `${raw}, ${prox.suffix}`;
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
