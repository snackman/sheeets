'use client';

import { MapPin } from 'lucide-react';
import { ETHDenverEvent } from '@/lib/types';
import { trackEventClick } from '@/lib/analytics';
import { StarButton } from './StarButton';
import { TagBadge } from './TagBadge';
import { OGImage } from './OGImage';

interface EventCardProps {
  event: ETHDenverEvent;
  isInItinerary?: boolean;
  onItineraryToggle?: (eventId: string) => void;
}

export function EventCard({
  event,
  isInItinerary = false,
  onItineraryToggle,
}: EventCardProps) {
  const timeDisplay = event.isAllDay
    ? 'All Day'
    : `${event.startTime}${event.endTime ? ` - ${event.endTime}` : ''}`;

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 hover:bg-slate-750 hover:border-slate-600 active:bg-slate-750 active:border-slate-600 transition-colors group flex gap-4">
      {/* Left: cover image */}
      {event.link && <OGImage url={event.link} eventId={event.id} />}

      {/* Right: event details */}
      <div className="flex-1 min-w-0">
        {/* Top row: Star, Name */}
        <div className="flex items-start gap-2">
          {onItineraryToggle ? (
            <StarButton
              eventId={event.id}
              isStarred={isInItinerary}
              onToggle={onItineraryToggle}
            />
          ) : (
            <div className="w-5 shrink-0" />
          )}

          <h3 className="flex-1 font-semibold text-white text-sm sm:text-base leading-tight min-w-0">
            {event.link ? (
              <a
                href={event.link}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-orange-400 active:text-orange-400 transition-colors"
                onClick={() => trackEventClick(event.name, event.link!)}
              >
                {event.name}
              </a>
            ) : (
              event.name
            )}
          </h3>
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
        {event.tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 mt-3">
            {event.tags.map((tag) => (
              <TagBadge key={tag} tag={tag} />
            ))}
          </div>
        )}

        {/* Note */}
        {event.note && (
          <p className="text-slate-600 text-xs mt-1 italic">{event.note}</p>
        )}
      </div>
    </div>
  );
}
