import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { parseBody, SubmissionActionSchema } from '@/lib/api-validation';
import { insertEventRowSorted, getSheetTitle } from '@/lib/google-sheets';
import { FALLBACK_TABS } from '@/lib/conferences';
import { getConferenceTabs } from '@/lib/get-conferences';
import { normalizeAddress } from '@/lib/utils';

const ADMIN_PASSWORD = 'trusttheplan';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(req: NextRequest) {
  const password = req.nextUrl.searchParams.get('password');
  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const status = req.nextUrl.searchParams.get('status') || 'pending';
  const conference = req.nextUrl.searchParams.get('conference') || '';

  const supabase = getSupabase();
  let query = supabase
    .from('event_submissions')
    .select('*')
    .order('created_at', { ascending: false });

  if (status !== 'all') {
    query = query.eq('status', status);
  }
  if (conference) {
    query = query.eq('conference', conference);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ submissions: data });
}

export async function POST(req: NextRequest) {
  const { data, error: parseError } = await parseBody(req, SubmissionActionSchema);
  if (parseError) return parseError;

  const { password, action, id, rejection_reason, edits } = data;

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabase();

  // Fetch the submission
  const { data: submission, error: fetchError } = await supabase
    .from('event_submissions')
    .select('*')
    .eq('id', id)
    .eq('status', 'pending')
    .single();

  if (fetchError || !submission) {
    return NextResponse.json(
      { error: 'Submission not found or already reviewed' },
      { status: 404 }
    );
  }

  if (action === 'reject') {
    const { error: updateError } = await supabase
      .from('event_submissions')
      .update({
        status: 'rejected',
        rejection_reason: rejection_reason || null,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('status', 'pending');

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, action: 'rejected' });
  }

  // Approve: merge edits, write to sheet
  const eventFields = {
    event_name: edits?.event_name ?? submission.event_name,
    event_date: edits?.event_date ?? submission.event_date,
    start_time: edits?.start_time ?? submission.start_time,
    end_time: edits?.end_time ?? submission.end_time,
    organizer: edits?.organizer ?? submission.organizer,
    address: edits?.address ?? submission.address,
    cost: edits?.cost ?? submission.cost,
    tags: edits?.tags ?? submission.tags,
    link: edits?.link ?? submission.link,
    has_food: edits?.has_food ?? submission.has_food,
    has_bar: edits?.has_bar ?? submission.has_bar,
    note: edits?.note ?? submission.note,
  };

  // Resolve conference to sheet tab
  let tabs = FALLBACK_TABS;
  try {
    tabs = await getConferenceTabs();
  } catch { /* use fallback */ }

  const tab = tabs.find((t) => t.name === submission.conference);
  if (!tab) {
    return NextResponse.json(
      { error: `Conference tab not found: ${submission.conference}` },
      { status: 400 }
    );
  }

  try {
    const sheetName = await getSheetTitle(tab.gid);
    const sheetRow = await insertEventRowSorted(sheetName, tab.gid, {
      date: eventFields.event_date,
      startTime: eventFields.start_time,
      endTime: eventFields.end_time,
      organizer: eventFields.organizer,
      name: eventFields.event_name,
      address: eventFields.address,
      cost: eventFields.cost,
      tags: eventFields.tags,
      link: eventFields.link,
      food: eventFields.has_food,
      bar: eventFields.has_bar,
      note: eventFields.note,
    });

    // Upsert geocoded address if coords exist
    if (submission.coords_lat && submission.coords_lng && eventFields.address) {
      try {
        await supabase.from('geocoded_addresses').upsert({
          normalized_address: normalizeAddress(eventFields.address),
          lat: submission.coords_lat,
          lng: submission.coords_lng,
          matched_address: eventFields.address,
          conference: submission.conference,
        });
      } catch (geoErr) {
        console.error('Failed to save geocoded address:', geoErr);
      }
    }

    // Update submission status
    const { error: updateError } = await supabase
      .from('event_submissions')
      .update({
        status: 'approved',
        reviewed_at: new Date().toISOString(),
        sheet_row: sheetRow,
      })
      .eq('id', id)
      .eq('status', 'pending');

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, action: 'approved', sheet_row: sheetRow });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: `Failed to write to sheet: ${message}` },
      { status: 500 }
    );
  }
}
