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
  const [friendCode, setFriendCode] = useState<string | null>(null);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [loading, setLoading] = useState(true);
  const initialFetchDone = useRef(false);

  // Fetch friend code and friends list when user is available
  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      setFriendCode(null);
      setFriends([]);
      setLoading(false);
      initialFetchDone.current = false;
      return;
    }

    if (initialFetchDone.current) return;

    async function fetchFriendData() {
      try {
        // Fetch existing friend code
        const { data: codeData } = await supabase
          .from('friend_codes')
          .select('code')
          .eq('user_id', user!.id)
          .maybeSingle();

        if (codeData) {
          setFriendCode(codeData.code);
        }

        // Fetch friends list
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

    // Get all friendships where this user is involved
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

    // Batch-fetch profiles for friend IDs
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

  const generateCode = useCallback(async (): Promise<string | null> => {
    if (!user) return null;

    // Check if user already has a code
    if (friendCode) return friendCode;

    const { data: existing } = await supabase
      .from('friend_codes')
      .select('code')
      .eq('user_id', user.id)
      .maybeSingle();

    if (existing) {
      setFriendCode(existing.code);
      return existing.code;
    }

    // Generate and insert a new code (retry on collision)
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = makeCode();
      const { error } = await supabase
        .from('friend_codes')
        .insert({ user_id: user.id, code });

      if (!error) {
        setFriendCode(code);
        trackFriendCodeGenerate();
        return code;
      }

      // If unique constraint violation on user_id, someone else may have raced
      // If unique constraint violation on code, try a new code
      if (error.code === '23505' && error.message?.includes('user_id')) {
        // User already has a code — fetch it
        const { data } = await supabase
          .from('friend_codes')
          .select('code')
          .eq('user_id', user.id)
          .maybeSingle();
        if (data) {
          setFriendCode(data.code);
          return data.code;
        }
      }
      // Otherwise retry with new code
    }

    console.error('Failed to generate friend code after retries');
    return null;
  }, [user, friendCode]);

  const addFriend = useCallback(
    async (code: string): Promise<{ ok: boolean; message: string }> => {
      if (!user) return { ok: false, message: 'Not signed in' };

      // Look up the code
      const { data: codeData, error: lookupError } = await supabase
        .from('friend_codes')
        .select('user_id')
        .eq('code', code.toLowerCase().trim())
        .maybeSingle();

      if (lookupError || !codeData) {
        return { ok: false, message: 'Friend code not found' };
      }

      const targetUserId = codeData.user_id;

      // Self-friend check
      if (targetUserId === user.id) {
        return { ok: false, message: "That's your own code!" };
      }

      // Order UUIDs for consistent storage
      const userA = user.id < targetUserId ? user.id : targetUserId;
      const userB = user.id < targetUserId ? targetUserId : user.id;

      // Upsert friendship
      const { error: upsertError } = await supabase
        .from('friendships')
        .upsert({ user_a: userA, user_b: userB }, { onConflict: 'user_a,user_b' });

      if (upsertError) {
        console.error('Failed to add friend:', upsertError);
        return { ok: false, message: 'Failed to add friend' };
      }

      trackFriendAdded();
      await refreshFriends();
      return { ok: true, message: 'Friend added!' };
    },
    [user, refreshFriends]
  );

  return {
    friendCode,
    friends,
    friendCount: friends.length,
    loading,
    generateCode,
    addFriend,
  };
}
