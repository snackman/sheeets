import { NextResponse } from 'next/server';
import { fetchEventsCached } from '@/lib/fetch-events-cached';

export async function GET() {
  try {
    const events = await fetchEventsCached();
    return NextResponse.json(events, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    });
  } catch (err) {
    console.error('Events API error:', err);
    return NextResponse.json([], { status: 500 });
  }
}
