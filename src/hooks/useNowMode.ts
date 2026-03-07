'use client';

import { useState, useEffect, useMemo } from 'react';
import type { ETHDenverEvent, FilterState } from '@/lib/types';
import { applyFilters, getConferenceNow } from '@/lib/filters';

interface UseNowModeOptions {
  events: ETHDenverEvent[];
  filters: FilterState;
  itinerary: Set<string>;
  selectedFriendEventIds?: Set<string>;
}

/**
 * Manages the "Now" mode auto-refresh tick and computes filtered events.
 * Bumps every 5 minutes while nowMode is active so the event list updates.
 */
export function useNowMode({
  events,
  filters,
  itinerary,
  selectedFriendEventIds,
}: UseNowModeOptions) {
  const [nowTick, setNowTick] = useState(0);

  useEffect(() => {
    if (!filters.nowMode) return;
    const interval = setInterval(() => {
      setNowTick((t) => t + 1);
    }, 5 * 60 * 1000); // 5 minutes
    return () => clearInterval(interval);
  }, [filters.nowMode]);

  const filteredEvents = useMemo(
    () =>
      applyFilters(
        events,
        filters,
        itinerary,
        filters.nowMode ? getConferenceNow(filters.conference).getTime() : undefined,
        selectedFriendEventIds
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events, filters, itinerary, nowTick, selectedFriendEventIds]
  );

  return { filteredEvents };
}
