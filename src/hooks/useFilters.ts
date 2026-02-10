'use client';

import { useState, useCallback, useMemo } from 'react';
import type { FilterState } from '@/lib/types';

const defaultFilters: FilterState = {
  selectedDays: [],
  timeOfDay: [],
  vibes: [],
  freeOnly: false,
  hasFood: false,
  hasBar: false,
  starredOnly: false,
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

  const toggleDay = useCallback((day: string) => {
    setFilters((prev) => ({
      ...prev,
      selectedDays: prev.selectedDays.includes(day)
        ? prev.selectedDays.filter((d) => d !== day)
        : [...prev.selectedDays, day],
    }));
  }, []);

  const toggleVibe = useCallback((vibe: string) => {
    setFilters((prev) => ({
      ...prev,
      vibes: prev.vibes.includes(vibe)
        ? prev.vibes.filter((v) => v !== vibe)
        : [...prev.vibes, vibe],
    }));
  }, []);

  const toggleTimeOfDay = useCallback((time: string) => {
    setFilters((prev) => ({
      ...prev,
      timeOfDay: prev.timeOfDay.includes(time)
        ? prev.timeOfDay.filter((t) => t !== time)
        : [...prev.timeOfDay, time],
    }));
  }, []);

  const toggleBool = useCallback(
    (
      key:
        | 'freeOnly'
        | 'hasFood'
        | 'hasBar'
        | 'starredOnly'
        | 'itineraryOnly'
    ) => {
      setFilters((prev) => ({ ...prev, [key]: !prev[key] }));
    },
    []
  );

  const clearFilters = useCallback(() => setFilters(defaultFilters), []);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.selectedDays.length > 0) count++;
    if (filters.timeOfDay.length > 0) count++;
    if (filters.vibes.length > 0) count++;
    if (filters.freeOnly) count++;
    if (filters.hasFood) count++;
    if (filters.hasBar) count++;
    if (filters.starredOnly) count++;
    if (filters.itineraryOnly) count++;
    if (filters.searchQuery) count++;
    return count;
  }, [filters]);

  return {
    filters,
    setFilter,
    toggleDay,
    toggleVibe,
    toggleTimeOfDay,
    toggleBool,
    clearFilters,
    activeFilterCount,
  };
}
