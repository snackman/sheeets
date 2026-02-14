'use client';

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { ViewMode } from '@/lib/types';
import { useEvents } from '@/hooks/useEvents';
import { useFilters } from '@/hooks/useFilters';
import { applyFilters } from '@/lib/filters';
import { TYPE_TAGS } from '@/lib/constants';
import { useItinerary } from '@/hooks/useItinerary';
import { useAuth } from '@/contexts/AuthContext';
import { useFriends } from '@/hooks/useFriends';
import { useFriendsItineraries } from '@/hooks/useFriendsItineraries';
import { trackItinerary, trackAuthPrompt } from '@/lib/analytics';
import { Header } from './Header';
import { FilterBar } from './FilterBar';
import { ListView } from './ListView';
import { TableView } from './TableView';
import { MapViewWrapper } from './MapViewWrapper';
import { Loading } from './Loading';
import { AuthModal } from './AuthModal';
import { FriendsPanel } from './FriendsPanel';
import { SponsorsTicker } from './SponsorsTicker';

const PENDING_FRIEND_KEY = 'sheeets-pending-friend-code';

export function EventApp() {
  const { events, loading, error } = useEvents();
  const {
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
  } = useFilters();
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [tableScrolled, setTableScrolled] = useState(false);
  const { user } = useAuth();
  const searchParams = useSearchParams();

  const {
    itinerary,
    toggle: toggleItinerary,
    count: itineraryCount,
    ready: itineraryReady,
  } = useItinerary();

  const { friends, addFriend, removeFriend } = useFriends();
  const { friendItineraries } = useFriendsItineraries(friends);

  // Friends panel
  const [showFriends, setShowFriends] = useState(false);

  // Auth-gated starring
  const [showAuthForStar, setShowAuthForStar] = useState(false);
  const pendingStarRef = useRef<string | null>(null);

  // Friend link handling
  const [showAuthForFriend, setShowAuthForFriend] = useState(false);
  const friendLinkProcessed = useRef(false);

  // Process ?friend=CODE param
  useEffect(() => {
    if (friendLinkProcessed.current) return;
    const friendCode = searchParams.get('friend');
    if (!friendCode) return;

    if (user) {
      // User is logged in — process immediately
      friendLinkProcessed.current = true;
      addFriend(friendCode).then(() => {
        // Remove the param from URL
        const url = new URL(window.location.href);
        url.searchParams.delete('friend');
        window.history.replaceState({}, '', url.toString());
      });
    } else {
      // User not logged in — store code and prompt auth
      try {
        sessionStorage.setItem(PENDING_FRIEND_KEY, friendCode);
      } catch {
        // sessionStorage may be unavailable
      }
      setShowAuthForFriend(true);
    }
  }, [searchParams, user, addFriend]);

  // After auth succeeds, check sessionStorage for pending friend code
  useEffect(() => {
    if (!user) return;
    try {
      const pendingCode = sessionStorage.getItem(PENDING_FRIEND_KEY);
      if (pendingCode) {
        sessionStorage.removeItem(PENDING_FRIEND_KEY);
        setShowAuthForFriend(false);
        addFriend(pendingCode).then(() => {
          // Remove the param from URL if still there
          const url = new URL(window.location.href);
          url.searchParams.delete('friend');
          window.history.replaceState({}, '', url.toString());
        });
      }
    } catch {
      // sessionStorage may be unavailable
    }
  }, [user, addFriend]);

  const handleItineraryToggle = useCallback(
    (eventId: string) => {
      if (user) {
        const action = itinerary.has(eventId) ? 'remove' : 'add';
        trackItinerary(eventId, action);
        toggleItinerary(eventId);
      } else {
        trackAuthPrompt('star');
        pendingStarRef.current = eventId;
        setShowAuthForStar(true);
      }
    },
    [user, toggleItinerary, itinerary]
  );

  // Complete pending star after successful login + sync
  useEffect(() => {
    if (user && itineraryReady && pendingStarRef.current) {
      toggleItinerary(pendingStarRef.current);
      pendingStarRef.current = null;
      setShowAuthForStar(false);
    }
  }, [user, itineraryReady, toggleItinerary]);

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

  const filteredEvents = useMemo(
    () => applyFilters(events, filters, itinerary, filters.nowMode ? Date.now() : undefined, selectedFriendEventIds),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events, filters, itinerary, nowTick, selectedFriendEventIds]
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
          events={events}
          itinerary={itinerary}
          onOpenFriends={() => setShowFriends(true)}
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
          events={events}
          itinerary={itinerary}
          onOpenFriends={() => setShowFriends(true)}
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
        events={events}
        itinerary={itinerary}
        onOpenFriends={() => setShowFriends(true)}
      />

      <SponsorsTicker />

      {/* Filter bar — collapses on table scroll to maximize table height */}
      <div className={
        viewMode === 'table'
          ? `shrink-0 transition-all duration-200 ${tableScrolled ? 'lg:overflow-visible lg:max-h-none overflow-hidden max-h-0' : ''}`
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
          friendsForFilter={friendsForFilter}
          selectedFriends={filters.selectedFriends}
          onToggleFriend={toggleFriend}
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
        <main className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">
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
      <AuthModal isOpen={showAuthForFriend} onClose={() => setShowAuthForFriend(false)} />
      <FriendsPanel
        isOpen={showFriends}
        onClose={() => setShowFriends(false)}
        friends={friends}
        onRemoveFriend={removeFriend}
      />
    </div>
  );
}
