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

const CONFIG_TTL_MS = 15_000;
let configCache: { at: number; value: ConferenceConfig[] } | null = null;

/** Drop the in-process conference-config cache (call after writing
 *  `admin_config`; other server instances catch up within the 60s TTL). */
export function invalidateConferenceConfigCache(): void {
  configCache = null;
}

/** Cached 15s in-process: a bulk admin action or a cron used to hit
 *  Supabase for the same row once per id/source. Empty/failed reads are
 *  never cached, so an outage can't pin the fallback tabs for a minute. */
async function fetchAllConferenceConfigs(): Promise<ConferenceConfig[]> {
  if (configCache && Date.now() - configCache.at < CONFIG_TTL_MS) return configCache.value;
  const value = await fetchAllConferenceConfigsUncached();
  if (value.length > 0) configCache = { at: Date.now(), value };
  return value;
}

async function fetchAllConferenceConfigsUncached(): Promise<ConferenceConfig[]> {
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
 * Server-side: fetch upcoming conferences — not yet active (future startDate,
 * not in the active list) but NOT explicitly hidden by admin. Admin-hidden
 * conferences must never appear in any public listing, so `!c.hidden` is
 * filtered here too, not just inherited from `getActiveConferences`.
 */
export async function getUpcomingConferences(): Promise<ConferenceConfig[]> {
  try {
    const allConfs = await fetchAllConferenceConfigs();
    const activeNames = getActiveConferences(allConfs).map((c) => c.name);

    return allConfs
      .filter((c) => !c.hidden && !activeNames.includes(c.name) && !isConferencePast(c))
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
  } catch {
    return [];
  }
}
