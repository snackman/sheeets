import { NextRequest, NextResponse } from 'next/server';
import { appendEventRow } from '@/lib/google-sheets';
import { EVENT_TABS } from '@/lib/constants';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { conference, event } = body;

    // Validate conference
    if (!conference || typeof conference !== 'string') {
      return NextResponse.json({ error: 'Conference is required' }, { status: 400 });
    }

    const tab = EVENT_TABS.find((t) => t.name === conference);
    if (!tab) {
      return NextResponse.json(
        { error: `Invalid conference: ${conference}. Valid options: ${EVENT_TABS.map((t) => t.name).join(', ')}` },
        { status: 400 }
      );
    }

    // Validate required fields
    if (!event || typeof event !== 'object') {
      return NextResponse.json({ error: 'Event data is required' }, { status: 400 });
    }

    if (!event.name || typeof event.name !== 'string' || !event.name.trim()) {
      return NextResponse.json({ error: 'Event name is required' }, { status: 400 });
    }

    if (!event.date || typeof event.date !== 'string' || !event.date.trim()) {
      return NextResponse.json({ error: 'Event date is required' }, { status: 400 });
    }

    const row = await appendEventRow(tab.name, {
      date: event.date.trim(),
      startTime: (event.startTime || '').trim(),
      endTime: (event.endTime || '').trim(),
      organizer: (event.organizer || '').trim(),
      name: event.name.trim(),
      address: (event.address || '').trim(),
      cost: (event.cost || 'Free').trim(),
      tags: (event.tags || '').trim(),
      link: (event.link || '').trim(),
      food: !!event.food,
      bar: !!event.bar,
      note: (event.note || '').trim(),
    });

    return NextResponse.json({ success: true, row });
  } catch (err) {
    console.error('Submit event error:', err);
    return NextResponse.json(
      { error: 'Failed to submit event. Please try again.' },
      { status: 500 }
    );
  }
}
