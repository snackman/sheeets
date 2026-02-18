import { NextResponse } from 'next/server';
import { parseGVizResponse, getCellValue } from '@/lib/gviz';
import { normalizeAddress } from '@/lib/utils';
import { SHEET_ID, EVENT_TABS } from '@/lib/constants';
import geocodedData from '@/data/geocoded-addresses.json';

const PROXIMITY: Record<string, { lat: number; lng: number; suffix: string }> = {
  Denver: { lat: 39.7392, lng: -104.9903, suffix: 'Denver, CO' },
  'Hong Kong': { lat: 22.3193, lng: 114.1694, suffix: 'Hong Kong' },
};

function getProximity(tabName: string) {
  for (const [key, val] of Object.entries(PROXIMITY)) {
    if (tabName.includes(key)) return val;
  }
  return PROXIMITY.Denver;
}

export async function GET(req: Request) {
  // Verify cron secret to prevent unauthorized access
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const token = process.env.MAPBOX_SECRET_TOKEN || process.env.MAPBOX_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) {
    return NextResponse.json({ error: 'No Mapbox token configured' }, { status: 500 });
  }

  const deployHook = process.env.VERCEL_DEPLOY_HOOK;

  // 1. Fetch all addresses from the sheet
  const addressMap = new Map<string, string>();

  for (const tab of EVENT_TABS) {
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
        if (address && !addressMap.has(address)) {
          addressMap.set(address, tab.name);
        }
      }
      if (table.rows.length < 500) break;
    }
  }

  // 2. Find addresses not in the static cache
  const cached = geocodedData.addresses as Record<string, unknown>;
  const newAddresses: Array<{ raw: string; normalized: string; tabName: string }> = [];

  for (const [address, tabName] of addressMap) {
    const normalized = normalizeAddress(address);
    if (!cached[normalized]) {
      newAddresses.push({ raw: address, normalized, tabName });
    }
  }

  if (newAddresses.length === 0) {
    return NextResponse.json({ message: 'No new addresses', total: addressMap.size });
  }

  // 3. Geocode new addresses (log only — can't write to static file at runtime)
  const geocoded: string[] = [];
  const failed: string[] = [];

  for (const { raw, tabName } of newAddresses) {
    try {
      const prox = getProximity(tabName);
      const query = raw.includes(prox.suffix) ? raw : `${raw}, ${prox.suffix}`;
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${token}&proximity=${prox.lng},${prox.lat}&limit=1`;
      const res = await fetch(url);
      const data = await res.json();

      if (data.features?.length > 0) {
        geocoded.push(raw);
      } else {
        failed.push(raw);
      }

      await new Promise((r) => setTimeout(r, 100));
    } catch {
      failed.push(raw);
    }
  }

  // 4. Trigger a redeploy so prebuild bakes the new addresses into the static cache
  if (geocoded.length > 0 && deployHook) {
    await fetch(deployHook, { method: 'POST' });
  }

  return NextResponse.json({
    newAddresses: newAddresses.length,
    geocoded: geocoded.length,
    failed: failed.length,
    redeployTriggered: geocoded.length > 0 && !!deployHook,
  });
}
