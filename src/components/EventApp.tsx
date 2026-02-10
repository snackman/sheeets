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
import { MapViewWrapper } from './MapViewWrapper';
import { Loading } from './Loading';
import { ItineraryPanel } from './ItineraryPanel';

export function EventApp() {
  const { events, loading, error } = useEvents();
  const {
    filters,
    setFilter,
    toggleDay,
    toggleVibe,
    toggleTimeOfDay,
    toggleBool,
    clearFilters,
    activeFilterCount,
  } = useFilters();
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [showItinerary, setShowItinerary] = useState(false);

  const { starred, toggle: toggleStar } = useStarred();
  const {
    itinerary,
    toggle: toggleItinerary,
    clear: clearItinerary,
    count: itineraryCount,
  } = useItinerary();

  const availableVibes = useMemo(
    () =>
      [...new Set(events.map((e) => e.vibe).filter(Boolean))].sort(),
    [events]
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
        onToggleDay={toggleDay}
        onToggleVibe={toggleVibe}
        onToggleTimeOfDay={toggleTimeOfDay}
        onToggleBool={toggleBool}
        onSearchChange={(query) => setFilter('searchQuery', query)}
        onClearFilters={clearFilters}
        activeFilterCount={activeFilterCount}
        totalEvents={events.length}
        filteredCount={filteredEvents.length}
        availableVibes={availableVibes}
      />

      {/* Main content area */}
      {viewMode === 'list' ? (
        <main>
          <ListView
            events={filteredEvents}
            totalCount={events.length}
            starred={starred}
            itinerary={itinerary}
            onStarToggle={toggleStar}
            onItineraryToggle={toggleItinerary}
          />
        </main>
      ) : (
        <main className="flex-1 min-h-0">
          <MapViewWrapper
            events={filteredEvents}
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
