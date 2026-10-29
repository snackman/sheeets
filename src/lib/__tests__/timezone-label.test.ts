import { describe, it, expect } from 'vitest';
import { formatTimeZoneLabel, conferenceTimeZoneLabel } from '../timezone-label';

describe('formatTimeZoneLabel', () => {
  it('labels Kolkata as IST', () => {
    expect(formatTimeZoneLabel('Asia/Kolkata')).toBe('IST (UTC+5:30)');
  });
  it('is DST-aware for London', () => {
    expect(formatTimeZoneLabel('Europe/London', new Date('2026-07-01T12:00:00Z'))).toMatch(/\(UTC\+1\)$/);
    expect(formatTimeZoneLabel('Europe/London', new Date('2026-12-01T12:00:00Z'))).toBe('GMT (UTC)');
  });
  it('returns null for missing or invalid zones', () => {
    expect(formatTimeZoneLabel(undefined)).toBeNull();
    expect(formatTimeZoneLabel('Nope/Nada')).toBeNull();
  });
  it('anchors a tab to its first date', () => {
    expect(conferenceTimeZoneLabel({ timezone: 'America/Denver', dates: ['2027-02-20'] })).toMatch(/\(UTC-7\)$/);
  });
});
