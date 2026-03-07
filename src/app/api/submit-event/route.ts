import { NextRequest, NextResponse } from 'next/server';
import { appendEventRow } from '@/lib/google-sheets';
import { EVENT_TABS } from '@/lib/conferences';
import { parseBody, SubmitEventSchema } from '@/lib/api-validation';

export async function POST(request: NextRequest) {
  try {
    const { data, error } = await parseBody(request, SubmitEventSchema);
    if (error) return error;

    const { conference, event } = data;

    const tab = EVENT_TABS.find((t) => t.name === conference);
    if (!tab) {
      return NextResponse.json(
        { error: `Invalid conference: ${conference}. Valid options: ${EVENT_TABS.map((t) => t.name).join(', ')}` },
        { status: 400 }
      );
    }

    const row = await appendEventRow(tab.name, {
      date: event.date.trim(),
      startTime: event.startTime.trim(),
      endTime: event.endTime.trim(),
      organizer: event.organizer.trim(),
      name: event.name.trim(),
      address: event.address.trim(),
      cost: event.cost.trim(),
      tags: event.tags.trim(),
      link: event.link.trim(),
      food: event.food,
      bar: event.bar,
      note: event.note.trim(),
    });

    return NextResponse.json({ success: true, row });
  } catch (err) {
    console.error('Submit event error:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: `Failed to submit event: ${message}` },
      { status: 500 }
    );
  }
}
