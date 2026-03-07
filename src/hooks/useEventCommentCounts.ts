'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';

/**
 * Batch-fetches comment counts for all events.
 * Uses the get_comment_counts() RPC for a single aggregated query,
 * with graceful fallback to per-row fetching if the RPC doesn't exist.
 * Returns a Map of eventId -> comment count.
 */
export function useEventCommentCounts() {
  const { user } = useAuth();
  const [commentCounts, setCommentCounts] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    async function fetchCounts() {
      // Try the RPC first (single aggregated query)
      const { data: rpcData, error: rpcError } = await supabase.rpc('get_comment_counts');

      if (!rpcError && rpcData) {
        const counts = new Map<string, number>();
        for (const row of rpcData as { event_id: string; comment_count: number }[]) {
          counts.set(row.event_id, row.comment_count);
        }
        setCommentCounts(counts);
        return;
      }

      // Fallback: RPC doesn't exist (error code 42883) or other error
      if (rpcError && rpcError.code !== '42883') {
        console.error('RPC get_comment_counts failed, falling back:', rpcError);
      }

      // Legacy: fetch all rows and aggregate client-side
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
