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
  itinerary?: Set<string>;
  onItineraryToggle?: (eventId: string) => void;
}

export function MapViewWrapper({
  events,
  onEventSelect,
  itinerary,
  onItineraryToggle,
}: MapViewWrapperProps) {
  return (
    <div className="w-full h-full overflow-hidden">
      <MapView
        events={events}
        onEventSelect={onEventSelect}
        itinerary={itinerary}
        onItineraryToggle={onItineraryToggle}
      />
    </div>
  );
}
