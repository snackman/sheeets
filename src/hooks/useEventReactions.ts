'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import type { ReactionEmoji } from '@/lib/types';

interface ReactionSummary {
  emoji: ReactionEmoji;
  count: number;
  reacted: boolean;
}

/**
 * Batch-fetches all reactions for visible events.
 * Uses the get_reaction_summaries() RPC for a single aggregated query,
 * with graceful fallback to per-row fetching if the RPC doesn't exist.
 *
 * Optimistic updates work on the aggregated summaries directly
 * (no raw row data needed when using the RPC path).
 *
 * Returns a Map of eventId -> reaction summaries + a toggleReaction function.
 */
export function useEventReactions() {
  const { user } = useAuth();

  // Aggregated summaries – this is the source of truth for the UI
  const [summariesMap, setSummariesMap] = useState<Map<string, ReactionSummary[]>>(new Map());

  // Legacy raw rows – only populated when the RPC is unavailable
  const [rawReactions, setRawReactions] = useState<
    { event_id: string; user_id: string; emoji: string }[]
  >([]);

  // Track which data path we're using so toggleReaction knows how to optimistically update
  const [usingRpc, setUsingRpc] = useState(false);

  useEffect(() => {
    async function fetchReactions() {
      // Try the RPC first (single aggregated query)
      const { data: rpcData, error: rpcError } = await supabase.rpc(
        'get_reaction_summaries',
        { p_user_id: user?.id ?? '00000000-0000-0000-0000-000000000000' }
      );

      if (!rpcError && rpcData) {
        setUsingRpc(true);
        const map = new Map<string, ReactionSummary[]>();
        for (const row of rpcData as { event_id: string; emoji: string; reaction_count: number; user_reacted: boolean }[]) {
          if (!map.has(row.event_id)) map.set(row.event_id, []);
          map.get(row.event_id)!.push({
            emoji: row.emoji as ReactionEmoji,
            count: row.reaction_count,
            reacted: row.user_reacted,
          });
        }
        // Sort each event's summaries by count descending
        for (const [, summaries] of map) {
          summaries.sort((a, b) => b.count - a.count);
        }
        setSummariesMap(map);
        return;
      }

      // Fallback: RPC doesn't exist (error code 42883) or other error
      if (rpcError && rpcError.code !== '42883') {
        console.error('RPC get_reaction_summaries failed, falling back:', rpcError);
      }

      setUsingRpc(false);

      // Legacy: fetch all rows and aggregate client-side
      const { data, error } = await supabase
        .from('event_reactions')
        .select('event_id, user_id, emoji');

      if (error) {
        console.error('Failed to fetch reactions:', error);
        return;
      }
      setRawReactions(data ?? []);
    }

    fetchReactions();
  }, [user]);

  // Build summaries from raw rows (legacy path only)
  const legacyReactionsByEvent = useMemo(() => {
    if (usingRpc) return new Map<string, ReactionSummary[]>();

    const map = new Map<string, ReactionSummary[]>();
    const eventGroups = new Map<string, { emoji: string; user_id: string }[]>();
    for (const r of rawReactions) {
      if (!eventGroups.has(r.event_id)) eventGroups.set(r.event_id, []);
      eventGroups.get(r.event_id)!.push(r);
    }

    for (const [eventId, reactions] of eventGroups) {
      const emojiCounts = new Map<string, { count: number; reacted: boolean }>();
      for (const r of reactions) {
        const existing = emojiCounts.get(r.emoji) ?? { count: 0, reacted: false };
        existing.count++;
        if (user && r.user_id === user.id) existing.reacted = true;
        emojiCounts.set(r.emoji, existing);
      }

      const summaries: ReactionSummary[] = [];
      for (const [emoji, { count, reacted }] of emojiCounts) {
        summaries.push({ emoji: emoji as ReactionEmoji, count, reacted });
      }
      summaries.sort((a, b) => b.count - a.count);
      map.set(eventId, summaries);
    }
    return map;
  }, [rawReactions, user, usingRpc]);

  // Expose the right map depending on which path we used
  const reactionsByEvent = usingRpc ? summariesMap : legacyReactionsByEvent;

  const toggleReaction = useCallback(
    async (eventId: string, emoji: ReactionEmoji) => {
      if (!user) return;

      if (usingRpc) {
        // --- RPC path: optimistic updates on the aggregated summariesMap ---
        const currentSummaries = summariesMap.get(eventId) ?? [];
        const existingIdx = currentSummaries.findIndex((s) => s.emoji === emoji);
        const isReacted = existingIdx >= 0 && currentSummaries[existingIdx].reacted;

        if (isReacted) {
          // Optimistic remove
          const updated = currentSummaries.map((s) => {
            if (s.emoji !== emoji) return s;
            return { ...s, count: s.count - 1, reacted: false };
          }).filter((s) => s.count > 0);

          setSummariesMap((prev) => {
            const next = new Map(prev);
            if (updated.length > 0) {
              next.set(eventId, updated.sort((a, b) => b.count - a.count));
            } else {
              next.delete(eventId);
            }
            return next;
          });

          const { error } = await supabase
            .from('event_reactions')
            .delete()
            .eq('event_id', eventId)
            .eq('user_id', user.id)
            .eq('emoji', emoji);

          if (error) {
            console.error('Failed to remove reaction:', error);
            // Revert
            setSummariesMap((prev) => {
              const next = new Map(prev);
              next.set(eventId, currentSummaries);
              return next;
            });
          }
        } else {
          // Optimistic add
          let updated: ReactionSummary[];
          if (existingIdx >= 0) {
            // Emoji exists for this event but user hasn't reacted
            updated = currentSummaries.map((s) => {
              if (s.emoji !== emoji) return s;
              return { ...s, count: s.count + 1, reacted: true };
            });
          } else {
            // Brand new emoji for this event
            updated = [...currentSummaries, { emoji, count: 1, reacted: true }];
          }
          updated.sort((a, b) => b.count - a.count);

          setSummariesMap((prev) => {
            const next = new Map(prev);
            next.set(eventId, updated);
            return next;
          });

          const { error } = await supabase.from('event_reactions').insert({
            event_id: eventId,
            user_id: user.id,
            emoji,
          });

          if (error) {
            console.error('Failed to add reaction:', error);
            // Revert
            setSummariesMap((prev) => {
              const next = new Map(prev);
              if (currentSummaries.length > 0) {
                next.set(eventId, currentSummaries);
              } else {
                next.delete(eventId);
              }
              return next;
            });
          }
        }
      } else {
        // --- Legacy path: optimistic updates on rawReactions ---
        const existing = rawReactions.find(
          (r) => r.event_id === eventId && r.user_id === user.id && r.emoji === emoji
        );

        if (existing) {
          // Optimistic remove
          setRawReactions((prev) =>
            prev.filter(
              (r) => !(r.event_id === eventId && r.user_id === user.id && r.emoji === emoji)
            )
          );
          const { error } = await supabase
            .from('event_reactions')
            .delete()
            .eq('event_id', eventId)
            .eq('user_id', user.id)
            .eq('emoji', emoji);

          if (error) {
            console.error('Failed to remove reaction:', error);
            // Revert
            setRawReactions((prev) => [...prev, { event_id: eventId, user_id: user.id, emoji }]);
          }
        } else {
          // Optimistic add
          const newReaction = { event_id: eventId, user_id: user.id, emoji };
          setRawReactions((prev) => [...prev, newReaction]);

          const { error } = await supabase.from('event_reactions').insert({
            event_id: eventId,
            user_id: user.id,
            emoji,
          });

          if (error) {
            console.error('Failed to add reaction:', error);
            // Revert
            setRawReactions((prev) =>
              prev.filter(
                (r) => !(r.event_id === eventId && r.user_id === user.id && r.emoji === emoji)
              )
            );
          }
        }
      }
    },
    [user, usingRpc, summariesMap, rawReactions]
  );

  return { reactionsByEvent, toggleReaction };
}
