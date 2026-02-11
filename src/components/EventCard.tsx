'use client';

import { MapPin, ExternalLink } from 'lucide-react';
import { ETHDenverEvent } from '@/lib/types';
import { VIBE_COLORS } from '@/lib/constants';
import { StarButton } from './StarButton';
import { ItineraryButton } from './ItineraryButton';

interface EventCardProps {
  event: ETHDenverEvent;
  isStarred?: boolean;
  isInItinerary?: boolean;
  onStarToggle?: (eventId: string) => void;
  onItineraryToggle?: (eventId: string) => void;
}

export function EventCard({
  event,
  isStarred = false,
  isInItinerary = false,
  onStarToggle,
  onItineraryToggle,
}: EventCardProps) {
  const vibeColor = VIBE_COLORS[event.vibe] || VIBE_COLORS['default'];

  const timeDisplay = event.isAllDay
    ? 'All Day'
    : `${event.startTime}${event.endTime ? ` - ${event.endTime}` : ''}`;

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 hover:bg-slate-750 hover:border-slate-600 transition-colors group">
      {/* Top row: Star, Name, Itinerary button */}
      <div className="flex items-start gap-2">
        {/* Star button */}
        {onStarToggle ? (
          <StarButton
            eventId={event.id}
            isStarred={isStarred}
            onToggle={onStarToggle}
          />
        ) : (
          <div className="w-5 shrink-0" />
        )}

        {/* Event name (links to RSVP if available) */}
        <h3 className="flex-1 font-semibold text-white text-sm sm:text-base leading-tight min-w-0">
          {event.link ? (
            <a
              href={event.link}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-orange-400 transition-colors inline-flex items-center gap-1"
            >
              {event.name}
              <ExternalLink className="w-3 h-3 text-slate-500 flex-shrink-0" />
            </a>
          ) : (
            event.name
          )}
        </h3>

        {/* Itinerary button */}
        {onItineraryToggle && (
          <ItineraryButton
            eventId={event.id}
            isInItinerary={isInItinerary}
            onToggle={onItineraryToggle}
          />
        )}
      </div>

      {/* Organizer */}
      {event.organizer && (
        <p className="text-slate-500 text-xs mt-1 ml-7">By {event.organizer}</p>
      )}

      {/* Date + Time */}
      <p className="text-slate-400 text-sm mt-1 ml-7">
        {event.date} · {timeDisplay}
      </p>

      {/* Address */}
      {event.address && (
        <p className="text-slate-500 text-sm mt-1 flex items-start gap-1">
          <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span className="truncate">{event.address}</span>
        </p>
      )}

      {/* Badges row */}
      <div className="flex flex-wrap items-center gap-1.5 mt-3">
        {/* Vibe badge */}
        {event.vibe && (
          <span
            className="px-2 py-0.5 rounded-full text-xs font-medium text-white"
            style={{ backgroundColor: vibeColor }}
          >
            {event.vibe}
          </span>
        )}

        {/* Cost badge */}
        {event.isFree ? (
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/20 text-emerald-400">
            FREE
          </span>
        ) : event.cost ? (
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/20 text-amber-400">
            {event.cost}
          </span>
        ) : null}

        {/* Food icon */}
        {event.hasFood && (
          <span
            className="text-sm"
            role="img"
            aria-label="Food available"
            title="Food available"
          >
            🍕
          </span>
        )}

        {/* Bar icon */}
        {event.hasBar && (
          <span
            className="text-sm"
            role="img"
            aria-label="Bar available"
            title="Bar available"
          >
            🍺
          </span>
        )}
      </div>

      {/* Note */}
      {event.note && (
        <p className="text-slate-600 text-xs mt-1 italic">{event.note}</p>
      )}
    </div>
  );
}
