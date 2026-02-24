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
 * Returns a Map of eventId -> reaction summaries + a toggleReaction function.
 */
export function useEventReactions() {
  const { user } = useAuth();
  const [rawReactions, setRawReactions] = useState<
    { event_id: string; user_id: string; emoji: string }[]
  >([]);

  useEffect(() => {
    if (!user) {
      setRawReactions([]);
      return;
    }

    async function fetchReactions() {
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

  const reactionsByEvent = useMemo(() => {
    const map = new Map<string, ReactionSummary[]>();
    // Group by event_id
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
      // Sort by count descending
      summaries.sort((a, b) => b.count - a.count);
      map.set(eventId, summaries);
    }
    return map;
  }, [rawReactions, user]);

  const toggleReaction = useCallback(
    async (eventId: string, emoji: ReactionEmoji) => {
      if (!user) return;

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
    },
    [user, rawReactions]
  );

  return { reactionsByEvent, toggleReaction };
}
