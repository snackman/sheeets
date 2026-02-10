'use client';

import { useState } from 'react';
import { Star, CalendarPlus, CalendarCheck, MapPin, ExternalLink } from 'lucide-react';
import { ETHDenverEvent } from '@/lib/types';
import { VIBE_COLORS } from '@/lib/constants';
import clsx from 'clsx';

interface EventCardProps {
  event: ETHDenverEvent;
}

export function EventCard({ event }: EventCardProps) {
  const [isStarred, setIsStarred] = useState(false);
  const [isInItinerary, setIsInItinerary] = useState(false);

  const vibeColor = VIBE_COLORS[event.vibe] || VIBE_COLORS['default'];

  const timeDisplay = event.isAllDay
    ? 'All Day'
    : `${event.startTime}${event.endTime ? ` - ${event.endTime}` : ''}`;

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 hover:bg-slate-750 hover:border-slate-600 transition-colors group">
      {/* Top row: Star, Name, Itinerary button */}
      <div className="flex items-start gap-2">
        {/* Star button */}
        <button
          onClick={() => setIsStarred(!isStarred)}
          className={clsx(
            'mt-0.5 shrink-0 transition-colors cursor-pointer',
            isStarred
              ? 'text-yellow-400'
              : 'text-slate-600 hover:text-yellow-400/60'
          )}
          aria-label={isStarred ? 'Remove star' : 'Add star'}
        >
          <Star
            className="w-5 h-5"
            fill={isStarred ? 'currentColor' : 'none'}
          />
        </button>

        {/* Event name */}
        <h3 className="flex-1 font-semibold text-white text-sm sm:text-base leading-tight min-w-0">
          {event.name}
        </h3>

        {/* Itinerary button */}
        <button
          onClick={() => setIsInItinerary(!isInItinerary)}
          className={clsx(
            'shrink-0 p-1 rounded transition-colors cursor-pointer',
            isInItinerary
              ? 'text-orange-400 bg-orange-500/10'
              : 'text-slate-600 hover:text-orange-400/60'
          )}
          aria-label={
            isInItinerary ? 'Remove from itinerary' : 'Add to itinerary'
          }
        >
          {isInItinerary ? (
            <CalendarCheck className="w-5 h-5" />
          ) : (
            <CalendarPlus className="w-5 h-5" />
          )}
        </button>
      </div>

      {/* Date + Time */}
      <p className="text-slate-400 text-sm mt-2">
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

      {/* Organizer */}
      {event.organizer && (
        <p className="text-slate-500 text-xs mt-2">By: {event.organizer}</p>
      )}

      {/* Note */}
      {event.note && (
        <p className="text-slate-600 text-xs mt-1 italic">{event.note}</p>
      )}

      {/* RSVP link */}
      {event.link && (
        <div className="mt-3 pt-2 border-t border-slate-700/50">
          <a
            href={event.link}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-orange-400 hover:text-orange-300 text-sm font-medium transition-colors"
          >
            RSVP
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      )}
    </div>
  );
}
