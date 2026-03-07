'use client';

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { ViewMode } from '@/lib/types';
import { useEvents } from '@/hooks/useEvents';
import { useFilters } from '@/hooks/useFilters';
import { applyFilters, getConferenceNow } from '@/lib/filters';
import { TYPE_TAGS, STORAGE_KEYS } from '@/lib/constants';
import { useItinerary } from '@/hooks/useItinerary';
import { usePOIs } from '@/hooks/usePOIs';
import { useAuth } from '@/contexts/AuthContext';
import { useFriends } from '@/hooks/useFriends';
import { useFriendsItineraries } from '@/hooks/useFriendsItineraries';
import { useCheckIns } from '@/hooks/useCheckIns';
import { useEventReactions } from '@/hooks/useEventReactions';
import { useEventCommentCounts } from '@/hooks/useEventCommentCounts';
import { useFriendLocations } from '@/hooks/useFriendLocations';
import { trackItinerary, trackAuthPrompt } from '@/lib/analytics';
import { Header } from './Header';
import { FilterBar } from './FilterBar';
import { ListView } from './ListView';
import { TableView } from './TableView';
import { MapViewWrapper } from './MapViewWrapper';
import { Loading } from './Loading';
import { AuthModal } from './AuthModal';
import { SubmitEventModal } from './SubmitEventModal';
import { FriendsPanel } from './FriendsPanel';
import { SponsorsTicker } from './SponsorsTicker';
import { useAdminConfig } from '@/hooks/useAdminConfig';

export function EventApp({ initialConference }: { initialConference?: string }) {
  const { config } = useAdminConfig();
  const { events, loading, error } = useEvents();
  const {
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
  } = useFilters(initialConference);
  const [viewMode, setViewMode] = useState<ViewMode>('map');
  const [viewRestored, setViewRestored] = useState(false);
  const [contentScrolled, setContentScrolled] = useState(false);

  // Restore view mode from localStorage on mount (after hydration)
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.VIEW_MODE);
    if (saved === 'map' || saved === 'list' || saved === 'table') {
      setViewMode(saved);
    }
    setViewRestored(true);
  }, []);

  // Persist view mode to localStorage (skip the initial restore)
  useEffect(() => {
    if (viewRestored) {
      localStorage.setItem(STORAGE_KEYS.VIEW_MODE, viewMode);
    }
  }, [viewMode, viewRestored]);

  // List view scroll tracking (mirrors TableView's onScrolledChange)
  const listMainRef = useRef<HTMLDivElement>(null);
  const listLastScrollTopRef = useRef(0);
  const listScrolledRef = useRef(false);

  const handleListScroll = useCallback(() => {
    const container = listMainRef.current;
    if (!container) return;

    const scrollTop = container.scrollTop;
    const atTop = scrollTop <= 5;
    const scrollingDown = scrollTop > listLastScrollTopRef.current + 2;
    const scrollingUp = scrollTop < listLastScrollTopRef.current - 2;
    listLastScrollTopRef.current = scrollTop;

    const overflowAmount = container.scrollHeight - container.clientHeight;
    const nearBottom = scrollTop + container.clientHeight >= container.scrollHeight - 50;
    const shouldHide = !atTop && !nearBottom && scrollingDown && overflowAmount > 80;
    const shouldShow = atTop || scrollingUp;

    if (shouldHide && !listScrolledRef.current) {
      listScrolledRef.current = true;
      setContentScrolled(true);
    } else if (shouldShow && listScrolledRef.current) {
      listScrolledRef.current = false;
      setContentScrolled(false);
    }
  }, []);
  const { user } = useAuth();

  const {
    itinerary,
    toggle: toggleItinerary,
    count: itineraryCount,
    ready: itineraryReady,
  } = useItinerary();

  const { pois, addPOI, removePOI, updatePOI, ownerNames } = usePOIs();

  const { friends, removeFriend, refreshFriends } = useFriends();
  const { friendItineraries } = useFriendsItineraries(friends);
  const { checkInCounts, checkInUsersByEvent } = useCheckIns(friends);
  const { reactionsByEvent, toggleReaction } = useEventReactions();
  const commentCounts = useEventCommentCounts();
  const friendLocations = useFriendLocations(friends);

  // Auth-gated reaction toggle
  const handleToggleReaction = useCallback(
    (eventId: string, emoji: import('@/lib/types').ReactionEmoji) => {
      if (user) {
        toggleReaction(eventId, emoji);
      } else {
        trackAuthPrompt('reaction');
        setShowAuthForStar(true);
      }
    },
    [user, toggleReaction]
  );

  // Friends panel
  const [showFriends, setShowFriends] = useState(false);

  const [showSubmitEvent, setShowSubmitEvent] = useState(false);

  // Auth-gated starring
  const [showAuthForStar, setShowAuthForStar] = useState(false);
  const pendingStarRef = useRef<string | null>(null);

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
      const confEvents = events.filter((e) => !filters.conference || e.conference === filters.conference);
      const present = new Set(confEvents.flatMap((e) => e.tags).filter(Boolean));
      return TYPE_TAGS.filter((t) => present.has(t));
    },
    [events, filters.conference]
  );

  const availableVibes = useMemo(
    () =>
      [...new Set(
        events
          .filter((e) => !filters.conference || e.conference === filters.conference)
          .flatMap((e) => e.tags)
          .filter(Boolean)
      )]
        .filter((t) => !TYPE_TAGS.includes(t))
        .sort(),
    [events, filters.conference]
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

  // Clear stale vibes/types when conference changes
  useEffect(() => {
    if (filters.vibes.length === 0) return;
    const available = new Set([...availableTypes, ...availableVibes]);
    const stale = filters.vibes.filter((v) => !available.has(v));
    if (stale.length > 0) {
      setFilter('vibes', filters.vibes.filter((v) => available.has(v)));
    }
  }, [availableTypes, availableVibes, filters.vibes, setFilter]);

  // Count how many friends have each event on their itinerary
  const friendsCountByEvent = useMemo(() => {
    const counts = new Map<string, number>();
    for (const fi of friendItineraries) {
      for (const eid of fi.eventIds) {
        counts.set(eid, (counts.get(eid) ?? 0) + 1);
      }
    }
    return counts;
  }, [friendItineraries]);

  // Inverted index: eventId -> list of friends going
  const friendsByEvent = useMemo(() => {
    const map = new Map<string, { userId: string; displayName: string }[]>();
    for (const fi of friendItineraries) {
      for (const eid of fi.eventIds) {
        if (!map.has(eid)) map.set(eid, []);
        map.get(eid)!.push({ userId: fi.userId, displayName: fi.displayName });
      }
    }
    return map;
  }, [friendItineraries]);

  // Inverted index: eventId -> list of friends checked in (green indicators)
  const checkedInFriendsByEvent = useMemo(() => {
    const friendMap = new Map(friends.map((f) => [f.user_id, f]));
    const map = new Map<string, { userId: string; displayName: string }[]>();
    for (const [eid, userIds] of checkInUsersByEvent) {
      const friendInfos: { userId: string; displayName: string }[] = [];
      for (const uid of userIds) {
        const friend = friendMap.get(uid);
        if (friend) {
          friendInfos.push({
            userId: uid,
            displayName: friend.display_name || (friend.x_handle ? `@${friend.x_handle}` : null) || friend.email || uid.slice(0, 8),
          });
        }
      }
      if (friendInfos.length > 0) map.set(eid, friendInfos);
    }
    return map;
  }, [checkInUsersByEvent, friends]);

  const filteredEvents = useMemo(
    () => applyFilters(events, filters, itinerary, filters.nowMode ? getConferenceNow(filters.conference).getTime() : undefined, selectedFriendEventIds),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events, filters, itinerary, nowTick, selectedFriendEventIds]
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-violet-950">
        <Header
          viewMode={viewMode}
          onViewChange={setViewMode}
          itineraryCount={0}
          onItineraryToggle={() => toggleBool('itineraryOnly')}
          isItineraryActive={filters.itineraryOnly}
          events={events}
          itinerary={itinerary}
          onOpenFriends={() => setShowFriends(true)}
          refreshFriends={refreshFriends}
        />
        <Loading />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-violet-950">
        <Header
          viewMode={viewMode}
          onViewChange={setViewMode}
          itineraryCount={0}
          onItineraryToggle={() => toggleBool('itineraryOnly')}
          isItineraryActive={filters.itineraryOnly}
          events={events}
          itinerary={itinerary}
          onOpenFriends={() => setShowFriends(true)}
          refreshFriends={refreshFriends}
        />
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 px-4">
          <div className="text-red-400 text-lg font-medium">Failed to load events</div>
          <p className="text-violet-400 text-sm text-center max-w-md">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-2 px-4 py-2 bg-cyan-500 hover:bg-cyan-600 active:bg-cyan-600 text-white rounded-lg text-sm font-medium transition-colors cursor-pointer"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-dvh flex flex-col bg-violet-950 overflow-hidden">
      <Header
        viewMode={viewMode}
        onViewChange={setViewMode}
        itineraryCount={conferenceItineraryCount}
        onItineraryToggle={() => toggleBool('itineraryOnly')}
        isItineraryActive={filters.itineraryOnly}
        events={events}
        itinerary={itinerary}
        onOpenFriends={() => setShowFriends(true)}
        onSubmitEvent={() => setShowSubmitEvent(true)}
        refreshFriends={refreshFriends}
      />

      <SponsorsTicker sponsors={config?.sponsors} />

      {/* Filter bar — collapses on scroll down in table/list views */}
      <div className={
        viewMode === 'table' || viewMode === 'list'
          ? `shrink-0 transition-all duration-200 ${contentScrolled ? 'lg:overflow-visible lg:max-h-none overflow-hidden max-h-0' : ''}`
          : 'shrink-0'
      }>
        <FilterBar
          filters={filters}
          onSetConference={setConference}
          onSetDateTimeRange={setDateTimeRange}
          onToggleVibe={toggleVibe}
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
          onSubmitEvent={() => setShowSubmitEvent(true)}
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
            friendsCountByEvent={friendsCountByEvent}
            friendsByEvent={friendsByEvent}
            checkedInFriendsByEvent={checkedInFriendsByEvent}
            checkInCounts={checkInCounts}
            reactionsByEvent={reactionsByEvent}
            onToggleReaction={handleToggleReaction}
            commentCounts={commentCounts}
            friendLocations={friendLocations}
            conference={filters.conference}
            pois={pois}
            onAddPOI={addPOI}
            onRemovePOI={removePOI}
            onUpdatePOI={updatePOI}
            ownerNames={ownerNames}
          />
        </main>
      ) : viewMode === 'table' ? (
        <main className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">
          <TableView
            events={filteredEvents}
            totalCount={conferenceEventCount}
            itinerary={itinerary}
            onItineraryToggle={handleItineraryToggle}
            onScrolledChange={setContentScrolled}
            friendsCountByEvent={friendsCountByEvent}
            friendsByEvent={friendsByEvent}
            checkedInFriendsByEvent={checkedInFriendsByEvent}
            checkInCounts={checkInCounts}
            reactionsByEvent={reactionsByEvent}
            onToggleReaction={handleToggleReaction}
            commentCounts={commentCounts}
          />
        </main>
      ) : (
        <main ref={listMainRef} onScroll={handleListScroll} className="flex-1 min-h-0 overflow-y-auto">
          <ListView
            events={filteredEvents}
            totalCount={conferenceEventCount}
            itinerary={itinerary}
            onItineraryToggle={handleItineraryToggle}
            friendsCountByEvent={friendsCountByEvent}
            friendsByEvent={friendsByEvent}
            checkedInFriendsByEvent={checkedInFriendsByEvent}
            checkInCounts={checkInCounts}
            reactionsByEvent={reactionsByEvent}
            onToggleReaction={handleToggleReaction}
            commentCounts={commentCounts}
            nativeAds={config?.native_ads}
          />
        </main>
      )}

      <AuthModal isOpen={showAuthForStar} onClose={() => { pendingStarRef.current = null; setShowAuthForStar(false); }} />
      <SubmitEventModal isOpen={showSubmitEvent} onClose={() => setShowSubmitEvent(false)} upsellCopy={config?.upsell_copy} />
      <FriendsPanel
        isOpen={showFriends}
        onClose={() => setShowFriends(false)}
        friends={friends}
        onRemoveFriend={removeFriend}
      />
    </div>
  );
}
