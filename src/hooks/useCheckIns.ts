'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import type { Friend } from '@/lib/types';

/**
 * Fetches check-in data for the current user and their friends.
 * Uses the get_check_in_counts() RPC for a single aggregated query,
 * with graceful fallback to per-row fetching if the RPC doesn't exist.
 * Returns counts per event and user IDs per event (excluding current user).
 */
export function useCheckIns(friends: Friend[]) {
  const { user, loading: authLoading } = useAuth();
  const [checkInCounts, setCheckInCounts] = useState<Map<string, number>>(new Map());
  const [checkInUsersByEvent, setCheckInUsersByEvent] = useState<Map<string, string[]>>(new Map());

  const friendIds = useMemo(
    () => friends.map((f) => f.user_id).sort().join(','),
    [friends]
  );

  useEffect(() => {
    if (authLoading || !user) {
      setCheckInCounts(new Map());
      setCheckInUsersByEvent(new Map());
      return;
    }

    async function fetchCheckIns() {
      const userIds = [user!.id, ...friends.map((f) => f.user_id)];

      // Try the RPC first (single aggregated query)
      const { data: rpcData, error: rpcError } = await supabase.rpc(
        'get_check_in_counts',
        { p_user_ids: userIds }
      );

      if (!rpcError && rpcData) {
        const counts = new Map<string, number>();
        const usersByEvent = new Map<string, string[]>();
        for (const row of rpcData as { event_id: string; checkin_count: number; user_ids: string[] }[]) {
          counts.set(row.event_id, row.checkin_count);
          // Filter out the current user from the user_ids array
          const friendsOnly = row.user_ids.filter((uid) => uid !== user!.id);
          if (friendsOnly.length > 0) {
            usersByEvent.set(row.event_id, friendsOnly);
          }
        }
        setCheckInCounts(counts);
        setCheckInUsersByEvent(usersByEvent);
        return;
      }

      // Fallback: RPC doesn't exist (error code 42883) or other error
      if (rpcError && rpcError.code !== '42883') {
        console.error('RPC get_check_in_counts failed, falling back:', rpcError);
      }

      // Legacy: fetch all rows and aggregate client-side
      const { data, error } = await supabase
        .from('check_ins')
        .select('event_id, user_id')
        .in('user_id', userIds);

      if (error) {
        console.error('Failed to fetch check-ins:', error);
        return;
      }

      const counts = new Map<string, number>();
      const usersByEvent = new Map<string, string[]>();
      for (const row of data ?? []) {
        const { event_id: eid, user_id: uid } = row as { event_id: string; user_id: string };
        counts.set(eid, (counts.get(eid) ?? 0) + 1);
        // Track friend user IDs per event (exclude current user)
        if (uid !== user!.id) {
          if (!usersByEvent.has(eid)) usersByEvent.set(eid, []);
          usersByEvent.get(eid)!.push(uid);
        }
      }
      setCheckInCounts(counts);
      setCheckInUsersByEvent(usersByEvent);
    }

    fetchCheckIns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading, friendIds]);

  return { checkInCounts, checkInUsersByEvent };
}
