'use client';

import Link from 'next/link';
import { CalendarIcon } from './icons/CalendarIcon';

interface ItineraryFABProps {
  count: number;
  conference?: string;
  onSignInNeeded?: () => void;
  isSignedIn: boolean;
}

const fabClass =
  'fixed bottom-6 right-6 z-40 flex items-center justify-center w-12 h-12 rounded-full ' +
  'bg-[var(--theme-accent-muted)] border border-[var(--theme-accent)] ' +
  'text-[var(--theme-accent)] hover:bg-[var(--theme-accent)] hover:text-[var(--theme-accent-text)] ' +
  'shadow-lg shadow-black/20 backdrop-blur-sm transition-colors';

export function ItineraryFAB({ count, conference, onSignInNeeded, isSignedIn }: ItineraryFABProps) {
  const href = conference ? `/plan?conf=${encodeURIComponent(conference)}` : '/plan';

  const badge = count > 0 ? (
    <span className="absolute -top-1 -right-1 text-[10px] font-bold min-w-[18px] h-[18px] flex items-center justify-center rounded-full px-1 bg-[var(--theme-accent)] text-[var(--theme-accent-text)]">
      {count}
    </span>
  ) : null;

  if (count > 0 || isSignedIn) {
    return (
      <Link href={href} className={fabClass}>
        <CalendarIcon className="w-6 h-6" />
        {badge}
      </Link>
    );
  }

  return (
    <button onClick={onSignInNeeded} className={`${fabClass} cursor-pointer`}>
      <CalendarIcon className="w-6 h-6" />
    </button>
  );
}
