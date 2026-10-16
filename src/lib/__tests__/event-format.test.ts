import { describe, it, expect } from 'vitest';
import { sheetDateShort, sheetDateShortFromISODate, time12FromTime24, sheetTime12Hour, formatCost } from '../event-format';

// Verified live against the curated "Token2049 2026" tab (gid 357353145):
// column A's number-format pattern is literally `ddd", "mmmm" "d` (e.g.
// "Mon, October 5") and its Start/End Time columns are plain TEXT cells
// like "9:00a"/"11:30a" — no weekday/year on time, no "M", no leading zero
// on the hour. These tests lock the ingest publisher's own formatters to
// that same convention (see Bug: "Devcon events invisible" — the ingest
// publisher used to emit "Oct 31"/"12:00 PM" instead).

describe('sheetDateShortFromISODate', () => {
  it('formats as "Weekday, Month day" with the full month name', () => {
    // 2026-10-05 is a Monday.
    expect(sheetDateShortFromISODate('2026-10-05')).toBe('Mon, October 5');
  });

  it('computes the correct weekday for a different date', () => {
    // 2026-11-03 is a Tuesday.
    expect(sheetDateShortFromISODate('2026-11-03')).toBe('Tue, November 3');
  });

  it('does not zero-pad the day', () => {
    expect(sheetDateShortFromISODate('2026-04-01')).toBe('Wed, April 1');
  });

  it('returns empty string for an unparseable date', () => {
    expect(sheetDateShortFromISODate('')).toBe('');
    expect(sheetDateShortFromISODate('not-a-date')).toBe('');
  });
});

describe('sheetDateShort', () => {
  it('converts a UTC instant to the local curated date in the given timezone', () => {
    // 2026-03-10T23:30:00Z has already rolled over to March 11 in
    // Europe/Paris (UTC+1).
    expect(sheetDateShort('2026-03-10T23:30:00.000Z', 'Europe/Paris')).toBe('Wed, March 11');
  });

  it('returns empty string for an invalid instant', () => {
    expect(sheetDateShort('not-a-date', 'UTC')).toBe('');
  });
});

describe('time12FromTime24', () => {
  it('formats morning times with a trailing lowercase "a", no space, no "M"', () => {
    expect(time12FromTime24('09:00')).toBe('9:00a');
    expect(time12FromTime24('11:30')).toBe('11:30a');
  });

  it('formats afternoon/evening times with a trailing lowercase "p"', () => {
    expect(time12FromTime24('18:00')).toBe('6:00p');
    expect(time12FromTime24('13:00')).toBe('1:00p');
  });

  it('handles noon and midnight correctly', () => {
    expect(time12FromTime24('12:00')).toBe('12:00p');
    expect(time12FromTime24('00:00')).toBe('12:00a');
  });

  it('returns empty string for malformed input', () => {
    expect(time12FromTime24('')).toBe('');
    expect(time12FromTime24('garbage')).toBe('');
  });
});

describe('sheetTime12Hour', () => {
  it('converts a UTC instant to the curated local time string', () => {
    expect(sheetTime12Hour('2026-03-10T18:00:00.000Z', 'Europe/Paris')).toBe('7:00p');
  });
});

describe('formatCost (unaffected by the text-cell fix, sanity check)', () => {
  it('formats whole-dollar cents as "$20"', () => {
    expect(formatCost(2000)).toBe('$20');
  });

  it('formats free/zero/null as "Free"', () => {
    expect(formatCost(0)).toBe('Free');
    expect(formatCost(null)).toBe('Free');
    expect(formatCost(undefined)).toBe('Free');
  });
});
