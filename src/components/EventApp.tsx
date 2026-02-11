'use client';

import { useState, useMemo, useEffect } from 'react';
import { ViewMode } from '@/lib/types';
import { useEvents } from '@/hooks/useEvents';
import { useFilters } from '@/hooks/useFilters';
import { applyFilters } from '@/lib/filters';
import { useItinerary } from '@/hooks/useItinerary';
import { Header } from './Header';
import { FilterBar } from './FilterBar';
import { ListView } from './ListView';
import { TableView } from './TableView';
import { MapViewWrapper } from './MapViewWrapper';
import { SearchBar } from './SearchBar';
import { Loading } from './Loading';

export function EventApp() {
  const { events, loading, error } = useEvents();
  const {
    filters,
    setFilter,
    setConference,
    setDayRange,
    toggleVibe,
    setTimeRange,
    toggleBool,
    toggleNowMode,
    clearFilters,
    activeFilterCount,
  } = useFilters();
  const [viewMode, setViewMode] = useState<ViewMode>('table');

  const {
    itinerary,
    toggle: toggleItinerary,
    count: itineraryCount,
  } = useItinerary();

  // Auto-refresh tick for "Now" mode — bumps every 5 minutes to recalculate filtered events
  const [nowTick, setNowTick] = useState(0);
  useEffect(() => {
    if (!filters.nowMode) return;
    const interval = setInterval(() => {
      setNowTick((t) => t + 1);
    }, 5 * 60 * 1000); // 5 minutes
    return () => clearInterval(interval);
  }, [filters.nowMode]);

  const availableConferences = useMemo(
    () => [...new Set(events.map((e) => e.conference).filter(Boolean))],
    [events]
  );

  const availableVibes = useMemo(
    () =>
      [...new Set(events.flatMap((e) => e.tags).filter(Boolean))].sort(),
    [events]
  );

  const conferenceEventCount = useMemo(
    () => events.filter((e) => !filters.conference || e.conference === filters.conference).length,
    [events, filters.conference]
  );

  const filteredEvents = useMemo(
    () => applyFilters(events, filters, itinerary, filters.nowMode ? Date.now() : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events, filters, itinerary, nowTick]
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900">
        <Header
          viewMode={viewMode}
          onViewChange={setViewMode}
          itineraryCount={0}
          onItineraryToggle={() => toggleBool('itineraryOnly')}
          isItineraryActive={filters.itineraryOnly}
        />
        <Loading />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-900">
        <Header
          viewMode={viewMode}
          onViewChange={setViewMode}
          itineraryCount={0}
          onItineraryToggle={() => toggleBool('itineraryOnly')}
          isItineraryActive={filters.itineraryOnly}
        />
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 px-4">
          <div className="text-red-400 text-lg font-medium">Failed to load events</div>
          <p className="text-slate-500 text-sm text-center max-w-md">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-sm font-medium transition-colors cursor-pointer"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={viewMode === 'map' ? 'h-screen flex flex-col bg-slate-900' : 'min-h-screen bg-slate-900'}>
      <Header
        viewMode={viewMode}
        onViewChange={setViewMode}
        itineraryCount={itineraryCount}
        onItineraryToggle={() => toggleBool('itineraryOnly')}
        isItineraryActive={filters.itineraryOnly}
      />

      {/* Filter bar */}
      <FilterBar
        filters={filters}
        onSetConference={setConference}
        onSetDayRange={setDayRange}
        onToggleVibe={toggleVibe}
        onSetTimeRange={setTimeRange}
        onToggleBool={toggleBool}
        onToggleNowMode={toggleNowMode}
        onClearFilters={clearFilters}
        activeFilterCount={activeFilterCount}
        availableConferences={availableConferences}
        availableVibes={availableVibes}
      />

      {/* Search bar + event count */}
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
        <SearchBar value={filters.searchQuery} onChange={(query) => setFilter('searchQuery', query)} />
        <p className="text-sm text-slate-400 whitespace-nowrap">
          <span className="text-white font-medium">{filteredEvents.length}</span> of{' '}
          {conferenceEventCount} events
        </p>
      </div>

      {/* Main content area */}
      {viewMode === 'map' ? (
        <main className="flex-1 min-h-0">
          <MapViewWrapper
            events={filteredEvents}
            itinerary={itinerary}
            onItineraryToggle={toggleItinerary}
          />
        </main>
      ) : viewMode === 'table' ? (
        <main>
          <TableView
            events={filteredEvents}
            totalCount={conferenceEventCount}
            itinerary={itinerary}
            onItineraryToggle={toggleItinerary}
          />
        </main>
      ) : (
        <main>
          <ListView
            events={filteredEvents}
            totalCount={conferenceEventCount}
            itinerary={itinerary}
            onItineraryToggle={toggleItinerary}
          />
        </main>
      )}

    </div>
  );
}
