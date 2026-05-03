import { NextRequest, NextResponse } from 'next/server';
import { FALLBACK_TABS } from '@/lib/conferences';
import { getConferenceTabs } from '@/lib/get-conferences';
import { parseBody, SubmitEventSchema } from '@/lib/api-validation';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: NextRequest) {
  try {
    const { data, error } = await parseBody(request, SubmitEventSchema);
    if (error) return error;

    const { conference, coords, event } = data;

    // Try dynamic conferences, fall back to hardcoded
    let tabs = FALLBACK_TABS;
    try {
      tabs = await getConferenceTabs();
    } catch {
      // Use fallback
    }

    const tab = tabs.find((t) => t.name === conference);
    if (!tab) {
      return NextResponse.json(
        { error: `Invalid conference: ${conference}. Valid options: ${tabs.map((t) => t.name).join(', ')}` },
        { status: 400 }
      );
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { error: insertError } = await supabase
      .from('event_submissions')
      .insert({
        conference,
        event_name: event.name.trim(),
        event_date: event.date.trim(),
        start_time: event.startTime.trim(),
        end_time: event.endTime.trim(),
        organizer: event.organizer.trim(),
        address: event.address.trim(),
        cost: event.cost.trim(),
        tags: event.tags.trim(),
        link: event.link.trim(),
        has_food: event.food,
        has_bar: event.bar,
        note: event.note.trim(),
        coords_lat: coords?.lat ?? null,
        coords_lng: coords?.lng ?? null,
      });

    if (insertError) {
      console.error('Failed to insert submission:', insertError);
      return NextResponse.json(
        { error: `Failed to submit event: ${insertError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, pending: true });
  } catch (err) {
    console.error('Submit event error:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: `Failed to submit event: ${message}` },
      { status: 500 }
    );
  }
}
