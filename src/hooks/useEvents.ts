'use client';

import { useState, useEffect } from 'react';
import { ETHDenverEvent } from '@/lib/types';
import { fetchEvents } from '@/lib/fetch-events';

export function useEvents() {
  const [events, setEvents] = useState<ETHDenverEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const data = await fetchEvents();
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
