'use client';

import { CalendarPlus, CalendarCheck } from 'lucide-react';
import clsx from 'clsx';

interface ItineraryButtonProps {
  eventId: string;
  isInItinerary: boolean;
  onToggle: (eventId: string) => void;
  size?: 'sm' | 'md';
}

export function ItineraryButton({
  eventId,
  isInItinerary,
  onToggle,
  size = 'md',
}: ItineraryButtonProps) {
  const iconSize = size === 'sm' ? 'w-3.5 h-3.5' : 'w-5 h-5';

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onToggle(eventId);
      }}
      className={clsx(
        'shrink-0 rounded transition-colors cursor-pointer',
        size === 'sm' ? 'p-0.5' : 'p-1',
        isInItinerary
          ? 'text-orange-400 bg-orange-500/10'
          : 'text-slate-600 hover:text-orange-400/60'
      )}
      aria-label={
        isInItinerary ? 'Remove from itinerary' : 'Add to itinerary'
      }
      title={isInItinerary ? 'Remove from itinerary' : 'Add to itinerary'}
    >
      {isInItinerary ? (
        <CalendarCheck className={iconSize} />
      ) : (
        <CalendarPlus className={iconSize} />
      )}
    </button>
  );
}
