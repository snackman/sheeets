'use client';

import { useState, useEffect, useCallback } from 'react';
import { STORAGE_KEYS } from '@/lib/constants';

export function useItinerary() {
  const [itinerary, setItinerary] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.ITINERARY);
      if (saved) {
        setItinerary(new Set(JSON.parse(saved)));
      }
    } catch {
      // Ignore parse errors
    }
    setLoaded(true);
  }, []);

  // Save to localStorage on change
  useEffect(() => {
    if (loaded) {
      localStorage.setItem(
        STORAGE_KEYS.ITINERARY,
        JSON.stringify([...itinerary])
      );
    }
  }, [itinerary, loaded]);

  const add = useCallback((eventId: string) => {
    setItinerary((prev) => {
      const next = new Set(prev);
      next.add(eventId);
      return next;
    });
  }, []);

  const remove = useCallback((eventId: string) => {
    setItinerary((prev) => {
      const next = new Set(prev);
      next.delete(eventId);
      return next;
    });
  }, []);

  const toggle = useCallback((eventId: string) => {
    setItinerary((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) next.delete(eventId);
      else next.add(eventId);
      return next;
    });
  }, []);

  const isInItinerary = useCallback(
    (eventId: string) => itinerary.has(eventId),
    [itinerary]
  );

  const clear = useCallback(() => {
    setItinerary(new Set());
  }, []);

  return {
    itinerary,
    add,
    remove,
    toggle,
    isInItinerary,
    clear,
    count: itinerary.size,
  };
}
