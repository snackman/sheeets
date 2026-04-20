import type { ETHDenverEvent } from './types';
import { sortByStartTime } from './time-parse';

export const MAX_FEATURED = 3;

/**
 * Extract up to MAX_FEATURED featured events from the given list,
 * sorted by start time. Runs on already-filtered events so it
 * respects all active filters.
 */
export function extractFeaturedEvents(
  events: ETHDenverEvent[],
): ETHDenverEvent[] {
  return events
    .filter((e) => e.isFeatured)
    .sort(sortByStartTime)
    .slice(0, MAX_FEATURED);
}
