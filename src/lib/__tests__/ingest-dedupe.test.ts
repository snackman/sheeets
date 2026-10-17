import { describe, it, expect, vi, beforeEach } from 'vitest';

// Tri-state, matching the real `getCachedLumaApiIdEntry` (MEDIUM item 7 +
// Part A item 1): no entry = never looked up; an entry with `apiId: null`
// = a confirmed miss, timestamped via `resolvedAt` so `buildSheetLinkIndex`
// can tell a fresh miss from a stale one; a string `apiId` = resolved.
const cacheStore = new Map<string, { apiId: string | null; resolvedAt: string }>();

function setMiss(key: string, resolvedAt: Date) {
  cacheStore.set(key, { apiId: null, resolvedAt: resolvedAt.toISOString() });
}

vi.mock('../ingest/db', () => ({
  getCachedLumaApiIdEntry: vi.fn(async (key: string) => cacheStore.get(key)),
  setCachedLumaApiId: vi.fn(async (key: string, apiId: string | null) => {
    cacheStore.set(key, { apiId, resolvedAt: new Date().toISOString() });
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
  findDuplicateByNameAndDate,
  normalizeNameForDuplicateCheck,
  nameTokens,
  jaccardSimilarity,
  fuzzyMatch,
  matchAgainstSheetAndCandidates,
  STALE_NEGATIVE_CACHE_MS,
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

  it('never re-fetches a FRESH confirmed miss (cached null, recently resolved) — only a never-looked-up (undefined) slug burns a lookup (MEDIUM item 7)', async () => {
    const { fetchLumaEvent } = await import('../luma-server');
    // Pre-seed the cache with a confirmed miss for this slug, resolved just now.
    setMiss('luma:no-such-slug', new Date());
    const index = await buildSheetLinkIndex([{ id: 'evt-3', link: 'https://luma.com/no-such-slug' }]);
    expect(fetchLumaEvent).not.toHaveBeenCalled();
    // Still matches by its own raw key even with no resolved alt key.
    expect(findSheetMatchByLink(index, { link: 'https://luma.com/no-such-slug' })?.id).toBe('evt-3');
  });

  describe('stale negative cache (Part A item 1 — 2026-10-16 incident)', () => {
    it('re-resolves a cached miss older than the staleness window instead of trusting it forever', async () => {
      const { fetchLumaEvent } = await import('../luma-server');
      // A buggy script wrote this "no api id" row long ago; it should no
      // longer be trusted, so the short link (which DOES resolve, per the
      // `fetchLumaEvent` mock) re-resolves and finds the duplicate.
      const staleAt = new Date(Date.now() - (STALE_NEGATIVE_CACHE_MS + 60_000));
      setMiss('luma:ethcc-mixer', staleAt);
      const index = await buildSheetLinkIndex([{ id: 'evt-6', link: 'https://luma.com/ethcc-mixer' }]);
      expect(fetchLumaEvent).toHaveBeenCalledTimes(1);
      expect(findSheetMatchByLink(index, { link: 'https://luma.com/event/evt-ABC123DEF456' })?.id).toBe('evt-6');
    });

    it('still trusts a cached miss just inside the staleness window', async () => {
      const { fetchLumaEvent } = await import('../luma-server');
      const almostStaleAt = new Date(Date.now() - (STALE_NEGATIVE_CACHE_MS - 60_000));
      setMiss('luma:ethcc-mixer', almostStaleAt);
      const index = await buildSheetLinkIndex([{ id: 'evt-7', link: 'https://luma.com/ethcc-mixer' }]);
      expect(fetchLumaEvent).not.toHaveBeenCalled();
      expect(findSheetMatchByLink(index, { link: 'https://luma.com/event/evt-ABC123DEF456' })).toBeNull();
    });

    it('leaves a stale miss uncached (not re-written as a fresh miss) when the run is out of resolution budget, so a later run retries it', async () => {
      const { fetchLumaEvent } = await import('../luma-server');
      const { setCachedLumaApiId } = await import('../ingest/db');
      const staleAt = new Date(Date.now() - (STALE_NEGATIVE_CACHE_MS + 60_000));
      setMiss('luma:ethcc-mixer', staleAt);
      const index = await buildSheetLinkIndex([{ id: 'evt-8', link: 'https://luma.com/ethcc-mixer' }], { maxResolutions: 0 });
      expect(fetchLumaEvent).not.toHaveBeenCalled();
      expect(setCachedLumaApiId).not.toHaveBeenCalled();
      // Treated conservatively: no resolved alt key, so a link-only check
      // would miss it — this is exactly why the name+date fallback exists.
      expect(findSheetMatchByLink(index, { link: 'https://luma.com/event/evt-ABC123DEF456' })).toBeNull();
    });
  });

  it('uses an injected resolveSlug instead of the default fetchLumaEvent path, so a caller can share its own rate limiter (MEDIUM item 7)', async () => {
    const { fetchLumaEvent } = await import('../luma-server');
    const resolveSlug = vi.fn(async (slug: string) => (slug === 'ethcc-mixer' ? 'evt-INJECTED999' : null));
    const index = await buildSheetLinkIndex([{ id: 'evt-4', link: 'https://luma.com/ethcc-mixer' }], { resolveSlug });
    expect(resolveSlug).toHaveBeenCalledWith('ethcc-mixer');
    expect(fetchLumaEvent).not.toHaveBeenCalled();
    expect(findSheetMatchByLink(index, { link: 'https://luma.com/event/evt-INJECTED999' })?.id).toBe('evt-4');
  });

  it('respects maxResolutions: 0 by never resolving a slug (admin hot-path usage)', async () => {
    const { fetchLumaEvent } = await import('../luma-server');
    const index = await buildSheetLinkIndex([{ id: 'evt-5', link: 'https://luma.com/ethcc-mixer' }], { maxResolutions: 0 });
    expect(fetchLumaEvent).not.toHaveBeenCalled();
    // The raw key still matches; only the resolved alt key is unavailable.
    expect(findSheetMatchByLink(index, { link: 'https://luma.com/ethcc-mixer' })?.id).toBe('evt-5');
    expect(findSheetMatchByLink(index, { link: 'https://luma.com/event/evt-ABC123DEF456' })).toBeNull();
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

describe('matchAgainstSheetAndCandidates (Phase 3 §5.2, shared by discovery sources)', () => {
  const event = {
    link: 'https://lu.ma/discovered-mixer',
    name: 'ETH Builders Mixer',
    dateISO: '2026-03-10',
    startTime: '6:00 PM',
    address: '123 Main St',
    lat: 40,
    lng: -105,
  };

  it('matches by exact link against the sheet link index', () => {
    const linkIndex = { byKey: new Map([['luma:discovered-mixer', { id: 'evt-sheet-1', link: event.link }]]) };
    const result = matchAgainstSheetAndCandidates(event, { linkIndex, sheetEvents: [], otherCandidates: [] });
    expect(result.duplicateOf).toBe('evt-sheet-1');
    expect(result.possibleDuplicateOf).toBeNull();
  });

  it('falls back to a fuzzy match against the sheet when there is no link match', () => {
    const linkIndex = { byKey: new Map() };
    const sheetEvents = [{ ...event, id: 'evt-sheet-2', link: 'https://lu.ma/other-slug', name: 'ETH Builders Mixer 2026' }];
    const result = matchAgainstSheetAndCandidates(event, { linkIndex, sheetEvents, otherCandidates: [] });
    expect(result.duplicateOf).toBe('evt-sheet-2');
  });

  it('falls back to a fuzzy match against other in-flight candidates', () => {
    const linkIndex = { byKey: new Map() };
    const otherCandidates = [{ id: 'cand-1', canonical_key: 'luma:another-slug', event: { ...event, name: 'ETH Builders Mixer 2026', link: 'https://lu.ma/another-slug' } }];
    const result = matchAgainstSheetAndCandidates(event, { linkIndex, sheetEvents: [], otherCandidates });
    expect(result.duplicateOf).toBe('cand-1');
  });

  it('records a possible_duplicate (0.6-0.85 band alone) without setting duplicateOf', () => {
    const linkIndex = { byKey: new Map() };
    const sheetEvents = [
      { id: 'evt-sheet-3', link: 'https://lu.ma/other', name: 'ETH Builders Mixer Redux', dateISO: event.dateISO, startTime: '11:00 PM', address: 'Somewhere else', lat: 1, lng: 1 },
    ];
    const result = matchAgainstSheetAndCandidates(event, { linkIndex, sheetEvents, otherCandidates: [] });
    expect(result.duplicateOf).toBeNull();
    expect(result.possibleDuplicateOf).toBe('evt-sheet-3');
  });

  it('excludeCandidateId keeps a candidate from matching itself', () => {
    const linkIndex = { byKey: new Map() };
    const otherCandidates = [{ id: 'cand-self', canonical_key: 'luma:discovered-mixer', event }];
    const result = matchAgainstSheetAndCandidates(event, { linkIndex, sheetEvents: [], otherCandidates, excludeCandidateId: 'cand-self' });
    expect(result.duplicateOf).toBeNull();
  });

  it('returns both null when nothing matches', () => {
    const linkIndex = { byKey: new Map() };
    const result = matchAgainstSheetAndCandidates(event, { linkIndex, sheetEvents: [], otherCandidates: [] });
    expect(result.duplicateOf).toBeNull();
    expect(result.possibleDuplicateOf).toBeNull();
  });
});

describe('findDuplicateByNameAndDate (Part A item 2 — fallback dedupe guard)', () => {
  it('matches on normalized name + same date, independent of link', () => {
    const sheetEvents = [{ id: 'evt-curator-1', name: 'Devcon Builders Mixer', dateISO: '2026-11-16' }];
    const match = findDuplicateByNameAndDate({ name: 'Devcon Builders Mixer', dateISO: '2026-11-16' }, sheetEvents);
    expect(match?.id).toBe('evt-curator-1');
  });

  it('is case/punctuation/emoji insensitive', () => {
    const sheetEvents = [{ id: 'evt-curator-2', name: 'Devcon Builders Mixer 🎉', dateISO: '2026-11-16' }];
    const match = findDuplicateByNameAndDate({ name: '  DEVCON, builders--mixer!! ', dateISO: '2026-11-16' }, sheetEvents);
    expect(match?.id).toBe('evt-curator-2');
  });

  it('does not match the same name on a different date', () => {
    const sheetEvents = [{ id: 'evt-curator-3', name: 'Devcon Builders Mixer', dateISO: '2026-11-17' }];
    const match = findDuplicateByNameAndDate({ name: 'Devcon Builders Mixer', dateISO: '2026-11-16' }, sheetEvents);
    expect(match).toBeNull();
  });

  it('does not match a different name on the same date', () => {
    const sheetEvents = [{ id: 'evt-curator-4', name: 'Yoga and Mindfulness Retreat', dateISO: '2026-11-16' }];
    const match = findDuplicateByNameAndDate({ name: 'Devcon Builders Mixer', dateISO: '2026-11-16' }, sheetEvents);
    expect(match).toBeNull();
  });

  it('returns null when the sheet is empty', () => {
    expect(findDuplicateByNameAndDate({ name: 'Devcon Builders Mixer', dateISO: '2026-11-16' }, [])).toBeNull();
  });

  it('reproduces the Devcon 8 / Breakpoint incident: a short-link row and a pipeline evt- row with the same name+date are caught even though their links differ entirely', () => {
    // The curator's hand-added short-link row — exactly the shape that hid
    // behind the stale `ingest_link_cache` miss in the 2026-10-16 incident.
    const sheetEvents = [{ id: 'evt-curator-5', name: 'Devcon 8 Welcome Reception', dateISO: '2026-11-16' }];
    // The pipeline's candidate, about to be inserted with the canonical
    // /event/evt-… link — the link-index check alone would miss this if
    // the short link's cache entry was a bad miss.
    const candidate = { name: 'Devcon 8 Welcome Reception', dateISO: '2026-11-16' };
    expect(findDuplicateByNameAndDate(candidate, sheetEvents)?.id).toBe('evt-curator-5');
  });
});

describe('normalizeNameForDuplicateCheck', () => {
  it('lowercases, strips punctuation/emoji and collapses whitespace', () => {
    expect(normalizeNameForDuplicateCheck('  Devcon 8 — Welcome Reception!! 🎉 ')).toBe('devcon 8 welcome reception');
  });
});
