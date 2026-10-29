'use client';

import { memo } from 'react';
import { ViewMode } from '@/lib/types';
import { ViewToggle } from './ViewToggle';

interface ViewToolbarProps {
  viewMode: ViewMode;
  onViewChange: (mode: ViewMode) => void;
  eventCount: number;
  /** e.g. "IST (UTC+5:30)" -- the active conference's time zone. */
  timeZoneLabel?: string | null;
}

/**
 * Toolbar row directly above the events content: result count on the left,
 * view mode switcher on the right.
 */
export const ViewToolbar = memo(function ViewToolbar({ viewMode, onViewChange, eventCount, timeZoneLabel }: ViewToolbarProps) {
  return (
    <div className="px-2 sm:px-4 py-2 flex items-center justify-between gap-3 bg-[var(--theme-bg-list)] border-b border-[var(--theme-border-secondary)]">
      <div className="min-w-0">
        <p className="text-sm text-[var(--theme-text-secondary)] tabular-nums whitespace-nowrap" aria-live="polite">
          <span className="font-semibold text-[var(--theme-text-primary)]">{eventCount.toLocaleString()}</span>{' '}
          {eventCount === 1 ? 'event' : 'events'}
        </p>
        {timeZoneLabel && (
          <p className="text-[11px] leading-tight text-[var(--theme-text-muted)] truncate" title={`Event times are shown in ${timeZoneLabel}`}>
            All times {timeZoneLabel}
          </p>
        )}
      </div>
      <ViewToggle viewMode={viewMode} onViewChange={onViewChange} />
    </div>
  );
});
