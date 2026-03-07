'use client';

import { useState, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { ChevronUp, ChevronDown, MapPinOff } from 'lucide-react';
import type { ETHDenverEvent, POI, POICategory, ReactionEmoji, FriendLocation } from '@/lib/types';
import { EventCard } from './EventCard';

const MapView = dynamic(
  () => import('./MapView').then((mod) => ({ default: mod.MapView })),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full bg-stone-950 flex items-center justify-center">
        <div className="text-stone-400">Loading map...</div>
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
  checkedInFriendsByEvent?: Map<string, { userId: string; displayName: string }[]>;
  checkInCounts?: Map<string, number>;
  reactionsByEvent?: Map<string, { emoji: ReactionEmoji; count: number; reacted: boolean }[]>;
  onToggleReaction?: (eventId: string, emoji: ReactionEmoji) => void;
  commentCounts?: Map<string, number>;
  friendLocations?: FriendLocation[];
  conference?: string;
  pois?: POI[];
  onAddPOI?: (poi: { name: string; lat: number; lng: number; address?: string | null; category: POICategory; note?: string | null }) => Promise<unknown>;
  onRemovePOI?: (id: string) => void;
  onUpdatePOI?: (id: string, updates: Partial<Pick<POI, 'name' | 'category' | 'note' | 'is_public'>>) => void;
  ownerNames?: Map<string, string>;
}

export function MapViewWrapper({
  events,
  onEventSelect,
  itinerary,
  onItineraryToggle,
  isItineraryView,
  friendsCountByEvent,
  friendsByEvent,
  checkedInFriendsByEvent,
  checkInCounts,
  reactionsByEvent,
  onToggleReaction,
  commentCounts,
  friendLocations,
  conference,
  pois,
  onAddPOI,
  onRemovePOI,
  onUpdatePOI,
  ownerNames,
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
        checkedInFriendsByEvent={checkedInFriendsByEvent}
        checkInCounts={checkInCounts}
        reactionsByEvent={reactionsByEvent}
        onToggleReaction={onToggleReaction}
        commentCounts={commentCounts}
        friendLocations={friendLocations}
        conference={conference}
        pois={pois}
        onAddPOI={onAddPOI}
        onRemovePOI={onRemovePOI}
        onUpdatePOI={onUpdatePOI}
        ownerNames={ownerNames}
      />

      {/* No-location drawer */}
      {count > 0 && (
        <div className="absolute bottom-0 left-0 right-0 z-10 flex flex-col pointer-events-none">
          {/* Scrollable event list */}
          {drawerOpen && (
            <div className="pointer-events-auto bg-stone-950/95 backdrop-blur-sm border-t border-stone-700 max-h-[45vh] overflow-y-auto">
              <div className="max-w-3xl mx-auto px-3 py-2 space-y-2">
                {noLocationEvents.map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    isInItinerary={itinerary?.has(event.id) ?? false}
                    onItineraryToggle={onItineraryToggle}
                    friendsCount={friendsCountByEvent?.get(event.id)}
                    friendsGoing={friendsByEvent?.get(event.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Toggle tab */}
          <button
            onClick={() => setDrawerOpen(!drawerOpen)}
            className="pointer-events-auto self-center mb-2 flex items-center gap-1.5 px-3 py-1.5 bg-stone-900/90 backdrop-blur-sm border border-stone-600 rounded-full text-xs text-stone-300 hover:text-white hover:bg-stone-800 active:bg-stone-800 transition-colors cursor-pointer shadow-lg"
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
