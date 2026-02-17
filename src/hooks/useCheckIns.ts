'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import type { Friend } from '@/lib/types';

/**
 * Fetches check-in data for the current user and their friends.
 * Returns a Map of event IDs to count of people checked in.
 */
export function useCheckIns(friends: Friend[]) {
  const { user, loading: authLoading } = useAuth();
  const [checkInCounts, setCheckInCounts] = useState<Map<string, number>>(new Map());

  const friendIds = useMemo(
    () => friends.map((f) => f.user_id).sort().join(','),
    [friends]
  );

  useEffect(() => {
    if (authLoading || !user) {
      setCheckInCounts(new Map());
      return;
    }

    async function fetchCheckIns() {
      const userIds = [user!.id, ...friends.map((f) => f.user_id)];
      const { data, error } = await supabase
        .from('check_ins')
        .select('event_id')
        .in('user_id', userIds);

      if (error) {
        console.error('Failed to fetch check-ins:', error);
        return;
      }

      const counts = new Map<string, number>();
      for (const row of data ?? []) {
        const eid = (row as { event_id: string }).event_id;
        counts.set(eid, (counts.get(eid) ?? 0) + 1);
      }
      setCheckInCounts(counts);
    }

    fetchCheckIns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading, friendIds]);

  return checkInCounts;
}
