import { memo } from 'react';

/** Shared empty state for the list, gallery and table views. */
export const EmptyEvents = memo(function EmptyEvents({ onClearFilters }: { onClearFilters?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-4 text-center text-[var(--theme-text-muted)]">
      <p className="text-lg font-medium">No events match your filters</p>
      <p className="text-sm mt-1">Try a different date, tag or search.</p>
      {onClearFilters && (
        <button
          type="button"
          onClick={onClearFilters}
          className="mt-4 px-4 py-2 rounded-lg text-sm font-medium bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-hover)] active:bg-[var(--theme-accent-hover)] text-[var(--theme-accent-text)] transition-colors cursor-pointer"
        >
          Clear filters
        </button>
      )}
    </div>
  );
});
