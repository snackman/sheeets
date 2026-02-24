'use client';

import { useState, useCallback, useMemo } from 'react';
import type { FilterState } from '@/lib/types';
import { DEFAULT_TAB, getTabConfig } from '@/lib/constants';

function getDateTimeRangeForConference(conference: string): { startDateTime: string; endDateTime: string } {
  const tab = getTabConfig(conference);
  const dates = tab.dates;
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: tab.timezone }));
  const pad = (n: number) => String(n).padStart(2, '0');
  const mins = now.getMinutes() < 30 ? 0 : 30;
  const nowISO = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(mins)}`;

  const firstEventStart = `${dates[0]}T00:00`;
  const lastEventEnd = `${dates[dates.length - 1]}T23:30`;

  // If now is before or after the event range, show all events
  if (nowISO > lastEventEnd || nowISO < firstEventStart) {
    return { startDateTime: firstEventStart, endDateTime: lastEventEnd };
  }

  return { startDateTime: nowISO, endDateTime: lastEventEnd };
}

const defaults = getDateTimeRangeForConference(DEFAULT_TAB.name);

const defaultFilters: FilterState = {
  conference: DEFAULT_TAB.name,
  startDateTime: defaults.startDateTime,
  endDateTime: defaults.endDateTime,
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
    const range = getDateTimeRangeForConference(conf);
    setFilters((prev) => ({ ...prev, conference: conf, startDateTime: range.startDateTime, endDateTime: range.endDateTime }));
  }, []);

  const setDateTimeRange = useCallback((start: string, end: string) => {
    setFilters((prev) => ({ ...prev, startDateTime: start, endDateTime: end }));
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
    if (filters.startDateTime !== defaultFilters.startDateTime || filters.endDateTime !== defaultFilters.endDateTime) count++;
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
    setDateTimeRange,
    toggleVibe,
    toggleFriend,
    toggleBool,
    toggleNowMode,
    clearFilters,
    activeFilterCount,
  };
}
