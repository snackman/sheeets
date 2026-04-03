import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { FALLBACK_TABS, getActiveConferences, conferenceToTab } from '@/lib/conferences';
import type { ConferenceConfig } from '@/lib/types';

export async function GET() {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data, error } = await supabase
      .from('admin_config')
      .select('value')
      .eq('key', 'conferences')
      .single();

    if (error || !data?.value) {
      // Fallback to hardcoded tabs
      return NextResponse.json(FALLBACK_TABS, {
        headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
      });
    }

    const allConfs = data.value as ConferenceConfig[];
    const active = getActiveConferences(allConfs);
    const tabs = active.map(conferenceToTab);

    // If no active conferences, return fallback
    if (tabs.length === 0) {
      return NextResponse.json(FALLBACK_TABS, {
        headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
      });
    }

    return NextResponse.json(tabs, {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
    });
  } catch {
    // Fallback on any error
    return NextResponse.json(FALLBACK_TABS, {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
    });
  }
}
