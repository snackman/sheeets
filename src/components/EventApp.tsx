'use client';

import { useState, useMemo } from 'react';
import { ViewMode } from '@/lib/types';
import { useEvents } from '@/hooks/useEvents';
import { useFilters } from '@/hooks/useFilters';
import { applyFilters } from '@/lib/filters';
import { useStarred } from '@/hooks/useStarred';
import { useItinerary } from '@/hooks/useItinerary';
import { Header } from './Header';
import { FilterBar } from './FilterBar';
import { ListView } from './ListView';
import { TableView } from './TableView';
import { MapViewWrapper } from './MapViewWrapper';
import { SearchBar } from './SearchBar';
import { Loading } from './Loading';
import { ItineraryPanel } from './ItineraryPanel';

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
    clearFilters,
    activeFilterCount,
  } = useFilters();
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [showItinerary, setShowItinerary] = useState(false);

  const { starred, toggle: toggleStar } = useStarred();
  const {
    itinerary,
    toggle: toggleItinerary,
    clear: clearItinerary,
    count: itineraryCount,
  } = useItinerary();

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
    () => applyFilters(events, filters, starred, itinerary),
    [events, filters, starred, itinerary]
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900">
        <Header
          viewMode={viewMode}
          onViewChange={setViewMode}
          itineraryCount={0}
          onItineraryOpen={() => setShowItinerary(true)}
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
          onItineraryOpen={() => setShowItinerary(true)}
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
        onItineraryOpen={() => setShowItinerary(true)}
      />

      {/* Filter bar */}
      <FilterBar
        filters={filters}
        onSetConference={setConference}
        onSetDayRange={setDayRange}
        onToggleVibe={toggleVibe}
        onSetTimeRange={setTimeRange}
        onToggleBool={toggleBool}
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
            starred={starred}
            itinerary={itinerary}
            onStarToggle={toggleStar}
            onItineraryToggle={toggleItinerary}
          />
        </main>
      ) : viewMode === 'table' ? (
        <main>
          <TableView
            events={filteredEvents}
            totalCount={conferenceEventCount}
            starred={starred}
            itinerary={itinerary}
            onStarToggle={toggleStar}
            onItineraryToggle={toggleItinerary}
          />
        </main>
      ) : (
        <main>
          <ListView
            events={filteredEvents}
            totalCount={conferenceEventCount}
            starred={starred}
            itinerary={itinerary}
            onStarToggle={toggleStar}
            onItineraryToggle={toggleItinerary}
          />
        </main>
      )}

      {/* Itinerary panel */}
      <ItineraryPanel
        isOpen={showItinerary}
        onClose={() => setShowItinerary(false)}
        events={events}
        itinerary={itinerary}
        starred={starred}
        onStarToggle={toggleStar}
        onItineraryToggle={toggleItinerary}
        onItineraryClear={clearItinerary}
      />
    </div>
  );
}
