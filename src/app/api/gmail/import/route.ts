import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getAuthenticatedUser } from '@/lib/gmail/server-auth';
import type { ImportEventPayload } from '@/lib/gmail/types';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(req: NextRequest) {
  try {
    const { user, error } = await getAuthenticatedUser(req);
    if (error) return error;

    const userId = user!.id;
    const body = await req.json();
    const events: ImportEventPayload[] = body.events;

    if (!Array.isArray(events) || events.length === 0) {
      return NextResponse.json(
        { error: 'No events provided' },
        { status: 400 }
      );
    }

    const supabase = getSupabase();
    let imported = 0;
    let skipped = 0;

    for (const event of events) {
      // Upsert the event (update if external_event_key already exists)
      const { data: upserted, error: eventError } = await supabase
        .from('imported_events')
        .upsert(
          {
            user_id: userId,
            source: 'gmail_luma',
            external_event_key: event.externalEventKey,
            event_name: event.eventName,
            event_start_at: event.eventStartAt,
            event_end_at: event.eventEndAt,
            location_raw: event.locationRaw,
            location_normalized: event.locationRaw, // Same as raw for MVP
            event_url: event.eventUrl,
            status: event.status,
            parse_confidence: event.parseConfidence,
            first_seen_at: event.firstSeenAt,
            last_seen_at: event.lastSeenAt,
            updated_at: new Date().toISOString(),
          },
          {
            onConflict: 'user_id,external_event_key',
          }
        )
        .select('id')
        .single();

      if (eventError || !upserted) {
        console.error('Failed to upsert event:', eventError);
        skipped++;
        continue;
      }

      // Insert source references
      for (const source of event.sources) {
        await supabase.from('imported_event_sources').upsert(
          {
            imported_event_id: upserted.id,
            gmail_message_id: source.gmailMessageId,
            gmail_thread_id: source.gmailThreadId,
            message_type: source.hadIcs ? 'calendar_invite' : 'unknown',
            sender: source.sender,
            subject: source.subject,
            received_at: source.receivedAt,
            had_ics: source.hadIcs,
          },
          {
            onConflict: 'id', // No real conflict expected, just insert
            ignoreDuplicates: true,
          }
        );
      }

      imported++;
    }

    return NextResponse.json({
      success: true,
      imported,
      skipped,
    });
  } catch (err) {
    console.error('Gmail import error:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: `Import failed: ${message}` },
      { status: 500 }
    );
  }
}
