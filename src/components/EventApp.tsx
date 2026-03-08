'use client';

import { useState } from 'react';
import { useEvents } from '@/hooks/useEvents';
import { useFilters } from '@/hooks/useFilters';
import { useItinerary } from '@/hooks/useItinerary';
import { usePOIs } from '@/hooks/usePOIs';
import { useFriends } from '@/hooks/useFriends';
import { useFriendsItineraries } from '@/hooks/useFriendsItineraries';
import { useCheckIns } from '@/hooks/useCheckIns';
import { useEventReactions } from '@/hooks/useEventReactions';
import { useEventCommentCounts } from '@/hooks/useEventCommentCounts';
import { useFriendLocations } from '@/hooks/useFriendLocations';
import { useViewMode } from '@/hooks/useViewMode';
import { useAuthGatedActions } from '@/hooks/useAuthGatedActions';
import { useConferenceData } from '@/hooks/useConferenceData';
import { useNowMode } from '@/hooks/useNowMode';
import { useAdminConfig } from '@/hooks/useAdminConfig';
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

  const {
    viewMode,
    setViewMode,
    contentScrolled,
    setContentScrolled,
    listMainRef,
    handleListScroll,
  } = useViewMode();

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

  const {
    showAuthForStar,
    handleItineraryToggle,
    handleToggleReaction,
    dismissAuth,
  } = useAuthGatedActions({
    itinerary,
    toggleItinerary,
    itineraryReady,
    toggleReaction,
    setFilter,
    itineraryOnly: filters.itineraryOnly,
  });

  const {
    availableConferences,
    availableTypes,
    availableVibes,
    conferenceEventCount,
    conferenceItineraryCount,
    friendsForFilter,
    selectedFriendEventIds,
    friendsCountByEvent,
    friendsByEvent,
    checkedInFriendsByEvent,
  } = useConferenceData({
    events,
    filters,
    itinerary,
    friends,
    friendItineraries,
    checkInUsersByEvent,
    setFilter,
  });

  const { filteredEvents } = useNowMode({
    events,
    filters,
    itinerary,
    selectedFriendEventIds,
  });

  // Friends panel
  const [showFriends, setShowFriends] = useState(false);
  const [showSubmitEvent, setShowSubmitEvent] = useState(false);
  const [showSignIn, setShowSignIn] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-950">
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
      <div className="min-h-screen bg-stone-950">
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
          <p className="text-stone-500 text-sm text-center max-w-md">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 active:bg-amber-600 text-stone-900 rounded-lg text-sm font-medium transition-colors cursor-pointer"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-dvh flex flex-col bg-stone-950 overflow-hidden">
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

      {/* Filter bar -- collapses on scroll down in table/list views */}
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
          onSignIn={() => setShowSignIn(true)}
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
            onSignIn={() => setShowSignIn(true)}
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
            scrollContainerRef={listMainRef}
          />
        </main>
      )}

      <AuthModal isOpen={showAuthForStar || showSignIn} onClose={() => { dismissAuth(); setShowSignIn(false); }} />
      <SubmitEventModal isOpen={showSubmitEvent} onClose={() => setShowSubmitEvent(false)} upsellCopy={config?.upsell_copy} initialConference={filters.conference} />
      <FriendsPanel
        isOpen={showFriends}
        onClose={() => setShowFriends(false)}
        friends={friends}
        onRemoveFriend={removeFriend}
      />
    </div>
  );
}
