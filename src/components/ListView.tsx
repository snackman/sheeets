'use client';

import { useMemo, useEffect, useRef, useState, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ETHDenverEvent, ReactionEmoji, NativeAd } from '@/lib/types';
import { formatDateLabel } from '@/lib/utils';
import { sortByStartTime } from '@/lib/time-parse';
import { EventCard } from './EventCard';
import NativeAdCard from './NativeAdCard';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface ListViewProps {
  events: ETHDenverEvent[];
  totalCount: number;
  itinerary?: Set<string>;
  onItineraryToggle?: (eventId: string) => void;
  friendsCountByEvent?: Map<string, number>;
  friendsByEvent?: Map<string, { userId: string; displayName: string }[]>;
  checkedInFriendsByEvent?: Map<string, { userId: string; displayName: string }[]>;
  checkInCounts?: Map<string, number>;
  reactionsByEvent?: Map<string, { emoji: ReactionEmoji; count: number; reacted: boolean }[]>;
  onToggleReaction?: (eventId: string, emoji: ReactionEmoji) => void;
  commentCounts?: Map<string, number>;
  nativeAds?: NativeAd[];
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
  scrollToEventId?: string;
}

interface DateGroup {
  dateISO: string;
  label: string;
  events: ETHDenverEvent[];
}

type VirtualListItem =
  | { kind: 'date-header'; dateISO: string; label: string; eventCount: number }
  | { kind: 'event'; event: ETHDenverEvent }
  | { kind: 'ad'; ad: NativeAd };

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Build the flat virtual list from date-grouped events, interleaving ads. */
function buildFlatList(
  dateGroups: DateGroup[],
  activeAds: NativeAd[],
): VirtualListItem[] {
  const items: VirtualListItem[] = [];
  let globalEventIndex = 0;

  for (const group of dateGroups) {
    items.push({
      kind: 'date-header',
      dateISO: group.dateISO,
      label: group.label,
      eventCount: group.events.length,
    });

    for (const event of group.events) {
      items.push({ kind: 'event', event });
      globalEventIndex++;

      // Insert ad after every 8th event
      if (activeAds.length > 0 && globalEventIndex % 8 === 0) {
        const adIndex = (Math.floor(globalEventIndex / 8) - 1) % activeAds.length;
        items.push({ kind: 'ad', ad: activeAds[adIndex] });
      }
    }
  }

  return items;
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */


export function ListView({
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
  nativeAds,
  scrollContainerRef,
  scrollToEventId,
}: ListViewProps) {
  const activeAds = useMemo(() => nativeAds?.filter(ad => ad.active) || [], [nativeAds]);

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

  /* ---- flatten into virtual items ---- */
  const flatItems = useMemo(
    () => buildFlatList(dateGroups, activeAds),
    [dateGroups, activeAds],
  );

  /* ---- fallback scroll container ref ---- */
  const internalRef = useRef<HTMLDivElement>(null);
  const containerRef = scrollContainerRef ?? internalRef;

  /* ---- virtualizer ---- */
  const virtualizer = useVirtualizer({
    count: flatItems.length,
    getScrollElement: () => containerRef.current,
    estimateSize: (index) => {
      const item = flatItems[index];
      if (item.kind === 'date-header') return 44;
      if (item.kind === 'ad') return 120;
      return 180; // event card estimate
    },
    overscan: 5,
    measureElement: (el) => {
      // Include the item's actual height (padding is part of the element)
      return el.getBoundingClientRect().height;
    },
  });

  /* ---- force virtualizer to recalculate once scroll container is mounted ---- */
  useEffect(() => {
    if (containerRef.current) {
      virtualizer.measure();
    }
  }, [virtualizer, containerRef]);

  /* ---- sticky date header overlay ---- */
  const [stickyLabel, setStickyLabel] = useState<string | null>(null);
  const [stickyCount, setStickyCount] = useState<number>(0);

  const updateStickyHeader = useCallback(() => {
    const scrollEl = containerRef.current;
    if (!scrollEl) return;

    const scrollTop = scrollEl.scrollTop;

    // Don't show sticky overlay when not scrolled — the first in-flow header is still visible
    if (scrollTop <= 10) {
      setStickyLabel(null);
      setStickyCount(0);
      return;
    }

    // Offset for the wrapper's padding-top (32px = py-4 on the outer container)
    const wrapperOffsetTop = 0;

    // Find the last date-header that has scrolled past the top
    let lastHeader: { label: string; eventCount: number } | null = null;

    const virtualItems = virtualizer.getVirtualItems();
    for (const vItem of virtualItems) {
      const item = flatItems[vItem.index];
      if (item.kind === 'date-header') {
        // vItem.start is relative to the virtual list top
        if (vItem.start <= scrollTop + wrapperOffsetTop) {
          lastHeader = { label: item.label, eventCount: item.eventCount };
        }
      }
    }

    // If we have no virtual items in range, check non-virtual items:
    // fallback — find the last date-header before scroll position
    if (!lastHeader) {
      for (let i = 0; i < flatItems.length; i++) {
        const item = flatItems[i];
        if (item.kind === 'date-header') {
          const offset = virtualizer.getOffsetForIndex(i, 'start');
          if (offset !== undefined && offset[0] <= scrollTop + wrapperOffsetTop) {
            lastHeader = { label: item.label, eventCount: item.eventCount };
          }
        }
      }
    }

    if (lastHeader) {
      setStickyLabel(lastHeader.label);
      setStickyCount(lastHeader.eventCount);
    } else if (flatItems.length > 0 && flatItems[0].kind === 'date-header') {
      // default to first header
      const first = flatItems[0];
      setStickyLabel(first.label);
      setStickyCount(first.eventCount);
    }
  }, [containerRef, flatItems, virtualizer]);

  // Attach scroll listener for sticky header
  useEffect(() => {
    const scrollEl = containerRef.current;
    if (!scrollEl) return;

    // Initial computation
    updateStickyHeader();

    const handleScroll = () => updateStickyHeader();
    scrollEl.addEventListener('scroll', handleScroll, { passive: true });
    return () => scrollEl.removeEventListener('scroll', handleScroll);
  }, [containerRef, updateStickyHeader]);

  // Also update when items change
  useEffect(() => {
    updateStickyHeader();
  }, [flatItems, updateStickyHeader]);

  /* ---- scrollToEventId support ---- */
  useEffect(() => {
    if (!scrollToEventId) return;
    const idx = flatItems.findIndex(
      (item) => item.kind === 'event' && item.event.id === scrollToEventId,
    );
    if (idx >= 0) {
      virtualizer.scrollToIndex(idx, { align: 'start', behavior: 'smooth' });
    }
  }, [scrollToEventId, flatItems, virtualizer]);

  /* ---- empty state ---- */
  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-stone-500">
        <p className="text-lg font-medium">No events found</p>
        <p className="text-sm mt-1">Try adjusting your filters</p>
      </div>
    );
  }

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div className="max-w-3xl mx-auto px-2 sm:px-4 pb-8 relative">
      {/* Overlay sticky date header */}
      {stickyLabel && (
        <div className="sticky top-0 z-20 bg-stone-950 py-2 -mx-2 px-2 sm:-mx-4 sm:px-4 border-b border-stone-800">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-white">
              {stickyLabel}
            </h2>
            <span className="text-xs text-stone-500 font-medium">
              {stickyCount} event{stickyCount !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
      )}

      {/* Virtual list container */}
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualItems.map((virtualRow) => {
          const item = flatItems[virtualRow.index];

          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              {item.kind === 'date-header' ? (
                /* In-flow date header (hidden behind sticky overlay once scrolled past) */
                <div className={`py-2 border-b border-stone-800 ${virtualRow.index === 0 ? '' : 'mt-4'}`}>
                  <div className="flex items-center justify-between">
                    <h2 className="text-base font-bold text-white">
                      {item.label}
                    </h2>
                    <span className="text-xs text-stone-500 font-medium">
                      {item.eventCount} event{item.eventCount !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>
              ) : item.kind === 'ad' ? (
                <div className="pt-3">
                  <NativeAdCard ad={item.ad} />
                </div>
              ) : (
                <div className="pt-3">
                  <EventCard
                    event={item.event}
                    isInItinerary={itinerary?.has(item.event.id)}
                    onItineraryToggle={onItineraryToggle}
                    friendsCount={friendsCountByEvent?.get(item.event.id)}
                    friendsGoing={friendsByEvent?.get(item.event.id)}
                    checkedInFriends={checkedInFriendsByEvent?.get(item.event.id)}
                    checkInCount={checkInCounts?.get(item.event.id)}
                    reactions={reactionsByEvent?.get(item.event.id)}
                    onToggleReaction={onToggleReaction}
                    commentCount={commentCounts?.get(item.event.id)}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
