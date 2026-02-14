'use client';

import { Star } from 'lucide-react';
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
  const iconSize = size === 'sm' ? 'w-4 h-4' : 'w-[22px] h-[22px]';

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onToggle(eventId);
      }}
      className={clsx(
        'relative shrink-0 transition-colors cursor-pointer',
        size === 'sm' ? 'p-1.5' : 'p-1',
        isStarred
          ? 'text-yellow-400'
          : 'text-slate-600 hover:text-yellow-400/60 active:text-yellow-400/60'
      )}
      aria-label={isStarred ? 'Remove star' : 'Add star'}
      title={
        friendsCount > 0
          ? `${friendsCount} friend${friendsCount !== 1 ? 's' : ''} going`
          : isStarred
            ? 'Remove star'
            : 'Star this event'
      }
    >
      <Star
        className={iconSize}
        fill={isStarred ? 'currentColor' : 'none'}
      />
      {friendsCount > 0 && (
        <span
          className={clsx(
            'absolute flex items-center justify-center rounded-full font-bold pointer-events-none',
            'bg-orange-500 text-white',
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
