'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
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
import { useConferenceTabs } from '@/hooks/useConferenceTabs';
import { useABTest } from '@/hooks/useABTest';
import { useTheme } from '@/contexts/ThemeContext';
import { ThemeId, DEFAULT_THEME } from '@/lib/themes';
import type { ABTest } from '@/lib/types';
import { resolveItemVariants, getVisitorId } from '@/lib/ab-testing';
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
import { OnboardingWizard } from './OnboardingWizard';
import { STORAGE_KEYS } from '@/lib/storage-keys';
import { getTabConfig } from '@/lib/conferences';

export function EventApp({ initialConference }: { initialConference?: string }) {
  const { config } = useAdminConfig();
  const { tabs: conferenceTabs } = useConferenceTabs();
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
  } = useFilters(initialConference, conferenceTabs);

  // Re-apply conference date range once dynamic tabs load
  // (fixes dates for conferences not in FALLBACK_TABS, e.g. Toronto Tech Week)
  useEffect(() => {
    if (initialConference && conferenceTabs.some(t => t.name === initialConference)) {
      setConference(initialConference);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conferenceTabs]);

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

  // Theme: read from admin config per-conference and apply
  const { setTheme } = useTheme();
  useEffect(() => {
    if (!config || !filters.conference) {
      setTheme(DEFAULT_THEME);
      return;
    }
    const configKey = `theme:${filters.conference}`;
    const configTheme = (config as Record<string, unknown>)[configKey] as string | undefined;
    if (configTheme === 'dark' || configTheme === 'paper' || configTheme === 'light' || configTheme === 'sxsw' || configTheme === 'sxsw2' || configTheme === 'gdc' || configTheme === 'ethcc') {
      setTheme(configTheme as ThemeId);
    } else {
      setTheme(DEFAULT_THEME);
    }
  }, [config, filters.conference, setTheme]);

  // Sync URL with selected conference
  useEffect(() => {
    const tab = getTabConfig(filters.conference, conferenceTabs);
    if (tab?.slug) {
      const newPath = `/${tab.slug}`;
      if (window.location.pathname !== newPath) {
        window.history.replaceState(null, '', newPath);
      }
    }
  }, [filters.conference, conferenceTabs]);

  // Per-item A/B variant resolution
  const visitorId = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return getVisitorId();
  }, []);

  const resolvedSponsors = useMemo(
    () => resolveItemVariants(config?.sponsors || [], visitorId),
    [config?.sponsors, visitorId]
  );
  const resolvedNativeAds = useMemo(
    () => resolveItemVariants(config?.native_ads || [], visitorId),
    [config?.native_ads, visitorId]
  );

  // A/B Testing: find running tests by placement
  const abTests = useMemo(() => {
    const tests = (config as Record<string, unknown>)?.ab_tests as ABTest[] | undefined;
    return tests || [];
  }, [config]);

  const adFrequencyTest = useMemo(
    () => abTests.find(t => t.placement === 'ad-frequency' && t.status === 'running' && (!t.conference || t.conference === filters.conference)),
    [abTests, filters.conference]
  );

  const sponsorCopyTest = useMemo(
    () => abTests.find(t => t.placement === 'sponsor-copy' && t.status === 'running' && (!t.conference || t.conference === filters.conference)),
    [abTests, filters.conference]
  );

  const nativeAdContentTest = useMemo(
    () => abTests.find(t => t.placement === 'native-ad-content' && t.status === 'running' && (!t.conference || t.conference === filters.conference)),
    [abTests, filters.conference]
  );

  const {
    config: adFreqConfig,
    trackClick: trackAdFreqClick,
    isActive: adFreqActive,
  } = useABTest({ test: adFrequencyTest });

  const {
    config: sponsorConfig,
    trackClick: trackSponsorClick,
    isActive: sponsorTestActive,
  } = useABTest({ test: sponsorCopyTest });

  const {
    config: nativeAdConfig,
    trackClick: trackNativeAdClick,
    isActive: nativeAdTestActive,
  } = useABTest({ test: nativeAdContentTest });

  // Derive ad frequency from A/B test config, default 8
  const adFrequency = adFreqActive && typeof adFreqConfig.frequency === 'number'
    ? adFreqConfig.frequency
    : 8;


  // Ad impression/click tracking for A/B tests
  const handleAdImpression = useCallback((_adId: string) => {
    // Impressions are tracked via the useABTest hook automatically
  }, []);

  const handleAdClick = useCallback((_adId: string) => {
    if (adFreqActive) trackAdFreqClick({ ad_id: _adId });
    if (nativeAdTestActive) trackNativeAdClick({ ad_id: _adId });
  }, [adFreqActive, trackAdFreqClick, nativeAdTestActive, trackNativeAdClick]);

  const handleTickerSponsorClick = useCallback((url: string) => {
    if (sponsorTestActive) trackSponsorClick({ url });
  }, [sponsorTestActive, trackSponsorClick]);

  // Friends panel
  const [showFriends, setShowFriends] = useState(false);
  const [showSubmitEvent, setShowSubmitEvent] = useState(false);
  const [showSignIn, setShowSignIn] = useState(false);

  // Onboarding wizard for first-time users
  const [showOnboarding, setShowOnboarding] = useState(false);
  useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEYS.ONBOARDING_COMPLETED)) {
      setShowOnboarding(true);
    }
  }, []);

  const handleOnboardingComplete = useCallback(
    (config: { conference: string; selectedTags: string[] }) => {
      localStorage.setItem(STORAGE_KEYS.ONBOARDING_COMPLETED, '1');
      setShowOnboarding(false);
      if (config.conference) {
        setConference(config.conference);
      }
      for (const tag of config.selectedTags) {
        toggleVibe(tag);
      }
    },
    [setConference, toggleVibe]
  );

  const handleOnboardingDismiss = useCallback(() => {
    localStorage.setItem(STORAGE_KEYS.ONBOARDING_COMPLETED, '1');
    setShowOnboarding(false);
  }, []);

  const conferenceEventCounts = useMemo(
    () => events.reduce<Record<string, number>>((acc, e) => {
      if (e.conference) {
        acc[e.conference] = (acc[e.conference] || 0) + 1;
      }
      return acc;
    }, {}),
    [events]
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--theme-bg-primary)]">
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
      <div className="min-h-screen bg-[var(--theme-bg-primary)]">
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
          <p className="text-[var(--theme-text-muted)] text-sm text-center max-w-md">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-2 px-4 py-2 bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-hover)] active:bg-[var(--theme-accent-hover)] text-[var(--theme-accent-text)] rounded-lg text-sm font-medium transition-colors cursor-pointer"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-dvh flex flex-col bg-[var(--theme-bg-primary)] overflow-hidden">
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

      <SponsorsTicker
        sponsors={resolvedSponsors}
        conference={filters.conference}
        onSponsorClick={handleTickerSponsorClick}
      />

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
          conferenceTabs={conferenceTabs}
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
            conferenceTabs={conferenceTabs}
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
            conference={filters.conference}
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
            nativeAds={resolvedNativeAds}
            scrollContainerRef={listMainRef}
            adFrequency={adFrequency}
            onAdImpression={handleAdImpression}
            onAdClick={handleAdClick}
            conference={filters.conference}
          />
        </main>
      )}

      <AuthModal isOpen={showAuthForStar || showSignIn} onClose={() => { dismissAuth(); setShowSignIn(false); }} />
      <SubmitEventModal isOpen={showSubmitEvent} onClose={() => setShowSubmitEvent(false)} upsellCopy={config?.upsell_copy} initialConference={filters.conference} conferenceTabs={conferenceTabs} />
      <FriendsPanel
        isOpen={showFriends}
        onClose={() => setShowFriends(false)}
        friends={friends}
        onRemoveFriend={removeFriend}
      />
      <OnboardingWizard
        isOpen={showOnboarding}
        onComplete={handleOnboardingComplete}
        onDismiss={handleOnboardingDismiss}
        availableConferences={availableConferences}
        conferenceEventCounts={conferenceEventCounts}
        events={events}
        onOpenAuth={() => { setShowOnboarding(false); setShowSignIn(true); }}
        conferenceTabs={conferenceTabs}
      />
    </div>
  );
}
