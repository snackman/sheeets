import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ addresses: {} });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data, error } = await supabase
      .from('geocoded_addresses')
      .select('normalized_address, lat, lng, matched_address');

    if (error) {
      console.error('Failed to fetch geocoded addresses:', error);
      return NextResponse.json({ addresses: {} });
    }

    const addresses: Record<string, { lat: number; lng: number; matchedAddress?: string }> = {};
    for (const row of data) {
      addresses[row.normalized_address] = {
        lat: row.lat,
        lng: row.lng,
        matchedAddress: row.matched_address || undefined,
      };
    }

    return NextResponse.json({ addresses });
  } catch (err) {
    console.error('Geocoded addresses API error:', err);
    return NextResponse.json({ addresses: {} });
  }
}
