'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import type { Friend } from '@/lib/types';

export function useFriends() {
  const { user, loading: authLoading } = useAuth();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [loading, setLoading] = useState(true);
  const initialFetchDone = useRef(false);

  const refreshFriends = useCallback(async () => {
    if (!user) return;

    const { data: friendshipsA } = await supabase
      .from('friendships')
      .select('user_b')
      .eq('user_a', user.id);

    const { data: friendshipsB } = await supabase
      .from('friendships')
      .select('user_a')
      .eq('user_b', user.id);

    const friendIds = new Set<string>();
    friendshipsA?.forEach((f) => friendIds.add(f.user_b));
    friendshipsB?.forEach((f) => friendIds.add(f.user_a));

    if (friendIds.size === 0) {
      setFriends([]);
      return;
    }

    const { data: profiles } = await supabase
      .from('profiles')
      .select('user_id, email, display_name, x_handle, rsvp_name')
      .in('user_id', [...friendIds]);

    const profileMap = new Map(
      (profiles ?? []).map((p) => [p.user_id, p])
    );

    setFriends(
      [...friendIds].map((id) => {
        const p = profileMap.get(id);
        return {
          user_id: id,
          email: p?.email ?? null,
          display_name: p?.display_name ?? null,
          x_handle: p?.x_handle ?? null,
          rsvp_name: p?.rsvp_name ?? null,
        };
      })
    );
  }, [user]);

  // Fetch friends list when user is available
  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      setFriends([]);
      setLoading(false);
      initialFetchDone.current = false;
      return;
    }

    if (initialFetchDone.current) return;

    async function fetchFriendData() {
      try {
        await refreshFriends();
      } catch (err) {
        console.error('Failed to fetch friend data:', err);
      }
      initialFetchDone.current = true;
      setLoading(false);
    }

    fetchFriendData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading]);

  const removeFriend = useCallback(async (targetUserId: string) => {
    if (!user) return;
    const userA = user.id < targetUserId ? user.id : targetUserId;
    const userB = user.id < targetUserId ? targetUserId : user.id;

    await supabase
      .from('friendships')
      .delete()
      .eq('user_a', userA)
      .eq('user_b', userB);

    await refreshFriends();
  }, [user, refreshFriends]);

  return {
    friends,
    friendCount: friends.length,
    loading,
    removeFriend,
    refreshFriends,
  };
}
