'use client';

import { useMemo, useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { ArrowLeft, AlertTriangle, Trash2, CalendarX, Share2, Download, Map as MapIcon, List } from 'lucide-react';
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

const MapView = dynamic(
  () => import('@/components/MapView').then((mod) => ({ default: mod.MapView })),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full bg-slate-900 flex items-center justify-center">
        <div className="text-slate-400">Loading map...</div>
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
  const { itinerary, toggle: toggleItinerary, clear: clearItinerary } = useItinerary();
  const { user } = useAuth();
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [viewMode, setViewMode] = useState<ItineraryViewMode>('list');
  const [shareStatus, setShareStatus] = useState<'idle' | 'sharing' | 'copied'>('idle');
  const captureRef = useRef<HTMLDivElement>(null);

  const itineraryEvents = useMemo(
    () => events.filter((e) => itinerary.has(e.id)),
    [events, itinerary]
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
      <div className="min-h-screen bg-slate-900">
        <Loading />
      </div>
    );
  }

  return (
    <div className={viewMode === 'map' ? 'h-screen flex flex-col bg-slate-900' : 'min-h-screen bg-slate-900'}>
      {/* Header */}
      <header className="sticky top-0 z-50 bg-slate-900/95 backdrop-blur-sm border-b border-slate-800">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="p-1.5 text-slate-400 hover:text-white transition-colors"
              aria-label="Back to events"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <h1 className="text-lg font-bold text-white">
              My Itinerary{' '}
              <span className="text-sm font-normal text-slate-400">
                ({itineraryEvents.length} event{itineraryEvents.length !== 1 ? 's' : ''})
              </span>
            </h1>
          </div>
          <div className="flex items-center gap-1">
            {itineraryEvents.length > 0 && (
              <>
                {/* View toggle */}
                <div className="flex rounded-lg border border-slate-700 overflow-hidden mr-1">
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
                          ? 'bg-orange-500 text-white'
                          : 'bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700'
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
                  className="p-1.5 text-slate-400 hover:text-orange-400 transition-colors cursor-pointer"
                  aria-label="Export to calendar"
                  title="Export to calendar (.ics)"
                >
                  <Download className="w-4 h-4" />
                </button>
                <button
                  onClick={handleSharePNG}
                  disabled={exporting}
                  className="p-1.5 text-slate-400 hover:text-orange-400 transition-colors cursor-pointer disabled:opacity-50"
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
                      : 'bg-slate-800 border border-slate-700 text-slate-400 hover:text-orange-400 hover:border-slate-600'
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
          <CalendarX className="w-12 h-12 text-slate-600 mb-4" />
          <p className="text-slate-400 font-medium mb-2">No events in your itinerary yet</p>
          <p className="text-slate-500 text-sm max-w-xs mb-4">
            Star events from the main page to build your schedule!
          </p>
          <Link
            href="/"
            className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-sm font-medium transition-colors"
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
          <div ref={captureRef} className="bg-slate-900">
            <div className="pt-3 pb-1 px-1 flex items-center gap-2">
              <span className="text-base">📅</span>
              <span className="text-sm font-bold text-white">sheeets.xyz</span>
              <span className="text-xs text-slate-500">— My Itinerary</span>
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
                  <div className="h-px flex-1 bg-slate-700" />
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider whitespace-nowrap">
                    {group.label}
                  </h3>
                  <div className="h-px flex-1 bg-slate-700" />
                </div>

                <div className="space-y-2">
                  {group.events.map((event) => {
                    const hasConflict = conflicts.has(event.id);
                    const vibeColor = VIBE_COLORS[event.vibe] || VIBE_COLORS['default'];
                    const timeDisplay = event.isAllDay
                      ? 'All Day'
                      : `${event.startTime}${event.endTime ? ` - ${event.endTime}` : ''}`;

                    return (
                      <div
                        key={event.id}
                        className={`bg-slate-800 rounded-lg p-3 border ${
                          hasConflict ? 'border-amber-500/40' : 'border-slate-700'
                        }`}
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
                          <h4 className="flex-1 text-sm font-semibold text-white leading-tight min-w-0">
                            {event.link ? (
                              <a
                                href={event.link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="hover:text-orange-400 transition-colors"
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
                            className="shrink-0 p-1 text-slate-500 hover:text-red-400 transition-colors cursor-pointer"
                            aria-label="Remove from itinerary"
                            title="Remove from itinerary"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {event.organizer && (
                          <p className="text-slate-500 text-xs mt-0.5">By {event.organizer}</p>
                        )}

                        <p className="text-slate-400 text-xs mt-1">{timeDisplay}</p>

                        {event.address && (
                          <p className="text-slate-500 text-xs mt-0.5 truncate">{event.address}</p>
                        )}

                        <div className="flex items-center gap-1.5 mt-1.5">
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

            <div className="pt-3 pb-2 text-center">
              <span className="text-[10px] text-slate-600">sheeets.xyz — side event guide</span>
            </div>
          </div>

          {/* Clear button */}
          <div className="mt-6 pt-4 border-t border-slate-800">
            {showClearConfirm ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-400">Clear all events?</span>
                <button
                  onClick={() => { clearItinerary(); setShowClearConfirm(false); }}
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
        </div>
      )}
    </div>
  );
}
