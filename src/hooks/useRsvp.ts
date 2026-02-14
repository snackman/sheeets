'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useProfile } from '@/hooks/useProfile';
import { supabase } from '@/lib/supabase';
import { isLumaUrl, getLumaSlug } from '@/lib/luma';
import { trackRsvp } from '@/lib/analytics';

export type RsvpStatus = 'idle' | 'loading' | 'confirmed' | 'error' | 'fallback';

interface RsvpState {
  status: RsvpStatus;
  error?: string;
}

interface LumaResolution {
  luma_api_id: string | null;
  luma_ticket_type_id: string | null;
  is_free: boolean;
  requires_approval: boolean;
}

export function useRsvp() {
  const { user } = useAuth();
  const { profile } = useProfile();

  // Map of eventId -> RSVP status
  const [rsvpStates, setRsvpStates] = useState<Map<string, RsvpState>>(new Map());

  // Cache of resolved Luma event metadata
  const lumaCache = useRef<Map<string, LumaResolution>>(new Map());

  // Track which event needs the embed overlay
  const [embedEvent, setEmbedEvent] = useState<{
    eventId: string;
    lumaUrl: string;
  } | null>(null);

  // Load existing RSVPs from database on mount
  useEffect(() => {
    if (!user) {
      setRsvpStates(new Map());
      return;
    }

    async function loadRsvps() {
      const { data } = await supabase
        .from('rsvps')
        .select('event_id, status')
        .eq('user_id', user!.id);

      if (data && data.length > 0) {
        const states = new Map<string, RsvpState>();
        for (const row of data) {
          states.set(row.event_id, { status: 'confirmed' });
        }
        setRsvpStates(states);
      }
    }

    loadRsvps();
  }, [user]);

  const getState = useCallback(
    (eventId: string): RsvpState => {
      return rsvpStates.get(eventId) ?? { status: 'idle' };
    },
    [rsvpStates]
  );

  const setState = useCallback((eventId: string, state: RsvpState) => {
    setRsvpStates((prev) => {
      const next = new Map(prev);
      next.set(eventId, state);
      return next;
    });
  }, []);

  /** Resolve Luma event metadata (cached) */
  const resolveLumaEvent = useCallback(
    async (eventId: string, lumaUrl: string): Promise<LumaResolution | null> => {
      // Check in-memory cache
      const cached = lumaCache.current.get(eventId);
      if (cached) return cached;

      const slug = getLumaSlug(lumaUrl);
      if (!slug) return null;

      try {
        const { data: session } = await supabase.auth.getSession();
        const token = session?.session?.access_token;

        const res = await supabase.functions.invoke('resolve-luma-event', {
          body: { event_id: eventId, luma_slug: slug },
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });

        if (res.error) {
          console.error('Failed to resolve Luma event:', res.error);
          return null;
        }

        const resolution = res.data as LumaResolution;
        lumaCache.current.set(eventId, resolution);
        return resolution;
      } catch (err) {
        console.error('Luma resolution error:', err);
        return null;
      }
    },
    []
  );

  /** Attempt RSVP for a Luma event */
  const rsvp = useCallback(
    async (eventId: string, eventUrl: string) => {
      if (!user || !profile) return;
      if (!isLumaUrl(eventUrl)) return;

      // Already confirmed
      const current = rsvpStates.get(eventId);
      if (current?.status === 'confirmed') return;

      setState(eventId, { status: 'loading' });
      trackRsvp(eventId, 'attempt');

      // Step 1: Resolve Luma event metadata
      const resolution = await resolveLumaEvent(eventId, eventUrl);

      if (!resolution?.luma_api_id) {
        // Can't resolve - fall back to embed
        setState(eventId, { status: 'fallback' });
        setEmbedEvent({ eventId, lumaUrl: eventUrl });
        trackRsvp(eventId, 'fallback_no_resolution');
        return;
      }

      // Step 2: If event requires approval or is paid, go straight to embed
      if (resolution.requires_approval || !resolution.is_free) {
        setState(eventId, { status: 'fallback' });
        setEmbedEvent({ eventId, lumaUrl: eventUrl });
        trackRsvp(eventId, 'fallback_paid_or_approval');
        return;
      }

      // Step 3: Try server-side RSVP
      const name = profile.display_name || profile.email || user.email || 'Guest';
      const email = profile.email || user.email || '';

      try {
        const { data: session } = await supabase.auth.getSession();
        const token = session?.session?.access_token;

        const res = await supabase.functions.invoke('luma-rsvp', {
          body: {
            event_id: eventId,
            luma_api_id: resolution.luma_api_id,
            ticket_type_id: resolution.luma_ticket_type_id,
            name,
            email,
          },
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });

        if (res.error) {
          throw new Error(res.error.message || 'RSVP failed');
        }

        const result = res.data as { success: boolean; fallback_required?: boolean };

        if (result.success) {
          setState(eventId, { status: 'confirmed' });
          trackRsvp(eventId, 'success');
        } else if (result.fallback_required) {
          setState(eventId, { status: 'fallback' });
          setEmbedEvent({ eventId, lumaUrl: eventUrl });
          trackRsvp(eventId, 'fallback_api_failed');
        } else {
          setState(eventId, { status: 'error', error: 'RSVP failed' });
          trackRsvp(eventId, 'error');
        }
      } catch (err) {
        console.error('RSVP error:', err);
        // Fall back to embed on any error
        setState(eventId, { status: 'fallback' });
        setEmbedEvent({ eventId, lumaUrl: eventUrl });
        trackRsvp(eventId, 'fallback_error');
      }
    },
    [user, profile, rsvpStates, setState, resolveLumaEvent]
  );

  /** Mark an event as RSVP'd via embed (user completed RSVP through Luma widget) */
  const markEmbedRsvp = useCallback(
    async (eventId: string) => {
      setState(eventId, { status: 'confirmed' });
      trackRsvp(eventId, 'embed_complete');

      // Record in database
      if (user) {
        const resolution = lumaCache.current.get(eventId);
        await supabase.from('rsvps').upsert(
          {
            user_id: user.id,
            event_id: eventId,
            luma_api_id: resolution?.luma_api_id || null,
            status: 'confirmed',
            method: 'embed',
          },
          { onConflict: 'user_id,event_id' }
        );
      }
    },
    [user, setState]
  );

  /** Close the embed overlay */
  const closeEmbed = useCallback(() => {
    setEmbedEvent(null);
  }, []);

  /** RSVP all events in a list (for itinerary "RSVP All") */
  const rsvpAll = useCallback(
    async (events: { id: string; link: string }[]) => {
      const lumaEvents = events.filter(
        (e) =>
          isLumaUrl(e.link) &&
          rsvpStates.get(e.id)?.status !== 'confirmed'
      );

      for (const event of lumaEvents) {
        await rsvp(event.id, event.link);
        // Small delay between RSVPs to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    },
    [rsvp, rsvpStates]
  );

  return {
    getState,
    rsvp,
    rsvpAll,
    embedEvent,
    closeEmbed,
    markEmbedRsvp,
  };
}
