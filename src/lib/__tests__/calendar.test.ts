import { describe, it, expect } from 'vitest';
import { getGoogleCalendarUrl, generateICS, resolveEventRange, zonedToUtc, addDaysISO } from '../calendar';
import type { ETHDenverEvent } from '../types';

function ev(over: Partial<ETHDenverEvent> = {}): ETHDenverEvent {
  return {
    id: 'e1', date: '', dateISO: '2026-11-03', startTime: '7:00 PM', endTime: '9:00 PM', isAllDay: false,
    organizer: '', name: 'Party', address: '', cost: '', isFree: false, vibe: '', tags: [], conference: 'Devcon 8',
    link: '', hasFood: false, hasBar: false, note: '', timeOfDay: 'evening', ...over,
  };
}

describe('resolveEventRange', () => {
  it('rolls default end past midnight', () => {
    const r = resolveEventRange('2026-11-03', { hour: 23, minute: 30 }, null);
    expect(r.end).toEqual({ dateISO: '2026-11-04', hour: 0, minute: 30 });
  });
  it('never yields hour 24', () => {
    const r = resolveEventRange('2026-12-31', { hour: 23, minute: 0 }, null);
    expect(r.end).toEqual({ dateISO: '2027-01-01', hour: 0, minute: 0 });
  });
  it('rolls overnight explicit end to next day', () => {
    const r = resolveEventRange('2026-11-03', { hour: 22, minute: 0 }, { hour: 2, minute: 0 });
    expect(r.end).toEqual({ dateISO: '2026-11-04', hour: 2, minute: 0 });
  });
  it('keeps same-day end', () => {
    const r = resolveEventRange('2026-11-03', { hour: 19, minute: 0 }, { hour: 21, minute: 0 });
    expect(r.end.dateISO).toBe('2026-11-03');
  });
});

describe('addDaysISO', () => {
  it('handles month and year boundaries', () => {
    expect(addDaysISO('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDaysISO('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('zonedToUtc', () => {
  it('converts Asia/Kolkata (UTC+5:30)', () => {
    expect(zonedToUtc({ dateISO: '2026-11-03', hour: 19, minute: 0 }, 'Asia/Kolkata').toISOString()).toBe('2026-11-03T13:30:00.000Z');
  });
  it('honours DST for Europe/London', () => {
    expect(zonedToUtc({ dateISO: '2026-07-01', hour: 12, minute: 0 }, 'Europe/London').toISOString()).toBe('2026-07-01T11:00:00.000Z');
    expect(zonedToUtc({ dateISO: '2026-12-01', hour: 12, minute: 0 }, 'Europe/London').toISOString()).toBe('2026-12-01T12:00:00.000Z');
  });
});

describe('getGoogleCalendarUrl', () => {
  it('adds ctz and local times', () => {
    const u = new URL(getGoogleCalendarUrl(ev(), 'Asia/Kolkata'));
    expect(u.searchParams.get('ctz')).toBe('Asia/Kolkata');
    expect(u.searchParams.get('dates')).toBe('20261103T190000/20261103T210000');
  });
  it('omits ctz without or with invalid zone', () => {
    expect(new URL(getGoogleCalendarUrl(ev())).searchParams.has('ctz')).toBe(false);
    expect(new URL(getGoogleCalendarUrl(ev(), 'Not/AZone')).searchParams.has('ctz')).toBe(false);
  });
  it('rolls late-night default end to next day', () => {
    const u = new URL(getGoogleCalendarUrl(ev({ startTime: '11:30 PM', endTime: '' }), 'Asia/Kolkata'));
    expect(u.searchParams.get('dates')).toBe('20261103T233000/20261104T003000');
  });
});

describe('generateICS', () => {
  it('writes UTC times with Z when a zone is given', () => {
    const ics = generateICS([ev()], 'Asia/Kolkata');
    expect(ics).toContain('DTSTART:20261103T133000Z');
    expect(ics).toContain('DTEND:20261103T153000Z');
  });
  it('rolls late-night default end across midnight', () => {
    const ics = generateICS([ev({ startTime: '11:30 PM', endTime: '' })], 'Asia/Kolkata');
    expect(ics).toContain('DTSTART:20261103T180000Z');
    expect(ics).toContain('DTEND:20261103T190000Z');
  });
  it('falls back to floating time without a zone', () => {
    expect(generateICS([ev()])).toContain('DTSTART:20261103T190000');
  });
});
