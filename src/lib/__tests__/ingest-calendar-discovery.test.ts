import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  resolveCandidateCalendar,
  evaluateCalendarItems,
  MIN_NEW_IN_WINDOW_EVENTS,
  MIN_TOTAL_IN_WINDOW_EVENTS,
  type LumaCalendarItem,
} from '../ingest/sources/calendar-discovery';
import type { EnrichLimiter } from '../ingest/enrich';
import type { IngestCandidateRow } from '../ingest/types';

const getItemsFixture = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'luma-calendar-get-items.json'), 'utf-8'));

function makeCandidate(partial: Partial<IngestCandidateRow>): Pick<IngestCandidateRow, 'canonical_key' | 'event'> {
  return {
    canonical_key: 'luma:evt-abc123',
    event: { calendar: null } as IngestCandidateRow['event'],
    ...partial,
  } as Pick<IngestCandidateRow, 'canonical_key' | 'event'>;
}

describe('resolveCandidateCalendar', () => {
  it('uses the cheap stored event.calendar.apiId path without calling the limiter', async () => {
    const limiter: EnrichLimiter = { enrich: vi.fn(async () => null) };
    const candidate = makeCandidate({
      canonical_key: 'luma:evt-abc123',
      event: { calendar: { apiId: 'cal-knownAlready', name: 'Known Calendar' } } as IngestCandidateRow['event'],
    });
    const resolved = await resolveCandidateCalendar(candidate, limiter);
    expect(resolved).toEqual({ apiId: 'cal-knownAlready', name: 'Known Calendar', isPersonal: false });
    expect(limiter.enrich).not.toHaveBeenCalled();
  });

  it('falls back to a live /event/get call (via the shared limiter) when no calendar is stored', async () => {
    const limiter: EnrichLimiter = {
      enrich: vi.fn(async () => ({
        calendar: { api_id: 'cal-FU1X0TNBTO8ti2F', name: 'The Best Event', is_personal: false, personal_user_api_id: null },
      }) as unknown as Awaited<ReturnType<EnrichLimiter['enrich']>>),
    };
    const candidate = makeCandidate({ canonical_key: 'luma:evt-mHRDVyLOaHAfZ3t' });
    const resolved = await resolveCandidateCalendar(candidate, limiter);
    expect(limiter.enrich).toHaveBeenCalledWith({ apiId: 'evt-mHRDVyLOaHAfZ3t' });
    expect(resolved).toEqual({ apiId: 'cal-FU1X0TNBTO8ti2F', name: 'The Best Event', isPersonal: false });
  });

  it('flags a personal calendar via is_personal', async () => {
    const limiter: EnrichLimiter = {
      enrich: vi.fn(async () => ({
        calendar: { api_id: 'cal-somePersonal', name: 'Jane Doe', is_personal: true, personal_user_api_id: 'usr-jane' },
      }) as unknown as Awaited<ReturnType<EnrichLimiter['enrich']>>),
    };
    const candidate = makeCandidate({ canonical_key: 'luma:evt-mHRDVyLOaHAfZ3t' });
    const resolved = await resolveCandidateCalendar(candidate, limiter);
    expect(resolved?.isPersonal).toBe(true);
  });

  it('returns null for a non-Luma canonical key', async () => {
    const limiter: EnrichLimiter = { enrich: vi.fn(async () => null) };
    const candidate = makeCandidate({ canonical_key: 'eventbrite:12345' });
    expect(await resolveCandidateCalendar(candidate, limiter)).toBeNull();
  });

  it('returns null when the live lookup fails/returns nothing', async () => {
    const limiter: EnrichLimiter = { enrich: vi.fn(async () => null) };
    const candidate = makeCandidate({ canonical_key: 'luma:evt-mHRDVyLOaHAfZ3t' });
    expect(await resolveCandidateCalendar(candidate, limiter)).toBeNull();
  });
});

describe('fetchLumaCalendarItems (mocked safeFetch)', () => {
  beforeEach(() => vi.resetModules());

  it('calls calendar/get-items exactly once with period=upcoming and parses entries', async () => {
    let capturedUrl: string | undefined;
    vi.doMock('../safe-fetch', () => ({
      safeFetch: vi.fn(async (url: string) => {
        capturedUrl = url;
        return { ok: true, status: 200, url, headers: {}, text: JSON.stringify(getItemsFixture) };
      }),
      SafeFetchError: class SafeFetchError extends Error {},
    }));
    const { fetchLumaCalendarItems } = await import('../ingest/sources/calendar-discovery');
    const items = await fetchLumaCalendarItems('cal-FU1X0TNBTO8ti2F');
    expect(capturedUrl).toContain('calendar_api_id=cal-FU1X0TNBTO8ti2F');
    expect(capturedUrl).toContain('period=upcoming');
    expect(items).toHaveLength(4);
    expect(items[0]).toMatchObject({ apiId: 'evt-mHRDVyLOaHAfZ3t', dateISO: '2026-11-05', lat: 51.5072, lng: -0.1276 });
    // An item missing coordinates still parses, just with lat/lng null.
    const noGeo = items.find((i) => i.apiId === 'evt-noGeo1');
    expect(noGeo?.lat).toBeNull();
  });

  it('rejects an invalid calendar id before fetching', async () => {
    const { fetchLumaCalendarItems } = await import('../ingest/sources/calendar-discovery');
    await expect(fetchLumaCalendarItems('not-a-calendar')).rejects.toThrow(/Invalid Luma calendar id/);
  });
});

describe('evaluateCalendarItems (threshold logic)', () => {
  const window = {
    startDate: '2026-11-05',
    endDate: '2026-11-07',
    windowPreDays: 1,
    windowPostDays: 1,
    center: { lat: 51.5072, lng: -0.1276 }, // London
    radiusKm: 40,
  };

  function items(): LumaCalendarItem[] {
    return [
      { apiId: 'evt-mHRDVyLOaHAfZ3t', name: 'Afterdark', link: 'https://luma.com/event/evt-mHRDVyLOaHAfZ3t', dateISO: '2026-11-05', lat: 51.5072, lng: -0.1276 },
      { apiId: 'evt-9zQwErX2abCdEfG', name: 'Breakfast', link: 'https://luma.com/event/evt-9zQwErX2abCdEfG', dateISO: '2026-11-06', lat: 51.5074, lng: -0.1278 },
      { apiId: 'evt-outOfWindow1', name: 'Tokyo Meetup', link: null, dateISO: '2027-03-01', lat: 35.6762, lng: 139.6503 },
      { apiId: 'evt-noGeo1', name: 'Venue TBA', link: null, dateISO: '2026-11-05', lat: null, lng: null },
    ];
  }

  it('is eligible on >= 2 in-window events even when NONE are "new"', () => {
    const existingKeys = new Set(['luma:evt-mhrdvyloahafz3t', 'luma:evt-9zqwerx2abcdefg']);
    const evalResult = evaluateCalendarItems(items(), window, existingKeys);
    expect(evalResult.inWindowCount).toBe(2); // Tokyo (out of window/area) and no-geo are both dropped.
    expect(evalResult.newCount).toBe(0);
    expect(evalResult.eligible).toBe(true);
    expect(MIN_TOTAL_IN_WINDOW_EVENTS).toBe(2);
  });

  it('is eligible on >= 1 NEW in-window event even if the total in-window count is only 1', () => {
    const onlyOneInWindow = items().slice(0, 1);
    const evalResult = evaluateCalendarItems(onlyOneInWindow, window, new Set());
    expect(evalResult.inWindowCount).toBe(1);
    expect(evalResult.newCount).toBe(1);
    expect(evalResult.eligible).toBe(true);
    expect(MIN_NEW_IN_WINDOW_EVENTS).toBe(1);
  });

  it('is NOT eligible with 1 in-window event that is already a known candidate', () => {
    const onlyOneInWindow = items().slice(0, 1);
    const existingKeys = new Set(['luma:evt-mhrdvyloahafz3t']);
    const evalResult = evaluateCalendarItems(onlyOneInWindow, window, existingKeys);
    expect(evalResult.inWindowCount).toBe(1);
    expect(evalResult.newCount).toBe(0);
    expect(evalResult.eligible).toBe(false);
  });

  it('drops events outside the date window or geo radius, and events with no coordinates', () => {
    const evalResult = evaluateCalendarItems(items(), window, new Set());
    expect(evalResult.sample.map((s) => s.name)).toEqual(['Afterdark', 'Breakfast']);
  });

  it('is not eligible on zero in-window events', () => {
    const evalResult = evaluateCalendarItems([items()[2], items()[3]], window, new Set());
    expect(evalResult.eligible).toBe(false);
    expect(evalResult.inWindowCount).toBe(0);
  });
});
