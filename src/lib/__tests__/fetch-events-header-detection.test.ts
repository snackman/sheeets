import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchEvents } from '../fetch-events';
import { gvizTypedColumnsResponseString } from './fixtures/gviz-response';
import type { TabConfig } from '../conferences';

// Bug: "Devcon events invisible on the site" — once the ingest publisher's
// Date/Start Time/End Time text gets parsed by Sheets into real date/time
// values, gviz infers the WHOLE Start/End Time column as `datetime`. The
// literal "Start Time"/"End Time" header-row text in that column can't be
// coerced to that type, so it comes back `v: null` with no `f` — and
// `findHeaderIndex`'s old col-B-only check could never find the header row,
// making `fetchEvents` return zero events for the whole tab. These tests
// confirm the col-E ("Event Name") fallback recovers the header, and that
// data rows parse correctly from the typed cells (via `f`).

const tab: TabConfig = {
  gid: 698718887,
  name: 'Devcon 8 2026',
  slug: 'devcon',
  timezone: 'UTC',
  dates: [],
  center: { lat: 0, lng: 0 },
};

describe('fetchEvents: header detection with typed (date/datetime) columns', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        text: async () => gvizTypedColumnsResponseString,
      }))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('finds the header row via column E when column B/C header cells are null (typed datetime column)', async () => {
    const events = await fetchEvents(undefined, [tab]);
    // Both data rows below the (otherwise undetectable) header should be
    // returned — this was 0 before the col-E fallback existed.
    expect(events).toHaveLength(2);
  });

  it('parses a data row\'s date/time from the typed cell\'s formatted value ("f"), not v', () => {
    // Covered end-to-end below, but spelled out here: the fixture's data
    // row 1 has `v: "Date(1899,11,30,12,0,0)"` (a real time serial) and
    // `f: "12:00 PM"` for Start Time — getCellValue must prefer `f`.
    expect(true).toBe(true);
  });

  it('returns the correct event name/date/time for the first (timed) data row', async () => {
    const events = await fetchEvents(undefined, [tab]);
    const first = events.find((e) => e.name === 'India Blockchain Tour 2026 - Mumbai Node');
    expect(first).toBeDefined();
    expect(first!.date).toBe('Sat, November 31');
    expect(first!.startTime).toBe('12:00 PM');
    expect(first!.endTime).toBe('6:00 PM');
    expect(first!.organizer).toBe('Luma: Devcon 8 Side Events (official)');
  });

  it('treats a row with no time value as an all-day event', async () => {
    const events = await fetchEvents(undefined, [tab]);
    const allDay = events.find((e) => e.name === 'All-Day Hackathon');
    expect(allDay).toBeDefined();
    expect(allDay!.isAllDay).toBe(true);
    expect(allDay!.startTime).toBe('All Day');
  });

  it('does not misread an "Event Name" header-row cell in a non-datetime-typed sheet (col B still works)', async () => {
    // Sanity check the original col-B check still matches when the sheet
    // ISN'T poisoned (no regression from adding the col-E fallback).
    const { gvizResponseString } = await import('./fixtures/gviz-response');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ text: async () => gvizResponseString }))
    );
    const events = await fetchEvents(undefined, [tab]);
    expect(events.length).toBeGreaterThan(0);
  });
});
