'use client';

import { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Calendar, Download, ExternalLink, Star, X } from 'lucide-react';
import type { ETHDenverEvent, ReactionEmoji } from '@/lib/types';
import { trackEventClick } from '@/lib/analytics';
import { AddressLink } from './AddressLink';
import { TagBadge } from './TagBadge';
import { EventCard } from './EventCard';

interface TableViewProps {
  events: ETHDenverEvent[];
  totalCount: number;
  itinerary?: Set<string>;
  onItineraryToggle?: (eventId: string) => void;
  onScrolledChange?: (scrolled: boolean) => void;
  friendsCountByEvent?: Map<string, number>;
  friendsByEvent?: Map<string, { userId: string; displayName: string }[]>;
  checkedInFriendsByEvent?: Map<string, { userId: string; displayName: string }[]>;
  checkInCounts?: Map<string, number>;
  reactionsByEvent?: Map<string, { emoji: ReactionEmoji; count: number; reacted: boolean }[]>;
  onToggleReaction?: (eventId: string, emoji: ReactionEmoji) => void;
  commentCounts?: Map<string, number>;
}

/** Format a dateISO string like "2026-02-10" into "Mon Feb 10" */
function formatDateHeader(dateISO: string): string {
  // Parse as local date (avoid timezone offset issues with new Date(string))
  const [year, month, day] = dateISO.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
  const monthName = d.toLocaleDateString('en-US', { month: 'short' });
  const dayNum = d.getDate();
  return `${dayName} ${monthName} ${dayNum}`;
}

/** Group events by dateISO, preserving order */
function groupByDate(events: ETHDenverEvent[]): { dateISO: string; label: string; events: ETHDenverEvent[] }[] {
  const groups: { dateISO: string; label: string; events: ETHDenverEvent[] }[] = [];
  let current: typeof groups[number] | null = null;

  for (const event of events) {
    if (!current || current.dateISO !== event.dateISO) {
      current = { dateISO: event.dateISO, label: formatDateHeader(event.dateISO), events: [] };
      groups.push(current);
    }
    current.events.push(event);
  }

  return groups;
}

const COLUMN_COUNT = 6; // star, time, organizer, event, location, tags

export function TableView({
  events,
  totalCount,
  itinerary,
  onItineraryToggle,
  onScrolledChange,
  friendsCountByEvent,
  friendsByEvent,
  checkedInFriendsByEvent,
  checkInCounts,
  reactionsByEvent,
  onToggleReaction,
  commentCounts,
}: TableViewProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const separatorRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());
  const [currentDateLabel, setCurrentDateLabel] = useState<string>('Time');
  const lastScrolledRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  const [selectedEvent, setSelectedEvent] = useState<ETHDenverEvent | null>(null);

  const groups = useMemo(() => groupByDate(events), [events]);

  // Compute dynamic tags column width based on max tag count across visible events
  const tagsColWidth = useMemo(() => {
    const maxTags = Math.min(10, events.reduce((max, e) => Math.max(max, e.tags.length), 0));
    return maxTags * 24 + 24; // 24px per icon (20px + 4px gap) + 24px cell padding
  }, [events]);

  // Close modal on Escape key
  useEffect(() => {
    if (!selectedEvent) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedEvent(null);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedEvent]);

  // Reset to "Time" when groups change (e.g. filter change)
  useEffect(() => {
    setCurrentDateLabel('Time');
  }, [groups]);

  // Track which date separator is at/near the top using IntersectionObserver
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || groups.length === 0) return;

    const observer = new IntersectionObserver(
      () => {
        const hasScrolled = container.scrollTop > 5;
        if (!hasScrolled) {
          setCurrentDateLabel('Time');
          return;
        }

        const separators = Array.from(separatorRefs.current.entries()).map(([dateISO, el]) => {
          const rect = el.getBoundingClientRect();
          const containerRect = container.getBoundingClientRect();
          return { dateISO, relativeTop: rect.top - containerRect.top };
        });
        separators.sort((a, b) => a.relativeTop - b.relativeTop);

        const stickyThreshold = 40;
        let currentDate: string | null = null;
        for (const sep of separators) {
          if (sep.relativeTop <= stickyThreshold) {
            currentDate = sep.dateISO;
          }
        }

        if (currentDate) {
          setCurrentDateLabel(formatDateHeader(currentDate));
        } else {
          setCurrentDateLabel('Time');
        }
      },
      {
        root: container,
        threshold: [0, 0.1, 0.5, 1],
        rootMargin: '-40px 0px 0px 0px',
      }
    );

    for (const el of separatorRefs.current.values()) {
      observer.observe(el);
    }

    return () => observer.disconnect();
  }, [groups]);

  // Also handle scroll events for more precise tracking
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container || groups.length === 0) return;

    // Notify parent: hide filter on scroll down, show on scroll up or at top
    const scrollTop = container.scrollTop;
    const atTop = scrollTop <= 5;
    const scrollingDown = scrollTop > lastScrollTopRef.current + 2;
    const scrollingUp = scrollTop < lastScrollTopRef.current - 2;
    lastScrollTopRef.current = scrollTop;

    // Only hide the filter bar if there's enough overflow that hiding it won't
    // eliminate the scroll, which would cause a show->hide->show jitter loop.
    const overflowAmount = container.scrollHeight - container.clientHeight;
    const nearBottom = scrollTop + container.clientHeight >= container.scrollHeight - 50;
    const shouldHide = !atTop && !nearBottom && scrollingDown && overflowAmount > 80;
    const shouldShow = atTop || scrollingUp;

    if (shouldHide && !lastScrolledRef.current) {
      lastScrolledRef.current = true;
      onScrolledChange?.(true);
    } else if (shouldShow && lastScrolledRef.current) {
      lastScrolledRef.current = false;
      onScrolledChange?.(false);
    }

    if (container.scrollTop <= 5) {
      setCurrentDateLabel('Time');
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const stickyThreshold = containerRect.top + 40;

    const separators = Array.from(separatorRefs.current.entries()).map(([dateISO, el]) => ({
      dateISO,
      top: el.getBoundingClientRect().top,
    }));

    separators.sort((a, b) => a.top - b.top);

    let currentDate: string | null = null;
    for (const sep of separators) {
      if (sep.top <= stickyThreshold) {
        currentDate = sep.dateISO;
      }
    }

    if (currentDate) {
      setCurrentDateLabel(formatDateHeader(currentDate));
    } else {
      setCurrentDateLabel('Time');
    }
  }, [groups, onScrolledChange]);

  // Store ref callback for separator rows
  const setSeparatorRef = useCallback((dateISO: string, el: HTMLTableRowElement | null) => {
    if (el) {
      separatorRefs.current.set(dateISO, el);
    } else {
      separatorRefs.current.delete(dateISO);
    }
  }, []);

  // Generate and download CSV from currently displayed events
  const downloadCSV = useCallback(() => {
    const escapeCSV = (value: string) => {
      if (value.includes(',') || value.includes('"') || value.includes('\n')) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    };

    const header = ['Date', 'Start Time', 'End Time', 'Organizer', 'Event Name', 'Address', 'Cost', 'Tags', 'Link'];
    const rows = events.map((e) => [
      e.date,
      e.startTime,
      e.endTime,
      e.organizer,
      e.name,
      e.address,
      e.cost,
      e.tags.join(', '),
      e.link,
    ].map(escapeCSV));

    const csv = [header.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'plan-wtf-events.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [events]);

  return (
    <div className="max-w-full mx-auto px-2 sm:px-4 pb-3 flex-1 min-h-0 min-w-0 flex flex-col w-full">
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="overflow-auto rounded-lg border border-[var(--theme-border-primary)] flex-1 min-h-0 min-w-0 overscroll-none"
      >
        <table className="w-full text-sm text-left md:table-fixed" style={{ minWidth: Math.max(640, 142 + tagsColWidth + 420) }}>
          <colgroup>
            <col style={{ width: 32 }} />                                                                          {/* star */}
            <col style={{ width: 100 }} />                                                                         {/* when */}
            <col style={{ width: `calc((100% - 32px - 100px - ${tagsColWidth}px) * 0.22)` }} />                    {/* organizer */}
            <col style={{ width: `calc((100% - 32px - 100px - ${tagsColWidth}px) * 0.50)` }} />                    {/* event */}
            <col style={{ width: `calc((100% - 32px - 100px - ${tagsColWidth}px) * 0.28)` }} />                    {/* where */}
            <col style={{ width: tagsColWidth }} />                                                                {/* tags */}
          </colgroup>
          <thead className="text-xs uppercase tracking-wider text-[var(--theme-text-secondary)] bg-[var(--theme-bg-secondary)] border-b border-[var(--theme-border-primary)] sticky top-0 z-20">
            <tr>
              <th className="px-3 py-2.5"><Calendar className="w-3.5 h-3.5" /></th>
              <th className="px-3 py-2.5 whitespace-nowrap">
                {currentDateLabel === 'Time' ? (
                  'WHEN'
                ) : (
                  <span className="text-[var(--theme-accent)] font-semibold" style={{ opacity: 0.8 }}>
                    {currentDateLabel.toUpperCase()}
                  </span>
                )}
              </th>
              <th className="px-3 py-2.5 hidden sm:table-cell">Organizer</th>
              <th className="px-3 py-2.5">Event</th>
              <th className="px-3 py-2.5">Where</th>
              <th className="px-3 py-2.5">
                <div className="flex items-center justify-between">
                  <span>Tags</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={downloadCSV}
                      className="p-1 rounded text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)] transition-colors cursor-pointer"
                      title="Download CSV"
                      aria-label="Download CSV"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                    <a
                      href="https://plan.wtf/data"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1 rounded text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)] transition-colors"
                      title="Open spreadsheet"
                      aria-label="Open spreadsheet"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--theme-border-primary)]/50">
            {groups.map((group) => (
              <DateGroup
                key={group.dateISO}
                group={group}
                itinerary={itinerary}
                onItineraryToggle={onItineraryToggle}
                setSeparatorRef={setSeparatorRef}
                friendsCountByEvent={friendsCountByEvent}
                checkInCounts={checkInCounts}
                onSelectEvent={setSelectedEvent}
              />
            ))}
          </tbody>
        </table>
      </div>
      {events.length === 0 && (
        <div className="text-center py-12 text-[var(--theme-text-muted)]">
          No events match your filters.
        </div>
      )}
      {selectedEvent && createPortal(
        <EventDetailModal
          event={selectedEvent}
          isInItinerary={itinerary?.has(selectedEvent.id) ?? false}
          onItineraryToggle={onItineraryToggle}
          friendsCount={friendsCountByEvent?.get(selectedEvent.id) ?? 0}
          friendsGoing={friendsByEvent?.get(selectedEvent.id)}
          checkedInFriends={checkedInFriendsByEvent?.get(selectedEvent.id)}
          reactions={reactionsByEvent?.get(selectedEvent.id)}
          onToggleReaction={onToggleReaction}
          commentCount={commentCounts?.get(selectedEvent.id)}
          onClose={() => setSelectedEvent(null)}
        />,
        document.body
      )}
    </div>
  );
}

/** Modal overlay showing full EventCard for a selected table row */
function EventDetailModal({
  event,
  isInItinerary,
  onItineraryToggle,
  friendsCount,
  friendsGoing,
  checkedInFriends,
  reactions,
  onToggleReaction,
  commentCount,
  onClose,
}: {
  event: ETHDenverEvent;
  isInItinerary: boolean;
  onItineraryToggle?: (eventId: string) => void;
  friendsCount: number;
  friendsGoing?: { userId: string; displayName: string }[];
  checkedInFriends?: { userId: string; displayName: string }[];
  reactions?: { emoji: ReactionEmoji; count: number; reacted: boolean }[];
  onToggleReaction?: (eventId: string, emoji: ReactionEmoji) => void;
  commentCount?: number;
  onClose: () => void;
}) {
  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[50] bg-black/50" onClick={onClose} />
      {/* Modal container */}
      <div className="fixed inset-0 z-[55] flex items-center justify-center p-4 pointer-events-none">
        <div className="relative w-full max-w-lg pointer-events-auto" onClick={(e) => e.stopPropagation()}>
          <EventCard
            event={event}
            isInItinerary={isInItinerary}
            onItineraryToggle={onItineraryToggle}
            friendsCount={friendsCount}
            friendsGoing={friendsGoing}
            checkedInFriends={checkedInFriends}
            reactions={reactions}
            onToggleReaction={onToggleReaction}
            commentCount={commentCount}
          />
          <button
            onClick={onClose}
            className="absolute top-2 right-2 p-1.5 rounded-full bg-[var(--theme-bg-tertiary)]/80 hover:bg-[var(--theme-border-primary)] text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)] transition-colors cursor-pointer z-10"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </>
  );
}

/** Renders a date separator row + all event rows for that date */
function DateGroup({
  group,
  itinerary,
  onItineraryToggle,
  setSeparatorRef,
  friendsCountByEvent,
  checkInCounts,
  onSelectEvent,
}: {
  group: { dateISO: string; label: string; events: ETHDenverEvent[] };
  itinerary?: Set<string>;
  onItineraryToggle?: (eventId: string) => void;
  setSeparatorRef: (dateISO: string, el: HTMLTableRowElement | null) => void;
  friendsCountByEvent?: Map<string, number>;
  checkInCounts?: Map<string, number>;
  onSelectEvent: (event: ETHDenverEvent) => void;
}) {
  return (
    <>
      {/* Date separator row */}
      <tr
        ref={(el) => setSeparatorRef(group.dateISO, el)}
        className="bg-[var(--theme-bg-secondary)]/80"
        data-date={group.dateISO}
      >
        <td className="border-b border-[var(--theme-border-primary)]/70"></td>
        <td
          colSpan={COLUMN_COUNT - 1}
          className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider border-b border-[var(--theme-border-primary)]/70"
          style={{ color: 'var(--theme-accent)', opacity: 0.8 }}
        >
          {group.label}
        </td>
      </tr>

      {/* Event rows */}
      {group.events.map((event) => {
        const isInItinerary = itinerary?.has(event.id) ?? false;

        return (
          <tr
            key={event.id}
            className={`hover:bg-[var(--theme-bg-secondary)]/70 transition-colors cursor-pointer ${event.isDuplicate ? 'bg-red-950/30' : event.isFeatured ? 'bg-[var(--theme-bg-primary)] border-l-2' : 'bg-[var(--theme-bg-primary)]'}`}
            style={event.isFeatured && !event.isDuplicate ? { borderLeftColor: 'var(--theme-popup-featured-border)' } : undefined}
            title={event.isDuplicate ? 'Possible duplicate — same name, date, and time as another event' : undefined}
            onClick={(e) => {
              const target = e.target as HTMLElement;
              if (target.closest('a, button')) return;
              onSelectEvent(event);
            }}
          >
            {/* Star (toggles itinerary) */}
            <td className="px-2 py-2">
              {(() => {
                const fc = friendsCountByEvent?.get(event.id) ?? 0;
                return (
                  <button
                    onClick={() => onItineraryToggle?.(event.id)}
                    className="relative cursor-pointer p-0.5"
                    title={
                      fc > 0
                        ? `${fc} friend${fc !== 1 ? 's' : ''} going`
                        : isInItinerary
                          ? 'Remove from itinerary'
                          : 'Add to itinerary'
                    }
                  >
                    <Star
                      className={`w-4 h-4 ${isInItinerary ? 'fill-current' : 'hover:opacity-60'}`}
                      style={{ color: isInItinerary ? 'var(--theme-star-active)' : 'var(--theme-star-inactive)' }}
                    />
                    {fc > 0 && (
                      <span className="absolute -top-1 -right-1.5 min-w-[14px] h-[14px] flex items-center justify-center rounded-full bg-[var(--theme-accent)] text-[var(--theme-accent-text)] text-[8px] font-bold px-0.5 pointer-events-none">
                        {fc}
                      </span>
                    )}
                  </button>
                );
              })()}
            </td>

            {/* Time */}
            <td className="px-3 py-2 text-[var(--theme-text-secondary)] whitespace-nowrap">
              <span className="relative inline-block">
                <span>
                  {event.startTime}
                  {event.endTime ? `-${event.endTime}` : ''}
                </span>
                {(checkInCounts?.get(event.id) ?? 0) > 0 && (
                  <span className="absolute -top-1.5 -right-3 min-w-[14px] h-[14px] flex items-center justify-center rounded-full bg-green-500 text-white text-[8px] font-bold px-0.5 pointer-events-none">
                    {checkInCounts!.get(event.id)}
                  </span>
                )}
              </span>
            </td>

            {/* Organizer (hidden on mobile portrait — shown inside Event cell instead) */}
            <td className="px-3 py-2 text-[var(--theme-text-secondary)] truncate hidden sm:table-cell" title={event.organizer}>
              {event.organizer}
            </td>

            {/* Event Name (+ organizer on mobile portrait) */}
            <td className="px-3 py-2 font-medium text-[var(--theme-text-primary)] overflow-hidden truncate max-w-[25ch] sm:max-w-none" title={event.name}>
              <span className="inline-flex items-center gap-1 max-w-full truncate">
                {event.isDuplicate && (
                  <span title="Duplicate entry in sheet"><AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" /></span>
                )}
                {event.link ? (
                  <a
                    href={event.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-[var(--theme-accent)] transition-colors truncate"
                    onClick={() => trackEventClick(event.name, event.link!)}
                  >
                    {event.name}
                  </a>
                ) : (
                  <span className="truncate">{event.name}</span>
                )}
              </span>
              {event.organizer && (
                <div className="sm:hidden text-[var(--theme-text-secondary)] text-xs font-normal truncate mt-0.5">
                  {event.organizer}
                </div>
              )}
            </td>

            {/* Location */}
            <td className="px-3 py-2 text-[var(--theme-text-secondary)] truncate max-w-[20ch] sm:max-w-none" title={event.address}>
              {event.address ? (
                <AddressLink address={event.address} navAddress={event.matchedAddress} lat={event.lat} lng={event.lng}
                  eventId={event.id} eventName={event.name}
                  className="hover:text-[var(--theme-accent)] transition-colors">
                  {event.address}
                </AddressLink>
              ) : null}
            </td>

            {/* Tags — single row, all visible */}
            <td className="px-3 py-2 whitespace-nowrap">
              <div className="flex gap-1 items-center" title={event.tags.join(', ')}>
                {event.tags.slice(0, 10).map((tag) => (
                  <TagBadge key={tag} tag={tag} iconOnly />
                ))}
              </div>
            </td>
          </tr>
        );
      })}
    </>
  );
}
