import type { ETHDenverEvent, FilterState } from './types';

function parseStartHour(t: string): number | null {
  if (!t) return null;
  const s = t.toLowerCase().trim();
  if (s === 'all day' || s === 'tbd') return null;
  const m = s.match(/(\d{1,2}):?(\d{2})?\s*(am?|pm?)?/i);
  if (!m) return null;
  let h = parseInt(m[1]);
  const isPM = m[3] && m[3].startsWith('p');
  const isAM = m[3] && m[3].startsWith('a');
  if (isPM && h !== 12) h += 12;
  if (isAM && h === 12) h = 0;
  return h;
}

export function applyFilters(
  events: ETHDenverEvent[],
  filters: FilterState,
  starred?: Set<string>,
  itinerary?: Set<string>
): ETHDenverEvent[] {
  return events.filter((event) => {
    // Conference filter
    if (filters.conference && event.conference !== filters.conference) {
      return false;
    }

    // Day filter
    if (
      filters.selectedDays.length > 0 &&
      !filters.selectedDays.includes(event.dateISO)
    ) {
      return false;
    }

    // Time range filter (continuous hours)
    if (filters.timeStart !== 0 || filters.timeEnd !== 24) {
      if (event.isAllDay) {
        // all-day events always pass time filter
      } else {
        const hour = parseStartHour(event.startTime);
        if (hour !== null && (hour < filters.timeStart || hour >= filters.timeEnd)) {
          return false;
        }
      }
    }

    // Tag filter (event must have ALL selected tags)
    if (filters.vibes.length > 0 && !filters.vibes.every(t => event.tags.includes(t))) {
      return false;
    }

    // Cost filter
    if (filters.freeOnly && !event.isFree) return false;

    // Amenities
    if (filters.hasFood && !event.hasFood) return false;
    if (filters.hasBar && !event.hasBar) return false;

    // Starred
    if (filters.starredOnly && starred && !starred.has(event.id)) return false;

    // Itinerary
    if (filters.itineraryOnly && itinerary && !itinerary.has(event.id))
      return false;

    // Search
    if (filters.searchQuery) {
      const q = filters.searchQuery.toLowerCase();
      const searchable = [
        event.name,
        event.organizer,
        event.address,
        event.note,
        event.conference,
        ...event.tags,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!searchable.includes(q)) return false;
    }

    return true;
  });
}
