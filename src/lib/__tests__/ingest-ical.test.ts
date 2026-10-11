import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseICalFeed, isCancelled, lumaEventApiIdFromUid, lumaSlugFromDescription } from '../ingest/ical';

const fixture = readFileSync(join(__dirname, 'fixtures', 'luma-calendar.ics'), 'utf-8');

describe('parseICalFeed', () => {
  const events = parseICalFeed(fixture);

  it('parses all 5 VEVENTs from the fixture', () => {
    expect(events).toHaveLength(5);
  });

  it('unfolds a SUMMARY split across physical lines', () => {
    const ev = events.find((e) => e.uid === 'evt-ABC123DEF456@events.lu.ma');
    expect(ev?.summary).toBe(
      'ETHCC Builders Mixer — a long enough title that Luma would fold it across multiple physical lines per RFC 5545'
    );
  });

  it('unescapes \\n and \\, in DESCRIPTION', () => {
    const ev = events.find((e) => e.uid === 'evt-ABC123DEF456@events.lu.ma');
    expect(ev?.description).toContain('Hosted by Alice, Bob & Carol');
    expect(ev?.description.split('\n')).toHaveLength(3); // stub line, blank, hosted-by line
  });

  it('parses DTSTART/DTEND as UTC ISO instants', () => {
    const ev = events.find((e) => e.uid === 'evt-ABC123DEF456@events.lu.ma');
    expect(ev?.dtstart).toBe('2026-03-10T18:00:00.000Z');
    expect(ev?.dtend).toBe('2026-03-10T21:00:00.000Z');
    expect(ev?.dtstartIsDateOnly).toBe(false);
  });

  it('parses GEO as lat/lng', () => {
    const ev = events.find((e) => e.uid === 'evt-ABC123DEF456@events.lu.ma');
    expect(ev?.geo).toEqual({ lat: 43.5528, lng: 7.0174 });
  });

  it('leaves GEO null when absent', () => {
    const ev = events.find((e) => e.uid === 'evt-NOGEO0001XY@events.lu.ma');
    expect(ev?.geo).toBeNull();
  });

  it('handles STATUS:CANCELLED', () => {
    const ev = events.find((e) => e.uid === 'evt-CANCELLED001@events.lu.ma');
    expect(ev?.status).toBe('CANCELLED');
    expect(isCancelled(ev!)).toBe(true);
    const confirmed = events.find((e) => e.uid === 'evt-ABC123DEF456@events.lu.ma');
    expect(isCancelled(confirmed!)).toBe(false);
  });

  it('handles DTSTART;VALUE=DATE (all-day) events', () => {
    const ev = events.find((e) => e.uid === 'evt-ALLDAY0001@events.lu.ma');
    expect(ev?.dtstart).toBe('2026-03-13');
    expect(ev?.dtstartIsDateOnly).toBe(true);
  });

  it('keeps a past event (filtering happens later in the pipeline, not in the parser)', () => {
    const ev = events.find((e) => e.uid === 'evt-PASTEVENT001@events.lu.ma');
    expect(ev?.dtstart).toBe('2023-03-10T18:00:00.000Z');
  });

  it('parses LOCATION as the canonical Luma event URL', () => {
    const ev = events.find((e) => e.uid === 'evt-ABC123DEF456@events.lu.ma');
    expect(ev?.location).toBe('https://luma.com/event/evt-ABC123DEF456');
  });

  it('returns an empty array for a feed with no VEVENTs', () => {
    expect(parseICalFeed('BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR')).toEqual([]);
  });

  it('skips a VEVENT missing UID or DTSTART rather than throwing', () => {
    const broken = 'BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:No uid or dtstart\nEND:VEVENT\nEND:VCALENDAR';
    expect(parseICalFeed(broken)).toEqual([]);
  });
});

describe('lumaEventApiIdFromUid', () => {
  it('extracts the evt- id from a Luma UID', () => {
    expect(lumaEventApiIdFromUid('evt-ABC123DEF456@events.lu.ma')).toBe('evt-ABC123DEF456');
  });

  it('returns null for a non-Luma UID', () => {
    expect(lumaEventApiIdFromUid('some-random-uid@example.com')).toBeNull();
  });
});

describe('lumaSlugFromDescription', () => {
  it('extracts the slug from the DESCRIPTION stub', () => {
    expect(lumaSlugFromDescription('Get up-to-date information at: https://luma.com/ethcc-mixer\n\nHosted by Alice')).toBe(
      'ethcc-mixer'
    );
  });

  it('returns null when no luma.com link is present', () => {
    expect(lumaSlugFromDescription('No link here')).toBeNull();
  });
});
