'use client';

import { Star } from 'lucide-react';
import clsx from 'clsx';

interface StarButtonProps {
  eventId: string;
  isStarred: boolean;
  onToggle: (eventId: string) => void;
  size?: 'sm' | 'md';
}

export function StarButton({
  eventId,
  isStarred,
  onToggle,
  size = 'md',
}: StarButtonProps) {
  const iconSize = size === 'sm' ? 'w-3.5 h-3.5' : 'w-5 h-5';

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onToggle(eventId);
      }}
      className={clsx(
        'shrink-0 transition-colors cursor-pointer',
        size === 'sm' ? 'p-1.5' : 'p-1',
        isStarred
          ? 'text-yellow-400'
          : 'text-gray-300 dark:text-slate-600 hover:text-yellow-500/60 dark:hover:text-yellow-400/60 active:text-yellow-500/60 dark:active:text-yellow-400/60'
      )}
      aria-label={isStarred ? 'Remove star' : 'Add star'}
      title={isStarred ? 'Remove star' : 'Star this event'}
    >
      <Star
        className={iconSize}
        fill={isStarred ? 'currentColor' : 'none'}
      />
    </button>
  );
}
