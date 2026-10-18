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
import type { EnrichLimiter, EnrichOutcome } from '../ingest/enrich';
import type { IngestCandidateRow } from '../ingest/types';

const getItemsFixture = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'luma-calendar-get-items.json'), 'utf-8'));

function makeCandidate(partial: Partial<IngestCandidateRow>): Pick<IngestCandidateRow, 'canonical_key'> {
  return { canonical_key: 'luma:evt-abc123', ...partial };
}

/** Minimal `EnrichLimiter` stub for these tests — `enrich`/`enrichResult`
 *  both delegate to the SAME underlying fn so call-count assertions stay
 *  simple; `exhausted` is always false (exhaustion has its own tests
 *  elsewhere, e.g. `ingest-discover-calendars.test.ts`). */
function stubLimiter(enrich: EnrichLimiter['enrich']): EnrichLimiter {
  return {
    enrich,
    enrichResult: async (ref) => {
      const payload = await enrich(ref);
      return (payload ? { status: 'ok', payload } : { status: 'not_found' }) as EnrichOutcome;
    },
    exhausted: false,
  };
}

describe('resolveCandidateCalendar', () => {
  // Review finding, MEDIUM item 3 ("use the true hosting calendar"): this
  // ALWAYS resolves live now — there is no more "cheap stored
  // event.calendar.apiId" short-circuit, because that stored field is
  // always the CURATED FEED's own calendar, not the event's true host, so
  // trusting it meant a real, different host calendar could never be
  // discovered for a `luma_ical` candidate.
  it('resolves the live calendar for a Luma candidate via the shared limiter', async () => {
    const enrich = vi.fn(async () => ({
      calendar: { api_id: 'cal-FU1X0TNBTO8ti2F', name: 'The Best Event', is_personal: false, personal_user_api_id: null },
    }) as unknown as Awaited<ReturnType<EnrichLimiter['enrich']>>);
    const limiter = stubLimiter(enrich);
    const candidate = makeCandidate({ canonical_key: 'luma:evt-mHRDVyLOaHAfZ3t' });
    const resolved = await resolveCandidateCalendar(candidate, limiter);
    expect(enrich).toHaveBeenCalledWith({ apiId: 'evt-mHRDVyLOaHAfZ3t' });
    expect(resolved).toEqual({
      status: 'resolved',
      calendar: { apiId: 'cal-FU1X0TNBTO8ti2F', name: 'The Best Event', isPersonal: false },
    });
  });

  // Exactly the scenario this feature exists for: a candidate ingested via
  // ONE calendar's feed (its stored `event.calendar.apiId`, if this test
  // provided one, would point at that feed — irrelevant now) turns out to
  // be truly HOSTED by a totally different calendar once resolved live.
  it('resolves a DIFFERENT calendar than any feed the candidate might have been ingested through', async () => {
    const enrich = vi.fn(async () => ({
      calendar: { api_id: 'cal-TrueHost', name: 'True Host Calendar', is_personal: false, personal_user_api_id: null },
    }) as unknown as Awaited<ReturnType<EnrichLimiter['enrich']>>);
    const limiter = stubLimiter(enrich);
    // This candidate's canonical key is all `resolveCandidateCalendar` is given.
    const candidate = makeCandidate({ canonical_key: 'luma:evt-mHRDVyLOaHAfZ3t' });
    const resolved = await resolveCandidateCalendar(candidate, limiter);
    expect(resolved.calendar?.apiId).toBe('cal-TrueHost');
  });

  it('flags a personal calendar via is_personal', async () => {
    const limiter = stubLimiter(vi.fn(async () => ({
      calendar: { api_id: 'cal-somePersonal', name: 'Jane Doe', is_personal: true, personal_user_api_id: 'usr-jane' },
    }) as unknown as Awaited<ReturnType<EnrichLimiter['enrich']>>));
    const candidate = makeCandidate({ canonical_key: 'luma:evt-mHRDVyLOaHAfZ3t' });
    const resolved = await resolveCandidateCalendar(candidate, limiter);
    expect(resolved.calendar?.isPersonal).toBe(true);
  });

  // 2026-10-18: real canonical keys are LOWERCASED; Luma's event/get is
  // case-sensitive, so the lowercased id 404'd and `hostCalendar = null`
  // was cached forever.
  it('uses the ORIGINAL-case api id from event.link, never the lowercased key', async () => {
    const enrich = vi.fn(async () => ({
      calendar: { api_id: 'cal-TrueHost', name: 'True Host', is_personal: false, personal_user_api_id: null },
    }) as unknown as Awaited<ReturnType<EnrichLimiter['enrich']>>);
    const candidate = {
      canonical_key: 'luma:evt-mhrdvyloahafz3t',
      event: { link: 'https://luma.com/event/evt-mHRDVyLOaHAfZ3t' } as IngestCandidateRow['event'],
    };
    const resolved = await resolveCandidateCalendar(candidate, stubLimiter(enrich));
    expect(enrich).toHaveBeenCalledWith({ apiId: 'evt-mHRDVyLOaHAfZ3t' });
    expect(resolved.calendar?.apiId).toBe('cal-TrueHost');
  });

  it('falls back to the short slug (from alt_keys) when the link carries no api id', async () => {
    const enrich = vi.fn(async () => ({
      calendar: { api_id: 'cal-TrueHost', name: 'True Host', is_personal: false, personal_user_api_id: null },
    }) as unknown as Awaited<ReturnType<EnrichLimiter['enrich']>>);
    const candidate = {
      canonical_key: 'luma:evt-mhrdvyloahafz3t',
      alt_keys: ['luma:scale-or-die-26'],
      event: { link: 'https://example.com/x' } as IngestCandidateRow['event'],
    };
    await resolveCandidateCalendar(candidate, stubLimiter(enrich));
    expect(enrich).toHaveBeenCalledWith({ slug: 'scale-or-die-26' });
    expect(enrich).toHaveBeenCalledTimes(1);
  });

  it('only a lowercased id and no slug: "unavailable" WITHOUT calling Luma (a 404 there would prove nothing)', async () => {
    const enrich = vi.fn(async () => null);
    const candidate = { canonical_key: 'luma:evt-mhrdvyloahafz3t', event: { link: '' } as IngestCandidateRow['event'] };
    expect(await resolveCandidateCalendar(candidate, stubLimiter(enrich))).toEqual({ status: 'unavailable', calendar: null });
    expect(enrich).not.toHaveBeenCalled();
  });

  it('"not_applicable" for a non-Luma canonical key — never calls the limiter', async () => {
    const enrich = vi.fn(async () => null);
    const limiter = stubLimiter(enrich);
    const candidate = makeCandidate({ canonical_key: 'eventbrite:12345' });
    expect(await resolveCandidateCalendar(candidate, limiter)).toEqual({ status: 'not_applicable', calendar: null });
    expect(enrich).not.toHaveBeenCalled();
  });

  // Review finding, HIGH item B / the same cache-poisoning class as
  // `enrich.ts#EnrichOutcome`: a CONFIRMED Luma 404 is a definitive
  // "resolved to nothing" (safe for the caller to cache forever), while an
  // exhausted limiter or a transient error is "we don't know" (must never
  // be cached) — these two cases must be distinguishable.
  it('"resolved" with a null calendar on a CONFIRMED Luma not_found', async () => {
    const limiter: EnrichLimiter = {
      enrich: vi.fn(async () => null),
      enrichResult: vi.fn(async () => ({ status: 'not_found' }) as EnrichOutcome),
      exhausted: false,
    };
    const candidate = makeCandidate({ canonical_key: 'luma:evt-mHRDVyLOaHAfZ3t' });
    expect(await resolveCandidateCalendar(candidate, limiter)).toEqual({ status: 'resolved', calendar: null });
  });

  it('"unavailable" (never "resolved") when the limiter is exhausted', async () => {
    const enrichResult = vi.fn(async () => ({ status: 'unavailable' }) as EnrichOutcome);
    const limiter: EnrichLimiter = { enrich: vi.fn(async () => null), enrichResult, exhausted: true };
    const candidate = makeCandidate({ canonical_key: 'luma:evt-mHRDVyLOaHAfZ3t' });
    expect(await resolveCandidateCalendar(candidate, limiter)).toEqual({ status: 'unavailable', calendar: null });
  });

  it('"unavailable" on a transient fetch error (not a confirmed 404)', async () => {
    const limiter: EnrichLimiter = {
      enrich: vi.fn(async () => null),
      enrichResult: vi.fn(async () => ({ status: 'unavailable' }) as EnrichOutcome),
      exhausted: false,
    };
    const candidate = makeCandidate({ canonical_key: 'luma:evt-mHRDVyLOaHAfZ3t' });
    expect(await resolveCandidateCalendar(candidate, limiter)).toEqual({ status: 'unavailable', calendar: null });
  });

  it('"resolved" with a null calendar when Luma responds but the payload has no usable calendar field', async () => {
    const limiter = stubLimiter(vi.fn(async () => ({ no_calendar_here: true }) as unknown as Awaited<ReturnType<EnrichLimiter['enrich']>>));
    const candidate = makeCandidate({ canonical_key: 'luma:evt-mHRDVyLOaHAfZ3t' });
    expect(await resolveCandidateCalendar(candidate, limiter)).toEqual({ status: 'resolved', calendar: null });
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
      { apiId: 'evt-thirdInWindow', name: 'Lunch Mixer', link: 'https://luma.com/event/evt-thirdInWindow', dateISO: '2026-11-06', lat: 51.5073, lng: -0.1277 },
      { apiId: 'evt-outOfWindow1', name: 'Tokyo Meetup', link: null, dateISO: '2027-03-01', lat: 35.6762, lng: 139.6503 },
      { apiId: 'evt-noGeo1', name: 'Venue TBA', link: null, dateISO: '2026-11-05', lat: null, lng: null },
      // No parseable api id at all — in-window, but can never be CONFIRMED
      // new (review finding, MEDIUM item 2's second half).
      { apiId: null, name: 'Unidentifiable Event', link: null, dateISO: '2026-11-05', lat: 51.5072, lng: -0.1276 },
    ];
  }

  // Review finding, MEDIUM item 2: thresholds raised from 1-new-or-2-total
  // to 2-new-or-3-total.
  it('is eligible on >= 3 in-window events even when NONE are "new"', () => {
    const existingKeys = new Set(['luma:evt-mhrdvyloahafz3t', 'luma:evt-9zqwerx2abcdefg', 'luma:evt-thirdinwindow']);
    const evalResult = evaluateCalendarItems(items().slice(0, 3), window, existingKeys);
    expect(evalResult.inWindowCount).toBe(3);
    expect(evalResult.newCount).toBe(0);
    expect(evalResult.eligible).toBe(true);
    expect(MIN_TOTAL_IN_WINDOW_EVENTS).toBe(3);
  });

  it('is NOT eligible with only 2 in-window events, none of them new', () => {
    const existingKeys = new Set(['luma:evt-mhrdvyloahafz3t', 'luma:evt-9zqwerx2abcdefg']);
    const evalResult = evaluateCalendarItems(items().slice(0, 2), window, existingKeys);
    expect(evalResult.inWindowCount).toBe(2);
    expect(evalResult.newCount).toBe(0);
    expect(evalResult.eligible).toBe(false);
  });

  it('is eligible on >= 2 NEW in-window events even if the total in-window count is only 2', () => {
    const twoInWindow = items().slice(0, 2);
    const evalResult = evaluateCalendarItems(twoInWindow, window, new Set());
    expect(evalResult.inWindowCount).toBe(2);
    expect(evalResult.newCount).toBe(2);
    expect(evalResult.eligible).toBe(true);
    expect(MIN_NEW_IN_WINDOW_EVENTS).toBe(2);
  });

  it('is NOT eligible with only 1 NEW in-window event (below the raised 2-new threshold) and fewer than 3 total', () => {
    const existingKeys = new Set(['luma:evt-9zqwerx2abcdefg']);
    const evalResult = evaluateCalendarItems(items().slice(0, 2), window, existingKeys);
    expect(evalResult.inWindowCount).toBe(2);
    expect(evalResult.newCount).toBe(1);
    expect(evalResult.eligible).toBe(false);
  });

  it('an in-window item with no parseable api id counts toward inWindowCount but never toward newCount', () => {
    const noApiIdItem = items()[5];
    expect(noApiIdItem.apiId).toBeNull();
    const evalResult = evaluateCalendarItems([noApiIdItem], window, new Set());
    expect(evalResult.inWindowCount).toBe(1);
    expect(evalResult.newCount).toBe(0);
    expect(evalResult.eligible).toBe(false);
  });

  it('drops events outside the date window or geo radius, and events with no coordinates', () => {
    const evalResult = evaluateCalendarItems(items(), window, new Set());
    expect(evalResult.sample.map((s) => s.name)).toEqual(['Afterdark', 'Breakfast', 'Lunch Mixer', 'Unidentifiable Event']);
  });

  it('is not eligible on zero in-window events', () => {
    const evalResult = evaluateCalendarItems([items()[3], items()[4]], window, new Set());
    expect(evalResult.eligible).toBe(false);
    expect(evalResult.inWindowCount).toBe(0);
  });
});
