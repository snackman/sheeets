'use client';

import { ExternalLink, Star, CalendarCheck } from 'lucide-react';
import type { ETHDenverEvent } from '@/lib/types';
import { VIBE_COLORS } from '@/lib/constants';

interface TableViewProps {
  events: ETHDenverEvent[];
  totalCount: number;
  starred?: Set<string>;
  itinerary?: Set<string>;
  onStarToggle?: (eventId: string) => void;
  onItineraryToggle?: (eventId: string) => void;
}

export function TableView({
  events,
  totalCount,
  starred,
  itinerary,
  onStarToggle,
  onItineraryToggle,
}: TableViewProps) {
  return (
    <div className="px-4 py-3">
      <div className="text-sm text-slate-400 mb-3">
        Showing {events.length} of {totalCount} events
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-700">
        <table className="w-full text-sm text-left">
          <thead className="text-xs uppercase tracking-wider text-slate-400 bg-slate-800 border-b border-slate-700">
            <tr>
              <th className="px-3 py-2.5 w-8"></th>
              <th className="px-3 py-2.5">Date</th>
              <th className="px-3 py-2.5">Time</th>
              <th className="px-3 py-2.5">Event</th>
              <th className="px-3 py-2.5">Vibe</th>
              <th className="px-3 py-2.5">Location</th>
              <th className="px-3 py-2.5">Cost</th>
              <th className="px-3 py-2.5">Organizer</th>
              <th className="px-3 py-2.5 text-center" title="Food">F</th>
              <th className="px-3 py-2.5 text-center" title="Bar">B</th>
              <th className="px-3 py-2.5 w-8"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/50">
            {events.map((event) => {
              const isStarred = starred?.has(event.id) ?? false;
              const isInItinerary = itinerary?.has(event.id) ?? false;
              const vibeColor = VIBE_COLORS[event.vibe] || VIBE_COLORS['default'];

              return (
                <tr
                  key={event.id}
                  className="bg-slate-900 hover:bg-slate-800/70 transition-colors"
                >
                  {/* Star + Itinerary */}
                  <td className="px-2 py-2">
                    <div className="flex gap-0.5">
                      <button
                        onClick={() => onStarToggle?.(event.id)}
                        className="cursor-pointer p-0.5"
                        title={isStarred ? 'Unstar' : 'Star'}
                      >
                        <Star
                          className={`w-3.5 h-3.5 ${isStarred ? 'text-yellow-400 fill-yellow-400' : 'text-slate-600 hover:text-slate-400'}`}
                        />
                      </button>
                      <button
                        onClick={() => onItineraryToggle?.(event.id)}
                        className="cursor-pointer p-0.5"
                        title={isInItinerary ? 'Remove from itinerary' : 'Add to itinerary'}
                      >
                        <CalendarCheck
                          className={`w-3.5 h-3.5 ${isInItinerary ? 'text-orange-400' : 'text-slate-600 hover:text-slate-400'}`}
                        />
                      </button>
                    </div>
                  </td>

                  {/* Date */}
                  <td className="px-3 py-2 text-slate-300 whitespace-nowrap">
                    {event.date}
                  </td>

                  {/* Time */}
                  <td className="px-3 py-2 text-slate-400 whitespace-nowrap">
                    {event.startTime}
                    {event.endTime ? ` - ${event.endTime}` : ''}
                  </td>

                  {/* Event Name */}
                  <td className="px-3 py-2 font-medium text-slate-100 max-w-xs">
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
                  </td>

                  {/* Vibe */}
                  <td className="px-3 py-2">
                    {event.vibe && (
                      <span
                        className="inline-block px-2 py-0.5 rounded-full text-xs font-medium text-white"
                        style={{ backgroundColor: vibeColor }}
                      >
                        {event.vibe}
                      </span>
                    )}
                  </td>

                  {/* Location */}
                  <td className="px-3 py-2 text-slate-400 max-w-[200px] truncate" title={event.address}>
                    {event.address}
                  </td>

                  {/* Cost */}
                  <td className="px-3 py-2 whitespace-nowrap">
                    {event.isFree ? (
                      <span className="text-emerald-400 text-xs font-medium">FREE</span>
                    ) : (
                      <span className="text-amber-400 text-xs">{event.cost}</span>
                    )}
                  </td>

                  {/* Organizer */}
                  <td className="px-3 py-2 text-slate-400 max-w-[180px] truncate" title={event.organizer}>
                    {event.organizer}
                  </td>

                  {/* Food */}
                  <td className="px-3 py-2 text-center">
                    {event.hasFood && <span title="Has food">🍕</span>}
                  </td>

                  {/* Bar */}
                  <td className="px-3 py-2 text-center">
                    {event.hasBar && <span title="Has bar">🍺</span>}
                  </td>

                  {/* Link */}
                  <td className="px-3 py-2">
                    {event.link && (
                      <a
                        href={event.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-orange-400 hover:text-orange-300"
                        title="RSVP"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {events.length === 0 && (
        <div className="text-center py-12 text-slate-500">
          No events match your filters.
        </div>
      )}
    </div>
  );
}
