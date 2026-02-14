'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import type { Friend } from '@/lib/types';

interface FriendItinerary {
  userId: string;
  displayName: string;
  eventIds: Set<string>;
}

export function useFriendsItineraries(friends: Friend[]) {
  const { user, loading: authLoading } = useAuth();
  const [rawItineraries, setRawItineraries] = useState<
    { userId: string; eventIds: string[] }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const initialFetchDone = useRef(false);

  // Re-fetch when friends list changes (by length + IDs)
  const friendIds = useMemo(
    () => friends.map((f) => f.user_id).sort().join(','),
    [friends]
  );

  useEffect(() => {
    if (authLoading) return;

    if (!user || friends.length === 0) {
      setRawItineraries([]);
      setLoading(false);
      initialFetchDone.current = false;
      return;
    }

    // Reset fetch flag when friends change so we refetch
    initialFetchDone.current = false;

    async function fetchItineraries() {
      try {
        const { data, error } = await supabase.rpc('get_friends_itineraries');

        if (error) {
          console.error('Failed to fetch friends itineraries:', error);
          setLoading(false);
          return;
        }

        setRawItineraries(
          (data ?? []).map((row: { user_id: string; event_ids: string[] }) => ({
            userId: row.user_id,
            eventIds: row.event_ids ?? [],
          }))
        );
      } catch (err) {
        console.error('Friends itineraries fetch error:', err);
      }
      initialFetchDone.current = true;
      setLoading(false);
    }

    fetchItineraries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading, friendIds]);

  // Merge display names from friends array
  const friendItineraries: FriendItinerary[] = useMemo(() => {
    const friendMap = new Map(friends.map((f) => [f.user_id, f]));
    return rawItineraries.map((ri) => {
      const friend = friendMap.get(ri.userId);
      return {
        userId: ri.userId,
        displayName:
          friend?.display_name || (friend?.x_handle ? `@${friend.x_handle}` : null) || friend?.email || ri.userId.slice(0, 8),
        eventIds: new Set(ri.eventIds),
      };
    });
  }, [rawItineraries, friends]);

  // Only friends that have at least one event
  const friendsWithEvents = useMemo(
    () => friendItineraries.filter((fi) => fi.eventIds.size > 0),
    [friendItineraries]
  );

  return { friendItineraries, friendsWithEvents, loading };
}
