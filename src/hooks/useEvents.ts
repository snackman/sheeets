'use client';

import { useState, useEffect } from 'react';
import { ETHDenverEvent } from '@/lib/types';
import { STORAGE_KEYS } from '@/lib/storage-keys';

const STALENESS_MS = 5 * 60 * 1000; // 5 minutes

function readCache(): ETHDenverEvent[] | null {
  try {
    const ts = sessionStorage.getItem(STORAGE_KEYS.EVENTS_CACHE_TS);
    if (!ts || Date.now() - Number(ts) > STALENESS_MS) return null;
    const raw = sessionStorage.getItem(STORAGE_KEYS.EVENTS_CACHE);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeCache(events: ETHDenverEvent[]) {
  try {
    sessionStorage.setItem(STORAGE_KEYS.EVENTS_CACHE, JSON.stringify(events));
    sessionStorage.setItem(STORAGE_KEYS.EVENTS_CACHE_TS, String(Date.now()));
  } catch {
    // sessionStorage full or unavailable — ignore
  }
}

function readStaleCache(): ETHDenverEvent[] | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEYS.EVENTS_CACHE);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function useEvents(initialEvents?: ETHDenverEvent[]) {
  const [events, setEvents] = useState<ETHDenverEvent[]>(initialEvents ?? []);
  const [loading, setLoading] = useState(!initialEvents);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      // Check sessionStorage for fresh cache
      const cached = readCache();
      if (cached) {
        setEvents(cached);
        setLoading(false);
        return;
      }

      // Fetch from API
      try {
        const res = await fetch('/api/events');
        if (!res.ok) throw new Error(`API returned ${res.status}`);
        const data: ETHDenverEvent[] = await res.json();
        writeCache(data);
        setEvents(data);
      } catch (e) {
        // Fall back to stale cache if available
        const stale = readStaleCache();
        if (stale) {
          setEvents(stale);
        } else if (!initialEvents) {
          setError(e instanceof Error ? e.message : 'Failed to load events');
        }
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return { events, loading, error };
}
