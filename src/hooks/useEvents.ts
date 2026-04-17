'use client';

import { useState, useEffect } from 'react';
import { ETHDenverEvent } from '@/lib/types';
import { fetchEvents, GeoAddressMap } from '@/lib/fetch-events';
import type { TabConfig } from '@/lib/conferences';
import { FALLBACK_TABS } from '@/lib/conferences';

async function fetchRuntimeAddresses(): Promise<GeoAddressMap> {
  try {
    const res = await fetch('/api/geocoded-addresses');
    if (!res.ok) return {};
    const data = await res.json();
    return data.addresses || {};
  } catch {
    return {};
  }
}

async function fetchDynamicTabs(): Promise<TabConfig[]> {
  try {
    const res = await fetch('/api/conferences');
    if (!res.ok) return FALLBACK_TABS;
    const data = await res.json();
    return Array.isArray(data) && data.length > 0 ? data : FALLBACK_TABS;
  } catch {
    return FALLBACK_TABS;
  }
}

export function useEvents() {
  const [events, setEvents] = useState<ETHDenverEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [runtimeAddresses, tabs] = await Promise.all([
          fetchRuntimeAddresses(),
          fetchDynamicTabs(),
        ]);
        const data = await fetchEvents(runtimeAddresses, tabs);
        setEvents(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load events');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return { events, loading, error };
}
