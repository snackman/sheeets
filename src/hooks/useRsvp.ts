'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';

interface ActiveRsvp {
  id: string;
  name: string;
  link: string;
}

export function useRsvp() {
  const { user, loading: authLoading } = useAuth();
  const [confirmedIds, setConfirmedIds] = useState<Set<string>>(new Set());
  const [activeRsvp, setActiveRsvp] = useState<ActiveRsvp | null>(null);
  const initialFetchDone = useRef(false);

  // Load confirmed RSVPs from Supabase when user logs in
  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      setConfirmedIds(new Set());
      initialFetchDone.current = false;
      return;
    }

    if (initialFetchDone.current) return;

    async function fetchRsvps() {
      try {
        const { data, error } = await supabase
          .from('rsvps')
          .select('event_id')
          .eq('user_id', user!.id)
          .eq('status', 'confirmed');

        if (error) {
          console.error('Failed to fetch RSVPs:', error);
          return;
        }

        if (data) {
          setConfirmedIds(new Set(data.map((r) => r.event_id)));
        }
      } catch (err) {
        console.error('RSVP fetch error:', err);
      }
      initialFetchDone.current = true;
    }

    fetchRsvps();
  }, [user, authLoading]);

  const getRsvpStatus = useCallback(
    (eventId: string): 'idle' | 'confirmed' => {
      return confirmedIds.has(eventId) ? 'confirmed' : 'idle';
    },
    [confirmedIds]
  );

  const openRsvp = useCallback((event: ActiveRsvp) => {
    setActiveRsvp(event);
  }, []);

  const closeRsvp = useCallback(() => {
    setActiveRsvp(null);
  }, []);

  const markConfirmed = useCallback(
    async (eventId: string) => {
      if (!user) return;

      // Optimistic update
      setConfirmedIds((prev) => {
        const next = new Set(prev);
        next.add(eventId);
        return next;
      });

      try {
        const { error } = await supabase.from('rsvps').upsert(
          {
            user_id: user.id,
            event_id: eventId,
            status: 'confirmed',
            method: 'manual',
            luma_api_id: null,
          },
          { onConflict: 'user_id,event_id' }
        );

        if (error) {
          console.error('Failed to save RSVP:', error);
          // Revert optimistic update
          setConfirmedIds((prev) => {
            const next = new Set(prev);
            next.delete(eventId);
            return next;
          });
        }
      } catch (err) {
        console.error('RSVP save error:', err);
      }

      setActiveRsvp(null);
    },
    [user]
  );

  return {
    getRsvpStatus,
    openRsvp,
    markConfirmed,
    closeRsvp,
    activeRsvp,
  };
}
