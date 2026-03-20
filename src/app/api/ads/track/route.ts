import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { parseBody } from '@/lib/api-validation';

const AdTrackSchema = z.object({
  ad_id: z.string().min(1, 'ad_id is required'),
  ad_name: z.string().optional(),
  placement: z.string().min(1, 'placement is required'),
  event_type: z.enum(['impression', 'click']),
  conference: z.string().optional(),
  visitor_id: z.string().optional(),
  url: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(req: NextRequest) {
  const { data, error: parseError } = await parseBody(req, AdTrackSchema);
  if (parseError) return parseError;

  const supabase = getSupabase();

  const { error } = await supabase.from('ad_events').insert({
    ad_id: data.ad_id,
    ad_name: data.ad_name || null,
    placement: data.placement,
    event_type: data.event_type,
    conference: data.conference || null,
    visitor_id: data.visitor_id || null,
    url: data.url || null,
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
