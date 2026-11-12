'use client';

import { EventCardSkeleton } from './EventCardSkeleton';

export function Loading() {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className="max-w-3xl mx-auto px-2 sm:px-4 py-4 space-y-3">
      <span className="sr-only">Loading events...</span>
      {Array.from({ length: 5 }, (_, i) => (
        <EventCardSkeleton key={i} />
      ))}
    </div>
  );
}
