'use client';

import { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { AlertTriangle, Star } from 'lucide-react';
import type { ETHDenverEvent } from '@/lib/types';
import { TagBadge } from './TagBadge';

interface TableViewProps {
  events: ETHDenverEvent[];
  totalCount: number;
  itinerary?: Set<string>;
  onItineraryToggle?: (eventId: string) => void;
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
}: TableViewProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const separatorRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());
  const [currentDateLabel, setCurrentDateLabel] = useState<string>('Time');

  const groups = useMemo(() => groupByDate(events), [events]);

  // Set initial date label from first group
  useEffect(() => {
    if (groups.length > 0) {
      setCurrentDateLabel(groups[0].label);
    } else {
      setCurrentDateLabel('Time');
    }
  }, [groups]);

  // Track which date separator is at/near the top using IntersectionObserver
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || groups.length === 0) return;

    // We observe each separator row. As separators scroll past the sticky header,
    // the one that most recently crossed out of view (or is still barely visible)
    // determines the current date.
    const observer = new IntersectionObserver(
      (entries) => {
        // Build a list of all separator positions relative to the container
        const separators = Array.from(separatorRefs.current.entries()).map(([dateISO, el]) => {
          const rect = el.getBoundingClientRect();
          const containerRect = container.getBoundingClientRect();
          return {
            dateISO,
            // Position of separator top relative to container top
            relativeTop: rect.top - containerRect.top,
          };
        });

        // Sort by position (top to bottom)
        separators.sort((a, b) => a.relativeTop - b.relativeTop);

        // The "current" date is the last separator that has scrolled to or past the
        // sticky header area (approx top ~40px to account for the sticky thead)
        const stickyThreshold = 50; // px below container top
        let currentDate: string | null = null;

        for (const sep of separators) {
          if (sep.relativeTop <= stickyThreshold) {
            currentDate = sep.dateISO;
          }
        }

        if (currentDate) {
          setCurrentDateLabel(formatDateHeader(currentDate));
        } else if (separators.length > 0) {
          // All separators are below threshold - show the first group
          setCurrentDateLabel(formatDateHeader(separators[0].dateISO));
        }
      },
      {
        root: container,
        // Multiple thresholds for smoother tracking
        threshold: [0, 0.1, 0.5, 1],
        // Negative top margin so we detect when separator passes the sticky header
        rootMargin: '-40px 0px 0px 0px',
      }
    );

    // Observe all separator rows
    for (const el of separatorRefs.current.values()) {
      observer.observe(el);
    }

    return () => observer.disconnect();
  }, [groups]);

  // Also handle scroll events for more precise tracking
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container || groups.length === 0) return;

    const containerRect = container.getBoundingClientRect();
    const stickyThreshold = containerRect.top + 50;

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
    } else if (separators.length > 0) {
      setCurrentDateLabel(formatDateHeader(separators[0].dateISO));
    }
  }, [groups]);

  // Store ref callback for separator rows
  const setSeparatorRef = useCallback((dateISO: string, el: HTMLTableRowElement | null) => {
    if (el) {
      separatorRefs.current.set(dateISO, el);
    } else {
      separatorRefs.current.delete(dateISO);
    }
  }, []);

  return (
    <div className="max-w-7xl mx-auto px-4 pb-3">
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="overflow-auto rounded-lg border border-slate-700"
        style={{ maxHeight: 'calc(100vh - 220px)' }}
      >
        <table className="min-w-[900px] text-sm text-left">
          <thead className="text-xs uppercase tracking-wider text-slate-400 bg-slate-800 border-b border-slate-700 sticky top-0 z-20">
            <tr>
              <th className="px-3 py-2.5 w-8"></th>
              <th className="px-3 py-2.5 min-w-[110px]">
                <span className="normal-case tracking-normal text-orange-400/90 font-semibold">
                  {currentDateLabel}
                </span>
              </th>
              <th className="px-3 py-2.5">Organizer</th>
              <th className="px-3 py-2.5">Event</th>
              <th className="px-3 py-2.5">Location</th>
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
    </div>
  );
}

/** Renders a date separator row + all event rows for that date */
function DateGroup({
  group,
  itinerary,
  onItineraryToggle,
  setSeparatorRef,
}: {
  group: { dateISO: string; label: string; events: ETHDenverEvent[] };
  itinerary?: Set<string>;
  onItineraryToggle?: (eventId: string) => void;
  setSeparatorRef: (dateISO: string, el: HTMLTableRowElement | null) => void;
}) {
  return (
    <>
      {/* Date separator row */}
      <tr
        ref={(el) => setSeparatorRef(group.dateISO, el)}
        className="bg-slate-800/80 sticky top-[37px] z-10"
        data-date={group.dateISO}
      >
        <td
          colSpan={COLUMN_COUNT}
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
            className={`hover:bg-slate-800/70 transition-colors ${event.isDuplicate ? 'bg-red-950/30' : 'bg-slate-900'}`}
            title={event.isDuplicate ? 'Possible duplicate — same name, date, and time as another event' : undefined}
          >
            {/* Star (toggles itinerary) */}
            <td className="px-2 py-2">
              <button
                onClick={() => onItineraryToggle?.(event.id)}
                className="cursor-pointer p-0.5"
                title={isInItinerary ? 'Remove from itinerary' : 'Add to itinerary'}
              >
                <Star
                  className={`w-3.5 h-3.5 ${isInItinerary ? 'text-yellow-400 fill-yellow-400' : 'text-slate-600 hover:text-slate-400'}`}
                />
              </button>
            </td>

            {/* Time */}
            <td className="px-3 py-2 text-slate-400 whitespace-nowrap">
              {event.startTime}
              {event.endTime ? `-${event.endTime}` : ''}
            </td>

            {/* Organizer */}
            <td className="px-3 py-2 text-slate-400 whitespace-nowrap" title={event.organizer}>
              {event.organizer.length > 15 ? event.organizer.slice(0, 15) + '\u2026' : event.organizer}
            </td>

            {/* Event Name */}
            <td className="px-3 py-2 font-medium text-slate-100 whitespace-nowrap" title={event.name}>
              <span className="inline-flex items-center gap-1">
                {event.isDuplicate && (
                  <span title="Duplicate entry in sheet"><AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" /></span>
                )}
                {event.link ? (
                  <a
                    href={event.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-orange-400 transition-colors"
                  >
                    {event.name.length > 25 ? event.name.slice(0, 25) + '\u2026' : event.name}
                  </a>
                ) : (
                  event.name.length > 25 ? event.name.slice(0, 25) + '\u2026' : event.name
                )}
              </span>
            </td>

            {/* Location */}
            <td className="px-3 py-2 text-slate-400 whitespace-nowrap" title={event.address}>
              {event.address ? (
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.address)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-orange-400 transition-colors"
                >
                  {event.address.length > 20 ? event.address.slice(0, 20) + '\u2026' : event.address}
                </a>
              ) : null}
            </td>

            {/* Tags */}
            <td className="px-3 py-2">
              <div className="flex gap-1 items-center" title={event.tags.join(', ')}>
                {event.tags.slice(0, 3).map((tag) => (
                  <TagBadge key={tag} tag={tag} iconOnly />
                ))}
                {event.tags.length > 3 && (
                  <span className="text-slate-500 text-xs">+{event.tags.length - 3}</span>
                )}
              </div>
            </td>
          </tr>
        );
      })}
    </>
  );
}
