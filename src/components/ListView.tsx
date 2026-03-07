'use client';

import { useMemo } from 'react';
import type { ETHDenverEvent, ReactionEmoji, NativeAd } from '@/lib/types';
import { formatDateLabel } from '@/lib/utils';
import { EventCard } from './EventCard';
import NativeAdCard from './NativeAdCard';

interface ListViewProps {
  events: ETHDenverEvent[];
  totalCount: number;
  itinerary?: Set<string>;
  onItineraryToggle?: (eventId: string) => void;
  friendsCountByEvent?: Map<string, number>;
  friendsByEvent?: Map<string, { userId: string; displayName: string }[]>;
  checkedInFriendsByEvent?: Map<string, { userId: string; displayName: string }[]>;
  checkInCounts?: Map<string, number>;
  reactionsByEvent?: Map<string, { emoji: ReactionEmoji; count: number; reacted: boolean }[]>;
  onToggleReaction?: (eventId: string, emoji: ReactionEmoji) => void;
  commentCounts?: Map<string, number>;
  nativeAds?: NativeAd[];
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
  itinerary,
  onItineraryToggle,
  friendsCountByEvent,
  friendsByEvent,
  checkedInFriendsByEvent,
  checkInCounts,
  reactionsByEvent,
  onToggleReaction,
  commentCounts,
  nativeAds,
}: ListViewProps) {
  const activeAds = nativeAds?.filter(ad => ad.active) || [];

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
      <div className="flex flex-col items-center justify-center py-20 text-sky-500">
        <p className="text-lg font-medium">No events found</p>
        <p className="text-sm mt-1">Try adjusting your filters</p>
      </div>
    );
  }

  let globalEventIndex = 0;

  return (
    <div className="max-w-3xl mx-auto px-2 sm:px-4 pb-8">
      {/* Date groups */}
      {dateGroups.map((group) => (
        <section key={group.dateISO} className="mb-6">
          {/* Sticky date header */}
          <div className="sticky top-0 z-20 bg-sky-950 py-2 -mx-2 px-2 sm:-mx-4 sm:px-4 border-b border-sky-900">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-white">
                {group.label}
              </h2>
              <span className="text-xs text-sky-500 font-medium">
                {group.events.length} event{group.events.length !== 1 ? 's' : ''}
              </span>
            </div>
          </div>

          {/* Event cards */}
          <div className="space-y-3 mt-3">
            {group.events.map((event) => {
              globalEventIndex++;
              const shouldInsertAd = activeAds.length > 0 && globalEventIndex % 8 === 0;
              const adIndex = shouldInsertAd ? (Math.floor(globalEventIndex / 8) - 1) % activeAds.length : 0;

              return (
                <div key={event.id}>
                  <EventCard
                    event={event}
                    isInItinerary={itinerary?.has(event.id)}
                    onItineraryToggle={onItineraryToggle}
                    friendsCount={friendsCountByEvent?.get(event.id)}
                    friendsGoing={friendsByEvent?.get(event.id)}
                    checkedInFriends={checkedInFriendsByEvent?.get(event.id)}
                    checkInCount={checkInCounts?.get(event.id)}
                    reactions={reactionsByEvent?.get(event.id)}
                    onToggleReaction={onToggleReaction}
                    commentCount={commentCounts?.get(event.id)}
                  />
                  {shouldInsertAd && (
                    <div className="mt-3">
                      <NativeAdCard ad={activeAds[adIndex]} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
