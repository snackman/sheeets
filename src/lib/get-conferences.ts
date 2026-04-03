import { createClient } from '@supabase/supabase-js';
import { FALLBACK_TABS, getActiveConferences, conferenceToTab } from './conferences';
import type { TabConfig } from './conferences';
import type { ConferenceConfig } from './types';

/**
 * Server-side: fetch active conferences from Supabase, fall back to FALLBACK_TABS.
 * Use this in server components and API routes that need dynamic conferences.
 */
export async function getConferenceTabs(): Promise<TabConfig[]> {
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
      return FALLBACK_TABS;
    }

    const allConfs = data.value as ConferenceConfig[];
    const active = getActiveConferences(allConfs);
    const tabs = active.map(conferenceToTab);

    return tabs.length > 0 ? tabs : FALLBACK_TABS;
  } catch {
    return FALLBACK_TABS;
  }
}

/**
 * Server-side: fetch ALL conferences (including past/hidden) from Supabase.
 * Used for URL routing so past conference slugs still resolve.
 */
export async function getAllConferenceTabs(): Promise<TabConfig[]> {
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
      return FALLBACK_TABS;
    }

    const allConfs = data.value as ConferenceConfig[];
    const tabs = allConfs.map(conferenceToTab);

    return tabs.length > 0 ? tabs : FALLBACK_TABS;
  } catch {
    return FALLBACK_TABS;
  }
}
