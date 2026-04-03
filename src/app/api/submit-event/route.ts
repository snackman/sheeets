import { NextRequest, NextResponse } from 'next/server';
import { appendEventRow } from '@/lib/google-sheets';
import { FALLBACK_TABS } from '@/lib/conferences';
import { getConferenceTabs } from '@/lib/get-conferences';
import { parseBody, SubmitEventSchema } from '@/lib/api-validation';
import { normalizeAddress } from '@/lib/utils';
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

    // Upsert geocoded address to Supabase for instant map pin display
    if (coords && event.address.trim()) {
      try {
        const supabase = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!
        );
        await supabase.from('geocoded_addresses').upsert({
          normalized_address: normalizeAddress(event.address.trim()),
          lat: coords.lat,
          lng: coords.lng,
          matched_address: event.address.trim(),
          conference,
        });
      } catch (geoErr) {
        // Non-fatal: log but don't fail the submission
        console.error('Failed to save geocoded address:', geoErr);
      }
    }

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
