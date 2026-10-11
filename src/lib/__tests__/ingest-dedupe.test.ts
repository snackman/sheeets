import { describe, it, expect, vi, beforeEach } from 'vitest';

const cacheStore = new Map<string, string | null>();

vi.mock('../ingest/db', () => ({
  getCachedLumaApiId: vi.fn(async (key: string) => (cacheStore.has(key) ? cacheStore.get(key)! : null)),
  setCachedLumaApiId: vi.fn(async (key: string, apiId: string | null) => {
    cacheStore.set(key, apiId);
  }),
}));

vi.mock('../luma-server', () => ({
  fetchLumaEvent: vi.fn(async ({ slug }: { slug?: string }) => {
    if (slug === 'ethcc-mixer') return { event: { api_id: 'evt-ABC123DEF456' } };
    throw Object.assign(new Error('not found'), { name: 'LumaFetchError', code: 'not_found' });
  }),
  LumaFetchError: class LumaFetchError extends Error {
    code: string;
    constructor(message: string, code = 'upstream') {
      super(message);
      this.code = code;
    }
  },
}));

import {
  canonicalKeyForEvent,
  buildSheetLinkIndex,
  findSheetMatchByLink,
  nameTokens,
  jaccardSimilarity,
  fuzzyMatch,
} from '../ingest/dedupe';

beforeEach(() => {
  cacheStore.clear();
  vi.clearAllMocks();
});

describe('canonicalKeyForEvent', () => {
  it('keys a Luma /event/evt-… link on the stable event id', () => {
    expect(canonicalKeyForEvent({ link: 'https://luma.com/event/evt-ABC123DEF456' })).toBe('luma:evt-abc123def456');
  });

  it('keys a Luma vanity-slug link on the slug', () => {
    expect(canonicalKeyForEvent({ link: 'https://luma.com/ethcc-mixer' })).toBe('luma:ethcc-mixer');
  });

  it('treats lu.ma and luma.com as the same host', () => {
    expect(canonicalKeyForEvent({ link: 'https://lu.ma/ethcc-mixer' })).toBe(canonicalKeyForEvent({ link: 'https://luma.com/ethcc-mixer' }));
  });

  it('keys a non-Luma link on lowercased host + path', () => {
    expect(canonicalKeyForEvent({ link: 'https://partiful.com/E/abc123' })).toBe('partiful.com/e/abc123');
  });

  it('returns null for an empty link', () => {
    expect(canonicalKeyForEvent({ link: '' })).toBeNull();
  });
});

describe('buildSheetLinkIndex', () => {
  it('matches a sheet event by its raw normalized link key', async () => {
    const index = await buildSheetLinkIndex([{ id: 'evt-1', link: 'https://luma.com/event/evt-ABC123DEF456' }]);
    const match = findSheetMatchByLink(index, { link: 'https://luma.com/event/evt-ABC123DEF456' });
    expect(match?.id).toBe('evt-1');
  });

  it('resolves a vanity-slug sheet link to its api id so a candidate keyed on the api id still matches (§5.2 item 2)', async () => {
    const index = await buildSheetLinkIndex([{ id: 'evt-2', link: 'https://luma.com/ethcc-mixer' }]);
    // The sheet event's own key (luma:ethcc-mixer) still matches directly...
    expect(findSheetMatchByLink(index, { link: 'https://luma.com/ethcc-mixer' })?.id).toBe('evt-2');
    // ...and the resolved alt key (luma:evt-abc123def456) also matches, which is
    // what lets a candidate built from the iCal UID (api id) find this sheet row.
    expect(findSheetMatchByLink(index, { link: 'https://luma.com/event/evt-ABC123DEF456' })?.id).toBe('evt-2');
  });

  it('caches the resolution so a second call does not hit the network again', async () => {
    const { fetchLumaEvent } = await import('../luma-server');
    await buildSheetLinkIndex([{ id: 'evt-2', link: 'https://luma.com/ethcc-mixer' }]);
    await buildSheetLinkIndex([{ id: 'evt-2', link: 'https://luma.com/ethcc-mixer' }]);
    expect(fetchLumaEvent).toHaveBeenCalledTimes(1);
  });

  it('returns no match for an unrelated link', async () => {
    const index = await buildSheetLinkIndex([{ id: 'evt-1', link: 'https://luma.com/event/evt-ABC123DEF456' }]);
    expect(findSheetMatchByLink(index, { link: 'https://luma.com/some-other-event' })).toBeNull();
  });
});

describe('nameTokens / jaccardSimilarity', () => {
  it('strips stopwords, punctuation and the conference name', () => {
    const tokens = nameTokens('ETHCC Rooftop Happy Hour @ Consensus 2026!', 'Consensus');
    expect(tokens.has('happy')).toBe(false);
    expect(tokens.has('hour')).toBe(false);
    expect(tokens.has('consensus')).toBe(false);
    expect(tokens.has('2026')).toBe(false);
    expect(tokens.has('rooftop')).toBe(true);
    expect(tokens.has('ethcc')).toBe(true);
  });

  it('gives identical names a similarity of 1', () => {
    expect(jaccardSimilarity(nameTokens('Builders Mixer'), nameTokens('Builders Mixer'))).toBe(1);
  });

  it('gives completely different names a similarity of 0', () => {
    expect(jaccardSimilarity(nameTokens('Builders Mixer'), nameTokens('Yoga Retreat'))).toBe(0);
  });
});

describe('fuzzyMatch', () => {
  const base = { name: 'ETH Builders Mixer', dateISO: '2026-03-10', startTime: '6:00 PM', address: '123 Main St', lat: 43.5528, lng: 7.0174 };

  it('returns null for events on different dates', () => {
    expect(fuzzyMatch(base, { ...base, dateISO: '2026-03-11' })).toBeNull();
  });

  it('flags a near-identical name as a duplicate outright (>= 0.85 — a trailing year is stripped, making these identical token sets)', () => {
    const result = fuzzyMatch(base, { ...base, name: 'ETH Builders Mixer 2026' });
    expect(result?.kind).toBe('duplicate');
    expect(result?.score).toBeGreaterThanOrEqual(0.85);
  });

  it('flags a partial name match (0.6-0.85 band) + same venue + close time as a duplicate', () => {
    // {eth,builders,mixer} vs {eth,builders,mixer,redux}: Jaccard = 3/4 = 0.75
    const result = fuzzyMatch(base, { ...base, name: 'ETH Builders Mixer Redux', startTime: '6:30 PM' });
    expect(result?.score).toBeGreaterThanOrEqual(0.6);
    expect(result?.score).toBeLessThan(0.85);
    expect(result?.kind).toBe('duplicate');
  });

  it('flags the same partial name match alone (no venue/geo/time match) as only a possible duplicate', () => {
    const result = fuzzyMatch(base, {
      name: 'ETH Builders Mixer Redux',
      dateISO: base.dateISO,
      startTime: '11:00 PM',
      address: 'Somewhere else entirely',
      lat: 10,
      lng: 10,
    });
    expect(result?.kind).toBe('possible_duplicate');
  });

  it('returns null for unrelated names on the same day', () => {
    expect(fuzzyMatch(base, { ...base, name: 'Yoga and Mindfulness Retreat' })).toBeNull();
  });
});
