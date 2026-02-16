'use client';

import { useState, useCallback, useMemo } from 'react';
import type { FilterState } from '@/lib/types';
import { EVENT_DATES } from '@/lib/constants';

function getDefaultSelectedDays(): string[] {
  const today = new Date();
  const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  // If today is before the earliest event date, don't filter
  if (todayISO < EVENT_DATES[0]) return [];

  // Filter to today and future dates
  const fromToday = EVENT_DATES.filter((d) => d >= todayISO);

  // If no dates remain (all events are in the past), show all
  if (fromToday.length === 0) return [];

  // If all dates remain, no need to filter
  if (fromToday.length === EVENT_DATES.length) return [];

  return fromToday;
}

const defaultFilters: FilterState = {
  conference: 'ETH Denver 2026',
  selectedDays: getDefaultSelectedDays(),
  timeStart: 0,
  timeEnd: 24,
  vibes: [],
  selectedFriends: [],
  itineraryOnly: false,
  searchQuery: '',
  nowMode: false,
};

export function useFilters() {
  const [filters, setFilters] = useState<FilterState>(defaultFilters);

  const setFilter = useCallback(
    <K extends keyof FilterState>(key: K, value: FilterState[K]) => {
      setFilters((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  const setConference = useCallback((conf: string) => {
    setFilters((prev) => ({ ...prev, conference: conf }));
  }, []);

  const setDayRange = useCallback((startIdx: number, endIdx: number, allDates: string[]) => {
    if (startIdx === 0 && endIdx === allDates.length - 1) {
      setFilters((prev) => ({ ...prev, selectedDays: [] }));
    } else {
      setFilters((prev) => ({
        ...prev,
        selectedDays: allDates.slice(startIdx, endIdx + 1),
      }));
    }
  }, []);

  const toggleVibe = useCallback((vibe: string) => {
    setFilters((prev) => ({
      ...prev,
      vibes: prev.vibes.includes(vibe)
        ? prev.vibes.filter((v) => v !== vibe)
        : [...prev.vibes, vibe],
    }));
  }, []);

  const toggleFriend = useCallback((friendId: string) => {
    setFilters((prev) => ({
      ...prev,
      selectedFriends: prev.selectedFriends.includes(friendId)
        ? prev.selectedFriends.filter((f) => f !== friendId)
        : [...prev.selectedFriends, friendId],
    }));
  }, []);

  const setTimeRange = useCallback((start: number, end: number) => {
    setFilters((prev) => ({ ...prev, timeStart: start, timeEnd: end }));
  }, []);

  const toggleBool = useCallback(
    (key: 'itineraryOnly') => {
      setFilters((prev) => ({ ...prev, [key]: !prev[key] }));
    },
    []
  );

  const toggleNowMode = useCallback(() => {
    setFilters((prev) => ({ ...prev, nowMode: !prev.nowMode }));
  }, []);

  const clearFilters = useCallback(() => setFilters(defaultFilters), []);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.selectedDays.length > 0) count++;
    if (filters.timeStart !== 0 || filters.timeEnd !== 24) count++;
    if (filters.vibes.length > 0) count++;
    if (filters.selectedFriends.length > 0) count++;
    if (filters.searchQuery) count++;
    if (filters.nowMode) count++;
    return count;
  }, [filters]);

  return {
    filters,
    setFilter,
    setConference,
    setDayRange,
    toggleVibe,
    toggleFriend,
    setTimeRange,
    toggleBool,
    toggleNowMode,
    clearFilters,
    activeFilterCount,
  };
}
