// Pipeline-level tests for the two new discovery source kinds added by
// this PR: `mira_series` and `sheet_tracker`. Same black-box approach as
// `ingest-pipeline-phase4.test.ts` (which this largely mirrors) — exercise
// `runSource` end-to-end with `processDiscoveredLink` mocked, so the REAL
// `processMiraSource`/`processSheetTrackerSource` -> `runDiscoveredLinksBatch`
// wiring in `pipeline.ts` is what's under test.
import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.OPENAI_API_KEY = 'test-key';
vi.mock('openai', () => ({ default: class FakeOpenAI {} }));

interface FakeRunRow {
  id: string;
  status: string;
  counts?: Record<string, number>;
  llm_input_tokens?: number;
  llm_output_tokens?: number;
  est_cost_usd?: number;
  error?: string | null;
}

let runRows: FakeRunRow[];
let sourceRows: Map<string, { id: string; conference: string; kind: string; label: string; config: Record<string, unknown>; trust: string; enabled: boolean; cursor: Record<string, unknown> }>;
let upsertedCandidates: Record<string, unknown>[];

const defaultProfile = {
  conference: 'Test Conf',
  theme_key: 'crypto',
  theme_description: 'Crypto stuff',
  include_keywords: [],
  exclude_keywords: [],
  trusted_hosts: [],
  blocked_hosts: [],
  publish_threshold: 85,
  review_threshold: 40,
  auto_publish_enabled: false,
  radius_km: 40,
  window_pre_days: 3,
  window_post_days: 1,
  allow_online: true,
  max_llm_calls_per_run: 150,
  max_publish_per_run: 25,
  enabled: true,
  auto_publish_killed_at: null as string | null,
  auto_publish_kill_reason: null as string | null,
  auto_publish_enabled_at: null as string | null,
};

vi.mock('../ingest/budget', () => ({
  checkMonthlyBudget: vi.fn(async () => ({ spentUsd: 0, capUsd: 20, exceeded: false })),
  checkMonthlyXBudget: vi.fn(async () => ({ spentUsd: 0, capUsd: 15, exceeded: false })),
}));

const listRecentCandidatesForDedupeMock = vi.fn(async (..._args: unknown[]) => [] as { id: string; canonical_key: string; event: unknown }[]);
// Review finding, HIGH item A: the FULL conference-wide known-key set
// (canonical_key + alt_keys, every status) `runDiscoveredLinksBatch`'s
// unseen-first ordering now actually relies on. Controllable per test so
// production-shaped scenarios (a short-link canonical key resolved to its
// stable `evt-…` form, with the short slug recorded ONLY in `alt_keys`)
// can be modeled directly.
const listAllCandidateKeysForConferenceMock = vi.fn(async (..._args: unknown[]) => new Set<string>());

vi.mock('../ingest/db', () => ({
  getSource: vi.fn(async (id: string) => sourceRows.get(id) ?? null),
  getProfile: vi.fn(async () => defaultProfile),
  getCandidateByKey: vi.fn(async () => null),
  getCandidateByKeyOrAltKey: vi.fn(async () => null),
  upsertCandidate: vi.fn(async (row: Record<string, unknown>) => {
    upsertedCandidates.push(row);
    return row;
  }),
  updateCandidate: vi.fn(async () => {}),
  listRecentCandidatesForDedupe: (...a: unknown[]) => listRecentCandidatesForDedupeMock(...a),
  listAllCandidateKeysForConference: (...a: unknown[]) => listAllCandidateKeysForConferenceMock(...a),
  createRun: vi.fn(async () => {
    const run: FakeRunRow = { id: `run-${runRows.length + 1}`, status: 'running' };
    runRows.push(run);
    return run;
  }),
  finishRun: vi.fn(async (id: string, patch: Partial<FakeRunRow>) => {
    const run = runRows.find((r) => r.id === id);
    if (run) Object.assign(run, patch);
  }),
  hasRecentRunningRun: vi.fn(async () => false),
  updateSource: vi.fn(async (id: string, patch: Record<string, unknown>) => {
    const row = sourceRows.get(id);
    if (row) Object.assign(row, patch);
  }),
  profileRowToThemeProfile: vi.fn((row: typeof defaultProfile) => ({
    themeKey: row.theme_key,
    themeName: 'Crypto / Web3',
    themeDescription: row.theme_description,
    includeKeywords: row.include_keywords,
    excludeKeywords: row.exclude_keywords,
    publishThreshold: row.publish_threshold,
    reviewThreshold: row.review_threshold,
  })),
  getIngestSupabase: vi.fn(() => ({
    from: () => ({
      select: () => ({
        is: () => Promise.resolve({ data: [] }),
        eq: () => Promise.resolve({ data: [], error: null }),
      }),
    }),
  })),
  listLabelsForFewShot: vi.fn(async () => []),
  listLabelsForHostSignals: vi.fn(async () => []),
  getRecentAutoPublishOutcomes: vi.fn(async () => []),
  getPrecisionRows: vi.fn(async () => []),
  upsertProfile: vi.fn(async () => ({})),
  updateProfilePatch: vi.fn(async () => ({})),
}));

vi.mock('../get-conferences', () => ({
  getAllConferenceTabs: vi.fn(async () => [
    {
      gid: 1,
      name: 'Test Conf',
      slug: 'test-conf',
      timezone: 'UTC',
      dates: ['2027-03-10', '2027-03-11'],
      center: { lat: 43.5528, lng: 7.0174 },
    },
  ]),
}));

vi.mock('../fetch-events', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../fetch-events')>();
  return {
    fetchEvents: vi.fn(async () => []),
    generateEventId: actual.generateEventId,
  };
});

vi.mock('../google-sheets', () => ({
  getSheetTitle: vi.fn(async () => 'Test Sheet Tab'),
  insertEventRowSorted: vi.fn(async () => 1),
}));

vi.mock('../fetch-events-cached', () => ({
  invalidateEventsCache: vi.fn(),
}));

vi.mock('../ingest/reconcile', () => ({
  reconcileConference: vi.fn(async () => ({ checked: 0, linked: 0, unpublishedExternal: 0, skipped: true })),
}));

/** Controllable from a test, read by the mocked `LumaEnrichmentLimiter`
 *  below so `runDiscoveredLinksBatch`'s "stop once exhausted" check (review
 *  finding, HIGH item 1) can be exercised through the real `runSource`
 *  black-box path, without needing to export that internal helper. */
let enrichLimiterExhausted = false;
vi.mock('../ingest/enrich', () => ({
  makeSlugResolver: () => async () => undefined,
  LumaEnrichmentLimiter: class {
    get exhausted() {
      return enrichLimiterExhausted;
    }
    async enrich() {
      return null;
    }
    async enrichResult() {
      return { status: 'unavailable' as const };
    }
  },
  HourlyWindowLumaLimiter: class {
    exhausted = false;
    async enrich() {
      return null;
    }
    async enrichResult() {
      return { status: 'unavailable' as const };
    }
  },
}));

let processDiscoveredLinkCalls: { url: string; sourceKind: string; sourceRef: string | null }[];
const processDiscoveredLinkMock = vi.fn(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async (url: string, _existing: unknown, ctx: { conference: string; sourceKind: string; sourceRef: string | null }, _hints?: unknown) => {
    processDiscoveredLinkCalls.push({ url, sourceKind: ctx.sourceKind, sourceRef: ctx.sourceRef });
    return {
      kind: 'row' as const,
      row: {
        conference: ctx.conference,
        canonical_key: url,
        alt_keys: [],
        source_id: null,
        source_kind: ctx.sourceKind,
        sources: [],
        source_ref: ctx.sourceRef,
        event: { name: url, link: url, dateISO: '2027-03-10' },
        content_hash: `h-${url}`,
        status: 'queued' as const,
      },
      classified: true,
      inputTokens: 10,
      outputTokens: 5,
      costUsd: 0.01,
    };
  }
);
vi.mock('../ingest/discover', () => ({
  sourceDateWindowPrefilter: () => null,
  processDiscoveredLink: (...args: unknown[]) => (processDiscoveredLinkMock as (...a: unknown[]) => unknown)(...args),
  PacedLinkLimiter: class PacedLinkLimiter {},
  buildHostSignalComputer: vi.fn(() => () => ({ isTrustedHost: false, isBlockedHost: false })),
}));

const fetchMiraSeriesEventsMock = vi.fn();
vi.mock('../ingest/sources/mira', () => ({
  fetchMiraSeriesEvents: (...a: unknown[]) => fetchMiraSeriesEventsMock(...a),
  buildMiraHintsByUrl: (events: { website: string | null; name: string; startDate: string | null; endDate: string | null }[]) =>
    new Map(events.filter((e) => e.website).map((e) => [e.website as string, { name: e.name, startDate: e.startDate, endDate: e.endDate }])),
}));

const fetchSheetTrackerLinksMock = vi.fn();
vi.mock('../ingest/sources/sheet-tracker', () => ({
  fetchSheetTrackerLinks: (...a: unknown[]) => fetchSheetTrackerLinksMock(...a),
}));

import { runSource } from '../ingest/pipeline';

function makeMiraSource(seriesSlug = 'Devcon8SideEvents2026') {
  sourceRows.set('src-mira', {
    id: 'src-mira',
    conference: 'Test Conf',
    kind: 'mira_series',
    label: seriesSlug,
    config: { series_slug: seriesSlug },
    trust: 'discovery',
    enabled: true,
    cursor: {},
  });
}

function makeSheetTrackerSource(sheetId = '1MDHdcFf69FEk_Zm48mJmYjzgrePxxpptMyY7MlzMBgg', gid?: number) {
  sourceRows.set('src-sheet', {
    id: 'src-sheet',
    conference: 'Test Conf',
    kind: 'sheet_tracker',
    label: 'Build3 tracker',
    config: { sheet_id: sheetId, ...(gid !== undefined ? { gid } : {}) },
    trust: 'discovery',
    enabled: true,
    cursor: {},
  });
}

beforeEach(() => {
  runRows = [];
  sourceRows = new Map();
  upsertedCandidates = [];
  processDiscoveredLinkCalls = [];
  processDiscoveredLinkMock.mockClear();
  fetchMiraSeriesEventsMock.mockReset();
  fetchSheetTrackerLinksMock.mockReset();
  listRecentCandidatesForDedupeMock.mockReset().mockResolvedValue([]);
  listAllCandidateKeysForConferenceMock.mockReset().mockResolvedValue(new Set());
  enrichLimiterExhausted = false;
});

describe('runSource(mira_series)', () => {
  it('feeds each event\'s allowlisted website link through processDiscoveredLink, tagged with the series page as sourceRef', async () => {
    makeMiraSource();
    fetchMiraSeriesEventsMock.mockResolvedValue([
      { id: 'rec1', name: 'Hacker House', startDate: '2026-11-01', endDate: null, city: 'London', website: 'https://luma.com/hacker-house', tags: 'Hacking', seriesSlug: 'Devcon8SideEvents2026' },
      { id: 'rec2', name: 'Panel Discussion', startDate: '2026-11-02', endDate: null, city: 'London', website: 'https://fintech.global/not-allowlisted', tags: 'Panel', seriesSlug: 'Devcon8SideEvents2026' },
      { id: 'rec3', name: 'No link event', startDate: '2026-11-03', endDate: null, city: 'London', website: null, tags: null, seriesSlug: 'Devcon8SideEvents2026' },
    ]);

    const result = await runSource('src-mira', { trigger: 'manual' });
    expect(result.status).toBe('ok');
    expect(result.counts.fetched).toBe(3);
    // Only the allowlisted lu.ma link is ever handed to processDiscoveredLink.
    expect(processDiscoveredLinkCalls).toHaveLength(1);
    expect(processDiscoveredLinkCalls[0].url).toBe('https://luma.com/hacker-house');
    expect(processDiscoveredLinkCalls[0].sourceKind).toBe('mira_series');
    expect(processDiscoveredLinkCalls[0].sourceRef).toBe('https://miragather.com/Devcon8SideEvents2026');
    expect(upsertedCandidates).toHaveLength(1);
  });

  it('passes each link\'s Mira name/dates to processDiscoveredLink as hints (pre-enrichment window check)', async () => {
    makeMiraSource('Breakpoint2026SideEvents2026');
    fetchMiraSeriesEventsMock.mockResolvedValue([
      { id: 'r1', name: 'Scale or Die', startDate: '2026-11-14T09:30:00.000Z', endDate: '2026-11-14T18:30:00.000Z', city: 'London', website: 'https://lu.ma/scale-or-die-26', tags: null, seriesSlug: 'Breakpoint2026SideEvents2026' },
    ]);
    await runSource('src-mira', { trigger: 'manual' });
    expect(processDiscoveredLinkMock).toHaveBeenCalledTimes(1);
    expect(processDiscoveredLinkMock.mock.calls[0][3]).toEqual({
      name: 'Scale or Die',
      startDate: '2026-11-14T09:30:00.000Z',
      endDate: '2026-11-14T18:30:00.000Z',
    });
  });

  it('a "deferred" outcome (Luma 429) writes nothing and is counted as deferred, not as an error', async () => {
    makeMiraSource();
    fetchMiraSeriesEventsMock.mockResolvedValue([
      { id: 'r1', name: 'X', startDate: '2026-11-01', endDate: null, city: 'London', website: 'https://lu.ma/rate-limited', tags: null, seriesSlug: 'Devcon8SideEvents2026' },
    ]);
    processDiscoveredLinkMock.mockImplementationOnce((async () => ({ kind: 'deferred', reason: 'Luma returned 429.' })) as never);
    const result = await runSource('src-mira', { trigger: 'manual' });
    expect(result.counts.deferred).toBe(1);
    expect(result.counts.errors ?? 0).toBe(0);
    expect(upsertedCandidates).toHaveLength(0);
  });

  it('skips the discovery-context build entirely when nothing is allowlisted (no DB/network round trips wasted)', async () => {
    makeMiraSource();
    fetchMiraSeriesEventsMock.mockResolvedValue([
      { id: 'rec1', name: 'Off-platform event', startDate: '2026-11-01', endDate: null, city: 'London', website: 'https://example.com/rsvp', tags: null, seriesSlug: 'Devcon8SideEvents2026' },
    ]);

    const result = await runSource('src-mira', { trigger: 'manual' });

    expect(result.status).toBe('ok');
    expect(processDiscoveredLinkCalls).toHaveLength(0);
  });
});

describe('runSource(sheet_tracker)', () => {
  it('feeds every extracted allowlisted link through processDiscoveredLink, tagged with the sheet page as sourceRef', async () => {
    makeSheetTrackerSource();
    fetchSheetTrackerLinksMock.mockResolvedValue(['https://luma.com/bittensor-hh', 'https://luma.com/ijy8hzbj']);

    const result = await runSource('src-sheet', { trigger: 'manual' });

    expect(result.status).toBe('ok');
    expect(result.counts.fetched).toBe(2);
    expect(fetchSheetTrackerLinksMock).toHaveBeenCalledWith('1MDHdcFf69FEk_Zm48mJmYjzgrePxxpptMyY7MlzMBgg', 0);
    expect(processDiscoveredLinkCalls).toHaveLength(2);
    expect(processDiscoveredLinkCalls.every((c) => c.sourceKind === 'sheet_tracker')).toBe(true);
    expect(processDiscoveredLinkCalls[0].sourceRef).toBe(
      'https://docs.google.com/spreadsheets/d/1MDHdcFf69FEk_Zm48mJmYjzgrePxxpptMyY7MlzMBgg/htmlview/sheet?gid=0'
    );
  });

  it('passes through a configured non-zero gid', async () => {
    makeSheetTrackerSource('1MDHdcFf69FEk_Zm48mJmYjzgrePxxpptMyY7MlzMBgg', 101);
    fetchSheetTrackerLinksMock.mockResolvedValue([]);

    await runSource('src-sheet', { trigger: 'manual' });

    expect(fetchSheetTrackerLinksMock).toHaveBeenCalledWith('1MDHdcFf69FEk_Zm48mJmYjzgrePxxpptMyY7MlzMBgg', 101);
  });

  it('a dry run never writes a candidate but still returns a preview', async () => {
    makeSheetTrackerSource();
    fetchSheetTrackerLinksMock.mockResolvedValue(['https://luma.com/bittensor-hh']);

    const result = await runSource('src-sheet', { trigger: 'manual', dryRun: true });

    expect(result.status).toBe('ok');
    expect(upsertedCandidates).toHaveLength(0);
    expect(result.previews).toHaveLength(1);
    expect(result.previews?.[0].canonical_key).toBe('https://luma.com/bittensor-hh');
  });
});

// Review finding, HIGH ("exhausting the Luma limiter poisons
// ingest_link_cache"): once the shared Luma limiter is exhausted,
// `runDiscoveredLinksBatch` must stop rather than keep handing links to
// `processDiscoveredLink` (which would otherwise write bogus `status:
// 'error'` rows for links it never actually got a fair shot at).
describe('runSource(mira_series / sheet_tracker): stops once the Luma enrichment limiter is exhausted', () => {
  it('mira_series: stops after the first link once the limiter reports exhausted, marking the run partial', async () => {
    makeMiraSource();
    fetchMiraSeriesEventsMock.mockResolvedValue([
      { id: 'rec1', name: 'First', startDate: '2026-11-01', endDate: null, city: 'London', website: 'https://luma.com/first', tags: null, seriesSlug: 'Devcon8SideEvents2026' },
      { id: 'rec2', name: 'Second', startDate: '2026-11-02', endDate: null, city: 'London', website: 'https://luma.com/second', tags: null, seriesSlug: 'Devcon8SideEvents2026' },
      { id: 'rec3', name: 'Third', startDate: '2026-11-03', endDate: null, city: 'London', website: 'https://luma.com/third', tags: null, seriesSlug: 'Devcon8SideEvents2026' },
    ]);
    // Exhausted from the very start — nothing should even be attempted.
    enrichLimiterExhausted = true;

    const result = await runSource('src-mira', { trigger: 'manual' });

    expect(processDiscoveredLinkCalls).toHaveLength(0);
    expect(result.status).toBe('partial');
  });

  it('mira_series: stops mid-batch, after the link that tips the limiter over, not before it', async () => {
    makeMiraSource();
    fetchMiraSeriesEventsMock.mockResolvedValue([
      { id: 'rec1', name: 'First', startDate: '2026-11-01', endDate: null, city: 'London', website: 'https://luma.com/first', tags: null, seriesSlug: 'Devcon8SideEvents2026' },
      { id: 'rec2', name: 'Second', startDate: '2026-11-02', endDate: null, city: 'London', website: 'https://luma.com/second', tags: null, seriesSlug: 'Devcon8SideEvents2026' },
      { id: 'rec3', name: 'Third', startDate: '2026-11-03', endDate: null, city: 'London', website: 'https://luma.com/third', tags: null, seriesSlug: 'Devcon8SideEvents2026' },
    ]);
    // Becomes exhausted only after the first link has been processed.
    enrichLimiterExhausted = false;
    processDiscoveredLinkMock.mockImplementationOnce(async (url, _existing, ctx) => {
      processDiscoveredLinkCalls.push({ url, sourceKind: ctx.sourceKind, sourceRef: ctx.sourceRef });
      enrichLimiterExhausted = true;
      return {
        kind: 'row',
        row: { conference: ctx.conference, canonical_key: url, alt_keys: [], source_id: null, source_kind: ctx.sourceKind, sources: [], source_ref: ctx.sourceRef, event: { name: url, link: url, dateISO: '2027-03-10' }, content_hash: `h-${url}`, status: 'queued' },
        classified: true,
        inputTokens: 1,
        outputTokens: 1,
        costUsd: 0.001,
      };
    });

    const result = await runSource('src-mira', { trigger: 'manual' });

    expect(processDiscoveredLinkCalls).toHaveLength(1);
    expect(result.status).toBe('partial');
  });

  it('sheet_tracker: stops once exhausted too (same shared runDiscoveredLinksBatch code path)', async () => {
    makeSheetTrackerSource();
    fetchSheetTrackerLinksMock.mockResolvedValue(['https://luma.com/a', 'https://luma.com/b']);
    enrichLimiterExhausted = true;

    const result = await runSource('src-sheet', { trigger: 'manual' });

    expect(processDiscoveredLinkCalls).toHaveLength(0);
    expect(result.status).toBe('partial');
  });
});

// Review finding, HIGH ("...so the same top links don't starve the tail
// every run"): links not already known as a candidate for this conference
// are tried BEFORE ones that are, so a big source's budget isn't
// re-spent re-enriching the same already-seen links at the front of the
// list every single run.
describe('runSource(mira_series): orders unseen links before already-known ones', () => {
  it('processes an unseen link before one that is already a known candidate, even though the known one appears first in the source list', async () => {
    makeMiraSource();
    // "https://luma.com/already-known" normalizes to canonical key
    // "luma:already-known" — seed otherCandidates with exactly that, so
    // the OTHER link ("brand-new") is the one treated as unseen.
    listRecentCandidatesForDedupeMock.mockResolvedValue([
      { id: 'cand-1', canonical_key: 'luma:already-known', event: { name: 'Old' } },
    ]);
    fetchMiraSeriesEventsMock.mockResolvedValue([
      { id: 'rec1', name: 'Already known', startDate: '2026-11-01', endDate: null, city: 'London', website: 'https://luma.com/already-known', tags: null, seriesSlug: 'Devcon8SideEvents2026' },
      { id: 'rec2', name: 'Brand new', startDate: '2026-11-02', endDate: null, city: 'London', website: 'https://luma.com/brand-new', tags: null, seriesSlug: 'Devcon8SideEvents2026' },
    ]);

    await runSource('src-mira', { trigger: 'manual' });

    expect(processDiscoveredLinkCalls.map((c) => c.url)).toEqual(['https://luma.com/brand-new', 'https://luma.com/already-known']);
  });
});

// Review finding, MEDIUM ("a dedicated, larger budget for these big-list
// sources, with a per-run cap on links"): a source that returns more links
// than one run should attempt is truncated, not processed in full.
describe('runSource(mira_series / sheet_tracker): per-run link cap for big-list sources', () => {
  it('mira_series: truncates to the per-run cap, keeping unseen links over already-known ones', async () => {
    makeMiraSource();
    // One already-known link, plus more unseen links than the cap allows.
    listRecentCandidatesForDedupeMock.mockResolvedValue([
      { id: 'cand-1', canonical_key: 'luma:already-known', event: { name: 'Old' } },
    ]);
    const unseenCount = 160; // above BIG_LIST_SOURCE_MAX_LINKS_PER_RUN (150)
    const events = Array.from({ length: unseenCount }, (_, i) => ({
      id: `rec${i}`,
      name: `Event ${i}`,
      startDate: '2026-11-01',
      endDate: null,
      city: 'London',
      website: `https://luma.com/unseen-${i}`,
      tags: null,
      seriesSlug: 'Devcon8SideEvents2026',
    }));
    events.push({ id: 'recKnown', name: 'Already known', startDate: '2026-11-01', endDate: null, city: 'London', website: 'https://luma.com/already-known', tags: null, seriesSlug: 'Devcon8SideEvents2026' });
    fetchMiraSeriesEventsMock.mockResolvedValue(events);

    await runSource('src-mira', { trigger: 'manual' });

    expect(processDiscoveredLinkCalls.length).toBe(150);
    // The cap truncates from the END of the unseen-first-ordered list, so
    // the already-known link (sorted last) never gets a turn, and every
    // processed link is one of the unseen ones.
    expect(processDiscoveredLinkCalls.some((c) => c.url === 'https://luma.com/already-known')).toBe(false);
  });
});

// Re-review (production-shaped data): a real Luma candidate for a short
// link is keyed by its STABLE `luma:evt-…` canonical_key, with the short
// slug recorded ONLY in `alt_keys` — never as its own canonical_key. The
// in-run dedupe pool (`otherCandidates`/`listRecentCandidatesForDedupe`)
// drops `alt_keys` entirely and excludes final/rejected candidates, so it
// can NEVER recognize a short link as "already known" — before this fix,
// that meant almost every short link counted as "unseen" every run, and
// `.slice(0, maxLinksPerRun)` kept the SAME first `maxLinksPerRun` links
// (in the source's own stable order) forever; anything past that index
// was never tried, no matter how many runs passed.
describe('runSource(mira_series): unseen-first ordering against PRODUCTION-SHAPED known keys (alt_keys, not canonical_key)', () => {
  function makeLinks(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      id: `rec${i}`,
      name: `Event ${i}`,
      startDate: '2026-11-01',
      endDate: null,
      city: 'London',
      website: `https://luma.com/link-${i}`,
      tags: null,
      seriesSlug: 'Devcon8SideEvents2026',
    }));
  }

  it('300 links, the first 150 already known ONLY via alt_keys (resolved to a luma:evt-… canonical key, never as their own canonical_key) — processes links 151-300, not 1-150 again', async () => {
    makeMiraSource();
    // Production shape: each of links 0..149's short-slug key
    // ("luma:link-0" .. "luma:link-149") is a known ALT key on some
    // OTHER candidate row keyed "luma:evt-…" — never its own
    // canonical_key. `otherCandidates`/the dedupe pool (which only ever
    // maps `canonical_key`) is left completely empty on purpose, so this
    // test can only pass if the ordering logic consults the real
        // alt-keys-aware known-key set.
    listRecentCandidatesForDedupeMock.mockResolvedValue([]);
    const knownAltKeys = new Set(Array.from({ length: 150 }, (_, i) => `luma:link-${i}`));
    listAllCandidateKeysForConferenceMock.mockResolvedValue(knownAltKeys);
    fetchMiraSeriesEventsMock.mockResolvedValue(makeLinks(300));

    const result = await runSource('src-mira', { trigger: 'manual' });

    expect(result.counts.fetched).toBe(300);
    expect(processDiscoveredLinkCalls).toHaveLength(150);
    const processedUrls = new Set(processDiscoveredLinkCalls.map((c) => c.url));
    for (let i = 0; i < 150; i++) expect(processedUrls.has(`https://luma.com/link-${i}`)).toBe(false);
    for (let i = 150; i < 300; i++) expect(processedUrls.has(`https://luma.com/link-${i}`)).toBe(true);
  });

  it('rotation for safety: once EVERY link is known, successive runs still cycle through different slices instead of the same front-of-list 150 winning forever', async () => {
    makeMiraSource();
    listRecentCandidatesForDedupeMock.mockResolvedValue([]);
    // Steady state: all 300 are already known (e.g. every one has long
    // since been ingested under its evt- canonical key).
    const allKnown = new Set(Array.from({ length: 300 }, (_, i) => `luma:link-${i}`));
    listAllCandidateKeysForConferenceMock.mockResolvedValue(allKnown);
    fetchMiraSeriesEventsMock.mockResolvedValue(makeLinks(300));

    await runSource('src-mira', { trigger: 'manual' });
    const firstRunUrls = processDiscoveredLinkCalls.map((c) => c.url);
    expect(firstRunUrls).toHaveLength(150);
    // Without rotation, every run would process exactly links 0-149 again.
    expect(firstRunUrls[0]).toBe('https://luma.com/link-0');
    // The offset cursor advanced past this run's slice, persisted on the
    // source row for the NEXT run to pick up.
    expect(sourceRows.get('src-mira')?.cursor.link_offset).toBeGreaterThan(0);

    processDiscoveredLinkCalls.length = 0; // reset the shared call log for the second run.
    await runSource('src-mira', { trigger: 'manual' });
    const secondRunUrls = processDiscoveredLinkCalls.map((c) => c.url);
    expect(secondRunUrls).toHaveLength(150);

    // The persisted `cursor.link_offset` rotated which 150-slice got a
    // turn — the second run's slice is NOT identical to the first's.
    expect(secondRunUrls).not.toEqual(firstRunUrls);
  });
});
