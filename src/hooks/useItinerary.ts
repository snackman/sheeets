'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { STORAGE_KEYS } from '@/lib/constants';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';

export function useItinerary() {
  const { user } = useAuth();
  const [itinerary, setItinerary] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const initialSyncDone = useRef(false);

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

  // Sync with Supabase when user logs in
  useEffect(() => {
    if (!user || !loaded) return;

    // Reset sync flag when user changes (new login)
    initialSyncDone.current = false;

    async function syncWithSupabase() {
      try {
        const { data } = await supabase
          .from('itineraries')
          .select('event_ids')
          .eq('user_id', user!.id)
          .maybeSingle();

        if (data?.event_ids) {
          // Merge server data with local data
          setItinerary((prev) => {
            const merged = new Set(prev);
            for (const id of data.event_ids) merged.add(id);
            return merged;
          });
        }
      } catch {
        // Error fetching — proceed with local data only
      }
      initialSyncDone.current = true;
    }

    syncWithSupabase();
  }, [user, loaded]);

  // Save to localStorage + Supabase on change
  useEffect(() => {
    if (!loaded) return;

    localStorage.setItem(
      STORAGE_KEYS.ITINERARY,
      JSON.stringify([...itinerary])
    );

    // Only sync to Supabase after initial merge is complete
    if (user && initialSyncDone.current) {
      supabase
        .from('itineraries')
        .upsert(
          {
            user_id: user.id,
            event_ids: [...itinerary],
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        )
        .then(({ error }) => {
          if (error) console.error('Failed to sync itinerary:', error);
        });
    }
  }, [itinerary, loaded, user]);

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
