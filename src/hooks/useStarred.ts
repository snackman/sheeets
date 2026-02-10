'use client';

import { useState, useEffect, useCallback } from 'react';
import { STORAGE_KEYS } from '@/lib/constants';

export function useStarred() {
  const [starred, setStarred] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.STARRED);
      if (saved) {
        setStarred(new Set(JSON.parse(saved)));
      }
    } catch {
      // Ignore parse errors
    }
    setLoaded(true);
  }, []);

  // Save to localStorage on change
  useEffect(() => {
    if (loaded) {
      localStorage.setItem(STORAGE_KEYS.STARRED, JSON.stringify([...starred]));
    }
  }, [starred, loaded]);

  const toggle = useCallback((eventId: string) => {
    setStarred((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) next.delete(eventId);
      else next.add(eventId);
      return next;
    });
  }, []);

  const isStarred = useCallback(
    (eventId: string) => starred.has(eventId),
    [starred]
  );

  return { starred, toggle, isStarred, count: starred.size };
}
