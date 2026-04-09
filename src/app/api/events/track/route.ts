import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { parseBody } from '@/lib/api-validation';

const EventTrackSchema = z.object({
  event_id: z.string().min(1, 'event_id is required'),
  event_name: z.string().optional(),
  event_type: z.enum(['click', 'impression', 'pin-click']),
  conference: z.string().optional(),
  visitor_id: z.string().optional(),
  url: z.string().optional(),
  source: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(req: NextRequest) {
  const { data, error: parseError } = await parseBody(req, EventTrackSchema);
  if (parseError) return parseError;

  const supabase = getSupabase();

  const { error } = await supabase.from('event_tracking').insert({
    event_id: data.event_id,
    event_name: data.event_name || null,
    event_type: data.event_type,
    conference: data.conference || null,
    visitor_id: data.visitor_id || null,
    url: data.url || null,
    source: data.source || null,
    metadata: data.metadata || {},
  });

  if (error) {
    // If the table doesn't exist yet, silently accept (graceful degradation)
    if (error.code === '42P01') {
      return NextResponse.json({ success: true, note: 'table not yet created' });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
