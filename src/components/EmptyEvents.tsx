'use client';

import { memo } from 'react';
import { SearchX } from 'lucide-react';
import { EmptyState } from './EmptyState';
import { Button } from './Button';
import { useActiveFilterSummary } from './ActiveFiltersContext';

interface EmptyEventsProps {
  /** Clears every filter and the search box (not the conference). */
  onClearFilters?: () => void;
  /** Overrides the summary from context (mainly for tests). */
  activeFilters?: string[];
}

/** Shared empty state for the list, gallery and table views. */
export const EmptyEvents = memo(function EmptyEvents({ onClearFilters, activeFilters }: EmptyEventsProps) {
  const fromContext = useActiveFilterSummary();
  const active = activeFilters ?? fromContext;

  return (
    <EmptyState
      icon={SearchX}
      title="No events match"
      description={
        active.length > 0 ? 'Nothing fits all of these. Try removing one:' : 'There are no events to show here yet.'
      }
    >
      {active.length > 0 && (
        <ul aria-label="Active filters" className="mt-3 flex flex-wrap justify-center gap-1.5 max-w-sm">
          {active.map((label) => (
            <li
              key={label}
              className="px-2.5 py-1 rounded-full text-xs border border-[var(--theme-border-primary)] bg-[var(--theme-bg-tertiary)] text-[var(--theme-text-secondary)]"
            >
              {label}
            </li>
          ))}
        </ul>
      )}
      {onClearFilters && active.length > 0 && (
        <Button type="button" onClick={onClearFilters} className="mt-4">
          Clear all
        </Button>
      )}
    </EmptyState>
  );
});
