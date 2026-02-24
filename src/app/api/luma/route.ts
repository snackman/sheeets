import { NextRequest, NextResponse } from 'next/server';

/** Extract the slug from a Luma URL (lu.ma/xxx or luma.com/xxx) */
function getLumaSlug(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === 'lu.ma' || u.hostname === 'luma.com' || u.hostname === 'www.luma.com') {
      const slug = u.pathname.replace(/^\//, '').split('/')[0];
      return slug || null;
    }
  } catch {
    // invalid URL
  }
  return null;
}

/** Format a date in the event's timezone as "Feb 16" */
function formatDate(isoDate: string, timezone: string): string {
  try {
    const d = new Date(isoDate);
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: timezone,
    });
  } catch {
    return '';
  }
}

/** Format a time in the event's timezone as "7:00 PM" */
function formatTime(isoDate: string, timezone: string): string {
  try {
    const d = new Date(isoDate);
    return d.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: timezone,
    });
  } catch {
    return '';
  }
}

/** Parse cost from ticket_price_cents */
function formatCost(priceCents: number | null | undefined): string {
  if (!priceCents || priceCents === 0) return 'Free';
  const dollars = priceCents / 100;
  return `$${dollars % 1 === 0 ? dollars.toFixed(0) : dollars.toFixed(2)}`;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url } = body;

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    const slug = getLumaSlug(url.trim());
    if (!slug) {
      return NextResponse.json(
        { error: 'Invalid Luma URL. Please provide a lu.ma or luma.com link.' },
        { status: 400 }
      );
    }

    const res = await fetch(`https://api.lu.ma/url?url=${encodeURIComponent(slug)}`, {
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: 'Could not fetch event from Luma. Please check the URL.' },
        { status: 422 }
      );
    }

    const data = await res.json();

    if (data.kind !== 'event' || !data.data?.event) {
      return NextResponse.json(
        { error: 'URL does not point to a Luma event.' },
        { status: 422 }
      );
    }

    const event = data.data.event;
    const timezone = event.timezone || 'America/Denver';

    // Parse address from geo_address_json
    let address = '';
    if (event.geo_address_json) {
      try {
        const geo = typeof event.geo_address_json === 'string'
          ? JSON.parse(event.geo_address_json)
          : event.geo_address_json;
        address = geo.full_address || geo.address || '';
      } catch {
        // ignore parse errors
      }
    }

    // Get organizer from hosts
    const organizer = data.data.hosts?.[0]?.name || '';

    // Format cost
    const cost = formatCost(event.ticket_price_cents);

    return NextResponse.json({
      name: event.name || '',
      date: formatDate(event.start_at, timezone),
      startTime: formatTime(event.start_at, timezone),
      endTime: event.end_at ? formatTime(event.end_at, timezone) : '',
      address,
      organizer,
      cost,
      link: url.trim(),
      tags: '',
    });
  } catch (err) {
    console.error('Luma API error:', err);
    return NextResponse.json(
      { error: 'Failed to fetch event details. Please try again.' },
      { status: 500 }
    );
  }
}
