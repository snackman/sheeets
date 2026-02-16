'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { AddressLink } from '@/components/AddressLink';
import dynamic from 'next/dynamic';
import { ArrowLeft, Calendar, Map as MapIcon, List, Copy, Check } from 'lucide-react';
import clsx from 'clsx';
import { useEvents } from '@/hooks/useEvents';
import { useItinerary } from '@/hooks/useItinerary';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { VIBE_COLORS } from '@/lib/constants';
import { formatDateLabel } from '@/lib/utils';
import type { ETHDenverEvent } from '@/lib/types';
import { Loading } from '@/components/Loading';
import { AuthModal } from '@/components/AuthModal';

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

type SharedViewMode = 'list' | 'map';

function sortByStartTime(a: ETHDenverEvent, b: ETHDenverEvent): number {
  if (a.isAllDay && !b.isAllDay) return -1;
  if (!a.isAllDay && b.isAllDay) return 1;
  if (a.isAllDay && b.isAllDay) return a.name.localeCompare(b.name);

  const timeToMinutes = (t: string): number => {
    const normalized = t.toLowerCase().trim();
    const match = normalized.match(/(\d{1,2}):?(\d{2})?\s*(am?|pm?)?/i);
    if (!match) return 0;
    let hour = parseInt(match[1]);
    const min = match[2] ? parseInt(match[2]) : 0;
    const isPM = match[3] && match[3].startsWith('p');
    const isAM = match[3] && match[3].startsWith('a');
    if (isPM && hour !== 12) hour += 12;
    if (isAM && hour === 12) hour = 0;
    return hour * 60 + min;
  };

  return timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
}

export default function SharedItineraryPage() {
  const params = useParams();
  const code = params.code as string;

  const { events, loading: eventsLoading } = useEvents();
  const { itinerary, addMany, toggle: toggleItinerary } = useItinerary();
  const { user } = useAuth();

  const [sharedEventIds, setSharedEventIds] = useState<string[] | null>(null);
  const [loadingShare, setLoadingShare] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [viewMode, setViewMode] = useState<SharedViewMode>('list');
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle');
  const [showAuth, setShowAuth] = useState(false);
  const [pendingCopy, setPendingCopy] = useState(false);

  // Fetch shared itinerary from Supabase
  useEffect(() => {
    async function fetchShared() {
      try {
        const { data, error } = await supabase
          .from('shared_itineraries')
          .select('event_ids')
          .eq('short_code', code)
          .maybeSingle();

        if (error || !data) {
          setNotFound(true);
        } else {
          setSharedEventIds(data.event_ids);
        }
      } catch {
        setNotFound(true);
      }
      setLoadingShare(false);
    }

    if (code) fetchShared();
  }, [code]);

  // Handle pending copy after auth
  useEffect(() => {
    if (pendingCopy && user && sharedEventIds) {
      addMany(sharedEventIds);
      setCopyStatus('copied');
      setPendingCopy(false);
      setTimeout(() => setCopyStatus('idle'), 2500);
    }
  }, [pendingCopy, user, sharedEventIds, addMany]);

  const sharedEvents = useMemo(() => {
    if (!sharedEventIds) return [];
    const idSet = new Set(sharedEventIds);
    return events.filter((e) => idSet.has(e.id));
  }, [events, sharedEventIds]);

  const dateGroups = useMemo(() => {
    const groupMap = new Map<string, ETHDenverEvent[]>();
    for (const event of sharedEvents) {
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
  }, [sharedEvents]);

  const dateRange = useMemo(() => {
    if (dateGroups.length === 0) return '';
    if (dateGroups.length === 1) return dateGroups[0].label;
    return `${dateGroups[0].label} - ${dateGroups[dateGroups.length - 1].label}`;
  }, [dateGroups]);

  const handleCopyToItinerary = useCallback(() => {
    if (!sharedEventIds || sharedEventIds.length === 0) return;

    if (!user) {
      setPendingCopy(true);
      setShowAuth(true);
      return;
    }

    addMany(sharedEventIds);
    setCopyStatus('copied');
    setTimeout(() => setCopyStatus('idle'), 2500);
  }, [sharedEventIds, user, addMany]);

  const handleAuthClose = useCallback(() => {
    setShowAuth(false);
    // If user didn't sign in, cancel pending copy
    if (!user) {
      setPendingCopy(false);
    }
  }, [user]);

  const loading = eventsLoading || loadingShare;

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900">
        <Loading />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center px-4">
        <p className="text-slate-400 text-lg font-medium mb-2">Itinerary not found</p>
        <p className="text-slate-500 text-sm mb-4">This share link may have expired or is invalid.</p>
        <Link
          href="/"
          className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-sm font-medium transition-colors"
        >
          Browse Events
        </Link>
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
            <div>
              <h1 className="text-lg font-bold text-white">Shared Itinerary</h1>
              <p className="text-xs text-slate-400">
                {sharedEvents.length} event{sharedEvents.length !== 1 ? 's' : ''}
                {dateRange && ` · ${dateRange}`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {sharedEvents.length > 0 && (
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
              </>
            )}
          </div>
        </div>
      </header>

      {/* Copy to itinerary banner */}
      {sharedEvents.length > 0 && (
        <div className="bg-slate-800/50 border-b border-slate-800">
          <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
            <p className="text-sm text-slate-300">
              Add these events to your itinerary
            </p>
            <button
              onClick={handleCopyToItinerary}
              className={clsx(
                'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer',
                copyStatus === 'copied'
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : 'bg-orange-500 hover:bg-orange-600 text-white'
              )}
            >
              {copyStatus === 'copied' ? (
                <>
                  <Check className="w-4 h-4" />
                  Added!
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  Copy to My Itinerary
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      {sharedEvents.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center px-4">
          <Calendar className="w-12 h-12 text-slate-600 mb-4" />
          <p className="text-slate-400 font-medium mb-2">No matching events found</p>
          <p className="text-slate-500 text-sm max-w-xs mb-4">
            The events in this itinerary may no longer be available.
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
            events={sharedEvents}
            itinerary={itinerary}
            onItineraryToggle={toggleItinerary}
          />
        </main>
      ) : (
        <div className="max-w-2xl mx-auto px-4 pb-8">
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
                  const vibeColor = VIBE_COLORS[event.vibe] || VIBE_COLORS['default'];
                  const timeDisplay = event.isAllDay
                    ? 'All Day'
                    : `${event.startTime}${event.endTime ? ` - ${event.endTime}` : ''}`;

                  return (
                    <div
                      key={event.id}
                      className="bg-slate-800 rounded-lg p-3 border border-slate-700"
                    >
                      <h4 className="text-sm font-semibold text-white leading-tight">
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

                      {event.organizer && (
                        <p className="text-slate-500 text-xs mt-0.5">By {event.organizer}</p>
                      )}

                      <p className="text-slate-400 text-xs mt-1">{timeDisplay}</p>

                      {event.address && (
                        <AddressLink address={event.address} lat={event.lat} lng={event.lng}
                          className="text-slate-500 hover:text-slate-300 text-xs mt-0.5 truncate block transition-colors">
                          {event.address}
                        </AddressLink>
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
      )}

      <AuthModal isOpen={showAuth} onClose={handleAuthClose} />
    </div>
  );
}
