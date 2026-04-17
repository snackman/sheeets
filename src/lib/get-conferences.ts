import { createClient } from '@supabase/supabase-js';
import { FALLBACK_TABS, getActiveConferences, conferenceToTab, isConferencePast } from './conferences';
import type { TabConfig } from './conferences';
import type { ConferenceConfig } from './types';

function createSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function fetchAllConferenceConfigs(): Promise<ConferenceConfig[]> {
  try {
    const supabase = createSupabase();
    const { data, error } = await supabase
      .from('admin_config')
      .select('value')
      .eq('key', 'conferences')
      .single();

    if (error || !data?.value) return [];
    return data.value as ConferenceConfig[];
  } catch {
    return [];
  }
}

/**
 * Server-side: fetch active conferences from Supabase, fall back to FALLBACK_TABS.
 * Use this in server components and API routes that need dynamic conferences.
 */
export async function getConferenceTabs(): Promise<TabConfig[]> {
  try {
    const allConfs = await fetchAllConferenceConfigs();
    if (allConfs.length === 0) return FALLBACK_TABS;

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
    const allConfs = await fetchAllConferenceConfigs();
    if (allConfs.length === 0) return FALLBACK_TABS;

    const tabs = allConfs.map(conferenceToTab);
    return tabs.length > 0 ? tabs : FALLBACK_TABS;
  } catch {
    return FALLBACK_TABS;
  }
}

/**
 * Server-side: fetch upcoming conferences — hidden but with future startDate.
 * These are conferences added by admin that aren't active yet.
 */
export async function getUpcomingConferences(): Promise<ConferenceConfig[]> {
  try {
    const allConfs = await fetchAllConferenceConfigs();
    const activeNames = getActiveConferences(allConfs).map((c) => c.name);

    return allConfs
      .filter((c) => !activeNames.includes(c.name) && !isConferencePast(c))
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
  } catch {
    return [];
  }
}
