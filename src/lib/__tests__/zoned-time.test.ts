import { describe, it, expect } from 'vitest';
import { getZonedParts, zonedDateISO, zonedSlotISO, zonedWallClockDate } from '../zoned-time';

const utc = (s: string) => new Date(s);

describe('getZonedParts', () => {
  it('Mumbai is UTC+5:30 with no DST', () => {
    expect(getZonedParts('Asia/Kolkata', utc('2026-03-29T00:30:00Z'))).toMatchObject({ day: 29, hour: 6, minute: 0 });
    expect(getZonedParts('Asia/Kolkata', utc('2026-10-25T00:30:00Z'))).toMatchObject({ day: 25, hour: 6, minute: 0 });
  });

  it('London springs forward on 2026-03-29 at 01:00 UTC', () => {
    expect(getZonedParts('Europe/London', utc('2026-03-29T00:59:00Z'))).toMatchObject({ hour: 0, minute: 59 });
    // 01:00 UTC is 02:00 BST; the 01:xx hour never exists locally
    expect(getZonedParts('Europe/London', utc('2026-03-29T01:00:00Z'))).toMatchObject({ hour: 2, minute: 0 });
  });

  it('London falls back on 2026-10-25 at 01:00 UTC', () => {
    expect(getZonedParts('Europe/London', utc('2026-10-25T00:59:00Z'))).toMatchObject({ hour: 1, minute: 59 });
    expect(getZonedParts('Europe/London', utc('2026-10-25T01:00:00Z'))).toMatchObject({ hour: 1, minute: 0 });
  });

  it('Miami springs forward on 2026-03-08 at 07:00 UTC', () => {
    expect(getZonedParts('America/New_York', utc('2026-03-08T06:59:00Z'))).toMatchObject({ hour: 1, minute: 59 });
    expect(getZonedParts('America/New_York', utc('2026-03-08T07:00:00Z'))).toMatchObject({ hour: 3, minute: 0 });
  });

  it('Miami falls back on 2026-11-01 at 06:00 UTC', () => {
    expect(getZonedParts('America/New_York', utc('2026-11-01T05:59:00Z'))).toMatchObject({ hour: 1, minute: 59 });
    expect(getZonedParts('America/New_York', utc('2026-11-01T06:00:00Z'))).toMatchObject({ hour: 1, minute: 0 });
  });

  it('never returns hour 24 at local midnight', () => {
    expect(getZonedParts('Europe/London', utc('2026-01-15T00:00:00Z')).hour).toBe(0);
    expect(getZonedParts('America/New_York', utc('2026-01-15T05:00:00Z')).hour).toBe(0);
  });

  it('crosses the date line correctly', () => {
    // 20:00 UTC on Mar 1 is already Mar 2 in Mumbai
    expect(getZonedParts('Asia/Kolkata', utc('2026-03-01T20:00:00Z'))).toMatchObject({ month: 3, day: 2, hour: 1, minute: 30 });
  });
});

describe('zonedDateISO', () => {
  it('returns the calendar day in the zone', () => {
    expect(zonedDateISO('Asia/Kolkata', utc('2026-03-01T20:00:00Z'))).toBe('2026-03-02');
    expect(zonedDateISO('America/New_York', utc('2026-03-01T03:00:00Z'))).toBe('2026-02-28');
  });

  it('computes tomorrow across month, year and leap-day boundaries', () => {
    expect(zonedDateISO('Europe/London', utc('2026-02-28T12:00:00Z'), 1)).toBe('2026-03-01');
    expect(zonedDateISO('Europe/London', utc('2026-12-31T12:00:00Z'), 1)).toBe('2027-01-01');
    expect(zonedDateISO('Europe/London', utc('2028-02-28T12:00:00Z'), 1)).toBe('2028-02-29');
  });

  it('tomorrow is a full calendar day later on 23h and 25h DST days', () => {
    // London 2026-03-29 is 23 hours long; 2026-10-25 is 25 hours long
    expect(zonedDateISO('Europe/London', utc('2026-03-29T10:00:00Z'), 1)).toBe('2026-03-30');
    expect(zonedDateISO('Europe/London', utc('2026-10-25T10:00:00Z'), 1)).toBe('2026-10-26');
    // Miami 2026-03-08 (23h) and 2026-11-01 (25h)
    expect(zonedDateISO('America/New_York', utc('2026-03-08T15:00:00Z'), 1)).toBe('2026-03-09');
    expect(zonedDateISO('America/New_York', utc('2026-11-01T15:00:00Z'), 1)).toBe('2026-11-02');
  });

  it('a late-evening Miami instant is still "today" there even though UTC rolled over', () => {
    expect(zonedDateISO('America/New_York', utc('2026-11-01T03:30:00Z'))).toBe('2026-10-31');
  });
});

describe('zonedSlotISO', () => {
  it('floors to the 30 minute slot', () => {
    expect(zonedSlotISO('Asia/Kolkata', utc('2026-03-01T04:29:00Z'))).toBe('2026-03-01T09:30'); // 09:59 IST
    expect(zonedSlotISO('Asia/Kolkata', utc('2026-03-01T04:31:00Z'))).toBe('2026-03-01T10:00'); // 10:01 IST
    expect(zonedSlotISO('Europe/London', utc('2026-03-29T01:10:00Z'))).toBe('2026-03-29T02:00');
  });
});

describe('zonedWallClockDate', () => {
  it('has local fields equal to the zone wall clock', () => {
    const d = zonedWallClockDate('Asia/Kolkata', utc('2026-03-01T20:00:00Z'));
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 3, 2, 1, 30]);
  });
});
