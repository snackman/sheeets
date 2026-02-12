'use client';

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { ViewMode } from '@/lib/types';
import { useEvents } from '@/hooks/useEvents';
import { useFilters } from '@/hooks/useFilters';
import { applyFilters } from '@/lib/filters';
import { TYPE_TAGS } from '@/lib/constants';
import { useItinerary } from '@/hooks/useItinerary';
import { useAuth } from '@/contexts/AuthContext';
import { Header } from './Header';
import { FilterBar } from './FilterBar';
import { ListView } from './ListView';
import { TableView } from './TableView';
import { MapViewWrapper } from './MapViewWrapper';
import { Loading } from './Loading';
import { AuthModal } from './AuthModal';

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
  const [tableScrolled, setTableScrolled] = useState(false);
  const { user } = useAuth();

  const {
    itinerary,
    toggle: toggleItinerary,
    count: itineraryCount,
  } = useItinerary();

  // Auth-gated starring
  const [showAuthForStar, setShowAuthForStar] = useState(false);
  const pendingStarRef = useRef<string | null>(null);

  const handleItineraryToggle = useCallback(
    (eventId: string) => {
      if (user) {
        toggleItinerary(eventId);
      } else {
        pendingStarRef.current = eventId;
        setShowAuthForStar(true);
      }
    },
    [user, toggleItinerary]
  );

  // Complete pending star after successful login
  useEffect(() => {
    if (user && pendingStarRef.current) {
      toggleItinerary(pendingStarRef.current);
      pendingStarRef.current = null;
      setShowAuthForStar(false);
    }
  }, [user, toggleItinerary]);

  // Turn off itinerary filter if user signs out or auth is dismissed
  useEffect(() => {
    if (!user && filters.itineraryOnly) {
      setFilter('itineraryOnly', false);
    }
  }, [user, filters.itineraryOnly, setFilter]);

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

  const availableTypes = useMemo(
    () => {
      const present = new Set(events.flatMap((e) => e.tags).filter(Boolean));
      return TYPE_TAGS.filter((t) => present.has(t));
    },
    [events]
  );

  const availableVibes = useMemo(
    () =>
      [...new Set(events.flatMap((e) => e.tags).filter(Boolean))]
        .filter((t) => !TYPE_TAGS.includes(t))
        .sort(),
    [events]
  );

  const conferenceEventCount = useMemo(
    () => events.filter((e) => !filters.conference || e.conference === filters.conference).length,
    [events, filters.conference]
  );

  const conferenceItineraryCount = useMemo(
    () => events.filter((e) => itinerary.has(e.id) && (!filters.conference || e.conference === filters.conference)).length,
    [events, itinerary, filters.conference]
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
            className="mt-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 active:bg-orange-600 text-white rounded-lg text-sm font-medium transition-colors cursor-pointer"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={viewMode === 'list' ? 'min-h-screen bg-slate-900' : 'h-dvh flex flex-col bg-slate-900 overflow-hidden'}>
      <Header
        viewMode={viewMode}
        onViewChange={setViewMode}
        itineraryCount={conferenceItineraryCount}
        onItineraryToggle={() => toggleBool('itineraryOnly')}
        isItineraryActive={filters.itineraryOnly}
      />

      {/* Filter bar — collapses on table scroll to maximize table height */}
      <div className={
        viewMode === 'table'
          ? `shrink-0 overflow-hidden transition-all duration-200 ${tableScrolled ? 'max-h-0' : 'max-h-60'}`
          : 'shrink-0'
      }>
        <FilterBar
          filters={filters}
          onSetConference={setConference}
          onSetDayRange={setDayRange}
          onToggleVibe={toggleVibe}
          onSetTimeRange={setTimeRange}
          onToggleNowMode={toggleNowMode}
          onClearFilters={clearFilters}
          activeFilterCount={activeFilterCount}
          availableConferences={availableConferences}
          availableTypes={availableTypes}
          availableVibes={availableVibes}
          searchQuery={filters.searchQuery}
          onSearchChange={(query) => setFilter('searchQuery', query)}
          eventCount={filteredEvents.length}
        />
      </div>

      {/* Main content area */}
      {viewMode === 'map' ? (
        <main className="flex-1 min-h-0">
          <MapViewWrapper
            events={filteredEvents}
            itinerary={itinerary}
            onItineraryToggle={handleItineraryToggle}
            isItineraryView={filters.itineraryOnly}
          />
        </main>
      ) : viewMode === 'table' ? (
        <main className="flex-1 min-h-0 flex flex-col">
          <TableView
            events={filteredEvents}
            totalCount={conferenceEventCount}
            itinerary={itinerary}
            onItineraryToggle={handleItineraryToggle}
            onScrolledChange={setTableScrolled}
          />
        </main>
      ) : (
        <main>
          <ListView
            events={filteredEvents}
            totalCount={conferenceEventCount}
            itinerary={itinerary}
            onItineraryToggle={handleItineraryToggle}
          />
        </main>
      )}

      <AuthModal isOpen={showAuthForStar} onClose={() => { pendingStarRef.current = null; setShowAuthForStar(false); }} />
    </div>
  );
}
