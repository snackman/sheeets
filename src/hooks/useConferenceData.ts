'use client';

import { useMemo, useEffect } from 'react';
import type { ETHDenverEvent } from '@/lib/types';
import type { FilterState } from '@/lib/types';
import { TYPE_TAGS } from '@/lib/tags';
import { getDisplayName } from '@/lib/user-display';
import type { Friend } from '@/lib/types';

interface FriendItinerary {
  userId: string;
  displayName: string;
  eventIds: Set<string>;
}

interface UseConferenceDataOptions {
  events: ETHDenverEvent[];
  filters: FilterState;
  itinerary: Set<string>;
  friends: Friend[];
  friendItineraries: FriendItinerary[];
  checkInUsersByEvent: Map<string, string[]>;
  setFilter: <K extends keyof FilterState>(key: K, value: FilterState[K]) => void;
}

/**
 * Derives conference-level computed data: available conferences,
 * available tags/vibes, friend-based counts, and keeps stale
 * filters in sync.
 */
export function useConferenceData({
  events,
  filters,
  itinerary,
  friends,
  friendItineraries,
  checkInUsersByEvent,
  setFilter,
}: UseConferenceDataOptions) {
  const availableConferences = useMemo(
    () => [...new Set(events.map((e) => e.conference).filter(Boolean))],
    [events]
  );

  const availableTypes = useMemo(
    () => {
      const confEvents = events.filter((e) => !filters.conference || e.conference === filters.conference);
      const present = new Set(confEvents.flatMap((e) => e.tags).filter(Boolean));
      return TYPE_TAGS.filter((t) => present.has(t));
    },
    [events, filters.conference]
  );

  const availableVibes = useMemo(
    () =>
      [...new Set(
        events
          .filter((e) => !filters.conference || e.conference === filters.conference)
          .flatMap((e) => e.tags)
          .filter(Boolean)
      )]
        .filter((t) => !TYPE_TAGS.includes(t))
        .sort(),
    [events, filters.conference]
  );

  const conferenceEventCount = useMemo(
    () => events.filter((e) => !filters.conference || e.conference === filters.conference).length,
    [events, filters.conference]
  );

  const conferenceItineraryCount = useMemo(
    () => events.filter((e) => itinerary.has(e.id) && (!filters.conference || e.conference === filters.conference)).length,
    [events, itinerary, filters.conference]
  );

  // Friends filter: only show friends whose events overlap with current conference events
  const conferenceEventIds = useMemo(() => {
    const ids = new Set<string>();
    for (const e of events) {
      if (!filters.conference || e.conference === filters.conference) {
        ids.add(e.id);
      }
    }
    return ids;
  }, [events, filters.conference]);

  const friendsForFilter = useMemo(
    () =>
      friendItineraries
        .filter((fi) => {
          for (const eid of fi.eventIds) {
            if (conferenceEventIds.has(eid)) return true;
          }
          return false;
        })
        .map((fi) => ({ userId: fi.userId, displayName: fi.displayName })),
    [friendItineraries, conferenceEventIds]
  );

  // Union of event IDs from selected friends only
  const selectedFriendEventIds = useMemo(() => {
    if (filters.selectedFriends.length === 0) return undefined;
    const ids = new Set<string>();
    for (const fi of friendItineraries) {
      if (filters.selectedFriends.includes(fi.userId)) {
        for (const eid of fi.eventIds) {
          ids.add(eid);
        }
      }
    }
    return ids;
  }, [filters.selectedFriends, friendItineraries]);

  // Clear selected friends if they're removed from the friends list
  useEffect(() => {
    if (filters.selectedFriends.length === 0) return;
    const friendIds = new Set(friends.map((f) => f.user_id));
    const stale = filters.selectedFriends.filter((id) => !friendIds.has(id));
    if (stale.length > 0) {
      setFilter('selectedFriends', filters.selectedFriends.filter((id) => friendIds.has(id)));
    }
  }, [friends, filters.selectedFriends, setFilter]);

  // Clear stale vibes/types when conference changes
  useEffect(() => {
    if (filters.vibes.length === 0) return;
    const available = new Set([...availableTypes, ...availableVibes]);
    const stale = filters.vibes.filter((v) => !available.has(v));
    if (stale.length > 0) {
      setFilter('vibes', filters.vibes.filter((v) => available.has(v)));
    }
  }, [availableTypes, availableVibes, filters.vibes, setFilter]);

  // Count how many friends have each event on their itinerary
  const friendsCountByEvent = useMemo(() => {
    const counts = new Map<string, number>();
    for (const fi of friendItineraries) {
      for (const eid of fi.eventIds) {
        counts.set(eid, (counts.get(eid) ?? 0) + 1);
      }
    }
    return counts;
  }, [friendItineraries]);

  // Inverted index: eventId -> list of friends going
  const friendsByEvent = useMemo(() => {
    const map = new Map<string, { userId: string; displayName: string }[]>();
    for (const fi of friendItineraries) {
      for (const eid of fi.eventIds) {
        if (!map.has(eid)) map.set(eid, []);
        map.get(eid)!.push({ userId: fi.userId, displayName: fi.displayName });
      }
    }
    return map;
  }, [friendItineraries]);

  // Inverted index: eventId -> list of friends checked in (green indicators)
  const checkedInFriendsByEvent = useMemo(() => {
    const friendMap = new Map(friends.map((f) => [f.user_id, f]));
    const map = new Map<string, { userId: string; displayName: string }[]>();
    for (const [eid, userIds] of checkInUsersByEvent) {
      const friendInfos: { userId: string; displayName: string }[] = [];
      for (const uid of userIds) {
        const friend = friendMap.get(uid);
        if (friend) {
          friendInfos.push({
            userId: uid,
            displayName: getDisplayName(friend, uid.slice(0, 8)),
          });
        }
      }
      if (friendInfos.length > 0) map.set(eid, friendInfos);
    }
    return map;
  }, [checkInUsersByEvent, friends]);

  return {
    availableConferences,
    availableTypes,
    availableVibes,
    conferenceEventCount,
    conferenceItineraryCount,
    friendsForFilter,
    selectedFriendEventIds,
    friendsCountByEvent,
    friendsByEvent,
    checkedInFriendsByEvent,
  };
}
