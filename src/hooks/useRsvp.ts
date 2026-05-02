'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { trackRsvp } from '@/lib/analytics';

interface ActiveRsvp {
  eventId: string;
  eventName: string;
  lumaUrl: string;
}

export function useRsvp() {
  const { user } = useAuth();
  const [confirmedIds, setConfirmedIds] = useState<Set<string>>(new Set());
  const [activeRsvp, setActiveRsvp] = useState<ActiveRsvp | null>(null);

  // Load confirmed RSVPs on auth
  useEffect(() => {
    if (!user) {
      setConfirmedIds(new Set());
      return;
    }

    supabase
      .from('rsvps')
      .select('event_id')
      .eq('user_id', user.id)
      .eq('status', 'confirmed')
      .then(({ data }) => {
        if (data) {
          setConfirmedIds(new Set(data.map((r) => r.event_id)));
        }
      });
  }, [user]);

  const getRsvpStatus = useCallback(
    (eventId: string): 'idle' | 'confirmed' => {
      return confirmedIds.has(eventId) ? 'confirmed' : 'idle';
    },
    [confirmedIds]
  );

  const openRsvp = useCallback(
    (eventId: string, eventName: string, lumaUrl: string) => {
      setActiveRsvp({ eventId, eventName, lumaUrl });
    },
    []
  );

  const closeRsvp = useCallback(() => {
    setActiveRsvp(null);
  }, []);

  const markConfirmed = useCallback(
    async (eventId: string, eventName: string) => {
      if (!user) return;

      const { error } = await supabase.from('rsvps').upsert(
        {
          user_id: user.id,
          event_id: eventId,
          status: 'confirmed',
          method: 'manual',
        },
        { onConflict: 'user_id,event_id' }
      );

      if (!error) {
        setConfirmedIds((prev) => new Set([...prev, eventId]));
        trackRsvp(eventId, eventName);
      }

      setActiveRsvp(null);
    },
    [user]
  );

  return {
    getRsvpStatus,
    openRsvp,
    closeRsvp,
    markConfirmed,
    activeRsvp,
  };
}
