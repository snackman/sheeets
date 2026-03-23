'use client';

import { useState, useMemo } from 'react';
import {
  CheckSquare,
  Square,
  MapPin,
  Calendar,
  Link2,
  ArrowRight,
  X,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { CONFIDENCE_THRESHOLDS } from '@/lib/gmail/constants';
import type { DeduplicatedEvent } from '@/lib/gmail/types';

interface LumaImportReviewProps {
  events: DeduplicatedEvent[];
  syncStats: { totalMessages: number; totalCandidates: number };
  onImport: (selected: DeduplicatedEvent[]) => void;
  onCancel: () => void;
}

export function LumaImportReview({
  events,
  syncStats,
  onImport,
  onCancel,
}: LumaImportReviewProps) {
  // Auto-select high and medium confidence events
  const [selected, setSelected] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    for (const event of events) {
      if (event.parseConfidence >= CONFIDENCE_THRESHOLDS.MEDIUM) {
        initial.add(event.externalEventKey);
      }
    }
    return initial;
  });

  const [expandedEvent, setExpandedEvent] = useState<string | null>(null);

  const selectedCount = selected.size;
  const allSelected = selectedCount === events.length;

  const toggleEvent = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(events.map((e) => e.externalEventKey)));
    }
  };

  const handleImport = () => {
    const selectedEvents = events.filter((e) =>
      selected.has(e.externalEventKey)
    );
    onImport(selectedEvents);
  };

  const { high, medium, low } = useMemo(() => {
    let h = 0, m = 0, l = 0;
    for (const e of events) {
      if (e.parseConfidence >= CONFIDENCE_THRESHOLDS.HIGH) h++;
      else if (e.parseConfidence >= CONFIDENCE_THRESHOLDS.MEDIUM) m++;
      else l++;
    }
    return { high: h, medium: m, low: l };
  }, [events]);

  if (events.length === 0) {
    return (
      <div className="max-w-lg mx-auto py-16 text-center">
        <p className="text-stone-400 text-lg mb-4">No Luma events found</p>
        <p className="text-stone-500 text-sm mb-6">
          We scanned {syncStats.totalMessages} email{syncStats.totalMessages !== 1 ? 's' : ''} but
          couldn&apos;t extract any event data. This might mean you don&apos;t have Luma
          event emails in this Gmail account.
        </p>
        <button
          onClick={onCancel}
          className="text-amber-400 hover:text-amber-300 text-sm cursor-pointer"
        >
          Go back
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Summary bar */}
      <div className="bg-stone-900 border border-stone-700 rounded-xl p-4 mb-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-white font-medium">
              Found {events.length} event{events.length !== 1 ? 's' : ''} from{' '}
              {syncStats.totalMessages} email{syncStats.totalMessages !== 1 ? 's' : ''}
            </p>
            <div className="flex gap-3 mt-1">
              {high > 0 && (
                <span className="text-xs text-green-400">
                  {high} high confidence
                </span>
              )}
              {medium > 0 && (
                <span className="text-xs text-yellow-400">
                  {medium} medium
                </span>
              )}
              {low > 0 && (
                <span className="text-xs text-red-400">{low} low</span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={toggleAll}
              className="text-stone-400 hover:text-white text-sm transition-colors cursor-pointer"
            >
              {allSelected ? 'Deselect all' : 'Select all'}
            </button>
            <span className="text-stone-600">|</span>
            <span className="text-stone-400 text-sm">
              {selectedCount} selected
            </span>
          </div>
        </div>
      </div>

      {/* Event list */}
      <div className="space-y-2 mb-6">
        {events.map((event) => (
          <EventRow
            key={event.externalEventKey}
            event={event}
            isSelected={selected.has(event.externalEventKey)}
            isExpanded={expandedEvent === event.externalEventKey}
            onToggle={() => toggleEvent(event.externalEventKey)}
            onExpand={() =>
              setExpandedEvent(
                expandedEvent === event.externalEventKey
                  ? null
                  : event.externalEventKey
              )
            }
          />
        ))}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between gap-4 bg-stone-900 border border-stone-700 rounded-xl p-4 sticky bottom-4">
        <button
          onClick={onCancel}
          className="text-stone-400 hover:text-white text-sm transition-colors flex items-center gap-1 cursor-pointer"
        >
          <X className="w-4 h-4" />
          Cancel
        </button>
        <button
          onClick={handleImport}
          disabled={selectedCount === 0}
          className="bg-amber-500 hover:bg-amber-600 disabled:bg-stone-700 disabled:text-stone-500
            text-stone-900 disabled:cursor-not-allowed font-semibold rounded-xl px-6 py-2.5
            transition-colors flex items-center gap-2 cursor-pointer"
        >
          Import {selectedCount} Event{selectedCount !== 1 ? 's' : ''}
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function EventRow({
  event,
  isSelected,
  isExpanded,
  onToggle,
  onExpand,
}: {
  event: DeduplicatedEvent;
  isSelected: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  onExpand: () => void;
}) {
  const confidenceLabel = getConfidenceLabel(event.parseConfidence);
  const formattedDate = event.eventStartAt
    ? formatEventDate(event.eventStartAt)
    : null;

  return (
    <div
      className={`bg-stone-900 border rounded-xl transition-colors ${
        isSelected ? 'border-amber-500/50' : 'border-stone-700'
      }`}
    >
      <div className="p-4 flex items-start gap-3">
        {/* Checkbox */}
        <button onClick={onToggle} className="mt-0.5 shrink-0 cursor-pointer">
          {isSelected ? (
            <CheckSquare className="w-5 h-5 text-amber-400" />
          ) : (
            <Square className="w-5 h-5 text-stone-600" />
          )}
        </button>

        {/* Event info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-white font-medium text-sm leading-tight truncate">
              {event.eventName}
            </h3>
            <ConfidenceBadge confidence={event.parseConfidence} label={confidenceLabel} />
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5">
            {formattedDate && (
              <span className="text-stone-400 text-xs flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5" />
                {formattedDate}
              </span>
            )}
            {event.locationRaw && (
              <span className="text-stone-400 text-xs flex items-center gap-1 truncate max-w-[200px]">
                <MapPin className="w-3.5 h-3.5 shrink-0" />
                {event.locationRaw}
              </span>
            )}
            {event.eventUrl && (
              <a
                href={event.eventUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-amber-400/70 hover:text-amber-400 text-xs flex items-center gap-1"
              >
                <Link2 className="w-3.5 h-3.5" />
                lu.ma
              </a>
            )}
          </div>

          {/* Source summary */}
          <div className="flex items-center gap-2 mt-1.5">
            <span className="text-stone-500 text-xs">
              {event.sources.length} email{event.sources.length !== 1 ? 's' : ''}
            </span>
            <StatusBadge status={event.status} />
            {event.messageTypes.map((type) => (
              <span
                key={type}
                className="text-stone-600 text-xs bg-stone-800 rounded px-1.5 py-0.5"
              >
                {type.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        </div>

        {/* Expand button */}
        <button
          onClick={onExpand}
          className="text-stone-500 hover:text-stone-300 transition-colors shrink-0 cursor-pointer"
        >
          {isExpanded ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
        </button>
      </div>

      {/* Expanded details */}
      {isExpanded && (
        <div className="border-t border-stone-800 px-4 py-3 bg-stone-950/50">
          <p className="text-stone-500 text-xs font-medium mb-2">Source Emails</p>
          <div className="space-y-1.5">
            {event.sources.map((source, i) => (
              <div key={i} className="text-xs text-stone-400 flex items-start gap-2">
                <span className="text-stone-600 shrink-0 w-16">
                  {source.receivedAt
                    ? new Date(source.receivedAt).toLocaleDateString()
                    : 'Unknown'}
                </span>
                <span className="truncate">{source.subject}</span>
                {source.hadIcs && (
                  <span className="text-blue-400/60 shrink-0">.ics</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ConfidenceBadge({
  confidence,
  label,
}: {
  confidence: number;
  label: string;
}) {
  const colors =
    confidence >= CONFIDENCE_THRESHOLDS.HIGH
      ? 'bg-green-500/10 text-green-400 border-green-500/20'
      : confidence >= CONFIDENCE_THRESHOLDS.MEDIUM
        ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
        : 'bg-red-500/10 text-red-400 border-red-500/20';

  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-full border shrink-0 ${colors}`}
    >
      {label}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    approved: 'text-green-400',
    rsvp: 'text-blue-400',
    waitlist: 'text-yellow-400',
    unknown: 'text-stone-500',
  };

  return (
    <span className={`text-xs ${colors[status] || colors.unknown}`}>
      {status}
    </span>
  );
}

function getConfidenceLabel(confidence: number): string {
  if (confidence >= CONFIDENCE_THRESHOLDS.HIGH) return 'High';
  if (confidence >= CONFIDENCE_THRESHOLDS.MEDIUM) return 'Medium';
  return 'Low';
}

function formatEventDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}
