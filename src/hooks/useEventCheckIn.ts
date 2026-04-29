'use client';

import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { distanceMeters } from '@/lib/geo';
import { passesNowFilter, getConferenceNow } from '@/lib/filters';
import { trackCheckIn } from '@/lib/analytics';
import { useAuth } from '@/contexts/AuthContext';
import type { ETHDenverEvent } from '@/lib/types';

interface CheckInResult {
  ok: boolean;
  message: string;
}

export function useEventCheckIn() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CheckInResult | null>(null);

  const clearResult = useCallback(() => setResult(null), []);

  const checkInToEvent = useCallback(
    async (eventId: string, eventName?: string) => {
      if (!user) return;
      setLoading(true);
      setResult(null);

      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 10_000,
          })
        );

        const { latitude: uLat, longitude: uLng } = pos.coords;

        const { error } = await supabase.from('check_ins').upsert(
          [{ user_id: user.id, event_id: eventId, lat: uLat, lng: uLng }],
          { onConflict: 'user_id,event_id' }
        );

        if (error) throw error;

        trackCheckIn(eventId, true);
        setResult({
          ok: true,
          message: eventName ? `Checked in at ${eventName}!` : 'Checked in!',
        });
      } catch (err: unknown) {
        const msg =
          err instanceof GeolocationPositionError
            ? 'Location access denied'
            : err instanceof Error
              ? err.message
              : 'Check-in failed';
        trackCheckIn(eventId, false);
        setResult({ ok: false, message: msg });
      }

      setLoading(false);
    },
    [user]
  );

  const checkInToNearbyEvents = useCallback(
    async (
      events: ETHDenverEvent[],
      itinerary: Set<string>,
      conference?: string
    ) => {
      if (!user) return;
      setLoading(true);
      setResult(null);

      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 10_000,
          })
        );

        const { latitude: uLat, longitude: uLng } = pos.coords;
        const now = getConferenceNow(conference);

        const nearby = events.filter((e) => {
          if (!itinerary.has(e.id)) return false;
          if (!e.lat || !e.lng) return false;
          if (!passesNowFilter(e, now)) return false;
          return distanceMeters(uLat, uLng, e.lat, e.lng) <= 150;
        });

        if (nearby.length === 0) {
          setResult({
            ok: false,
            message: 'No active itinerary events nearby',
          });
          setLoading(false);
          return;
        }

        const rows = nearby.map((e) => ({
          user_id: user.id,
          event_id: e.id,
          lat: uLat,
          lng: uLng,
        }));

        const { error } = await supabase.from('check_ins').upsert(rows, {
          onConflict: 'user_id,event_id',
        });

        if (error) throw error;

        const names = nearby.map((e) => e.name).join(', ');
        setResult({
          ok: true,
          message: `Checked in at ${names}!`,
        });
      } catch (err: unknown) {
        const msg =
          err instanceof GeolocationPositionError
            ? 'Location access denied'
            : err instanceof Error
              ? err.message
              : 'Check-in failed';
        setResult({ ok: false, message: msg });
      }

      setLoading(false);
    },
    [user]
  );

  return { checkInToEvent, checkInToNearbyEvents, loading, result, clearResult };
}
