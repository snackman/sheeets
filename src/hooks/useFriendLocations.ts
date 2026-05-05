'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import type { Friend, FriendLocation } from '@/lib/types';

/**
 * On mount, upserts the current user's location to user_locations.
 * Fetches friends' locations via the get_friends_locations() RPC.
 * Re-fetches every 5 minutes.
 */
export function useFriendLocations(friends: Friend[]) {
  const { user, loading: authLoading } = useAuth();
  const [friendLocations, setFriendLocations] = useState<FriendLocation[]>([]);

  const friendIds = useMemo(
    () => friends.map((f) => f.user_id).sort().join(','),
    [friends]
  );

  // Upsert own location on mount
  useEffect(() => {
    if (authLoading || !user) return;
    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        supabase
          .from('user_locations')
          .upsert(
            {
              user_id: user.id,
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id' }
          )
          .then(({ error }) => {
            if (error) console.error('Failed to upsert location:', error);
          });
      },
      (err) => {
        console.warn('Geolocation unavailable:', err.message);
      },
      { enableHighAccuracy: false, timeout: 10000 }
    );
  }, [user, authLoading]);

  // Fetch friends' locations
  useEffect(() => {
    if (authLoading || !user || friends.length === 0) {
      setFriendLocations([]);
      return;
    }

    async function fetchLocations() {
      const { data, error } = await supabase.rpc('get_friends_locations');

      if (error) {
        console.error('Failed to fetch friends locations:', error);
        return;
      }

      const friendMap = new Map(friends.map((f) => [f.user_id, f]));
      const locations: FriendLocation[] = (data ?? []).map(
        (row: { user_id: string; lat: number; lng: number; updated_at: string }) => {
          const friend = friendMap.get(row.user_id);
          return {
            user_id: row.user_id,
            lat: row.lat,
            lng: row.lng,
            updated_at: row.updated_at,
            display_name: friend?.display_name ?? undefined,
            x_handle: friend?.x_handle ?? undefined,
            avatar_url: friend?.avatar_url ?? undefined,
          };
        }
      );

      setFriendLocations(locations);
    }

    fetchLocations();

    // Re-fetch every 5 minutes
    const interval = setInterval(fetchLocations, 5 * 60 * 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading, friendIds]);

  return friendLocations;
}
