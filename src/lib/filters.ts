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

/** Parse a time string like "12:00p", "6:00 PM", "2:30 AM" to minutes since midnight */
export function parseTimeToMinutes(t: string): number | null {
  if (!t) return null;
  const s = t.toLowerCase().trim();
  if (s === 'all day' || s === 'tbd') return null;
  const m = s.match(/(\d{1,2}):?(\d{2})?\s*(am?|pm?)?/i);
  if (!m) return null;
  let h = parseInt(m[1]);
  const min = m[2] ? parseInt(m[2]) : 0;
  const isPM = m[3] && m[3].startsWith('p');
  const isAM = m[3] && m[3].startsWith('a');
  if (isPM && h !== 12) h += 12;
  if (isAM && h === 12) h = 0;
  return h * 60 + min;
}

/** Check if an event passes the "Now" filter (happening now or starting within 60 minutes) */
export function passesNowFilter(event: ETHDenverEvent, now: Date): boolean {
  // Check if event date matches today
  const todayISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (event.dateISO !== todayISO) return false;

  // All-day events happening today always pass
  if (event.isAllDay) return true;

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = parseTimeToMinutes(event.startTime);

  // If we can't parse start time, include the event (benefit of the doubt)
  if (startMinutes === null) return true;

  const endMinutes = parseTimeToMinutes(event.endTime);

  // Event is currently happening: started and hasn't ended
  if (startMinutes <= nowMinutes) {
    // If no end time, assume it's still going for 2 hours after start
    if (endMinutes === null) {
      return nowMinutes <= startMinutes + 120;
    }
    // End time is after now — still happening
    if (endMinutes >= nowMinutes) return true;
    // Event has ended
    return false;
  }

  // Event starts within the next 60 minutes
  if (startMinutes > nowMinutes && startMinutes <= nowMinutes + 60) {
    return true;
  }

  return false;
}

export function applyFilters(
  events: ETHDenverEvent[],
  filters: FilterState,
  itinerary?: Set<string>,
  nowTimestamp?: number
): ETHDenverEvent[] {
  // Create the "now" Date once for consistency across all events
  const now = nowTimestamp ? new Date(nowTimestamp) : new Date();

  return events.filter((event) => {
    // Conference filter
    if (filters.conference && event.conference !== filters.conference) {
      return false;
    }

    // Now mode overrides day + time filters
    if (filters.nowMode) {
      if (!passesNowFilter(event, now)) return false;
    } else {
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
    }

    // Tag filter (event must have ALL selected tags)
    if (filters.vibes.length > 0 && !filters.vibes.every(t => event.tags.includes(t))) {
      return false;
    }

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
