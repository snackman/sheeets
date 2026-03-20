import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(req: NextRequest) {
  const testId = req.nextUrl.searchParams.get('test_id');
  if (!testId) {
    return NextResponse.json({ error: 'test_id query param required' }, { status: 400 });
  }

  const supabase = getSupabase();

  // Get the test config to get variant names
  const { data: configRow } = await supabase
    .from('admin_config')
    .select('value')
    .eq('key', 'ab_tests')
    .single();

  const tests = (configRow?.value as Array<{
    id: string;
    variants: Array<{ id: string; name: string }>;
  }>) || [];
  const test = tests.find(t => t.id === testId);

  if (!test) {
    return NextResponse.json({ error: 'Test not found' }, { status: 404 });
  }

  // Query aggregated event counts per variant and event_type
  const { data: events, error } = await supabase
    .from('ab_events')
    .select('variant_id, event_type')
    .eq('test_id', testId);

  if (error) {
    // Table may not exist yet
    if (error.code === '42P01') {
      return NextResponse.json({
        test_id: testId,
        variants: test.variants.map(v => ({
          variant_id: v.id,
          variant_name: v.name,
          impressions: 0,
          clicks: 0,
          conversions: 0,
          ctr: 0,
          cvr: 0,
        })),
      });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Aggregate counts
  const counts: Record<string, { impressions: number; clicks: number; conversions: number }> = {};
  for (const v of test.variants) {
    counts[v.id] = { impressions: 0, clicks: 0, conversions: 0 };
  }

  for (const ev of events || []) {
    if (!counts[ev.variant_id]) {
      counts[ev.variant_id] = { impressions: 0, clicks: 0, conversions: 0 };
    }
    if (ev.event_type === 'impression') counts[ev.variant_id].impressions++;
    else if (ev.event_type === 'click') counts[ev.variant_id].clicks++;
    else if (ev.event_type === 'conversion') counts[ev.variant_id].conversions++;
  }

  const variants = test.variants.map(v => {
    const c = counts[v.id] || { impressions: 0, clicks: 0, conversions: 0 };
    return {
      variant_id: v.id,
      variant_name: v.name,
      impressions: c.impressions,
      clicks: c.clicks,
      conversions: c.conversions,
      ctr: c.impressions > 0 ? c.clicks / c.impressions : 0,
      cvr: c.impressions > 0 ? c.conversions / c.impressions : 0,
    };
  });

  return NextResponse.json({ test_id: testId, variants });
}
