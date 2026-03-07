import { NextRequest, NextResponse } from 'next/server';
import { parseBody, LumaSchema } from '@/lib/api-validation';

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

/** Format a UTC ISO date as "YYYY-MM-DD" in the event's timezone */
function formatDateISO(isoDate: string, timezone: string): string {
  try {
    const d = new Date(isoDate);
    const parts = d.toLocaleDateString('en-CA', { timeZone: timezone }).split('-');
    return parts.join('-'); // "2026-03-10"
  } catch {
    return '';
  }
}

/** Format a UTC ISO date as "HH:mm" (24h) in the event's timezone */
function formatTime24(isoDate: string, timezone: string): string {
  try {
    const d = new Date(isoDate);
    return d.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
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
    const { data, error } = await parseBody(request, LumaSchema);
    if (error) return error;

    const { url } = data;

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

    const lumaData = await res.json();

    if (lumaData.kind !== 'event' || !lumaData.data?.event) {
      return NextResponse.json(
        { error: 'URL does not point to a Luma event.' },
        { status: 422 }
      );
    }

    const event = lumaData.data.event;
    const timezone = event.timezone || 'America/Denver';

    // Parse address from geo_address_json, fall back to geo_address_info
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
    if (!address && event.geo_address_info) {
      const info = typeof event.geo_address_info === 'string'
        ? JSON.parse(event.geo_address_info)
        : event.geo_address_info;
      address = info.full_address || info.city_state || info.city || '';
    }

    // Get organizer from hosts
    const organizer = lumaData.data.hosts?.[0]?.name || '';

    // Format cost
    const cost = formatCost(event.ticket_price_cents);

    return NextResponse.json({
      name: event.name || '',
      dateISO: formatDateISO(event.start_at, timezone),
      startTime24: formatTime24(event.start_at, timezone),
      endTime24: event.end_at ? formatTime24(event.end_at, timezone) : '',
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
