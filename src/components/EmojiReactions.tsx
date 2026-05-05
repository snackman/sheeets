'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { REACTION_EMOJIS } from '@/lib/constants';
import type { ReactionEmoji } from '@/lib/types';
import { trackReactionToggle, trackReactionPickerOpen } from '@/lib/analytics';

interface ReactionSummary {
  emoji: ReactionEmoji;
  count: number;
  reacted: boolean;
}

interface EmojiReactionsProps {
  eventId: string;
  reactions?: ReactionSummary[];
  onToggle: (eventId: string, emoji: ReactionEmoji) => void;
  compact?: boolean;
}

export function EmojiReactions({
  eventId,
  reactions = [],
  onToggle,
  compact = false,
}: EmojiReactionsProps) {
  const [showPicker, setShowPicker] = useState(false);

  // Emojis that already have reactions
  const activeEmojis = new Set(reactions.map((r) => r.emoji));
  // Emojis available to add
  const availableEmojis = REACTION_EMOJIS.filter((e) => !activeEmojis.has(e));

  const pillSize = compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-1.5 py-0.5 text-xs';
  const gap = compact ? 'gap-1' : 'gap-1.5';

  return (
    <div className={`flex flex-wrap items-center ${gap}`}>
      {reactions.map((r) => (
        <button
          key={r.emoji}
          onClick={(e) => {
            e.stopPropagation();
            trackReactionToggle(eventId, r.emoji, !r.reacted);
            onToggle(eventId, r.emoji);
          }}
          className={`${pillSize} rounded-full border transition-colors cursor-pointer inline-flex items-center gap-1 ${
            r.reacted
              ? 'border-[var(--theme-accent)]/60 bg-[var(--theme-accent)]/10 text-[var(--theme-text-primary)]'
              : 'border-[var(--theme-border-primary)] bg-[var(--theme-bg-tertiary)]/50 text-[var(--theme-text-secondary)] hover:border-[var(--theme-text-muted)]'
          }`}
        >
          <span>{r.emoji}</span>
          <span className="font-medium">{r.count}</span>
        </button>
      ))}

      {/* Add reaction button */}
      <div className="relative">
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (!showPicker) trackReactionPickerOpen();
            setShowPicker(!showPicker);
          }}
          className={`${pillSize} rounded-full border border-[var(--theme-border-primary)] bg-[var(--theme-bg-tertiary)]/50 text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)] hover:border-[var(--theme-text-muted)] transition-colors cursor-pointer inline-flex items-center`}
        >
          <Plus className={compact ? 'w-2.5 h-2.5' : 'w-3 h-3'} />
        </button>

        {showPicker && (
          <>
            <div
              className="fixed inset-0 z-[40]"
              onClick={(e) => {
                e.stopPropagation();
                setShowPicker(false);
              }}
            />
            <div className="absolute bottom-full left-0 mb-1 z-[41] bg-[var(--theme-bg-secondary)] border border-[var(--theme-border-primary)] rounded-lg shadow-xl p-1.5 flex gap-1">
              {(availableEmojis.length > 0 ? availableEmojis : REACTION_EMOJIS).map((emoji) => (
                <button
                  key={emoji}
                  onClick={(e) => {
                    e.stopPropagation();
                    trackReactionToggle(eventId, emoji, true);
                    onToggle(eventId, emoji as ReactionEmoji);
                    setShowPicker(false);
                  }}
                  className="p-1.5 rounded hover:bg-[var(--theme-bg-tertiary)] transition-colors cursor-pointer text-base"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
