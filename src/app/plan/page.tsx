'use client';

import { Suspense, useMemo, useState, useRef, useCallback, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { EventCard } from '@/components/EventCard';
import { Trash2, Share2, GripVertical, Eye, EyeOff } from 'lucide-react';
import { useEvents } from '@/hooks/useEvents';
import { useItinerary } from '@/hooks/useItinerary';


import { formatDateLabel } from '@/lib/utils';
import { trackItineraryClear, trackItineraryReorder } from '@/lib/analytics';
import type { ETHDenverEvent } from '@/lib/types';
import { Loading } from '@/components/Loading';
import { useEventCheckIn } from '@/hooks/useEventCheckIn';
import { useDragReorder } from '@/hooks/useDragReorder';
import { useProfile } from '@/hooks/useProfile';
import { Header } from '@/components/Header';
import { FilterBar } from '@/components/FilterBar';
import { SponsorsTicker } from '@/components/SponsorsTicker';
import { ShareCardModal } from '@/components/ShareCardModal';
import { useConferenceTabs } from '@/hooks/useConferenceTabs';
import { useFilters } from '@/hooks/useFilters';
import { useAdminConfig } from '@/hooks/useAdminConfig';
import { useConferenceData } from '@/hooks/useConferenceData';
import { GoogleCalendarButton } from '@/components/GoogleCalendarButton';
import { getTabConfig } from '@/lib/conferences';
import { passesNowFilter, applyFilters, computeTagCounts, getConferenceNow } from '@/lib/filters';
import { resolveItemVariants, getVisitorId } from '@/lib/ab-testing';
import { TableView } from '@/components/TableView';
import { useFriends } from '@/hooks/useFriends';
import { useFriendsItineraries } from '@/hooks/useFriendsItineraries';
import type { FriendInfo } from '@/lib/types';
import { STORAGE_KEYS } from '@/lib/storage-keys';

const MapView = dynamic(
  () => import('@/components/MapView').then((mod) => ({ default: mod.MapView })),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full bg-[var(--theme-bg-primary)] flex items-center justify-center">
        <div className="text-[var(--theme-text-secondary)]">Loading map...</div>
      </div>
    ),
  }
);

type ItineraryViewMode = 'list' | 'map' | 'table';


function CheckInToast({ result, onDismiss }: { result: { ok: boolean; message: string }; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 3000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div className={`mx-4 mt-2 px-3 py-2 rounded-lg text-sm font-medium ${
      result.ok
        ? 'bg-green-600 text-white'
        : 'bg-[var(--theme-bg-secondary)] text-[var(--theme-text-secondary)] border border-[var(--theme-border-primary)]'
    }`}>
      {result.message}
    </div>
  );
}

function ItineraryContent() {
  const { events, loading } = useEvents();
  const { tabs: conferenceTabs } = useConferenceTabs();
  const { itinerary, toggle: toggleItinerary, clear: clearItinerary, reorder: reorderItinerary, hiddenEvents, toggleHidden } = useItinerary();

  const { profile } = useProfile();
  const { config } = useAdminConfig();
  const { friends } = useFriends();
  const { friendItineraries } = useFriendsItineraries(friends);

  const friendsByEvent = useMemo(() => {
    const map = new Map<string, FriendInfo[]>();
    for (const fi of friendItineraries) {
      for (const eid of fi.eventIds) {
        if (!map.has(eid)) map.set(eid, []);
        map.get(eid)!.push({
          userId: fi.userId,
          displayName: fi.displayName,
          avatarUrl: fi.avatarUrl,
          xHandle: fi.xHandle,
        });
      }
    }
    return map;
  }, [friendItineraries]);

  const { checkInToEvent, loading: checkInLoading, result: checkInResult, clearResult: clearCheckInResult } = useEventCheckIn();
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [viewMode, setViewModeState] = useState<ItineraryViewMode>('list');
  const setViewMode = useCallback((mode: ItineraryViewMode) => {
    setViewModeState(mode);
    localStorage.setItem(STORAGE_KEYS.VIEW_MODE, mode);
  }, []);
  const [viewModeRestored, setViewModeRestored] = useState(false);
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.VIEW_MODE);
    if (saved === 'list' || saved === 'map' || saved === 'table') {
      setViewMode(saved);
    }
    setViewModeRestored(true);
  }, []);
  const [showShareCard, setShowShareCard] = useState(false);
  const captureRef = useRef<HTMLDivElement>(null);

  // User location for distance display
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    if (!navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { maximumAge: 30000, enableHighAccuracy: false }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  // Get conferences that have itinerary events — iterate Set to preserve insertion/reorder order
  const allItineraryEvents = useMemo(() => {
    const eventMap = new Map(events.map(e => [e.id, e]));
    const result: ETHDenverEvent[] = [];
    for (const id of itinerary) {
      const ev = eventMap.get(id);
      if (ev) result.push(ev);
    }
    return result;
  }, [events, itinerary]);
  const conferences = useMemo(
    () => [...new Set(allItineraryEvents.map((e) => e.conference).filter(Boolean))],
    [allItineraryEvents]
  );
  const searchParams = useSearchParams();
  const confParam = searchParams.get('conf') || '';

  // Filters
  const {
    filters,
    setFilter,
    setConference,
    setDateTimeRange,
    toggleVibe,
    toggleNowMode,
    toggleTagMatchAll,
    toggleFriend,
    clearFilters,
    activeFilterCount,
  } = useFilters(confParam || undefined, conferenceTabs);

  const activeConference = filters.conference;

  // Auto-select conference from URL param or first itinerary conference
  useEffect(() => {
    if (confParam && conferences.includes(confParam)) {
      setConference(confParam);
    } else if (conferences.length > 0 && !activeConference) {
      setConference(conferences[0]);
    }
  }, [conferences, confParam]);

  const {
    availableConferences,
    availableTypes,
    availableVibes,
    friendsForFilter,
    selectedFriendEventIds,
  } = useConferenceData({
    events: allItineraryEvents,
    filters,
    itinerary,
    friends,
    friendItineraries,
    checkInUsersByEvent: new Map(),
    setFilter,
  });

  // Apply filters to itinerary events
  const itineraryEvents = useMemo(() => {
    const confFiltered = allItineraryEvents.filter((e) => !activeConference || e.conference === activeConference);
    return applyFilters(confFiltered, filters, itinerary, filters.nowMode ? getConferenceNow(filters.conference).getTime() : undefined, selectedFriendEventIds);
  }, [allItineraryEvents, activeConference, filters, itinerary, selectedFriendEventIds]);

  const tagCounts = useMemo(() => computeTagCounts(itineraryEvents), [itineraryEvents]);

  // Sponsors
  const visitorId = useMemo(() => typeof window !== 'undefined' ? getVisitorId() : '', []);
  const resolvedSponsors = useMemo(
    () => resolveItemVariants(config?.sponsors || [], visitorId),
    [config?.sponsors, visitorId]
  );

  const dateGroups = useMemo(() => {
    const groupMap = new Map<string, ETHDenverEvent[]>();
    for (const event of itineraryEvents) {
      const key = event.dateISO || 'unknown';
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key)!.push(event);
    }
    return Array.from(groupMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dateISO, groupEvents]) => ({
        dateISO,
        label: dateISO === 'unknown' ? 'Date TBD' : formatDateLabel(dateISO),
        events: groupEvents,
      }));
  }, [itineraryEvents]);

  const conferenceTimezone = useMemo(
    () => getTabConfig(activeConference, conferenceTabs).timezone,
    [activeConference, conferenceTabs]
  );

  const exportableEvents = useMemo(
    () => itineraryEvents.filter((e) => !hiddenEvents.has(e.id)),
    [itineraryEvents, hiddenEvents]
  );

  // Flat ordered list of all event IDs across date groups (for drag reorder)
  const flatEventIds = useMemo(
    () => dateGroups.flatMap((g) => g.events.map((e) => e.id)),
    [dateGroups]
  );

  const handleReorder = useCallback(
    (orderedIds: string[]) => {
      trackItineraryReorder();
      // The drag reorder gives us the visible (conference-filtered) IDs in new order.
      // Preserve IDs from other conferences that aren't visible.
      const allIds = [...itinerary];
      const visibleIdSet = new Set(flatEventIds);
      const otherIds = allIds.filter((id) => !visibleIdSet.has(id));
      reorderItinerary([...orderedIds, ...otherIds]);
    },
    [itinerary, flatEventIds, reorderItinerary]
  );

  const {
    setOrderedIds,
    registerItemRef,
    getDragHandleProps,
    getItemProps,
    getDropIndicator,
    dragId,
  } = useDragReorder({ onReorder: handleReorder });

  // Keep ordered IDs in sync
  useEffect(() => {
    setOrderedIds(flatEventIds);
  }, [flatEventIds, setOrderedIds]);


  if (loading || !viewModeRestored) {
    return (
      <div className="min-h-screen bg-[var(--theme-bg-primary)]">
        <Loading />
      </div>
    );
  }

  return (
    <div className={viewMode === 'map' || viewMode === 'table' ? 'h-screen flex flex-col bg-[var(--theme-bg-primary)]' : 'min-h-screen bg-[var(--theme-bg-primary)]'}>
      <Header
        viewMode={viewMode}
        onViewChange={setViewMode}
        events={events}
        itinerary={itinerary}
        onOpenFriends={() => {}}
        activeConference={activeConference}
      />

      <SponsorsTicker
        sponsors={resolvedSponsors}
        conference={activeConference}
      />

      <FilterBar
        filters={filters}
        onSetConference={setConference}
        onSetDateTimeRange={setDateTimeRange}
        onToggleVibe={toggleVibe}
        onToggleNowMode={toggleNowMode}
        onToggleTagMatchAll={toggleTagMatchAll}
        onClearFilters={clearFilters}
        activeFilterCount={activeFilterCount}
        availableConferences={availableConferences}
        availableTypes={availableTypes}
        availableVibes={availableVibes}
        tagCounts={tagCounts}
        friendsForFilter={friendsForFilter}
        selectedFriends={filters.selectedFriends}
        onToggleFriend={toggleFriend}
        searchQuery={filters.searchQuery}
        onSearchChange={(query) => setFilter('searchQuery', query)}
        eventCount={itineraryEvents.length}
        conferenceTabs={conferenceTabs}
        itineraryCount={itineraryEvents.length}
        onItineraryToggle={() => {}}
        trailingButtons={
          itineraryEvents.length > 0 ? (
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => setShowShareCard(true)}
                className="shrink-0 p-2 rounded-lg text-[var(--theme-text-secondary)] hover:text-[var(--theme-accent)] transition-colors cursor-pointer"
                aria-label="Share my plan"
                title="Share my plan as PNG"
              >
                <Share2 className="w-5 h-5" />
              </button>
              <GoogleCalendarButton
                events={exportableEvents}
                timezone={conferenceTimezone}
              />
            </div>
          ) : undefined
        }
      />

      {/* Check-in result toast */}
      {checkInResult && (
        <CheckInToast result={checkInResult} onDismiss={clearCheckInResult} />
      )}

      {/* Content */}
      {itineraryEvents.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center px-4">
          <img src="/logo.png" alt="" className="h-10 w-auto opacity-30 mb-4" style={{ filter: 'var(--theme-logo-filter)' }} />
          <p className="text-[var(--theme-text-secondary)] font-medium mb-2">No events in your plan yet</p>
          <p className="text-[var(--theme-text-muted)] text-sm max-w-xs mb-4">
            Add events from the main page to build your schedule!
          </p>
          <Link
            href="/"
            className="px-4 py-2 bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-hover)] text-[var(--theme-accent-text)] rounded-lg text-sm font-medium transition-colors"
          >
            Browse Events
          </Link>
        </div>
      ) : viewMode === 'map' ? (
        <main className="flex-1 min-h-0">
          <MapView
            events={itineraryEvents}
            itinerary={itinerary}
            onItineraryToggle={toggleItinerary}
            conference={activeConference}
            conferenceTabs={conferenceTabs}
          />
        </main>
      ) : viewMode === 'table' ? (
        <main className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">
          <TableView
            events={itineraryEvents}
            totalCount={itineraryEvents.length}
            itinerary={itinerary}
            onItineraryToggle={toggleItinerary}
            conference={activeConference}
            userLocation={userLocation}
            friendsByEvent={friendsByEvent}
          />
        </main>
      ) : (
        <div className="max-w-2xl mx-auto px-4 pb-8">
          <div ref={captureRef} className="bg-[var(--theme-bg-primary)]">
            {dateGroups.map((group) => (
              <section key={group.dateISO} className="mt-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="h-px flex-1 bg-[var(--theme-border-secondary)]" />
                  <h3 className="text-xs font-bold text-[var(--theme-text-secondary)] uppercase tracking-wider whitespace-nowrap">
                    {group.label}
                  </h3>
                  <div className="h-px flex-1 bg-[var(--theme-border-secondary)]" />
                </div>

                <div className="space-y-2">
                  {group.events.map((event) => {
                    const dropIndicator = getDropIndicator(event.id);
                    const isBeingDragged = dragId === event.id;

                    return (
                      <div
                        key={event.id}
                        ref={(el) => registerItemRef(event.id, el)}
                        {...getItemProps(event.id)}
                        className="relative"
                      >
                        {/* Drop indicator - above */}
                        {dropIndicator.showAbove && (
                          <div className="absolute -top-1.5 left-0 right-0 h-0.5 bg-[var(--theme-accent)] rounded-full z-10" />
                        )}

                        <div className={`flex items-start gap-2 ${isBeingDragged ? 'opacity-40' : 'opacity-100'} transition-opacity`}>
                          <div
                            data-export-hide
                            {...getDragHandleProps(event.id)}
                            className="shrink-0 pt-4 text-[var(--theme-text-faint)] hover:text-[var(--theme-text-secondary)] active:text-[var(--theme-text-secondary)] cursor-grab active:cursor-grabbing touch-none select-none"
                            aria-label="Drag to reorder"
                            title="Drag to reorder"
                          >
                            <GripVertical className="w-4 h-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <EventCard
                              event={event}
                              isInItinerary={true}
                              onItineraryToggle={toggleItinerary}
                              onCheckIn={(eventId) => checkInToEvent(eventId, event.name)}
                              checkInLoading={checkInLoading}
                              liveUrgency={passesNowFilter(event, getConferenceNow(activeConference)) ? 'green' : undefined}
                              conference={activeConference}
                              userLocation={userLocation}
                              friendsGoing={friendsByEvent.get(event.id)}
                            />
                          </div>
                        </div>

                        {/* Hide/show toggle for friends visibility */}
                        <div className="flex justify-end mt-1 mr-1" data-export-hide>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleHidden(event.id);
                            }}
                            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] transition-colors cursor-pointer ${
                              hiddenEvents.has(event.id)
                                ? 'text-[var(--theme-text-muted)] bg-[var(--theme-bg-tertiary)]'
                                : 'text-[var(--theme-text-faint)] hover:text-[var(--theme-text-muted)]'
                            }`}
                            title={hiddenEvents.has(event.id) ? 'Hidden from friends (tap to show)' : 'Hide from friends'}
                          >
                            {hiddenEvents.has(event.id) ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                            <span>{hiddenEvents.has(event.id) ? 'Hidden' : 'Hide'}</span>
                          </button>
                        </div>

                        {/* Drop indicator - below */}
                        {dropIndicator.showBelow && (
                          <div className="absolute -bottom-1.5 left-0 right-0 h-0.5 bg-[var(--theme-accent)] rounded-full z-10" />
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}

            <div className="pt-3 pb-2 text-center">
              <span className="text-[10px] text-[var(--theme-text-faint)]">plan.wtf — side event guide</span>
            </div>
          </div>

          {/* Clear button */}
          <div className="mt-6 pt-4 border-t border-[var(--theme-border-secondary)]">
            {showClearConfirm ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-[var(--theme-text-secondary)]">Clear all events?</span>
                <button
                  onClick={() => { trackItineraryClear(); clearItinerary(); setShowClearConfirm(false); }}
                  className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white text-xs font-medium rounded transition-colors cursor-pointer"
                >
                  Yes, clear
                </button>
                <button
                  onClick={() => setShowClearConfirm(false)}
                  className="px-3 py-1.5 bg-[var(--theme-bg-tertiary)] hover:bg-[var(--theme-bg-tertiary)] text-[var(--theme-text-secondary)] text-xs font-medium rounded transition-colors cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowClearConfirm(true)}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-[var(--theme-bg-secondary)] hover:bg-[var(--theme-bg-tertiary)] border border-[var(--theme-border-primary)] text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-secondary)] rounded-lg text-sm font-medium transition-colors cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
                Clear Plan
              </button>
            )}
          </div>
        </div>
      )}

      <ShareCardModal
        isOpen={showShareCard}
        onClose={() => setShowShareCard(false)}
        events={itineraryEvents}
        conferenceName={activeConference || 'My Plan'}
        displayName={profile?.display_name ?? null}
        avatarUrl={profile?.avatar_url}
        hiddenEventIds={hiddenEvents}
      />
    </div>
  );
}

export default function ItineraryPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[var(--theme-bg-primary)]"><Loading /></div>}>
      <ItineraryContent />
    </Suspense>
  );
}
