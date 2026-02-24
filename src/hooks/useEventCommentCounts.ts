'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';

/**
 * Batch-fetches comment counts for all events.
 * Returns a Map of eventId -> comment count.
 */
export function useEventCommentCounts() {
  const { user } = useAuth();
  const [commentCounts, setCommentCounts] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    if (!user) {
      setCommentCounts(new Map());
      return;
    }

    async function fetchCounts() {
      const { data, error } = await supabase
        .from('event_comments')
        .select('event_id');

      if (error) {
        console.error('Failed to fetch comment counts:', error);
        return;
      }

      const counts = new Map<string, number>();
      for (const row of data ?? []) {
        const eid = (row as { event_id: string }).event_id;
        counts.set(eid, (counts.get(eid) ?? 0) + 1);
      }
      setCommentCounts(counts);
    }

    fetchCounts();
  }, [user]);

  return commentCounts;
}
