'use client';

import { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { X, AlertTriangle, Trash2, CalendarX, Share2, ExternalLink, Download, GripVertical } from 'lucide-react';
import type { ETHDenverEvent } from '@/lib/types';
import { VIBE_COLORS } from '@/lib/tags';
import { formatDateLabel } from '@/lib/utils';
import { sortByStartTime, detectConflicts } from '@/lib/time-parse';
import { downloadICS } from '@/lib/calendar';
import { useDragReorder } from '@/hooks/useDragReorder';
import { trackItineraryClear, trackItineraryConferenceTab, trackItineraryExportIcs, trackItinerarySharePng, trackItineraryReorder } from '@/lib/analytics';

interface ItineraryPanelProps {
  isOpen: boolean;
  onClose: () => void;
  events: ETHDenverEvent[];
  itinerary: Set<string>;
  onItineraryToggle: (eventId: string) => void;
  onItineraryClear: () => void;
  onReorder?: (orderedIds: string[]) => void;
  activeConference?: string;
}

interface DateGroup {
  dateISO: string;
  label: string;
  events: ETHDenverEvent[];
}

export function ItineraryPanel({
  isOpen,
  onClose,
  events,
  itinerary,
  onItineraryToggle,
  onItineraryClear,
  onReorder,
  activeConference,
}: ItineraryPanelProps) {
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [exporting, setExporting] = useState(false);
  const captureRef = useRef<HTMLDivElement>(null);

  // All itinerary events (for badge count)
  const allItineraryEvents = useMemo(
    () => events.filter((e) => itinerary.has(e.id)),
    [events, itinerary]
  );

  // Conferences that have itinerary events
  const conferences = useMemo(
    () => [...new Set(allItineraryEvents.map((e) => e.conference).filter(Boolean))],
    [allItineraryEvents]
  );

  // Default to the active conference from the main view, fall back to first conference with events
  const [selectedConference, setSelectedConference] = useState('');
  // Sync selectedConference when the active conference or available conferences change.
  // Using useEffect instead of useMemo to avoid setState during render (which causes
  // cascading re-renders and was a contributing factor to the row duplication bug).
  useEffect(() => {
    if (activeConference && conferences.includes(activeConference)) {
      setSelectedConference(activeConference);
    } else if (conferences.length > 0 && !selectedConference) {
      setSelectedConference(conferences[0]);
    }
  }, [activeConference, conferences, selectedConference]);

  // Filter to selected conference
  const itineraryEvents = useMemo(
    () => allItineraryEvents.filter((e) => !selectedConference || e.conference === selectedConference),
    [allItineraryEvents, selectedConference]
  );

  // Detect conflicts
  const conflicts = useMemo(
    () => detectConflicts(itineraryEvents),
    [itineraryEvents]
  );

  // Group by date
  const dateGroups: DateGroup[] = useMemo(() => {
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
        label:
          dateISO === 'unknown' ? 'Date TBD' : formatDateLabel(dateISO),
        events: groupEvents.sort(sortByStartTime),
      }));
  }, [itineraryEvents]);

  const handleSharePNG = useCallback(async () => {
    if (!captureRef.current || itineraryEvents.length === 0) return;
    setExporting(true);
    try {
      const { toBlob } = await import('html-to-image');

      // Hide interactive elements before capture
      const hideEls = captureRef.current.querySelectorAll('[data-export-hide]');
      hideEls.forEach((el) => (el as HTMLElement).style.display = 'none');

      const blob = await toBlob(captureRef.current, {
        backgroundColor: '#0c0a09',
        pixelRatio: 2,
      });

      // Restore hidden elements
      hideEls.forEach((el) => (el as HTMLElement).style.display = '');

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

  const handleClear = () => {
    trackItineraryClear();
    onItineraryClear();
    setShowClearConfirm(false);
  };

  // Flat ordered list of all event IDs across date groups (for drag reorder)
  const flatEventIds = useMemo(
    () => dateGroups.flatMap((g) => g.events.map((e) => e.id)),
    [dateGroups]
  );

  const handleReorder = useCallback(
    (orderedIds: string[]) => {
      if (!onReorder) return;
      trackItineraryReorder();
      // The drag reorder gives us the visible (conference-filtered) IDs in new order.
      // We need to preserve IDs from other conferences that aren't visible.
      const allIds = [...itinerary];
      const visibleIdSet = new Set(flatEventIds);
      const otherIds = allIds.filter((id) => !visibleIdSet.has(id));
      onReorder([...orderedIds, ...otherIds]);
    },
    [onReorder, itinerary, flatEventIds]
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

  const canDrag = !!onReorder;

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-[60] bg-black/50 transition-opacity duration-300 ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className={`fixed top-0 right-0 z-[70] h-full w-full max-w-md bg-stone-950 border-l border-stone-700 shadow-2xl transition-transform duration-300 ease-in-out pt-[var(--safe-area-top)] ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-stone-800">
          <h2 className="text-lg font-bold text-white">
            My Itinerary{' '}
            <span className="text-sm font-normal text-stone-400">
              ({itineraryEvents.length} event
              {itineraryEvents.length !== 1 ? 's' : ''})
            </span>
          </h2>
          <div className="flex items-center gap-1">
            {itineraryEvents.length > 0 && (
              <>
                <Link
                  href="/itinerary"
                  className="p-1.5 text-stone-400 hover:text-amber-400 active:text-amber-400 transition-colors"
                  aria-label="Open full page"
                  title="Open full page"
                >
                  <ExternalLink className="w-4 h-4" />
                </Link>
                <button
                  onClick={() => { trackItineraryExportIcs(); downloadICS(itineraryEvents); }}
                  className="p-1.5 text-stone-400 hover:text-amber-400 active:text-amber-400 transition-colors cursor-pointer"
                  aria-label="Export to calendar"
                  title="Export to calendar (.ics)"
                >
                  <Download className="w-4 h-4" />
                </button>
                <button
                  onClick={() => { trackItinerarySharePng(); handleSharePNG(); }}
                  disabled={exporting}
                  className="p-1.5 text-stone-400 hover:text-amber-400 active:text-amber-400 transition-colors cursor-pointer disabled:opacity-50"
                  aria-label="Share as PNG"
                  title="Share as PNG"
                >
                  <Share2 className="w-4 h-4" />
                </button>
              </>
            )}
            <button
              onClick={onClose}
              className="p-1 text-stone-400 hover:text-white active:text-white transition-colors cursor-pointer"
              aria-label="Close itinerary"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Conference tabs */}
        {conferences.length > 1 && (
          <div className="flex border-b border-stone-800 px-4">
            {conferences.map((conf) => (
              <button
                key={conf}
                onClick={() => { trackItineraryConferenceTab(conf); setSelectedConference(conf); }}
                className={`px-3 py-2 text-xs font-medium transition-colors cursor-pointer border-b-2 ${
                  selectedConference === conf
                    ? 'border-amber-500 text-white'
                    : 'border-transparent text-stone-400 hover:text-stone-200 active:text-stone-200'
                }`}
              >
                {conf.replace(/ 2026$/, '')}
              </button>
            ))}
          </div>
        )}

        {/* Content */}
        <div className={`overflow-y-auto ${conferences.length > 1 ? 'h-[calc(100%-95px)]' : 'h-[calc(100%-57px)]'} px-4 pb-4`}>
          {itineraryEvents.length === 0 ? (
            /* Empty state */
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <CalendarX className="w-12 h-12 text-stone-600 mb-4" />
              <p className="text-stone-400 font-medium mb-2">
                No events in your itinerary yet
              </p>
              <p className="text-stone-500 text-sm max-w-xs">
                Star events and add them to build your schedule!
              </p>
            </div>
          ) : (
            <>
              {/* Capturable content for PNG export */}
              <div ref={captureRef} className="bg-stone-950">
                {/* Branding header (visible in PNG) */}
                <div className="pt-3 pb-1 px-1 flex items-center gap-2">
                  <span className="text-base">📅</span>
                  <span className="text-sm font-bold text-white">sheeets.xyz</span>
                  <span className="text-xs text-stone-500">— My Itinerary</span>
                </div>

                {/* Conflict warning */}
                {conflicts.size > 0 && (
                  <div className="mt-2 mb-1 px-3 py-2 bg-amber-500/10 border border-amber-500/20 rounded-lg flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                    <p className="text-amber-400 text-xs">
                      {conflicts.size} event{conflicts.size !== 1 ? 's' : ''} with
                      schedule conflicts
                    </p>
                  </div>
                )}

                {/* Date groups */}
                {dateGroups.map((group) => (
                  <section key={group.dateISO} className="mt-4">
                    {/* Date header */}
                    <div className="flex items-center gap-2 mb-2">
                      <div className="h-px flex-1 bg-stone-800" />
                      <h3 className="text-xs font-bold text-stone-400 uppercase tracking-wider whitespace-nowrap">
                        {group.label}
                      </h3>
                      <div className="h-px flex-1 bg-stone-800" />
                    </div>

                    {/* Event cards */}
                    <div className="space-y-2">
                      {group.events.map((event) => {
                        const hasConflict = conflicts.has(event.id);
                        const vibeColor =
                          VIBE_COLORS[event.vibe] || VIBE_COLORS['default'];
                        const timeDisplay = event.isAllDay
                          ? 'All Day'
                          : `${event.startTime}${event.endTime ? ` - ${event.endTime}` : ''}`;
                        const dropIndicator = getDropIndicator(event.id);
                        const isBeingDragged = dragId === event.id;

                        return (
                          <div
                            key={event.id}
                            ref={(el) => registerItemRef(event.id, el)}
                            {...(canDrag ? getItemProps(event.id) : {})}
                            className="relative"
                          >
                            {/* Drop indicator - above */}
                            {dropIndicator.showAbove && (
                              <div className="absolute -top-1.5 left-0 right-0 h-0.5 bg-amber-500 rounded-full z-10" />
                            )}

                            <div
                              className={`bg-stone-900 rounded-lg p-3 border transition-opacity ${
                                hasConflict
                                  ? 'border-amber-500/40'
                                  : 'border-stone-700'
                              } ${isBeingDragged ? 'opacity-40' : 'opacity-100'}`}
                            >
                              {/* Conflict warning */}
                              {hasConflict && (
                                <div className="flex items-center gap-1.5 mb-2 text-amber-400">
                                  <AlertTriangle className="w-3 h-3" />
                                  <span className="text-[10px] font-medium uppercase tracking-wide">
                                    Schedule conflict
                                  </span>
                                </div>
                              )}

                              {/* Top row: drag handle, name, remove */}
                              <div className="flex items-start gap-2">
                                {canDrag && (
                                  <div
                                    data-export-hide
                                    {...getDragHandleProps(event.id)}
                                    className="shrink-0 pt-0.5 text-stone-600 hover:text-stone-400 active:text-stone-400 cursor-grab active:cursor-grabbing touch-none select-none"
                                    aria-label="Drag to reorder"
                                    title="Drag to reorder"
                                  >
                                    <GripVertical className="w-4 h-4" />
                                  </div>
                                )}
                                <h4 className="flex-1 text-sm font-semibold text-white leading-tight min-w-0 truncate">
                                  {event.name}
                                </h4>
                                <button
                                  data-export-hide
                                  onClick={() => onItineraryToggle(event.id)}
                                  className="shrink-0 p-1 text-stone-500 hover:text-red-400 active:text-red-400 transition-colors cursor-pointer"
                                  aria-label="Remove from itinerary"
                                  title="Remove from itinerary"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>

                              {/* Time */}
                              <p className={`text-stone-400 text-xs mt-1 ${canDrag ? 'ml-6' : ''}`}>
                                {timeDisplay}
                              </p>

                              {/* Badges */}
                              <div className={`flex items-center gap-1.5 mt-1.5 ${canDrag ? 'ml-6' : ''}`}>
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
                              <div className="absolute -bottom-1.5 left-0 right-0 h-0.5 bg-amber-500 rounded-full z-10" />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ))}

                {/* Footer in PNG */}
                <div className="pt-3 pb-2 text-center">
                  <span className="text-[10px] text-stone-600">sheeets.xyz — side event guide</span>
                </div>
              </div>

              {/* Interactive controls (outside capture area) */}

              {/* Clear all button */}
              <div className="mt-6 pt-4 border-t border-stone-800">
                {showClearConfirm ? (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-stone-400">
                      Clear all events?
                    </span>
                    <button
                      onClick={handleClear}
                      className="px-3 py-1.5 bg-red-500 hover:bg-red-600 active:bg-red-600 text-white text-xs font-medium rounded transition-colors cursor-pointer"
                    >
                      Yes, clear
                    </button>
                    <button
                      onClick={() => setShowClearConfirm(false)}
                      className="px-3 py-1.5 bg-stone-800 hover:bg-stone-700 active:bg-stone-700 text-stone-300 text-xs font-medium rounded transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowClearConfirm(true)}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-stone-900 hover:bg-stone-800 active:bg-stone-800 border border-stone-700 text-stone-400 hover:text-stone-300 active:text-stone-300 rounded-lg text-sm font-medium transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                    Clear Itinerary
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
