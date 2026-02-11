'use client';

import { useMemo } from 'react';
import { ETHDenverEvent } from '@/lib/types';
import { formatDateLabel } from '@/lib/utils';
import { EventCard } from './EventCard';

interface ListViewProps {
  events: ETHDenverEvent[];
  totalCount: number;
  starred?: Set<string>;
  itinerary?: Set<string>;
  onStarToggle?: (eventId: string) => void;
  onItineraryToggle?: (eventId: string) => void;
}

interface DateGroup {
  dateISO: string;
  label: string;
  events: ETHDenverEvent[];
}

function sortByStartTime(a: ETHDenverEvent, b: ETHDenverEvent): number {
  // All-day events come first
  if (a.isAllDay && !b.isAllDay) return -1;
  if (!a.isAllDay && b.isAllDay) return 1;
  if (a.isAllDay && b.isAllDay) return a.name.localeCompare(b.name);

  // Compare start times by parsing them
  const timeToMinutes = (t: string): number => {
    const normalized = t.toLowerCase().trim();
    const match = normalized.match(/(\d{1,2}):?(\d{2})?\s*(am?|pm?)?/i);
    if (!match) return 0;
    let hour = parseInt(match[1]);
    const min = match[2] ? parseInt(match[2]) : 0;
    const isPM = match[3] && match[3].startsWith('p');
    const isAM = match[3] && match[3].startsWith('a');
    if (isPM && hour !== 12) hour += 12;
    if (isAM && hour === 12) hour = 0;
    return hour * 60 + min;
  };

  return timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
}

export function ListView({
  events,
  totalCount,
  starred,
  itinerary,
  onStarToggle,
  onItineraryToggle,
}: ListViewProps) {
  const dateGroups: DateGroup[] = useMemo(() => {
    const groupMap = new Map<string, ETHDenverEvent[]>();

    for (const event of events) {
      const key = event.dateISO || 'unknown';
      if (!groupMap.has(key)) {
        groupMap.set(key, []);
      }
      groupMap.get(key)!.push(event);
    }

    return Array.from(groupMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dateISO, groupEvents]) => ({
        dateISO,
        label:
          dateISO === 'unknown' ? 'Date TBD' : formatDateLabel(dateISO),
        events: groupEvents.sort(sortByStartTime),
      }));
  }, [events]);

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-500">
        <p className="text-lg font-medium">No events found</p>
        <p className="text-sm mt-1">Try adjusting your filters</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 pb-8">
      {/* Date groups */}
      {dateGroups.map((group) => (
        <section key={group.dateISO} className="mb-6">
          {/* Sticky date header */}
          <div className="sticky top-[57px] z-40 bg-slate-900/95 backdrop-blur-sm py-2 -mx-4 px-4 border-b border-slate-800">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-white">
                {group.label}
              </h2>
              <span className="text-xs text-slate-500 font-medium">
                {group.events.length} event{group.events.length !== 1 ? 's' : ''}
              </span>
            </div>
          </div>

          {/* Event cards */}
          <div className="space-y-3 mt-3">
            {group.events.map((event) => (
              <EventCard
                key={event.id}
                event={event}
                isStarred={starred?.has(event.id)}
                isInItinerary={itinerary?.has(event.id)}
                onStarToggle={onStarToggle}
                onItineraryToggle={onItineraryToggle}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
