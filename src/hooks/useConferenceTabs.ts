'use client';

import { useState, useEffect } from 'react';
import { FALLBACK_TABS } from '@/lib/conferences';
import type { TabConfig } from '@/lib/conferences';

/**
 * Client-side hook to fetch dynamic conference tabs from /api/conferences.
 * Falls back to FALLBACK_TABS if the fetch fails.
 */
export function useConferenceTabs(): { tabs: TabConfig[]; loading: boolean } {
  const [tabs, setTabs] = useState<TabConfig[]>(FALLBACK_TABS);
  const [loading, setLoading] = useState(true);

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
