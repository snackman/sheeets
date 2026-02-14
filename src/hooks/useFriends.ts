'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import type { Friend } from '@/lib/types';
import { trackFriendCodeGenerate, trackFriendAdded } from '@/lib/analytics';

const CODE_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

function makeCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

export function useFriends() {
  const { user, loading: authLoading } = useAuth();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [loading, setLoading] = useState(true);
  const initialFetchDone = useRef(false);

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
      .select('user_id, display_name, x_handle, farcaster_username')
      .in('user_id', [...friendIds]);

    setFriends(
      (profiles ?? []).map((p) => ({
        user_id: p.user_id,
        display_name: p.display_name,
        x_handle: p.x_handle,
        farcaster_username: p.farcaster_username,
      }))
    );
  }, [user]);

  /** Generate a new single-use friend code */
  const generateCode = useCallback(async (): Promise<string | null> => {
    if (!user) return null;

    for (let attempt = 0; attempt < 5; attempt++) {
      const code = makeCode();
      const { error } = await supabase
        .from('friend_codes')
        .insert({ user_id: user.id, code });

      if (!error) {
        trackFriendCodeGenerate();
        return code;
      }

      // Unique constraint on code — retry with a new code
      if (error.code === '23505') continue;

      console.error('Failed to insert friend code:', error);
      return null;
    }

    console.error('Failed to generate friend code after retries');
    return null;
  }, [user]);

  const addFriend = useCallback(
    async (code: string): Promise<{ ok: boolean; message: string }> => {
      if (!user) return { ok: false, message: 'Not signed in' };

      const trimmedCode = code.toLowerCase().trim();

      // Look up the code (only unused codes)
      const { data: codeData, error: lookupError } = await supabase
        .from('friend_codes')
        .select('id, user_id')
        .eq('code', trimmedCode)
        .is('used_at', null)
        .maybeSingle();

      if (lookupError || !codeData) {
        return { ok: false, message: 'Friend code not found or already used' };
      }

      const targetUserId = codeData.user_id;

      if (targetUserId === user.id) {
        return { ok: false, message: "That's your own code!" };
      }

      // Order UUIDs
      const userA = user.id < targetUserId ? user.id : targetUserId;
      const userB = user.id < targetUserId ? targetUserId : user.id;

      // Create friendship
      const { error: upsertError } = await supabase
        .from('friendships')
        .upsert({ user_a: userA, user_b: userB }, { onConflict: 'user_a,user_b' });

      if (upsertError) {
        console.error('Failed to add friend:', upsertError);
        return { ok: false, message: 'Failed to add friend' };
      }

      // Mark code as used
      await supabase
        .from('friend_codes')
        .update({ used_at: new Date().toISOString() })
        .eq('id', codeData.id);

      trackFriendAdded();
      await refreshFriends();
      return { ok: true, message: 'Friend added!' };
    },
    [user, refreshFriends]
  );

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
    generateCode,
    addFriend,
    removeFriend,
  };
}
