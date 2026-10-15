import { describe, it, expect } from 'vitest';
import { clampInsertIndex, endsBefore, type EventTime } from '../useDragReorder';

// A simple day of back-to-back-ish events to exercise the clamp:
//   a: 09:00-10:00  b: 10:00-11:00  c: 12:00-13:00  d: 12:30-13:30 (overlaps c)
const TIMES: Record<string, EventTime> = {
  a: { dateISO: '2026-04-11', startMinutes: 540, endMinutes: 600 },
  b: { dateISO: '2026-04-11', startMinutes: 600, endMinutes: 660 },
  c: { dateISO: '2026-04-11', startMinutes: 720, endMinutes: 780 },
  d: { dateISO: '2026-04-11', startMinutes: 750, endMinutes: 810 },
};

function getTime(id: string): EventTime | null {
  return TIMES[id] ?? null;
}

describe('endsBefore', () => {
  it('is true when a ends before b starts on the same day', () => {
    expect(endsBefore(TIMES.a, TIMES.b)).toBe(true);
  });

  it('is false when the ranges overlap', () => {
    expect(endsBefore(TIMES.c, TIMES.d)).toBe(false);
    expect(endsBefore(TIMES.d, TIMES.c)).toBe(false);
  });

  it('is true when a is on an earlier day entirely', () => {
    const earlierDay: EventTime = { dateISO: '2026-04-10', startMinutes: 1000, endMinutes: 1100 };
    expect(endsBefore(earlierDay, TIMES.a)).toBe(true);
  });

  it('is false when end/start minutes are unknown (all-day-ish events)', () => {
    const unknown: EventTime = { dateISO: '2026-04-11', startMinutes: null, endMinutes: null };
    expect(endsBefore(unknown, TIMES.a)).toBe(false);
    expect(endsBefore(TIMES.a, unknown)).toBe(false);
  });
});

describe('clampInsertIndex', () => {
  it('leaves the index untouched when the source has no known time', () => {
    const ids = ['a', 'b', 'c'];
    expect(clampInsertIndex(ids, 'missing', 2, getTime)).toBe(2);
  });

  it('does not allow dragging an event past one it does not overlap with (below)', () => {
    // Dragging "a" (09:00-10:00, no overlaps) all the way to the end should get
    // clamped back to before "b", since a ends exactly when b starts.
    const ids = ['a', 'b', 'c', 'd'];
    const clamped = clampInsertIndex(ids, 'a', 4, getTime);
    expect(clamped).toBeLessThanOrEqual(ids.indexOf('b'));
  });

  it('does not allow dragging an event past one it does not overlap with (above)', () => {
    // Dragging "d" (12:30-13:30) to the very front should get clamped so it
    // doesn't end up before "a" or "b", which it ends after (not overlapping).
    const ids = ['a', 'b', 'c', 'd'];
    const clamped = clampInsertIndex(ids, 'd', 0, getTime);
    expect(clamped).toBeGreaterThan(ids.indexOf('b'));
  });

  it('allows free movement among events that overlap', () => {
    // "c" and "d" overlap, so c should be able to move to either side of d.
    const ids = ['a', 'b', 'c', 'd'];
    const clampedBefore = clampInsertIndex(ids, 'c', ids.indexOf('d'), getTime);
    const clampedAfter = clampInsertIndex(ids, 'c', ids.indexOf('d') + 1, getTime);
    expect(clampedBefore).toBe(ids.indexOf('d'));
    expect(clampedAfter).toBe(ids.indexOf('d') + 1);
  });
});
