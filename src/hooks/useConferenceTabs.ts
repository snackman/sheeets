'use client';

import { useState, useEffect } from 'react';
import { FALLBACK_TABS } from '@/lib/conferences';
import type { TabConfig } from '@/lib/conferences';

/**
 * Client-side hook to fetch dynamic conference tabs from /api/conferences.
 *
 * `initialTabs` seeds the state with the server-fetched tab list (e.g. from
 * `getAllConferenceTabs()` in a server component) so the very first render
 * -- including the server-rendered HTML -- already has the real conference
 * dates/timezone/center, instead of the hardcoded FALLBACK_TABS (which only
 * covers a few long-past conferences). Without this, anything derived from
 * `tabs` during that first render -- most importantly `useFilters`' default
 * date range -- used the wrong conference's dates until the `/api/conferences`
 * fetch below resolved, which made every event look filtered out ("0 events")
 * on first load for any conference not in FALLBACK_TABS.
 *
 * Falls back to FALLBACK_TABS only when no `initialTabs` were provided.
 */
export function useConferenceTabs(initialTabs?: TabConfig[]): { tabs: TabConfig[]; loading: boolean } {
  const hasInitialTabs = !!initialTabs && initialTabs.length > 0;
  const [tabs, setTabs] = useState<TabConfig[]>(hasInitialTabs ? initialTabs : FALLBACK_TABS);
  const [loading, setLoading] = useState(!hasInitialTabs);

  useEffect(() => {
    fetch('/api/conferences')
      .then((res) => res.json())
      .then((data: TabConfig[]) => {
        if (Array.isArray(data) && data.length > 0) {
          setTabs(data);
        }
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, []);

  return { tabs, loading };
}
