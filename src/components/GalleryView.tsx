'use client';

import { useMemo, useEffect, useState, useCallback } from 'react';
import { Star } from 'lucide-react';
import type { ETHDenverEvent, ReactionEmoji, FriendInfo } from '@/lib/types';
import { formatDateLabel } from '@/lib/utils';
import { sortByStartTime } from '@/lib/time-parse';
import { imageCache, FlyerLightbox } from './OGImage';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface GalleryViewProps {
  events: ETHDenverEvent[];
  totalCount: number;
  itinerary?: Set<string>;
  onItineraryToggle?: (eventId: string) => void;
  friendsCountByEvent?: Map<string, number>;
  friendsByEvent?: Map<string, FriendInfo[]>;
  checkedInFriendsByEvent?: Map<string, FriendInfo[]>;
  checkInCounts?: Map<string, number>;
  reactionsByEvent?: Map<string, { emoji: ReactionEmoji; count: number; reacted: boolean }[]>;
  onToggleReaction?: (eventId: string, emoji: ReactionEmoji) => void;
  commentCounts?: Map<string, number>;
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
  conference?: string;
  liveEventIds?: Map<string, 'green' | 'yellow' | 'red'>;
}

interface DateGroup {
  dateISO: string;
  label: string;
  events: ETHDenverEvent[];
}

/* ------------------------------------------------------------------ */
/* GalleryCard (inline sub-component)                                  */
/* ------------------------------------------------------------------ */

function GalleryCard({
  event,
  isInItinerary,
  onItineraryToggle,
  isLive,
  onClick,
}: {
  event: ETHDenverEvent;
  isInItinerary?: boolean;
  onItineraryToggle?: (eventId: string) => void;
  isLive?: boolean;
  onClick: () => void;
}) {
  const cachedImage = event.link ? imageCache.get(event.link) : undefined;
  const hasImage = cachedImage && cachedImage !== null;
  const hasLink = !!event.link;

  // Format time display
  const timeDisplay = event.isAllDay
    ? 'All Day'
    : event.startTime
      ? `${event.startTime}${event.endTime ? ` - ${event.endTime}` : ''}`
      : '';

  return (
    <div
      className={`rounded-lg overflow-hidden border bg-[var(--theme-bg-card)] hover:bg-[var(--theme-bg-card-hover)] cursor-pointer transition-all ${
        isLive ? 'border-green-500' : 'border-[var(--theme-border-primary)]'
      }`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
    >
      {/* Image area — full size, no cropping */}
      <div className="relative overflow-hidden bg-[var(--theme-bg-tertiary)]">
        {hasImage ? (
          <img
            src={cachedImage!}
            alt=""
            className="w-full h-auto block"
            loading="lazy"
          />
        ) : hasLink ? (
          /* Shimmer placeholder for events with a link but no cached image yet */
          <div className="w-full aspect-[1200/630] animate-pulse bg-[var(--theme-bg-tertiary)]" />
        ) : (
          /* Styled placeholder for events with no link at all */
          <div className="w-full aspect-[1200/630] flex items-center justify-center p-3">
            <p className="text-xs text-[var(--theme-text-muted)] text-center line-clamp-3 font-medium">
              {event.name}
            </p>
          </div>
        )}

        {/* Star / itinerary button overlaid top-right */}
        {onItineraryToggle && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onItineraryToggle(event.id);
            }}
            className="absolute top-1.5 right-1.5 p-1 rounded-full bg-black/40 hover:bg-black/60 text-white transition-colors cursor-pointer z-10"
            aria-label={isInItinerary ? 'Remove from itinerary' : 'Add to itinerary'}
          >
            <Star
              className={`w-4 h-4 ${isInItinerary ? 'fill-yellow-400 text-yellow-400' : ''}`}
            />
          </button>
        )}
      </div>

      {/* Text area below image */}
      <div className="p-2">
        <p className="text-sm font-medium text-[var(--theme-text-primary)] line-clamp-2 leading-tight">
          {event.name}
        </p>
        {timeDisplay && (
          <p className="text-xs text-[var(--theme-text-muted)] mt-1">
            {timeDisplay}
          </p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* GalleryView component                                               */
/* ------------------------------------------------------------------ */

export function GalleryView({
  events,
  totalCount,
  itinerary,
  onItineraryToggle,
  friendsCountByEvent,
  friendsByEvent,
  checkedInFriendsByEvent,
  checkInCounts,
  reactionsByEvent,
  onToggleReaction,
  commentCounts,
  scrollContainerRef,
  conference,
  liveEventIds,
}: GalleryViewProps) {
  const [loadTick, setLoadTick] = useState(0);

  /* ---- date-group the events ---- */
  const dateGroups: DateGroup[] = useMemo(() => {
    const groupMap = new Map<string, ETHDenverEvent[]>();
    for (const event of events) {
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
  }, [events]);

  /* ---- flat list of all events (for lightbox navigation) ---- */
  const allEvents = useMemo(
    () => dateGroups.flatMap((g) => g.events),
    [dateGroups],
  );

  /* ---- batch-fetch OG images for the first ~20 uncached events ---- */
  useEffect(() => {
    const uncached = allEvents
      .filter((e) => e.link && !imageCache.has(e.link))
      .slice(0, 20);
    if (uncached.length === 0) return;

    fetch('/api/og', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: uncached.map((e) => ({ eventId: e.id, url: e.link })),
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.results) {
          // results is Record<string, string | null> keyed by eventId
          for (const [eventId, imageUrl] of Object.entries(data.results)) {
            const ev = allEvents.find((e) => e.id === eventId);
            if (ev?.link) imageCache.set(ev.link, imageUrl as string | null);
          }
          setLoadTick((n) => n + 1);
        }
      })
      .catch(() => {});
  }, [allEvents]);

  /* ---- flyer lightbox navigation ---- */
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const lightboxEvent = lightboxIndex !== null ? allEvents[lightboxIndex] : null;
  const lightboxImageUrl =
    lightboxEvent?.link ? imageCache.get(lightboxEvent.link) ?? null : null;
  const lightboxRsvpUrl = lightboxEvent?.link || undefined;

  const canPrev = lightboxIndex !== null && lightboxIndex > 0;
  const canNext =
    lightboxIndex !== null && lightboxIndex < allEvents.length - 1;

  // Preload adjacent OG images when lightbox is open
  useEffect(() => {
    if (lightboxIndex === null) return;

    const preloadNeighbor = (idx: number) => {
      const ev = allEvents[idx];
      if (!ev?.link || imageCache.has(ev.link)) return;
      const params = new URLSearchParams({ url: ev.link });
      if (ev.id) params.set('eventId', ev.id);
      fetch(`/api/og?${params.toString()}`)
        .then((res) => res.json())
        .then((data) => {
          if (ev.link) {
            imageCache.set(ev.link, data.imageUrl ?? null);
            setLoadTick((n) => n + 1);
          }
        })
        .catch(() => {});
    };

    if (lightboxIndex > 0) preloadNeighbor(lightboxIndex - 1);
    if (lightboxIndex < allEvents.length - 1) preloadNeighbor(lightboxIndex + 1);
  }, [lightboxIndex, allEvents]);

  const handlePrev = useCallback(() => {
    if (!canPrev) return;
    setLightboxIndex((i) => (i !== null ? i - 1 : null));
  }, [canPrev]);

  const handleNext = useCallback(() => {
    if (!canNext) return;
    setLightboxIndex((i) => (i !== null ? i + 1 : null));
  }, [canNext]);

  /* ---- empty state ---- */
  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-[var(--theme-text-muted)]">
        <p className="text-lg font-medium">No events found</p>
        <p className="text-sm mt-1">Try adjusting your filters</p>
      </div>
    );
  }

  // Track a running offset so we can map cards to allEvents indices
  let globalEventOffset = 0;

  return (
    <div className="max-w-6xl mx-auto px-2 sm:px-4 pb-8">
      {dateGroups.map((group, groupIdx) => {
        const groupStartOffset = globalEventOffset;
        globalEventOffset += group.events.length;

        return (
          <div key={group.dateISO}>
            {/* Sticky date header */}
            <div className="sticky top-0 z-20 bg-[var(--theme-bg-primary)] py-2 border-b border-[var(--theme-border-secondary)]">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold text-[var(--theme-text-primary)]">
                  {group.label}
                </h2>
                <span className="text-xs text-[var(--theme-text-muted)] font-medium">
                  {group.events.length} event{group.events.length !== 1 ? 's' : ''}
                </span>
              </div>
            </div>

            {/* Grid */}
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3 md:gap-3 lg:grid-cols-4 lg:gap-3 mt-2 mb-4">
              {group.events.map((event, eventIdx) => {
                const flatIdx = groupStartOffset + eventIdx;
                return (
                  <GalleryCard
                    key={event.id}
                    event={event}
                    isInItinerary={itinerary?.has(event.id)}
                    onItineraryToggle={onItineraryToggle}
                    isLive={liveEventIds?.has(event.id)}
                    onClick={() => setLightboxIndex(flatIdx)}
                  />
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Flyer lightbox with prev/next navigation */}
      {lightboxIndex !== null && lightboxImageUrl && (
        <FlyerLightbox
          imageUrl={lightboxImageUrl}
          rsvpUrl={lightboxRsvpUrl}
          onClose={() => setLightboxIndex(null)}
          onPrev={canPrev ? handlePrev : undefined}
          onNext={canNext ? handleNext : undefined}
        />
      )}
    </div>
  );
}
