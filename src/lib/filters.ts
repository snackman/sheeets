import type { ETHDenverEvent, FilterState } from './types';

export function applyFilters(
  events: ETHDenverEvent[],
  filters: FilterState,
  starred?: Set<string>,
  itinerary?: Set<string>
): ETHDenverEvent[] {
  return events.filter((event) => {
    // Day filter
    if (
      filters.selectedDays.length > 0 &&
      !filters.selectedDays.includes(event.dateISO)
    ) {
      return false;
    }

    // Time of day filter
    if (
      filters.timeOfDay.length > 0 &&
      !filters.timeOfDay.includes(event.timeOfDay)
    ) {
      return false;
    }

    // Tag filter (matches if any of the event's tags are selected)
    if (filters.vibes.length > 0 && !event.tags.some(t => filters.vibes.includes(t))) {
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
