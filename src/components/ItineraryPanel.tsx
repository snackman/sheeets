'use client';

import { useMemo, useState, useRef, useCallback } from 'react';
import { X, AlertTriangle, Trash2, CalendarX, Share2 } from 'lucide-react';
import type { ETHDenverEvent } from '@/lib/types';
import { VIBE_COLORS } from '@/lib/constants';
import { formatDateLabel } from '@/lib/utils';
import { StarButton } from './StarButton';

interface ItineraryPanelProps {
  isOpen: boolean;
  onClose: () => void;
  events: ETHDenverEvent[];
  itinerary: Set<string>;
  starred: Set<string>;
  onStarToggle: (eventId: string) => void;
  onItineraryToggle: (eventId: string) => void;
  onItineraryClear: () => void;
}

interface DateGroup {
  dateISO: string;
  label: string;
  events: ETHDenverEvent[];
}

/**
 * Parse a time string like "12:00p", "6:00 PM", "2:00p" to minutes since midnight.
 */
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

/**
 * Detect events that have time conflicts (overlapping times on the same day).
 */
function detectConflicts(events: ETHDenverEvent[]): Set<string> {
  const conflicts = new Set<string>();

  // Group by date
  const byDate = new Map<string, ETHDenverEvent[]>();
  for (const event of events) {
    const key = event.dateISO || 'unknown';
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key)!.push(event);
  }

  // Check overlaps within each day
  for (const dayEvents of byDate.values()) {
    for (let i = 0; i < dayEvents.length; i++) {
      for (let j = i + 1; j < dayEvents.length; j++) {
        const a = dayEvents[i];
        const b = dayEvents[j];

        // Skip all-day events for conflict detection
        if (a.isAllDay || b.isAllDay) continue;

        const aStart = timeToMinutes(a.startTime);
        const aEnd = timeToMinutes(a.endTime);
        const bStart = timeToMinutes(b.startTime);
        const bEnd = timeToMinutes(b.endTime);

        // Can't determine overlap without both start and end times
        if (aStart === null || aEnd === null || bStart === null || bEnd === null)
          continue;

        // Two events conflict if: A starts before B ends AND B starts before A ends
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

  const aMin = timeToMinutes(a.startTime) ?? 0;
  const bMin = timeToMinutes(b.startTime) ?? 0;
  return aMin - bMin;
}

export function ItineraryPanel({
  isOpen,
  onClose,
  events,
  itinerary,
  starred,
  onStarToggle,
  onItineraryToggle,
  onItineraryClear,
}: ItineraryPanelProps) {
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [exporting, setExporting] = useState(false);
  const captureRef = useRef<HTMLDivElement>(null);

  // Filter to only itinerary events
  const itineraryEvents = useMemo(
    () => events.filter((e) => itinerary.has(e.id)),
    [events, itinerary]
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
      const mod = await import('html2canvas');
      const html2canvas = mod.default || mod;
      const canvas = await (html2canvas as any)(captureRef.current, {
        backgroundColor: '#0f172a',
        scale: 2,
        useCORS: true,
        onclone: (doc: Document) => {
          doc.querySelectorAll('[data-export-hide]').forEach((el) => el.remove());
        },
      });
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/png')
      );
      if (!blob) return;

      // Try native share on mobile
      const file = new File([blob], 'itinerary.png', { type: 'image/png' });
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'My Itinerary' });
      } else {
        // Download fallback
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
    onItineraryClear();
    setShowClearConfirm(false);
  };

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
        className={`fixed top-0 right-0 z-[70] h-full w-full max-w-md bg-slate-900 border-l border-slate-700 shadow-2xl transition-transform duration-300 ease-in-out ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <h2 className="text-lg font-bold text-white">
            My Itinerary{' '}
            <span className="text-sm font-normal text-slate-400">
              ({itineraryEvents.length} event
              {itineraryEvents.length !== 1 ? 's' : ''})
            </span>
          </h2>
          <div className="flex items-center gap-1">
            {itineraryEvents.length > 0 && (
              <button
                onClick={handleSharePNG}
                disabled={exporting}
                className="p-1.5 text-slate-400 hover:text-orange-400 transition-colors cursor-pointer disabled:opacity-50"
                aria-label="Share as PNG"
                title="Share as PNG"
              >
                <Share2 className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1 text-slate-400 hover:text-white transition-colors cursor-pointer"
              aria-label="Close itinerary"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="overflow-y-auto h-[calc(100%-57px)] px-4 pb-4">
          {itineraryEvents.length === 0 ? (
            /* Empty state */
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <CalendarX className="w-12 h-12 text-slate-600 mb-4" />
              <p className="text-slate-400 font-medium mb-2">
                No events in your itinerary yet
              </p>
              <p className="text-slate-500 text-sm max-w-xs">
                Star events and add them to build your schedule!
              </p>
            </div>
          ) : (
            <>
              {/* Capturable content for PNG export */}
              <div ref={captureRef} className="bg-slate-900">
                {/* Branding header (visible in PNG) */}
                <div className="pt-3 pb-1 px-1 flex items-center gap-2">
                  <span className="text-base">📅</span>
                  <span className="text-sm font-bold text-white">sheeets.xyz</span>
                  <span className="text-xs text-slate-500">— My Itinerary</span>
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
                      <div className="h-px flex-1 bg-slate-700" />
                      <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider whitespace-nowrap">
                        {group.label}
                      </h3>
                      <div className="h-px flex-1 bg-slate-700" />
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

                        return (
                          <div
                            key={event.id}
                            className={`bg-slate-800 rounded-lg p-3 border ${
                              hasConflict
                                ? 'border-amber-500/40'
                                : 'border-slate-700'
                            }`}
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

                            {/* Top row: star, name, remove */}
                            <div className="flex items-start gap-2">
                              <div data-export-hide>
                                <StarButton
                                  eventId={event.id}
                                  isStarred={starred.has(event.id)}
                                  onToggle={onStarToggle}
                                  size="sm"
                                />
                              </div>
                              <h4 className="flex-1 text-sm font-semibold text-white leading-tight min-w-0 truncate">
                                {event.name}
                              </h4>
                              <button
                                data-export-hide
                                onClick={() => onItineraryToggle(event.id)}
                                className="shrink-0 p-1 text-slate-500 hover:text-red-400 transition-colors cursor-pointer"
                                aria-label="Remove from itinerary"
                                title="Remove from itinerary"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>

                            {/* Time */}
                            <p className="text-slate-400 text-xs mt-1 ml-5">
                              {timeDisplay}
                            </p>

                            {/* Badges */}
                            <div className="flex items-center gap-1.5 mt-1.5 ml-5">
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
                        );
                      })}
                    </div>
                  </section>
                ))}

                {/* Footer in PNG */}
                <div className="pt-3 pb-2 text-center">
                  <span className="text-[10px] text-slate-600">sheeets.xyz — side event guide</span>
                </div>
              </div>

              {/* Interactive controls (outside capture area) */}

              {/* Clear all button */}
              <div className="mt-6 pt-4 border-t border-slate-800">
                {showClearConfirm ? (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-slate-400">
                      Clear all events?
                    </span>
                    <button
                      onClick={handleClear}
                      className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white text-xs font-medium rounded transition-colors cursor-pointer"
                    >
                      Yes, clear
                    </button>
                    <button
                      onClick={() => setShowClearConfirm(false)}
                      className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-medium rounded transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowClearConfirm(true)}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-400 hover:text-slate-300 rounded-lg text-sm font-medium transition-colors cursor-pointer"
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
