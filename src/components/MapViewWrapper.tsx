'use client';

import { useState, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { ChevronUp, ChevronDown, MapPinOff } from 'lucide-react';
import type { ETHDenverEvent } from '@/lib/types';
import type { RsvpStatus } from '@/hooks/useRsvp';
import { EventCard } from './EventCard';

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
  isItineraryView?: boolean;
  friendsCountByEvent?: Map<string, number>;
  friendsByEvent?: Map<string, { userId: string; displayName: string }[]>;
  getRsvpState?: (eventId: string) => { status: RsvpStatus };
  onRsvp?: (eventId: string, eventUrl: string) => void;
}

export function MapViewWrapper({
  events,
  onEventSelect,
  itinerary,
  onItineraryToggle,
  isItineraryView,
  friendsCountByEvent,
  friendsByEvent,
  getRsvpState,
  onRsvp,
}: MapViewWrapperProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  const noLocationEvents = useMemo(
    () => events.filter((e) => e.lat == null || e.lng == null),
    [events]
  );

  const count = noLocationEvents.length;

  return (
    <div className="w-full h-full overflow-hidden relative">
      <MapView
        events={events}
        onEventSelect={onEventSelect}
        itinerary={itinerary}
        onItineraryToggle={onItineraryToggle}
        isItineraryView={isItineraryView}
        friendsCountByEvent={friendsCountByEvent}
        friendsByEvent={friendsByEvent}
        getRsvpState={getRsvpState}
        onRsvp={onRsvp}
      />

      {/* No-location drawer */}
      {count > 0 && (
        <div className="absolute bottom-0 left-0 right-0 z-10 flex flex-col pointer-events-none">
          {/* Scrollable event list */}
          {drawerOpen && (
            <div className="pointer-events-auto bg-slate-900/95 backdrop-blur-sm border-t border-slate-700 max-h-[45vh] overflow-y-auto">
              <div className="max-w-3xl mx-auto px-3 py-2 space-y-2">
                {noLocationEvents.map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    isInItinerary={itinerary?.has(event.id) ?? false}
                    onItineraryToggle={onItineraryToggle}
                    friendsCount={friendsCountByEvent?.get(event.id)}
                    friendsGoing={friendsByEvent?.get(event.id)}
                    rsvpStatus={getRsvpState?.(event.id)?.status}
                    onRsvp={onRsvp}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Toggle tab */}
          <button
            onClick={() => setDrawerOpen(!drawerOpen)}
            className="pointer-events-auto self-center mb-2 flex items-center gap-1.5 px-3 py-1.5 bg-slate-800/90 backdrop-blur-sm border border-slate-600 rounded-full text-xs text-slate-300 hover:text-white hover:bg-slate-700 active:bg-slate-700 transition-colors cursor-pointer shadow-lg"
          >
            <MapPinOff className="w-3.5 h-3.5" />
            {count} without location
            {drawerOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
          </button>
        </div>
      )}
    </div>
  );
}
