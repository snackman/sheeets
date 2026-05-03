'use client';

import { Suspense, useMemo, useState, useRef, useCallback, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { EventCard } from '@/components/EventCard';
import { ArrowLeft, Trash2, CalendarX, Share2, Map as MapIcon, List, Table, GripVertical, Eye, EyeOff, ChevronDown, MapPin } from 'lucide-react';
import clsx from 'clsx';
import { useEvents } from '@/hooks/useEvents';
import { useItinerary } from '@/hooks/useItinerary';


import { formatDateLabel } from '@/lib/utils';
import { trackItineraryClear, trackItineraryConferenceTab, trackItineraryReorder } from '@/lib/analytics';
import type { ETHDenverEvent } from '@/lib/types';
import { Loading } from '@/components/Loading';
import { useEventCheckIn } from '@/hooks/useEventCheckIn';
import { passesNowFilter, getConferenceNow } from '@/lib/filters';
import { useDragReorder } from '@/hooks/useDragReorder';
import { useProfile } from '@/hooks/useProfile';
import { ShareCardModal } from '@/components/ShareCardModal';
import { useConferenceTabs } from '@/hooks/useConferenceTabs';
import { getTabConfig } from '@/lib/conferences';
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
  const [viewMode, setViewMode] = useState<ItineraryViewMode>('list');
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.VIEW_MODE);
    if (saved === 'list' || saved === 'map' || saved === 'table') {
      setViewMode(saved);
    }
  }, []);
  const [showShareCard, setShowShareCard] = useState(false);
  const [confOpen, setConfOpen] = useState(false);
  const confBtnRef = useRef<HTMLButtonElement | null>(null);
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
  const [activeConference, setActiveConference] = useState(confParam);

  // Auto-select conference: respect URL param, then fall back to first conference
  useEffect(() => {
    if (confParam && conferences.includes(confParam)) {
      setActiveConference(confParam);
    } else if (conferences.length > 0 && !activeConference) {
      setActiveConference(conferences[0]);
    }
  }, [conferences, confParam]);

  const itineraryEvents = useMemo(
    () => allItineraryEvents.filter((e) => !activeConference || e.conference === activeConference),
    [allItineraryEvents, activeConference]
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


  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--theme-bg-primary)]">
        <Loading />
      </div>
    );
  }

  return (
    <div className={viewMode === 'map' || viewMode === 'table' ? 'h-screen flex flex-col bg-[var(--theme-bg-primary)]' : 'min-h-screen bg-[var(--theme-bg-primary)]'}>
      {/* Header */}
      <header className="sticky top-0 z-50 bg-[var(--theme-bg-primary)]/95 backdrop-blur-sm border-b border-[var(--theme-border-secondary)]">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              href={activeConference ? `/${getTabConfig(activeConference, conferenceTabs).slug}` : '/'}
              className="p-1.5 text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)] transition-colors"
              aria-label="Back to events"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
          </div>
          {/* Conference dropdown */}
          {conferences.length > 0 && (
            <div className="shrink-0 relative">
              <button
                ref={(el) => { confBtnRef.current = el; }}
                onClick={() => setConfOpen(!confOpen)}
                className={clsx(
                  'flex items-center gap-1.5 px-3 py-2 rounded-lg font-semibold cursor-pointer transition-colors border',
                  confOpen
                    ? 'text-[var(--theme-accent)] border-[var(--theme-accent)]'
                    : 'bg-[var(--theme-bg-secondary)] text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)] hover:bg-[var(--theme-bg-tertiary)] border-[var(--theme-border-primary)]',
                  (activeConference || 'All').length > 12 ? 'text-xs' : 'text-sm'
                )}
                style={confOpen ? { backgroundColor: 'var(--theme-accent-muted)' } : undefined}
              >
                <MapPin className="w-3.5 h-3.5 shrink-0" />
                <span className="whitespace-nowrap">{activeConference ? activeConference.replace(/ 2026$/, '') : 'All'}</span>
                <ChevronDown className="w-3.5 h-3.5 shrink-0" />
              </button>
              {confOpen && (
                <>
                  <div className="fixed inset-0 z-[60]" onClick={() => setConfOpen(false)} />
                  <div
                    className="fixed z-[70] bg-[var(--theme-bg-secondary)] border border-[var(--theme-border-primary)] rounded-lg shadow-xl overflow-hidden min-w-[180px]"
                    style={{
                      top: confBtnRef.current ? confBtnRef.current.getBoundingClientRect().bottom + 4 : 0,
                      left: confBtnRef.current ? confBtnRef.current.getBoundingClientRect().left : 16,
                    }}
                  >
                    {conferences.map((conf) => (
                      <button
                        key={conf}
                        onClick={() => { trackItineraryConferenceTab(conf); setActiveConference(conf); setConfOpen(false); }}
                        className={clsx(
                          'w-full text-left px-4 py-3 text-sm font-semibold transition-colors cursor-pointer',
                          activeConference === conf
                            ? 'bg-[var(--theme-accent)] text-[var(--theme-accent-text)]'
                            : 'text-[var(--theme-text-primary)] hover:bg-[var(--theme-bg-tertiary)]'
                        )}
                      >
                        {conf}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          <div className="flex items-center gap-1">
            {itineraryEvents.length > 0 && (
              <>
                {/* View toggle */}
                <div className="flex rounded-lg border border-[var(--theme-border-primary)] overflow-hidden mr-1">
                  {([
                    { mode: 'list' as const, icon: List, label: 'List' },
                    { mode: 'table' as const, icon: Table, label: 'Table' },
                    { mode: 'map' as const, icon: MapIcon, label: 'Map' },
                  ]).map(({ mode, icon: Icon, label }) => (
                    <button
                      key={mode}
                      onClick={() => setViewMode(mode)}
                      className={clsx(
                        'flex items-center gap-1 px-2 py-1 text-xs font-medium transition-colors cursor-pointer',
                        viewMode === mode
                          ? 'bg-[var(--theme-accent)] text-[var(--theme-accent-text)]'
                          : 'bg-[var(--theme-bg-secondary)] text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)] hover:bg-[var(--theme-bg-tertiary)]'
                      )}
                      aria-label={`${label} view`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">{label}</span>
                    </button>
                  ))}
                </div>

                <button
                  onClick={() => setShowShareCard(true)}
                  className="p-1.5 text-[var(--theme-text-secondary)] hover:text-[var(--theme-accent)] transition-colors cursor-pointer"
                  aria-label="Share my plan"
                  title="Share my plan as PNG"
                >
                  <Share2 className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Check-in result toast */}
      {checkInResult && (
        <CheckInToast result={checkInResult} onDismiss={clearCheckInResult} />
      )}

      {/* Content */}
      {itineraryEvents.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center px-4">
          <CalendarX className="w-12 h-12 text-[var(--theme-text-faint)] mb-4" />
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
          />
        </main>
      ) : (
        <div className="max-w-2xl mx-auto px-4 pb-8">
          <div ref={captureRef} className="bg-[var(--theme-bg-primary)]">
            <div className="pt-3 pb-1 px-1 flex items-center gap-2">
              <span className="text-base">📅</span>
              <span className="text-sm font-bold text-[var(--theme-text-primary)]">plan.wtf</span>
              <span className="text-xs text-[var(--theme-text-muted)]">— My Plan</span>
            </div>

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
