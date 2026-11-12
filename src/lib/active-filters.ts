import type { FilterState } from './types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function shortDate(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split('-').map(Number);
  return m && d ? `${MONTHS[m - 1]} ${d}` : iso;
}

const TIME_LABELS: Record<FilterState['timeMode'], string | null> = {
  off: null,
  now: 'Happening now',
  today: 'Today',
  tomorrow: 'Tomorrow',
};

/**
 * Human-readable list of everything currently narrowing the event list
 * (excluding the conference itself, which "Clear all" never changes).
 * `defaults` is the conference's default date range.
 */
export function describeActiveFilters(
  filters: FilterState,
  defaults: { startDateTime: string; endDateTime: string },
): string[] {
  const out: string[] = [];
  const q = filters.searchQuery.trim();
  if (q) out.push(`Search: "${q}"`);
  const time = TIME_LABELS[filters.timeMode];
  if (time) out.push(time);
  else if (filters.startDateTime !== defaults.startDateTime || filters.endDateTime !== defaults.endDateTime) {
    const a = shortDate(filters.startDateTime);
    const b = shortDate(filters.endDateTime);
    out.push(a === b ? `Date: ${a}` : `Dates: ${a} - ${b}`);
  }
  for (const v of filters.vibes) out.push(v);
  if (filters.selectedFriends.length > 0) {
    out.push(`${filters.selectedFriends.length} friend${filters.selectedFriends.length === 1 ? '' : 's'}`);
  }
  if (filters.selectedOrgs.length > 0) {
    out.push(`${filters.selectedOrgs.length} organizer${filters.selectedOrgs.length === 1 ? '' : 's'}`);
  }
  if (filters.itineraryOnly) out.push('My plan only');
  return out;
}
