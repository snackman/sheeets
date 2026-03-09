'use client';

import { useState, useEffect } from 'react';
import { ETHDenverEvent } from '@/lib/types';
import { fetchEvents, GeoAddressMap } from '@/lib/fetch-events';

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

export function useEvents() {
  const [events, setEvents] = useState<ETHDenverEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        // Fetch runtime geocoded addresses first (fast, small payload),
        // then pass them to fetchEvents so it can merge them with the static cache
        const runtimeAddresses = await fetchRuntimeAddresses();
        const data = await fetchEvents(runtimeAddresses);
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
