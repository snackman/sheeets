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

export function StarButton({
  eventId,
  isStarred,
  onToggle,
  size = 'md',
  friendsCount = 0,
}: StarButtonProps) {
  const iconSize = size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5';
  const containerSize = size === 'sm'
    ? 'w-5 h-5'
    : 'w-6 h-6';

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onToggle(eventId);
      }}
      className={clsx(
        'relative shrink-0 transition-colors cursor-pointer flex items-center justify-center rounded-full border',
        containerSize,
        isStarred
          ? 'bg-[var(--theme-accent)] text-[var(--theme-accent-text)] border-[var(--theme-accent)]'
          : 'text-[var(--theme-text-secondary)] border-[var(--theme-border-primary)] hover:text-[var(--theme-text-primary)] hover:border-[var(--theme-text-secondary)]',
      )}
      aria-label={isStarred ? 'Remove from plan' : 'Add to plan'}
      title={
        friendsCount > 0
          ? `${friendsCount} friend${friendsCount !== 1 ? 's' : ''} going`
          : isStarred
            ? 'Remove from plan'
            : 'Add to plan'
      }
    >
      {isStarred ? (
        <Check className={iconSize} strokeWidth={3} />
      ) : (
        <Plus className={iconSize} strokeWidth={2.5} />
      )}
      {friendsCount > 0 && (
        <span
          className={clsx(
            'absolute flex items-center justify-center rounded-full font-bold pointer-events-none',
            isStarred
              ? 'bg-[var(--theme-accent-text)] text-[var(--theme-accent)] border border-[var(--theme-accent)]'
              : 'bg-[var(--theme-accent)] text-[var(--theme-accent-text)]',
            size === 'sm'
              ? '-top-0.5 -right-0.5 min-w-[14px] h-[14px] text-[8px] px-0.5'
              : '-top-1 -right-1 min-w-[16px] h-[16px] text-[9px] px-0.5'
          )}
        >
          {friendsCount}
        </span>
      )}
    </button>
  );
}
