'use client';

import { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Calendar, Star, X } from 'lucide-react';
import type { ETHDenverEvent } from '@/lib/types';
import { trackEventClick } from '@/lib/analytics';
import { TagBadge } from './TagBadge';
import { EventCard } from './EventCard';

interface TableViewProps {
  events: ETHDenverEvent[];
  totalCount: number;
  itinerary?: Set<string>;
  onItineraryToggle?: (eventId: string) => void;
  onScrolledChange?: (scrolled: boolean) => void;
  friendsCountByEvent?: Map<string, number>;
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
}: TableViewProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const separatorRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());
  const [currentDateLabel, setCurrentDateLabel] = useState<string>('Time');
  const lastScrolledRef = useRef(false);
  const [selectedEvent, setSelectedEvent] = useState<ETHDenverEvent | null>(null);

  const groups = useMemo(() => groupByDate(events), [events]);

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

    // Notify parent whether we've scrolled away from top
    const scrolled = container.scrollTop > 5;
    if (scrolled !== lastScrolledRef.current) {
      lastScrolledRef.current = scrolled;
      onScrolledChange?.(scrolled);
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

  return (
    <div className="max-w-7xl mx-auto px-2 sm:px-4 pb-3 flex-1 min-h-0 min-w-0 flex flex-col w-full">
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="overflow-auto rounded-lg border border-slate-700 flex-1 min-h-0 min-w-0"
      >
        <table className="w-full min-w-[640px] sm:min-w-[900px] text-sm text-left table-fixed">
          <colgroup>
            <col className="w-8" />           {/* star */}
            <col className="w-[110px]" />     {/* when */}
            <col style={{ width: '25%' }} />  {/* organizer */}
            <col style={{ width: '26%' }} />  {/* event */}
            <col style={{ width: '15%' }} />  {/* where */}
            <col style={{ width: '22%' }} />  {/* tags */}
          </colgroup>
          <thead className="text-xs uppercase tracking-wider text-slate-400 bg-slate-800 border-b border-slate-700 sticky top-0 z-20">
            <tr>
              <th className="px-3 py-2.5"><Calendar className="w-3.5 h-3.5" /></th>
              <th className="px-3 py-2.5">
                {currentDateLabel === 'Time' ? (
                  'WHEN'
                ) : (
                  <span className="text-orange-400/80 font-semibold">
                    {currentDateLabel.toUpperCase()}
                  </span>
                )}
              </th>
              <th className="px-3 py-2.5 hidden sm:table-cell">Organizer</th>
              <th className="px-3 py-2.5">Event</th>
              <th className="px-3 py-2.5">Where</th>
              <th className="px-3 py-2.5">Tags</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/50">
            {groups.map((group) => (
              <DateGroup
                key={group.dateISO}
                group={group}
                itinerary={itinerary}
                onItineraryToggle={onItineraryToggle}
                setSeparatorRef={setSeparatorRef}
                friendsCountByEvent={friendsCountByEvent}
                onSelectEvent={setSelectedEvent}
              />
            ))}
          </tbody>
        </table>
      </div>
      {events.length === 0 && (
        <div className="text-center py-12 text-slate-500">
          No events match your filters.
        </div>
      )}
      {selectedEvent && createPortal(
        <EventDetailModal
          event={selectedEvent}
          isInItinerary={itinerary?.has(selectedEvent.id) ?? false}
          onItineraryToggle={onItineraryToggle}
          friendsCount={friendsCountByEvent?.get(selectedEvent.id) ?? 0}
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
  onClose,
}: {
  event: ETHDenverEvent;
  isInItinerary: boolean;
  onItineraryToggle?: (eventId: string) => void;
  friendsCount: number;
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
          />
          <button
            onClick={onClose}
            className="absolute top-2 right-2 p-1.5 rounded-full bg-slate-700/80 hover:bg-slate-600 text-slate-300 hover:text-white transition-colors cursor-pointer z-10"
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
  onSelectEvent,
}: {
  group: { dateISO: string; label: string; events: ETHDenverEvent[] };
  itinerary?: Set<string>;
  onItineraryToggle?: (eventId: string) => void;
  setSeparatorRef: (dateISO: string, el: HTMLTableRowElement | null) => void;
  friendsCountByEvent?: Map<string, number>;
  onSelectEvent: (event: ETHDenverEvent) => void;
}) {
  return (
    <>
      {/* Date separator row */}
      <tr
        ref={(el) => setSeparatorRef(group.dateISO, el)}
        className="bg-slate-800/80"
        data-date={group.dateISO}
      >
        <td className="border-b border-slate-700/70"></td>
        <td
          colSpan={COLUMN_COUNT - 1}
          className="px-3 py-1.5 text-xs font-semibold text-orange-400/80 uppercase tracking-wider border-b border-slate-700/70"
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
            className={`hover:bg-slate-800/70 transition-colors cursor-pointer ${event.isDuplicate ? 'bg-red-950/30' : 'bg-slate-900'}`}
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
                      className={`w-3.5 h-3.5 ${isInItinerary ? 'text-yellow-400 fill-yellow-400' : 'text-slate-600 hover:text-slate-400'}`}
                    />
                    {fc > 0 && (
                      <span className="absolute -top-1 -right-1.5 min-w-[14px] h-[14px] flex items-center justify-center rounded-full bg-blue-500 text-white text-[8px] font-bold px-0.5 pointer-events-none">
                        {fc}
                      </span>
                    )}
                  </button>
                );
              })()}
            </td>

            {/* Time */}
            <td className="px-3 py-2 text-slate-400 whitespace-nowrap">
              {event.startTime}
              {event.endTime ? `-${event.endTime}` : ''}
            </td>

            {/* Organizer (hidden on mobile portrait — shown inside Event cell instead) */}
            <td className="px-3 py-2 text-slate-400 truncate hidden sm:table-cell" title={event.organizer}>
              {event.organizer}
            </td>

            {/* Event Name (+ organizer on mobile portrait) */}
            <td className="px-3 py-2 font-medium text-slate-100 overflow-hidden sm:truncate" title={event.name}>
              <span className="inline-flex items-center gap-1 max-w-full truncate">
                {event.isDuplicate && (
                  <span title="Duplicate entry in sheet"><AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" /></span>
                )}
                {event.link ? (
                  <a
                    href={event.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-orange-400 transition-colors truncate"
                    onClick={() => trackEventClick(event.name, event.link!)}
                  >
                    {event.name}
                  </a>
                ) : (
                  <span className="truncate">{event.name}</span>
                )}
              </span>
              {event.organizer && (
                <div className="sm:hidden text-slate-400 text-xs font-normal truncate mt-0.5">
                  {event.organizer}
                </div>
              )}
            </td>

            {/* Location */}
            <td className="px-3 py-2 text-slate-400 truncate" title={event.address}>
              {event.address ? (
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.address)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-orange-400 transition-colors"
                >
                  {event.address}
                </a>
              ) : null}
            </td>

            {/* Tags */}
            <td className="px-3 py-2 overflow-hidden">
              <div className="flex gap-1 items-center" title={event.tags.join(', ')}>
                {event.tags.map((tag) => (
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
