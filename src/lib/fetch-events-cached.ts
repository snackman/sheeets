import { unstable_cache } from 'next/cache';
import { fetchEvents } from './fetch-events';
import { ETHDenverEvent } from './types';

/**
 * Server-side cached version of fetchEvents().
 * Uses Next.js unstable_cache with 5-minute revalidation
 * to avoid hitting Google Sheets on every request.
 */
export const fetchEventsCached: () => Promise<ETHDenverEvent[]> = unstable_cache(
  async () => {
    return fetchEvents();
  },
  ['events-all'],
  { revalidate: 300 }, // 5 minutes
);
