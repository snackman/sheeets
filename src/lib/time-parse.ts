import type { ETHDenverEvent } from './types';

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

/** Sort two events by start time (all-day first, then by parsed minutes) */
export function sortByStartTime(a: ETHDenverEvent, b: ETHDenverEvent): number {
  if (a.isAllDay && !b.isAllDay) return -1;
  if (!a.isAllDay && b.isAllDay) return 1;
  if (a.isAllDay && b.isAllDay) return a.name.localeCompare(b.name);

  return (parseTimeToMinutes(a.startTime) ?? 0) - (parseTimeToMinutes(b.startTime) ?? 0);
}

/**
 * Detect events that have time conflicts (overlapping times on the same day).
 * Returns a Set of conflicting event IDs.
 */
export function detectConflicts(events: ETHDenverEvent[]): Set<string> {
  const conflicts = new Set<string>();

  // Group by date
  const byDate = new Map<string, ETHDenverEvent[]>();
  for (const event of events) {
    const key = event.dateISO || 'unknown';
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key)!.push(event);
  }

  // Check overlaps within each day
  for (const dayEvents of byDate.values()) {
    for (let i = 0; i < dayEvents.length; i++) {
      for (let j = i + 1; j < dayEvents.length; j++) {
        const a = dayEvents[i];
        const b = dayEvents[j];

        // Skip all-day events for conflict detection
        if (a.isAllDay || b.isAllDay) continue;

        const aStart = parseTimeToMinutes(a.startTime);
        const aEnd = parseTimeToMinutes(a.endTime);
        const bStart = parseTimeToMinutes(b.startTime);
        const bEnd = parseTimeToMinutes(b.endTime);

        // Can't determine overlap without both start and end times
        if (aStart === null || aEnd === null || bStart === null || bEnd === null)
          continue;

        // Two events conflict if: A starts before B ends AND B starts before A ends
        if (aStart < bEnd && bStart < aEnd) {
          conflicts.add(a.id);
          conflicts.add(b.id);
        }
      }
    }
  }

  return conflicts;
}

/** Relative time display (e.g. "5m ago", "2h ago", "3d ago") */
export function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}
