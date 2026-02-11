'use client';

import { ExternalLink, Star, Ticket } from 'lucide-react';
import type { ETHDenverEvent } from '@/lib/types';
import { isLumaLink } from '@/lib/utils';
import { TagBadge } from './TagBadge';

interface TableViewProps {
  events: ETHDenverEvent[];
  totalCount: number;
  itinerary?: Set<string>;
  onItineraryToggle?: (eventId: string) => void;
}

export function TableView({
  events,
  totalCount,
  itinerary,
  onItineraryToggle,
}: TableViewProps) {
  return (
    <div className="max-w-7xl mx-auto px-4 pb-3">
      <div className="overflow-auto rounded-lg border border-slate-700" style={{ maxHeight: 'calc(100vh - 220px)' }}>
        <table className="min-w-[900px] text-sm text-left">
          <thead className="text-xs uppercase tracking-wider text-slate-400 bg-slate-800 border-b border-slate-700 sticky top-0 z-10">
            <tr>
              <th className="px-3 py-2.5 w-8"></th>
              <th className="px-3 py-2.5">Date</th>
              <th className="px-3 py-2.5">Time</th>
              <th className="px-3 py-2.5">Organizer</th>
              <th className="px-3 py-2.5">Event</th>
              <th className="px-3 py-2.5 text-center">RSVP</th>
              <th className="px-3 py-2.5">Tags</th>
              <th className="px-3 py-2.5">Location</th>
              <th className="px-3 py-2.5">Cost</th>
              <th className="px-3 py-2.5 text-center" title="Food">F</th>
              <th className="px-3 py-2.5 text-center" title="Bar">B</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/50">
            {events.map((event) => {
              const isInItinerary = itinerary?.has(event.id) ?? false;

              return (
                <tr
                  key={event.id}
                  className="bg-slate-900 hover:bg-slate-800/70 transition-colors"
                >
                  {/* Star (toggles itinerary) */}
                  <td className="px-2 py-2">
                    <button
                      onClick={() => onItineraryToggle?.(event.id)}
                      className="cursor-pointer p-0.5"
                      title={isInItinerary ? 'Remove from itinerary' : 'Add to itinerary'}
                    >
                      <Star
                        className={`w-3.5 h-3.5 ${isInItinerary ? 'text-yellow-400 fill-yellow-400' : 'text-slate-600 hover:text-slate-400'}`}
                      />
                    </button>
                  </td>

                  {/* Date */}
                  <td className="px-3 py-2 text-slate-300 whitespace-nowrap">
                    {event.date}
                  </td>

                  {/* Time */}
                  <td className="px-3 py-2 text-slate-400 whitespace-nowrap">
                    {event.startTime}
                    {event.endTime ? `-${event.endTime}` : ''}
                  </td>

                  {/* Organizer */}
                  <td className="px-3 py-2 text-slate-400 whitespace-nowrap" title={event.organizer}>
                    {event.organizer.length > 15 ? event.organizer.slice(0, 15) + '…' : event.organizer}
                  </td>

                  {/* Event Name */}
                  <td className="px-3 py-2 font-medium text-slate-100 whitespace-nowrap" title={event.name}>
                    {event.link ? (
                      <a
                        href={event.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-orange-400 transition-colors"
                      >
                        {event.name.length > 25 ? event.name.slice(0, 25) + '…' : event.name}
                      </a>
                    ) : (
                      event.name.length > 25 ? event.name.slice(0, 25) + '…' : event.name
                    )}
                  </td>

                  {/* RSVP */}
                  <td className="px-3 py-2 text-center">
                    {event.link && (
                      <a
                        href={event.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${
                          isLumaLink(event.link)
                            ? 'bg-purple-500/20 text-purple-400 hover:bg-purple-500/30'
                            : 'bg-orange-500/20 text-orange-400 hover:bg-orange-500/30'
                        }`}
                      >
                        <Ticket className="w-3 h-3" />
                        {isLumaLink(event.link) ? 'Luma' : 'RSVP'}
                      </a>
                    )}
                  </td>

                  {/* Tags */}
                  <td className="px-3 py-2">
                    <div className="flex gap-1 items-center" title={event.tags.join(', ')}>
                      {event.tags.slice(0, 3).map((tag) => (
                        <TagBadge key={tag} tag={tag} iconOnly />
                      ))}
                      {event.tags.length > 3 && (
                        <span className="text-slate-500 text-xs">+{event.tags.length - 3}</span>
                      )}
                    </div>
                  </td>

                  {/* Location */}
                  <td className="px-3 py-2 text-slate-400 whitespace-nowrap" title={event.address}>
                    {event.address ? (
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.address)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-orange-400 transition-colors"
                      >
                        {event.address.length > 20 ? event.address.slice(0, 20) + '…' : event.address}
                      </a>
                    ) : null}
                  </td>

                  {/* Cost */}
                  <td className="px-3 py-2 whitespace-nowrap">
                    {event.isFree ? (
                      <span className="text-emerald-400 text-xs font-medium">FREE</span>
                    ) : (
                      <span className="text-amber-400 text-xs">{event.cost}</span>
                    )}
                  </td>

                  {/* Food */}
                  <td className="px-3 py-2 text-center">
                    {event.hasFood && <span title="Has food">🍕</span>}
                  </td>

                  {/* Bar */}
                  <td className="px-3 py-2 text-center">
                    {event.hasBar && <span title="Has bar">🍺</span>}
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
