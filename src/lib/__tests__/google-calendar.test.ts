import { describe, it, expect } from 'vitest';
import { buildCalendarEvent } from '../google-calendar';
import type { ETHDenverEvent } from '../types';

function ev(over: Partial<ETHDenverEvent> = {}): ETHDenverEvent {
  return {
    id: 'e1', date: '', dateISO: '2026-11-03', startTime: '7:00 PM', endTime: '9:00 PM', isAllDay: false,
    organizer: '', name: 'Party', address: '', cost: '', isFree: false, vibe: '', tags: [], conference: 'Devcon 8',
    link: '', hasFood: false, hasBar: false, note: '', timeOfDay: 'evening', ...over,
  };
}

describe('buildCalendarEvent', () => {
  it('same-day event', () => {
    const c = buildCalendarEvent(ev(), 'Asia/Kolkata');
    expect(c.start).toEqual({ dateTime: '2026-11-03T19:00:00', timeZone: 'Asia/Kolkata' });
    expect(c.end).toEqual({ dateTime: '2026-11-03T21:00:00', timeZone: 'Asia/Kolkata' });
  });
  it('10 PM - 2 AM ends next day', () => {
    const c = buildCalendarEvent(ev({ startTime: '10:00 PM', endTime: '2:00 AM' }), 'Asia/Kolkata');
    expect(c.end.dateTime).toBe('2026-11-04T02:00:00');
  });
  it('11 PM with no end rolls to 00:00 next day, never T24', () => {
    const c = buildCalendarEvent(ev({ startTime: '11:00 PM', endTime: '' }), 'Asia/Kolkata');
    expect(c.end.dateTime).toBe('2026-11-04T00:00:00');
  });
  it('all-day end is next day across month/year boundary', () => {
    const c = buildCalendarEvent(ev({ isAllDay: true, dateISO: '2026-12-31' }), 'Asia/Kolkata');
    expect(c.start.date).toBe('2026-12-31');
    expect(c.end.date).toBe('2027-01-01');
  });
});
