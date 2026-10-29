import { NextResponse } from 'next/server';
import { getPublicGeocodedAddressesCached } from '@/lib/geocoded-addresses';

export async function GET() {
  try {
    const addresses = await getPublicGeocodedAddressesCached();
    return NextResponse.json({ addresses }, {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
      },
    });
  } catch (err) {
    console.error('Geocoded addresses API error:', err);
    return NextResponse.json({ addresses: {} });
  }
}
