'use client';

import { Popup } from 'react-map-gl/mapbox';
import { X } from 'lucide-react';
import type { ETHDenverEvent } from '@/lib/types';
import { VIBE_COLORS } from '@/lib/constants';
import { StarButton } from './StarButton';

interface EventPopupProps {
  event: ETHDenverEvent;
  latitude: number;
  longitude: number;
  onClose: () => void;
  isInItinerary?: boolean;
  onItineraryToggle?: (eventId: string) => void;
}

interface MultiEventPopupProps {
  events: ETHDenverEvent[];
  latitude: number;
  longitude: number;
  onClose: () => void;
  onSelectEvent?: (event: ETHDenverEvent) => void;
}

function SingleEventContent({
  event,
  onClose,
  isInItinerary = false,
  onItineraryToggle,
}: {
  event: ETHDenverEvent;
  onClose: () => void;
  isInItinerary?: boolean;
  onItineraryToggle?: (eventId: string) => void;
}) {
  const vibeColor = VIBE_COLORS[event.vibe] || VIBE_COLORS['default'];
  const timeDisplay = event.isAllDay
    ? 'All Day'
    : `${event.startTime}${event.endTime ? ` - ${event.endTime}` : ''}`;

  return (
    <div className="w-[280px] max-w-[calc(100vw-3rem)]">
      {/* Row 1: Event name (linked) + star + close */}
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="min-w-0 flex-1">
          {event.link ? (
            <a
              href={event.link}
              target="_blank"
              rel="noopener noreferrer"
              className="font-bold text-sm text-white leading-tight line-clamp-2 hover:text-orange-300 transition-colors"
            >
              {event.name}
            </a>
          ) : (
            <h3 className="font-bold text-sm text-white leading-tight line-clamp-2">
              {event.name}
            </h3>
          )}
          {event.organizer && (
            <p className="text-xs text-slate-500 mt-0.5">{event.organizer}</p>
          )}
        </div>
        <div className="flex items-center shrink-0">
          {onItineraryToggle && (
            <StarButton
              eventId={event.id}
              isStarred={isInItinerary}
              onToggle={onItineraryToggle}
              size="sm"
            />
          )}
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white active:text-white transition-colors"
            aria-label="Close popup"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Row 2: Vibe tag + cost */}
      <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
        <span
          className="px-1.5 py-0.5 rounded text-[10px] font-semibold text-white"
          style={{ backgroundColor: vibeColor }}
        >
          {event.vibe || 'Event'}
        </span>
        <span className="text-xs text-slate-400">
          {event.isFree ? 'Free' : event.cost || 'Paid'}
        </span>
      </div>

      {/* Row 3: Date + time */}
      <p className="text-xs text-slate-300">
        {event.date} &middot; {timeDisplay}
      </p>
    </div>
  );
}

export function EventPopup({
  event,
  latitude,
  longitude,
  onClose,
  isInItinerary,
  onItineraryToggle,
}: EventPopupProps) {
  return (
    <Popup
      latitude={latitude}
      longitude={longitude}
      onClose={onClose}
      closeButton={false}
      closeOnClick={false}
      anchor="bottom"
      offset={16}
      className="map-popup"
    >
      <SingleEventContent
        event={event}
        onClose={onClose}
        isInItinerary={isInItinerary}
        onItineraryToggle={onItineraryToggle}
      />
    </Popup>
  );
}

export function MultiEventPopup({
  events,
  latitude,
  longitude,
  onClose,
  onSelectEvent,
}: MultiEventPopupProps) {
  return (
    <Popup
      latitude={latitude}
      longitude={longitude}
      onClose={onClose}
      closeButton={false}
      closeOnClick={false}
      anchor="bottom"
      offset={16}
      className="map-popup"
    >
      <div className="w-[280px] max-w-[calc(100vw-3rem)]">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-bold text-sm text-white">
            {events.length} events at this location
          </h3>
          <button
            onClick={onClose}
            className="shrink-0 p-1.5 text-slate-400 hover:text-white active:text-white transition-colors"
            aria-label="Close popup"
          >
            <X size={16} />
          </button>
        </div>
        <div className="max-h-[240px] overflow-y-auto space-y-1.5 pr-1">
          {events.map((event) => {
            const vibeColor =
              VIBE_COLORS[event.vibe] || VIBE_COLORS['default'];
            return (
              <button
                key={event.id}
                className="w-full text-left p-2.5 bg-slate-700/50 hover:bg-slate-600/50 active:bg-slate-600/50 rounded transition-colors"
                onClick={() => onSelectEvent?.(event)}
              >
                <p className="text-xs font-semibold text-white leading-tight truncate">
                  {event.name}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span
                    className="px-1 py-0.5 rounded text-[9px] font-semibold text-white"
                    style={{ backgroundColor: vibeColor }}
                  >
                    {event.vibe || 'Event'}
                  </span>
                  <span className="text-[10px] text-slate-400">
                    {event.startTime}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </Popup>
  );
}
