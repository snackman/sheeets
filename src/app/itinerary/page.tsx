'use client';

import { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { AddressLink } from '@/components/AddressLink';
import { ArrowLeft, AlertTriangle, Trash2, CalendarX, Share2, Download, Map as MapIcon, List, GripVertical } from 'lucide-react';
import clsx from 'clsx';
import { useEvents } from '@/hooks/useEvents';
import { useItinerary } from '@/hooks/useItinerary';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { VIBE_COLORS } from '@/lib/constants';
import { formatDateLabel } from '@/lib/utils';
import { downloadICS } from '@/lib/calendar';
import type { ETHDenverEvent } from '@/lib/types';
import { Loading } from '@/components/Loading';
import { EventCard } from '@/components/EventCard';
import { useDragReorder } from '@/hooks/useDragReorder';

const MapView = dynamic(
  () => import('@/components/MapView').then((mod) => ({ default: mod.MapView })),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full bg-violet-950 flex items-center justify-center">
        <div className="text-violet-300">Loading map...</div>
      </div>
    ),
  }
);

type ItineraryViewMode = 'list' | 'map';

function timeToMinutes(t: string): number | null {
  if (!t) return null;
  const normalized = t.toLowerCase().trim();
  if (normalized === 'all day' || normalized === 'tbd') return null;
  const match = normalized.match(/(\d{1,2}):?(\d{2})?\s*(am?|pm?)?/i);
  if (!match) return null;
  let hour = parseInt(match[1]);
  const min = match[2] ? parseInt(match[2]) : 0;
  const isPM = match[3] && match[3].startsWith('p');
  const isAM = match[3] && match[3].startsWith('a');
  if (isPM && hour !== 12) hour += 12;
  if (isAM && hour === 12) hour = 0;
  return hour * 60 + min;
}

function detectConflicts(events: ETHDenverEvent[]): Set<string> {
  const conflicts = new Set<string>();
  const byDate = new Map<string, ETHDenverEvent[]>();
  for (const event of events) {
    const key = event.dateISO || 'unknown';
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key)!.push(event);
  }
  for (const dayEvents of byDate.values()) {
    for (let i = 0; i < dayEvents.length; i++) {
      for (let j = i + 1; j < dayEvents.length; j++) {
        const a = dayEvents[i], b = dayEvents[j];
        if (a.isAllDay || b.isAllDay) continue;
        const aStart = timeToMinutes(a.startTime), aEnd = timeToMinutes(a.endTime);
        const bStart = timeToMinutes(b.startTime), bEnd = timeToMinutes(b.endTime);
        if (aStart === null || aEnd === null || bStart === null || bEnd === null) continue;
        if (aStart < bEnd && bStart < aEnd) {
          conflicts.add(a.id);
          conflicts.add(b.id);
        }
      }
    }
  }
  return conflicts;
}

function sortByStartTime(a: ETHDenverEvent, b: ETHDenverEvent): number {
  if (a.isAllDay && !b.isAllDay) return -1;
  if (!a.isAllDay && b.isAllDay) return 1;
  if (a.isAllDay && b.isAllDay) return a.name.localeCompare(b.name);
  return (timeToMinutes(a.startTime) ?? 0) - (timeToMinutes(b.startTime) ?? 0);
}

function generateShortCode(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export default function ItineraryPage() {
  const { events, loading } = useEvents();
  const { itinerary, toggle: toggleItinerary, clear: clearItinerary, reorder: reorderItinerary } = useItinerary();
  const { user } = useAuth();
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [viewMode, setViewMode] = useState<ItineraryViewMode>('list');
  const [shareStatus, setShareStatus] = useState<'idle' | 'sharing' | 'copied'>('idle');
  const captureRef = useRef<HTMLDivElement>(null);

  // Get conferences that have itinerary events
  const allItineraryEvents = useMemo(
    () => events.filter((e) => itinerary.has(e.id)),
    [events, itinerary]
  );
  const conferences = useMemo(
    () => [...new Set(allItineraryEvents.map((e) => e.conference).filter(Boolean))],
    [allItineraryEvents]
  );
  const [activeConference, setActiveConference] = useState('');

  // Auto-select first conference when data loads
  useMemo(() => {
    if (conferences.length > 0 && !activeConference) {
      setActiveConference(conferences[0]);
    }
  }, [conferences, activeConference]);

  const itineraryEvents = useMemo(
    () => allItineraryEvents.filter((e) => !activeConference || e.conference === activeConference),
    [allItineraryEvents, activeConference]
  );

  const conflicts = useMemo(() => detectConflicts(itineraryEvents), [itineraryEvents]);

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
        events: groupEvents.sort(sortByStartTime),
      }));
  }, [itineraryEvents]);

  // Flat ordered list of all event IDs across date groups (for drag reorder)
  const flatEventIds = useMemo(
    () => dateGroups.flatMap((g) => g.events.map((e) => e.id)),
    [dateGroups]
  );

  const handleReorder = useCallback(
    (orderedIds: string[]) => {
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

  const handleSharePNG = useCallback(async () => {
    if (!captureRef.current || itineraryEvents.length === 0) return;
    setExporting(true);
    try {
      const { toBlob } = await import('html-to-image');
      const hideEls = captureRef.current.querySelectorAll('[data-export-hide]');
      hideEls.forEach((el) => ((el as HTMLElement).style.display = 'none'));
      const blob = await toBlob(captureRef.current, { backgroundColor: '#0f172a', pixelRatio: 2 });
      hideEls.forEach((el) => ((el as HTMLElement).style.display = ''));
      if (!blob) return;
      const file = new File([blob], 'itinerary.png', { type: 'image/png' });
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'My Itinerary' });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'itinerary.png';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error('PNG export failed:', err);
    } finally {
      setExporting(false);
    }
  }, [itineraryEvents.length]);

  const handleShareLink = useCallback(async () => {
    if (itineraryEvents.length === 0) return;
    setShareStatus('sharing');
    try {
      const shortCode = generateShortCode();
      const eventIds = itineraryEvents.map((e) => e.id);
      const { error } = await supabase.from('shared_itineraries').insert({
        short_code: shortCode,
        event_ids: eventIds,
        created_by: user?.id ?? null,
      });
      if (error) {
        console.error('Failed to create share link:', error);
        setShareStatus('idle');
        return;
      }
      const shareUrl = `${window.location.origin}/itinerary/s/${shortCode}`;
      await navigator.clipboard.writeText(shareUrl);
      setShareStatus('copied');
      setTimeout(() => setShareStatus('idle'), 2500);
    } catch (err) {
      console.error('Share failed:', err);
      setShareStatus('idle');
    }
  }, [itineraryEvents, user]);

  if (loading) {
    return (
      <div className="min-h-screen bg-violet-950">
        <Loading />
      </div>
    );
  }

  return (
    <div className={viewMode === 'map' ? 'h-screen flex flex-col bg-violet-950' : 'min-h-screen bg-violet-950'}>
      {/* Header */}
      <header className="sticky top-0 z-50 bg-violet-950/95 backdrop-blur-sm border-b border-violet-900">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="p-1.5 text-violet-300 hover:text-white transition-colors"
              aria-label="Back to events"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <h1 className="text-lg font-bold text-white">
              My Itinerary{' '}
              <span className="text-sm font-normal text-violet-300">
                ({itineraryEvents.length} event{itineraryEvents.length !== 1 ? 's' : ''})
              </span>
            </h1>
          </div>
          {/* Conference tabs */}
          {conferences.length > 1 && (
            <div className="flex rounded-lg border border-violet-800 overflow-hidden">
              {conferences.map((conf) => (
                <button
                  key={conf}
                  onClick={() => setActiveConference(conf)}
                  className={clsx(
                    'px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer',
                    activeConference === conf
                      ? 'bg-cyan-500 text-white'
                      : 'bg-violet-900 text-violet-300 hover:text-violet-100 hover:bg-violet-800'
                  )}
                >
                  {conf.replace(/ 2026$/, '')}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-1">
            {itineraryEvents.length > 0 && (
              <>
                {/* View toggle */}
                <div className="flex rounded-lg border border-violet-800 overflow-hidden mr-1">
                  {([
                    { mode: 'list' as const, icon: List, label: 'List' },
                    { mode: 'map' as const, icon: MapIcon, label: 'Map' },
                  ]).map(({ mode, icon: Icon, label }) => (
                    <button
                      key={mode}
                      onClick={() => setViewMode(mode)}
                      className={clsx(
                        'flex items-center gap-1 px-2 py-1 text-xs font-medium transition-colors cursor-pointer',
                        viewMode === mode
                          ? 'bg-cyan-500 text-white'
                          : 'bg-violet-900 text-violet-300 hover:text-violet-100 hover:bg-violet-800'
                      )}
                      aria-label={`${label} view`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">{label}</span>
                    </button>
                  ))}
                </div>

                <button
                  onClick={() => downloadICS(itineraryEvents)}
                  className="p-1.5 text-violet-300 hover:text-cyan-400 transition-colors cursor-pointer"
                  aria-label="Export to calendar"
                  title="Export to calendar (.ics)"
                >
                  <Download className="w-4 h-4" />
                </button>
                <button
                  onClick={handleSharePNG}
                  disabled={exporting}
                  className="p-1.5 text-violet-300 hover:text-cyan-400 transition-colors cursor-pointer disabled:opacity-50"
                  aria-label="Share as PNG"
                  title="Share as PNG"
                >
                  <Share2 className="w-4 h-4" />
                </button>
                <button
                  onClick={handleShareLink}
                  disabled={shareStatus === 'sharing'}
                  className={clsx(
                    'px-2 py-1 text-xs font-medium rounded transition-colors cursor-pointer',
                    shareStatus === 'copied'
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : 'bg-violet-900 border border-violet-800 text-violet-300 hover:text-cyan-400 hover:border-violet-700'
                  )}
                  title="Share link"
                >
                  {shareStatus === 'sharing' ? 'Saving...' : shareStatus === 'copied' ? 'Copied!' : 'Share Link'}
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Content */}
      {itineraryEvents.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center px-4">
          <CalendarX className="w-12 h-12 text-violet-500 mb-4" />
          <p className="text-violet-300 font-medium mb-2">No events in your itinerary yet</p>
          <p className="text-violet-400 text-sm max-w-xs mb-4">
            Star events from the main page to build your schedule!
          </p>
          <Link
            href="/"
            className="px-4 py-2 bg-cyan-500 hover:bg-cyan-600 text-white rounded-lg text-sm font-medium transition-colors"
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
          />
        </main>
      ) : (
        <div className="max-w-2xl mx-auto px-4 pb-8">
          <div ref={captureRef} className="bg-violet-950">
            <div className="pt-3 pb-1 px-1 flex items-center gap-2">
              <span className="text-base">📅</span>
              <span className="text-sm font-bold text-white">sheeets.xyz</span>
              <span className="text-xs text-violet-400">— My Itinerary</span>
            </div>

            {conflicts.size > 0 && (
              <div className="mt-2 mb-1 px-3 py-2 bg-amber-500/10 border border-amber-500/20 rounded-lg flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                <p className="text-amber-400 text-xs">
                  {conflicts.size} event{conflicts.size !== 1 ? 's' : ''} with schedule conflicts
                </p>
              </div>
            )}

            {dateGroups.map((group) => (
              <section key={group.dateISO} className="mt-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="h-px flex-1 bg-violet-800" />
                  <h3 className="text-xs font-bold text-violet-300 uppercase tracking-wider whitespace-nowrap">
                    {group.label}
                  </h3>
                  <div className="h-px flex-1 bg-violet-800" />
                </div>

                <div className="space-y-2">
                  {group.events.map((event) => {
                    const hasConflict = conflicts.has(event.id);
                    const vibeColor = VIBE_COLORS[event.vibe] || VIBE_COLORS['default'];
                    const timeDisplay = event.isAllDay
                      ? 'All Day'
                      : `${event.startTime}${event.endTime ? ` - ${event.endTime}` : ''}`;
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
                          <div className="absolute -top-1.5 left-0 right-0 h-0.5 bg-cyan-500 rounded-full z-10" />
                        )}

                        <div
                          className={`bg-violet-900 rounded-lg p-3 border transition-opacity ${
                            hasConflict ? 'border-amber-500/40' : 'border-violet-800'
                          } ${isBeingDragged ? 'opacity-40' : 'opacity-100'}`}
                        >
                          {hasConflict && (
                            <div className="flex items-center gap-1.5 mb-2 text-amber-400">
                              <AlertTriangle className="w-3 h-3" />
                              <span className="text-[10px] font-medium uppercase tracking-wide">
                                Schedule conflict
                              </span>
                            </div>
                          )}

                          <div className="flex items-start gap-2">
                            <div
                              data-export-hide
                              {...getDragHandleProps(event.id)}
                              className="shrink-0 pt-0.5 text-violet-500 hover:text-violet-300 active:text-violet-300 cursor-grab active:cursor-grabbing touch-none select-none"
                              aria-label="Drag to reorder"
                              title="Drag to reorder"
                            >
                              <GripVertical className="w-4 h-4" />
                            </div>
                            <h4 className="flex-1 text-sm font-semibold text-white leading-tight min-w-0">
                              {event.link ? (
                                <a
                                  href={event.link}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="hover:text-cyan-400 transition-colors"
                                >
                                  {event.name}
                                </a>
                              ) : (
                                event.name
                              )}
                            </h4>
                            <button
                              data-export-hide
                              onClick={() => toggleItinerary(event.id)}
                              className="shrink-0 p-1 text-violet-400 hover:text-red-400 transition-colors cursor-pointer"
                              aria-label="Remove from itinerary"
                              title="Remove from itinerary"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          {event.organizer && (
                            <p className="text-violet-400 text-xs mt-0.5 ml-6">By {event.organizer}</p>
                          )}

                          <p className="text-violet-300 text-xs mt-1 ml-6">{timeDisplay}</p>

                          {event.address && (
                            <AddressLink address={event.address} navAddress={event.matchedAddress} lat={event.lat} lng={event.lng}
                              eventId={event.id} eventName={event.name}
                              className="text-violet-400 hover:text-violet-200 text-xs mt-0.5 truncate block transition-colors ml-6">
                              {event.address}
                            </AddressLink>
                          )}

                          <div className="flex items-center gap-1.5 mt-1.5 ml-6">
                            {event.vibe && (
                              <span
                                className="px-1.5 py-0.5 rounded text-[10px] font-semibold text-white"
                                style={{ backgroundColor: vibeColor }}
                              >
                                {event.vibe}
                              </span>
                            )}
                            {event.isFree && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/20 text-emerald-400">
                                FREE
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Drop indicator - below */}
                        {dropIndicator.showBelow && (
                          <div className="absolute -bottom-1.5 left-0 right-0 h-0.5 bg-cyan-500 rounded-full z-10" />
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}

            <div className="pt-3 pb-2 text-center">
              <span className="text-[10px] text-violet-500">sheeets.xyz — side event guide</span>
            </div>
          </div>

          {/* Clear button */}
          <div className="mt-6 pt-4 border-t border-violet-900">
            {showClearConfirm ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-violet-300">Clear all events?</span>
                <button
                  onClick={() => { clearItinerary(); setShowClearConfirm(false); }}
                  className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white text-xs font-medium rounded transition-colors cursor-pointer"
                >
                  Yes, clear
                </button>
                <button
                  onClick={() => setShowClearConfirm(false)}
                  className="px-3 py-1.5 bg-violet-800 hover:bg-violet-700 text-violet-200 text-xs font-medium rounded transition-colors cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowClearConfirm(true)}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-violet-900 hover:bg-violet-800 border border-violet-800 text-violet-300 hover:text-violet-200 rounded-lg text-sm font-medium transition-colors cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
                Clear Itinerary
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
