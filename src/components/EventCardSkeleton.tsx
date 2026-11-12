/** Placeholder shaped like an EventCard, shown while events load. */
export function EventCardSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="rounded-lg p-4 flex gap-4 overflow-hidden bg-[var(--theme-bg-card)] border border-[var(--theme-border-primary)] animate-pulse"
    >
      <div className="flex flex-col items-center gap-2 shrink-0">
        <div className="w-6 h-6 rounded-full bg-[var(--theme-bg-tertiary)]" />
        <div className="w-6 h-6 rounded-full bg-[var(--theme-bg-tertiary)]" />
      </div>
      <div className="w-20 h-20 rounded-lg shrink-0 bg-[var(--theme-bg-tertiary)]" />
      <div className="flex-1 min-w-0 space-y-2.5">
        <div className="h-4 w-3/4 rounded bg-[var(--theme-bg-tertiary)]" />
        <div className="h-3 w-1/2 rounded bg-[var(--theme-bg-tertiary)]" />
        <div className="h-3 w-2/3 rounded bg-[var(--theme-bg-tertiary)]" />
        <div className="flex gap-1.5 pt-1">
          <div className="h-5 w-14 rounded-full bg-[var(--theme-bg-tertiary)]" />
          <div className="h-5 w-12 rounded-full bg-[var(--theme-bg-tertiary)]" />
        </div>
      </div>
    </div>
  );
}
