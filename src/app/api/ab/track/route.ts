import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { parseBody, ABTrackEventSchema } from '@/lib/api-validation';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(req: NextRequest) {
  const { data, error: parseError } = await parseBody(req, ABTrackEventSchema);
  if (parseError) return parseError;

  const supabase = getSupabase();

  // Verify the test exists and is running
  const { data: testRows } = await supabase
    .from('admin_config')
    .select('value')
    .eq('key', 'ab_tests')
    .single();

  if (!testRows?.value) {
    return NextResponse.json({ error: 'No A/B tests configured' }, { status: 404 });
  }

  const tests = testRows.value as Array<{ id: string; status: string }>;
  const test = tests.find(t => t.id === data.test_id);
  if (!test || test.status !== 'running') {
    return NextResponse.json({ error: 'Test not found or not running' }, { status: 404 });
  }

  // Insert the tracking event
  const { error } = await supabase.from('ab_events').insert({
    test_id: data.test_id,
    variant_id: data.variant_id,
    visitor_id: data.visitor_id,
    event_type: data.event_type,
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
