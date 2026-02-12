'use client';

import { useState, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { ChevronUp, ChevronDown, MapPinOff, ExternalLink } from 'lucide-react';
import type { ETHDenverEvent } from '@/lib/types';
import { VIBE_COLORS } from '@/lib/constants';
import { StarButton } from './StarButton';

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
}

export function MapViewWrapper({
  events,
  onEventSelect,
  itinerary,
  onItineraryToggle,
  isItineraryView,
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
      />

      {/* No-location drawer */}
      {count > 0 && (
        <div className="absolute bottom-0 left-0 right-0 z-10 flex flex-col pointer-events-none">
          {/* Scrollable event list */}
          {drawerOpen && (
            <div className="pointer-events-auto bg-slate-900/95 backdrop-blur-sm border-t border-slate-700 max-h-[45vh] overflow-y-auto">
              <div className="max-w-3xl mx-auto px-3 py-2 space-y-1.5">
                {noLocationEvents.map((event) => {
                  const vibeColor = VIBE_COLORS[event.vibe] || VIBE_COLORS['default'];
                  const timeDisplay = event.isAllDay
                    ? 'All Day'
                    : event.startTime || '';
                  return (
                    <div
                      key={event.id}
                      className="flex items-center gap-2 px-3 py-2 bg-slate-800/80 rounded-lg"
                    >
                      {onItineraryToggle && (
                        <StarButton
                          eventId={event.id}
                          isStarred={itinerary?.has(event.id) ?? false}
                          onToggle={onItineraryToggle}
                          size="sm"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span
                            className="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-semibold text-white"
                            style={{ backgroundColor: vibeColor }}
                          >
                            {event.vibe || 'Event'}
                          </span>
                          <span className="text-[11px] text-slate-400 shrink-0">{event.date} {timeDisplay}</span>
                        </div>
                        <p className="text-sm text-white font-medium truncate mt-0.5">
                          {event.name}
                        </p>
                        {event.organizer && (
                          <p className="text-[11px] text-slate-500 truncate">
                            {event.organizer}
                          </p>
                        )}
                      </div>
                      {event.link && (
                        <a
                          href={event.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 p-2 text-orange-400 hover:text-orange-300 active:text-orange-300 transition-colors"
                          aria-label="Open event link"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      )}
                    </div>
                  );
                })}
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
