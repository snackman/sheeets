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
  'fixed bottom-6 right-6 z-40 flex items-center gap-2 h-10 px-3.5 rounded-lg ' +
  'bg-[var(--theme-filter-control-bg)] border border-[var(--theme-filter-control-border)] ' +
  'text-[var(--theme-filter-text)] hover:text-[var(--theme-text-primary)] hover:bg-[var(--theme-bg-tertiary)] ' +
  'shadow-lg shadow-black/20 backdrop-blur-sm transition-colors';

export function ItineraryFAB({ count, conference, onSignInNeeded, isSignedIn }: ItineraryFABProps) {
  const href = conference ? `/plan?conf=${encodeURIComponent(conference)}` : '/plan';

  const badge = count > 0 ? (
    <span className="text-[10px] font-bold min-w-[18px] h-[18px] flex items-center justify-center rounded-full px-1 bg-orange-500 text-white">
      {count}
    </span>
  ) : null;

  if (count > 0 || isSignedIn) {
    return (
      <Link href={href} className={fabClass}>
        <CalendarIcon className="w-5 h-5" />
        {badge}
      </Link>
    );
  }

  return (
    <button onClick={onSignInNeeded} className={`${fabClass} cursor-pointer`}>
      <CalendarIcon className="w-5 h-5" />
    </button>
  );
}
