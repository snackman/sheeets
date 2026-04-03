import { describe, it, expect } from 'vitest';
import { parseTimeToMinutes, sortByStartTime, detectConflicts } from '../time-parse';
import type { ETHDenverEvent } from '../types';
import { sampleEvents } from './fixtures/sample-events';

describe('parseTimeToMinutes', () => {
  it('parses "12:00p" to 720', () => {
    expect(parseTimeToMinutes('12:00p')).toBe(720);
  });

  it('parses "6:00 PM" to 1080', () => {
    expect(parseTimeToMinutes('6:00 PM')).toBe(1080);
  });

  it('parses "9:00a" to 540', () => {
    expect(parseTimeToMinutes('9:00a')).toBe(540);
  });

  it('parses "12:00a" (midnight) to 0', () => {
    expect(parseTimeToMinutes('12:00a')).toBe(0);
  });

  it('parses "12:00 AM" to 0', () => {
    expect(parseTimeToMinutes('12:00 AM')).toBe(0);
  });

  it('parses "2:30 AM" to 150', () => {
    expect(parseTimeToMinutes('2:30 AM')).toBe(150);
  });

  it('parses "11:59p" to 1439', () => {
    expect(parseTimeToMinutes('11:59p')).toBe(1439);
  });

  it('parses "1:00p" to 780', () => {
    expect(parseTimeToMinutes('1:00p')).toBe(780);
  });

  it('parses "5:00p" to 1020', () => {
    expect(parseTimeToMinutes('5:00p')).toBe(1020);
  });

  it('parses "2:00a" to 120', () => {
    expect(parseTimeToMinutes('2:00a')).toBe(120);
  });

  it('returns null for "All Day"', () => {
    expect(parseTimeToMinutes('All Day')).toBeNull();
  });

  it('returns null for "all day" (case-insensitive)', () => {
    expect(parseTimeToMinutes('all day')).toBeNull();
  });

  it('returns null for "TBD"', () => {
    expect(parseTimeToMinutes('TBD')).toBeNull();
  });

  it('returns null for "tbd" (case-insensitive)', () => {
    expect(parseTimeToMinutes('tbd')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseTimeToMinutes('')).toBeNull();
  });

  it('handles time with space before am/pm', () => {
    expect(parseTimeToMinutes('3:00 pm')).toBe(900);
  });

  it('handles time without minutes', () => {
    // "3p" should parse as 3:00 PM = 900
    expect(parseTimeToMinutes('3p')).toBe(900);
  });
});

describe('sortByStartTime', () => {
  it('places all-day events before timed events', () => {
    const allDay = sampleEvents.find((e) => e.isAllDay)!;
    const timed = sampleEvents.find((e) => !e.isAllDay)!;
    expect(sortByStartTime(allDay, timed)).toBeLessThan(0);
  });

  it('places timed events after all-day events', () => {
    const allDay = sampleEvents.find((e) => e.isAllDay)!;
    const timed = sampleEvents.find((e) => !e.isAllDay)!;
    expect(sortByStartTime(timed, allDay)).toBeGreaterThan(0);
  });

  it('sorts two all-day events alphabetically by name', () => {
    const a: ETHDenverEvent = {
      ...sampleEvents[0],
      isAllDay: true,
      startTime: 'All Day',
      name: 'Alpha Event',
    };
    const b: ETHDenverEvent = {
      ...sampleEvents[0],
      isAllDay: true,
      startTime: 'All Day',
      name: 'Beta Event',
    };
    expect(sortByStartTime(a, b)).toBeLessThan(0);
    expect(sortByStartTime(b, a)).toBeGreaterThan(0);
  });

  it('sorts earlier timed events before later ones', () => {
    const morning: ETHDenverEvent = {
      ...sampleEvents[0],
      startTime: '9:00a',
      isAllDay: false,
    };
    const afternoon: ETHDenverEvent = {
      ...sampleEvents[0],
      startTime: '2:00p',
      isAllDay: false,
    };
    expect(sortByStartTime(morning, afternoon)).toBeLessThan(0);
  });

  it('sorts a list of events correctly', () => {
    const events: ETHDenverEvent[] = [
      { ...sampleEvents[0], startTime: '5:00p', isAllDay: false, name: 'C' },
      { ...sampleEvents[0], startTime: 'All Day', isAllDay: true, name: 'A' },
      { ...sampleEvents[0], startTime: '9:00a', isAllDay: false, name: 'B' },
    ];
    const sorted = [...events].sort(sortByStartTime);
    expect(sorted[0].name).toBe('A'); // all-day first
    expect(sorted[1].name).toBe('B'); // 9am
    expect(sorted[2].name).toBe('C'); // 5pm
  });
});

describe('detectConflicts', () => {
  it('detects overlapping events on the same day', () => {
    const events: ETHDenverEvent[] = [
      {
        ...sampleEvents[0],
        id: 'conflict-a',
        dateISO: '2026-04-11',
        startTime: '10:00a',
        endTime: '12:00p',
        isAllDay: false,
      },
      {
        ...sampleEvents[0],
        id: 'conflict-b',
        dateISO: '2026-04-11',
        startTime: '11:00a',
        endTime: '1:00p',
        isAllDay: false,
      },
    ];
    const conflicts = detectConflicts(events);
    expect(conflicts.has('conflict-a')).toBe(true);
    expect(conflicts.has('conflict-b')).toBe(true);
  });

  it('does not flag non-overlapping events', () => {
    const events: ETHDenverEvent[] = [
      {
        ...sampleEvents[0],
        id: 'no-conflict-a',
        dateISO: '2026-04-11',
        startTime: '10:00a',
        endTime: '12:00p',
        isAllDay: false,
      },
      {
        ...sampleEvents[0],
        id: 'no-conflict-b',
        dateISO: '2026-04-11',
        startTime: '1:00p',
        endTime: '3:00p',
        isAllDay: false,
      },
    ];
    const conflicts = detectConflicts(events);
    expect(conflicts.size).toBe(0);
  });

  it('does not flag events on different days', () => {
    const events: ETHDenverEvent[] = [
      {
        ...sampleEvents[0],
        id: 'day-a',
        dateISO: '2026-04-11',
        startTime: '10:00a',
        endTime: '12:00p',
        isAllDay: false,
      },
      {
        ...sampleEvents[0],
        id: 'day-b',
        dateISO: '2026-04-12',
        startTime: '10:00a',
        endTime: '12:00p',
        isAllDay: false,
      },
    ];
    const conflicts = detectConflicts(events);
    expect(conflicts.size).toBe(0);
  });

  it('skips all-day events for conflict detection', () => {
    const events: ETHDenverEvent[] = [
      {
        ...sampleEvents[0],
        id: 'allday',
        dateISO: '2026-04-11',
        startTime: 'All Day',
        endTime: '',
        isAllDay: true,
      },
      {
        ...sampleEvents[0],
        id: 'timed',
        dateISO: '2026-04-11',
        startTime: '10:00a',
        endTime: '12:00p',
        isAllDay: false,
      },
    ];
    const conflicts = detectConflicts(events);
    expect(conflicts.size).toBe(0);
  });

  it('skips events without end times', () => {
    const events: ETHDenverEvent[] = [
      {
        ...sampleEvents[0],
        id: 'no-end-a',
        dateISO: '2026-04-11',
        startTime: '10:00a',
        endTime: '',
        isAllDay: false,
      },
      {
        ...sampleEvents[0],
        id: 'no-end-b',
        dateISO: '2026-04-11',
        startTime: '10:00a',
        endTime: '12:00p',
        isAllDay: false,
      },
    ];
    const conflicts = detectConflicts(events);
    // Can't determine overlap without both end times
    expect(conflicts.size).toBe(0);
  });

  it('returns empty set for empty events array', () => {
    expect(detectConflicts([]).size).toBe(0);
  });

  it('detects multiple conflicts on the same day', () => {
    const events: ETHDenverEvent[] = [
      {
        ...sampleEvents[0],
        id: 'multi-a',
        dateISO: '2026-04-11',
        startTime: '10:00a',
        endTime: '12:00p',
        isAllDay: false,
      },
      {
        ...sampleEvents[0],
        id: 'multi-b',
        dateISO: '2026-04-11',
        startTime: '11:00a',
        endTime: '1:00p',
        isAllDay: false,
      },
      {
        ...sampleEvents[0],
        id: 'multi-c',
        dateISO: '2026-04-11',
        startTime: '12:30p',
        endTime: '2:00p',
        isAllDay: false,
      },
    ];
    const conflicts = detectConflicts(events);
    expect(conflicts.has('multi-a')).toBe(true);
    expect(conflicts.has('multi-b')).toBe(true);
    expect(conflicts.has('multi-c')).toBe(true);
  });

  it('handles adjacent but non-overlapping events (end = start of next)', () => {
    const events: ETHDenverEvent[] = [
      {
        ...sampleEvents[0],
        id: 'adj-a',
        dateISO: '2026-04-11',
        startTime: '10:00a',
        endTime: '12:00p',
        isAllDay: false,
      },
      {
        ...sampleEvents[0],
        id: 'adj-b',
        dateISO: '2026-04-11',
        startTime: '12:00p',
        endTime: '2:00p',
        isAllDay: false,
      },
    ];
    const conflicts = detectConflicts(events);
    // 10:00-12:00 and 12:00-2:00: aStart(600) < bEnd(840) AND bStart(720) < aEnd(720)
    // bStart(720) < aEnd(720) is false (720 < 720 = false), so no conflict
    expect(conflicts.size).toBe(0);
  });
});
