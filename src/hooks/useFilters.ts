'use client';

import { useState, useCallback, useMemo } from 'react';
import type { FilterState } from '@/lib/types';

const defaultFilters: FilterState = {
  conference: 'ETH Denver 2026',
  selectedDays: [],
  timeStart: 0,
  timeEnd: 24,
  vibes: [],
  freeOnly: false,
  hasFood: false,
  hasBar: false,
  itineraryOnly: false,
  searchQuery: '',
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

  const setTimeRange = useCallback((start: number, end: number) => {
    setFilters((prev) => ({ ...prev, timeStart: start, timeEnd: end }));
  }, []);

  const toggleBool = useCallback(
    (
      key:
        | 'freeOnly'
        | 'hasFood'
        | 'hasBar'
        | 'itineraryOnly'
    ) => {
      setFilters((prev) => ({ ...prev, [key]: !prev[key] }));
    },
    []
  );

  const clearFilters = useCallback(() => setFilters(defaultFilters), []);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.conference) count++;
    if (filters.selectedDays.length > 0) count++;
    if (filters.timeStart !== 0 || filters.timeEnd !== 24) count++;
    if (filters.vibes.length > 0) count++;
    if (filters.freeOnly) count++;
    if (filters.hasFood) count++;
    if (filters.hasBar) count++;
    if (filters.itineraryOnly) count++;
    if (filters.searchQuery) count++;
    return count;
  }, [filters]);

  return {
    filters,
    setFilter,
    setConference,
    setDayRange,
    toggleVibe,
    setTimeRange,
    toggleBool,
    clearFilters,
    activeFilterCount,
  };
}
