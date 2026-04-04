import { describe, it, expect } from 'vitest';
import {
  parseDateToISO,
  parseTimeToHour,
  getTimeOfDay,
  isFreeEvent,
  normalizeAddress,
  formatDateLabel,
} from '../utils';

describe('parseDateToISO', () => {
  it('parses "Mar 21" to "2026-03-21"', () => {
    expect(parseDateToISO('Mar 21')).toBe('2026-03-21');
  });

  it('parses "Tue, Feb 10" to "2026-02-10"', () => {
    expect(parseDateToISO('Tue, Feb 10')).toBe('2026-02-10');
  });

  it('parses "Sat, Apr 11" to "2026-04-11"', () => {
    expect(parseDateToISO('Sat, Apr 11')).toBe('2026-04-11');
  });

  it('parses "Jan 1" with zero-padded day', () => {
    expect(parseDateToISO('Jan 1')).toBe('2026-01-01');
  });

  it('parses "Dec 25" correctly', () => {
    expect(parseDateToISO('Dec 25')).toBe('2026-12-25');
  });

  it('parses "Mon, May 4" correctly', () => {
    expect(parseDateToISO('Mon, May 4')).toBe('2026-05-04');
  });

  it('returns empty string for empty input', () => {
    expect(parseDateToISO('')).toBe('');
  });

  it('returns empty string for unparseable input', () => {
    expect(parseDateToISO('not a date')).toBe('');
  });

  it('returns empty string for just a number', () => {
    expect(parseDateToISO('42')).toBe('');
  });
});

describe('parseTimeToHour', () => {
  it('parses "9:00a" to 9', () => {
    expect(parseTimeToHour('9:00a')).toBe(9);
  });

  it('parses "12:00p" to 12', () => {
    expect(parseTimeToHour('12:00p')).toBe(12);
  });

  it('parses "6:00 PM" to 18', () => {
    expect(parseTimeToHour('6:00 PM')).toBe(18);
  });

  it('parses "12:00 AM" to 0', () => {
    expect(parseTimeToHour('12:00 AM')).toBe(0);
  });

  it('parses "2:30 AM" to 2', () => {
    expect(parseTimeToHour('2:30 AM')).toBe(2);
  });

  it('returns null for "All Day"', () => {
    expect(parseTimeToHour('All Day')).toBeNull();
  });

  it('returns null for "TBD"', () => {
    expect(parseTimeToHour('TBD')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseTimeToHour('')).toBeNull();
  });
});

describe('getTimeOfDay', () => {
  it('returns "morning" for 9:00a', () => {
    expect(getTimeOfDay('9:00a')).toBe('morning');
  });

  it('returns "morning" for 6:00a (boundary)', () => {
    expect(getTimeOfDay('6:00a')).toBe('morning');
  });

  it('returns "afternoon" for 12:00p', () => {
    expect(getTimeOfDay('12:00p')).toBe('afternoon');
  });

  it('returns "afternoon" for 2:00p', () => {
    expect(getTimeOfDay('2:00p')).toBe('afternoon');
  });

  it('returns "evening" for 6:00p', () => {
    expect(getTimeOfDay('6:00p')).toBe('evening');
  });

  it('returns "evening" for 5:00 PM (boundary)', () => {
    expect(getTimeOfDay('5:00 PM')).toBe('evening');
  });

  it('returns "night" for 9:00 PM', () => {
    expect(getTimeOfDay('9:00 PM')).toBe('night');
  });

  it('returns "night" for 2:00a (early morning = night)', () => {
    expect(getTimeOfDay('2:00a')).toBe('night');
  });

  it('returns "all-day" for "All Day"', () => {
    expect(getTimeOfDay('All Day')).toBe('all-day');
  });

  it('returns "all-day" for "TBD"', () => {
    expect(getTimeOfDay('TBD')).toBe('all-day');
  });

  it('returns "all-day" for empty string', () => {
    expect(getTimeOfDay('')).toBe('all-day');
  });
});

describe('isFreeEvent', () => {
  it('returns true for "Free"', () => {
    expect(isFreeEvent('Free')).toBe(true);
  });

  it('returns true for "free" (case-insensitive)', () => {
    expect(isFreeEvent('free')).toBe(true);
  });

  it('returns true for empty string', () => {
    expect(isFreeEvent('')).toBe(true);
  });

  it('returns true for "0"', () => {
    expect(isFreeEvent('0')).toBe(true);
  });

  it('returns true for "$0"', () => {
    expect(isFreeEvent('$0')).toBe(true);
  });

  it('returns false for "$50"', () => {
    expect(isFreeEvent('$50')).toBe(false);
  });

  it('returns false for "$200"', () => {
    expect(isFreeEvent('$200')).toBe(false);
  });

  it('returns false for "75"', () => {
    expect(isFreeEvent('75')).toBe(false);
  });

  it('returns true for whitespace-only string (trims to empty)', () => {
    expect(isFreeEvent('  ')).toBe(true);
  });

  it('returns true for " Free " with whitespace', () => {
    expect(isFreeEvent(' Free ')).toBe(true);
  });
});

describe('normalizeAddress', () => {
  it('lowercases the address', () => {
    expect(normalizeAddress('123 Main Street')).toBe('123 main street');
  });

  it('trims whitespace', () => {
    expect(normalizeAddress('  123 Main St  ')).toBe('123 main st');
  });

  it('collapses multiple spaces', () => {
    expect(normalizeAddress('123   Main    St')).toBe('123 main st');
  });

  it('removes trailing periods and commas', () => {
    expect(normalizeAddress('123 Main St.')).toBe('123 main st');
    expect(normalizeAddress('123 Main St,')).toBe('123 main st');
    expect(normalizeAddress('123 Main St.,.')).toBe('123 main st');
  });

  it('handles complex address normalization', () => {
    expect(normalizeAddress('  45  Avenue des  Champs-Elysees,  Paris,  ')).toBe(
      '45 avenue des champs-elysees, paris',
    );
  });

  it('returns empty string for empty input', () => {
    expect(normalizeAddress('')).toBe('');
  });
});

describe('formatDateLabel', () => {
  it('formats "2026-04-11" as "Sat, Apr 11"', () => {
    expect(formatDateLabel('2026-04-11')).toBe('Sat, Apr 11');
  });

  it('formats "2026-05-03" as "Sun, May 3"', () => {
    expect(formatDateLabel('2026-05-03')).toBe('Sun, May 3');
  });

  it('formats "2026-01-01" as "Thu, Jan 1"', () => {
    expect(formatDateLabel('2026-01-01')).toBe('Thu, Jan 1');
  });

  it('formats "2026-12-25" as "Fri, Dec 25"', () => {
    expect(formatDateLabel('2026-12-25')).toBe('Fri, Dec 25');
  });
});
