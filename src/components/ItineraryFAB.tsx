'use client';

import Link from 'next/link';
import { CalendarIcon } from './icons/CalendarIcon';

interface ItineraryFABProps {
  count: number;
  conference?: string;
}

export function ItineraryFAB({ count, conference }: ItineraryFABProps) {
  const href = conference ? `/plan?conf=${encodeURIComponent(conference)}` : '/plan';

  return (
    <Link
      href={href}
      className="fixed bottom-6 right-6 z-40 flex items-center gap-2 px-4 py-3 rounded-full bg-[var(--theme-accent)] text-[var(--theme-accent-text)] shadow-lg hover:bg-[var(--theme-accent-hover)] transition-colors"
    >
      <CalendarIcon className="w-5 h-5" />
      <span className="text-sm font-semibold">{count}</span>
    </Link>
  );
}
