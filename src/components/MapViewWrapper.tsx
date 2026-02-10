'use client';

import dynamic from 'next/dynamic';
import type { ETHDenverEvent } from '@/lib/types';

const MapView = dynamic(
  () => import('./MapView').then((mod) => ({ default: mod.MapView })),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full bg-slate-900 flex items-center justify-center">
        <div className="text-slate-400">Loading map...</div>
      </div>
    ),
  }
);

interface MapViewWrapperProps {
  events: ETHDenverEvent[];
  onEventSelect?: (event: ETHDenverEvent) => void;
  starred?: Set<string>;
  itinerary?: Set<string>;
  onStarToggle?: (eventId: string) => void;
  onItineraryToggle?: (eventId: string) => void;
}

export function MapViewWrapper({
  events,
  onEventSelect,
  starred,
  itinerary,
  onStarToggle,
  onItineraryToggle,
}: MapViewWrapperProps) {
  return (
    <div className="w-full h-full">
      <MapView
        events={events}
        onEventSelect={onEventSelect}
        starred={starred}
        itinerary={itinerary}
        onStarToggle={onStarToggle}
        onItineraryToggle={onItineraryToggle}
      />
    </div>
  );
}
