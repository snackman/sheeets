export interface MissingAddress {
  raw: string;
  normalized: string;
  conference: string;
  center: { lat: number; lng: number };
}

/**
 * Pick which of this run's missing addresses `/api/cron/geocode` should
 * actually call Mapbox for (review finding, HIGH):
 *   1. Skip anything that failed recently (within the cron's retry-after
 *      cooldown, tracked in the `geocode_failures` table) -- an address
 *      that genuinely can't be geocoded was otherwise retried every single
 *      run, forever.
 *   2. Cap the remainder at `maxCalls` per run, so one run with a large
 *      backlog can't blow through the function's time budget or Mapbox's
 *      rate limit.
 *
 * Pure and side-effect free so it's unit-testable without mocking Mapbox,
 * Supabase, or the route's request/response plumbing.
 */
export function selectAddressesToAttempt(
  missing: MissingAddress[],
  recentlyFailedNormalized: ReadonlySet<string>,
  maxCalls: number
): { attempted: MissingAddress[]; skippedCooldown: number } {
  const eligible = missing.filter((m) => !recentlyFailedNormalized.has(m.normalized));
  return {
    attempted: eligible.slice(0, maxCalls),
    skippedCooldown: missing.length - eligible.length,
  };
}
