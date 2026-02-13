'use client';

import { Popup } from 'react-map-gl/mapbox';
import { X, Calendar } from 'lucide-react';
import type { ETHDenverEvent } from '@/lib/types';
import { trackEventClick } from '@/lib/analytics';
import { StarButton } from './StarButton';
import { TagBadge } from './TagBadge';
import { OGImage } from './OGImage';

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
  const timeDisplay = event.isAllDay
    ? 'All Day'
    : `${event.startTime}${event.endTime ? ` - ${event.endTime}` : ''}`;

  return (
    <div className="w-[300px] max-w-[calc(100vw-3rem)] flex gap-3">
      {/* Left: cover image */}
      {event.link && <OGImage url={event.link} eventId={event.id} />}

      {/* Right: event details */}
      <div className="flex-1 min-w-0">
        {/* Top row: Star + Name + Close */}
        <div className="flex items-start gap-1">
          {onItineraryToggle && (
            <StarButton
              eventId={event.id}
              isStarred={isInItinerary}
              onToggle={onItineraryToggle}
              size="sm"
            />
          )}
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-sm text-white leading-tight line-clamp-2">
              {event.link ? (
                <a
                  href={event.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-orange-400 transition-colors"
                  onClick={() => trackEventClick(event.name, event.link!)}
                >
                  {event.name}
                </a>
              ) : (
                event.name
              )}
            </h3>
            {event.organizer && (
              <p className="text-xs text-slate-500 mt-0.5">{event.organizer}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="shrink-0 p-1 text-slate-400 hover:text-white active:text-white transition-colors"
            aria-label="Close popup"
          >
            <X size={14} />
          </button>
        </div>

        {/* Date + Time */}
        <p className="text-slate-400 text-xs mt-1.5 flex items-center gap-1">
          <Calendar className="w-3 h-3 shrink-0" />
          <span>{event.date} · {timeDisplay}</span>
        </p>

        {/* Tags row */}
        {event.tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 mt-2">
            {event.tags.map((tag) => (
              <TagBadge key={tag} tag={tag} />
            ))}
          </div>
        )}

        {/* Note */}
        {event.note && (
          <p className="text-slate-600 text-xs mt-1 italic line-clamp-2">{event.note}</p>
        )}
      </div>
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
      <div className="w-[300px] max-w-[calc(100vw-3rem)]">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-bold text-sm text-white">
            {events.length} events at this location
          </h3>
          <button
            onClick={onClose}
            className="shrink-0 p-1 text-slate-400 hover:text-white active:text-white transition-colors"
            aria-label="Close popup"
          >
            <X size={14} />
          </button>
        </div>
        <div className="max-h-[260px] overflow-y-auto space-y-1.5 pr-1">
          {events.map((event) => {
            const timeDisplay = event.isAllDay
              ? 'All Day'
              : event.startTime;
            return (
              <button
                key={event.id}
                className="w-full text-left p-2.5 bg-slate-700/50 hover:bg-slate-600/50 active:bg-slate-600/50 rounded-lg transition-colors"
                onClick={() => onSelectEvent?.(event)}
              >
                <p className="text-xs font-semibold text-white leading-tight truncate">
                  {event.name}
                </p>
                {event.organizer && (
                  <p className="text-[10px] text-slate-500 mt-0.5 truncate">{event.organizer}</p>
                )}
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  <span className="text-[10px] text-slate-400">
                    {timeDisplay}
                  </span>
                  {event.tags.slice(0, 3).map((tag) => (
                    <TagBadge key={tag} tag={tag} iconOnly />
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </Popup>
  );
}
