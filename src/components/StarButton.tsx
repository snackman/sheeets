'use client';

import { Plus, Check } from 'lucide-react';
import clsx from 'clsx';

interface StarButtonProps {
  eventId: string;
  isStarred: boolean;
  onToggle: (eventId: string) => void;
  size?: 'sm' | 'md';
  friendsCount?: number;
}

/** Add/remove an event from the user's plan (+ when not in plan, check when in plan). */
export function StarButton({
  eventId,
  isStarred,
  onToggle,
  size = 'md',
  friendsCount = 0,
}: StarButtonProps) {
  const iconSize = size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5';
  const circleSize = size === 'sm' ? 'w-5 h-5' : 'w-6 h-6';
  const friendsLabel = `${friendsCount} friend${friendsCount !== 1 ? 's' : ''} going`;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle(eventId);
      }}
      // Visible circle stays small; hit-44 adds an invisible >= 44px touch target on touch/mobile.
      className="group/star hit-44 shrink-0 cursor-pointer flex items-center justify-center rounded-full"
      aria-label="Add to plan"
      aria-pressed={isStarred}
      title={friendsCount > 0 ? `${friendsLabel} · ${isStarred ? 'In your plan' : 'Add to plan'}` : isStarred ? 'Remove from plan' : 'Add to plan'}
    >
      <span
        className={clsx(
          'relative flex items-center justify-center rounded-full border transition-colors',
          circleSize,
          isStarred
            ? 'text-[var(--theme-accent)] border-[var(--theme-accent)] bg-[var(--theme-accent-muted)]'
            : 'text-[var(--theme-text-secondary)] border-[var(--theme-border-primary)] group-hover/star:text-[var(--theme-text-primary)] group-hover/star:border-[var(--theme-text-secondary)] group-hover/star:bg-[var(--theme-bg-tertiary)]',
        )}
      >
        {isStarred ? (
          <Check className={iconSize} strokeWidth={3} aria-hidden="true" />
        ) : (
          <Plus className={iconSize} strokeWidth={2.5} aria-hidden="true" />
        )}
        {friendsCount > 0 && (
          <span
            aria-hidden="true"
            className={clsx(
              'absolute flex items-center justify-center rounded-full font-bold pointer-events-none',
              isStarred
                ? 'bg-[var(--theme-accent-text)] text-[var(--theme-accent)] border border-[var(--theme-accent)]'
                : 'bg-[var(--theme-accent)] text-[var(--theme-accent-text)]',
              size === 'sm'
                ? '-top-1 -right-1.5 min-w-[14px] h-[14px] text-2xs px-0.5'
                : '-top-1 -right-1.5 min-w-[16px] h-[16px] text-2xs px-0.5',
            )}
          >
            {friendsCount}
          </span>
        )}
      </span>
      {friendsCount > 0 && <span className="sr-only">{friendsLabel}</span>}
    </button>
  );
}
