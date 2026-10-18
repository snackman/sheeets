// Pipeline-level tests for the Phase 4 source processors (X, Meetup,
// sponsor pages) — added per re-review item 1 (HIGH): "LLM cost from the
// X, Meetup and sponsor-pages runs is thrown away." These exercise
// `runSource` end-to-end (same black-box approach as `ingest-pipeline.test.ts`
// uses for the Luma path), mocking `processDiscoveredLink` directly so the
// REAL `runDiscoveredLinksBatch`/`canClassify` wiring inside `pipeline.ts`
// is what's under test — not a re-implementation of the classifier.
import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.OPENAI_API_KEY = 'test-key';
vi.mock('openai', () => ({ default: class FakeOpenAI {} }));

interface FakeRunRow {
  id: string;
  status: string;
  counts?: unknown;
  llm_input_tokens?: number;
  llm_output_tokens?: number;
  est_cost_usd?: number;
  x_posts_read?: number;
  x_cost_usd?: number;
  error?: string | null;
}

let runRows: FakeRunRow[];
let sourceRows: Map<string, { id: string; conference: string; kind: string; label: string; config: Record<string, unknown>; trust: string; enabled: boolean; cursor: Record<string, unknown> }>;
let updateSourceCalls: { id: string; patch: Record<string, unknown> }[];
let recordRunXCostCalls: { runId: string; usage: { xPostsRead: number; xCostUsd: number } }[];

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

const checkMonthlyBudgetMock = vi.fn(async () => ({ spentUsd: 0, capUsd: 20, exceeded: false }));
const checkMonthlyXBudgetMock = vi.fn(async () => ({ spentUsd: 0, capUsd: 15, exceeded: false }));
vi.mock('../ingest/budget', () => ({
  checkMonthlyBudget: () => checkMonthlyBudgetMock(),
  checkMonthlyXBudget: () => checkMonthlyXBudgetMock(),
}));

vi.mock('../ingest/db', () => ({
  getSource: vi.fn(async (id: string) => sourceRows.get(id) ?? null),
  getProfile: vi.fn(async () => defaultProfile),
  getCandidateByKey: vi.fn(async () => null),
  // `runDiscoveredLinksBatch` (X/Meetup/sponsor-pages) looks up its cheap
  // pre-check via the alt-keys-aware lookup now (Bug: "short Luma links
  // bypass dedupe") — `processDiscoveredLink` itself is mocked above, so
  // this just needs to exist and resolve "no existing candidate".
  getCandidateByKeyOrAltKey: vi.fn(async () => null),
  upsertCandidate: vi.fn(async (row: Record<string, unknown>) => row),
  updateCandidate: vi.fn(async () => {}),
  listRecentCandidatesForDedupe: vi.fn(async () => []),
  // Review finding, HIGH item A: `buildDiscoverySourceContext` now also
  // fetches the FULL conference-wide known-key set for the unseen-first
  // ordering fix — empty by default here, same as `otherCandidates`.
  listAllCandidateKeysForConference: vi.fn(async () => new Set<string>()),
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
    updateSourceCalls.push({ id, patch });
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
  recordRunXCost: vi.fn(async (runId: string, usage: { xPostsRead: number; xCostUsd: number }) => {
    recordRunXCostCalls.push({ runId, usage });
    const run = runRows.find((r) => r.id === runId);
    if (run) {
      run.x_posts_read = usage.xPostsRead;
      run.x_cost_usd = usage.xCostUsd;
    }
  }),
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

// A controllable `processDiscoveredLink` so these tests exercise the REAL
// `runDiscoveredLinksBatch`/`canClassify` budget wiring in `pipeline.ts`
// (re-review item 1) without needing the full classifier stack.
let processDiscoveredLinkCalls: { url: string; canClassify: boolean }[];
let costPerClassifiedCall = 5; // deliberately large so a small cap trips quickly
const processDiscoveredLinkMock = vi.fn(
  async (url: string, _existing: unknown, ctx: { canClassify: () => boolean; conference: string; sourceKind: string }) => {
    const canClassify = ctx.canClassify();
    processDiscoveredLinkCalls.push({ url, canClassify });
    if (!canClassify) {
      return {
        kind: 'row' as const,
        row: {
          conference: ctx.conference,
          canonical_key: url,
          alt_keys: [],
          source_id: null,
          source_kind: ctx.sourceKind,
          sources: [],
          source_ref: null,
          event: { name: url, link: url, dateISO: '2027-03-10' },
          content_hash: `h-${url}`,
          status: 'pending_classify' as const,
        },
        classified: false,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
      };
    }
    return {
      kind: 'row' as const,
      row: {
        conference: ctx.conference,
        canonical_key: url,
        alt_keys: [],
        source_id: null,
        source_kind: ctx.sourceKind,
        sources: [],
        source_ref: null,
        event: { name: url, link: url, dateISO: '2027-03-10' },
        content_hash: `h-${url}`,
        status: 'queued' as const,
      },
      classified: true,
      inputTokens: 100,
      outputTokens: 20,
      costUsd: costPerClassifiedCall,
    };
  }
);
vi.mock('../ingest/discover', () => ({
  sourceDateWindowPrefilter: () => null,
  processDiscoveredLink: (...args: unknown[]) => (processDiscoveredLinkMock as (...a: unknown[]) => unknown)(...args),
  PacedLinkLimiter: class PacedLinkLimiter {},
  buildHostSignalComputer: vi.fn(() => () => ({ isTrustedHost: false, isBlockedHost: false })),
}));

const fetchXUserPostsMock = vi.fn();
const isXConfiguredMock = vi.fn(() => true);
vi.mock('../ingest/sources/x', () => ({
  isXConfigured: () => isXConfiguredMock(),
  fetchXUserPosts: (...a: unknown[]) => fetchXUserPostsMock(...a),
  X_POST_READ_COST_USD: 0.005,
  MAX_RESULTS_PER_ACCOUNT_PER_RUN: 10,
  X_MAX_PAGES_PER_RUN: 3,
}));

const searchMeetupEventsMock = vi.fn();
const isMeetupConfiguredMock = vi.fn(() => true);
vi.mock('../ingest/sources/meetup', () => ({
  isMeetupConfigured: () => isMeetupConfiguredMock(),
  searchMeetupEvents: (...a: unknown[]) => searchMeetupEventsMock(...a),
}));

const resolveSponsorPageUrlsMock = vi.fn();
const fetchSponsorPageLinksMock = vi.fn();
vi.mock('../ingest/sources/sponsor-pages', () => ({
  resolveSponsorPageUrls: (...a: unknown[]) => resolveSponsorPageUrlsMock(...a),
  fetchSponsorPageLinks: (...a: unknown[]) => fetchSponsorPageLinksMock(...a),
  createRobotsCache: vi.fn(() => new Map()),
  SPONSOR_PAGE_WORST_CASE_MS: 16_500,
}));

// Re-review (this round): "persist LLM cost on a thrown batch ... for all
// sources including Telegram" - Telegram predates the X/Meetup/sponsor-
// pages helpers and has its own inline processDiscoveredLink loop, so it
// needs its own minimal mocks here to exercise that path too.
const fetchTelegramChannelHtmlMock = vi.fn(async () => '<html></html>');
const parseTelegramChannelHtmlMock = vi.fn(() => [] as { postRef: string; url: string; text: string; links: string[] }[]);
vi.mock('../ingest/sources/telegram', () => ({
  fetchTelegramChannelHtml: () => fetchTelegramChannelHtmlMock(),
  parseTelegramChannelHtml: () => parseTelegramChannelHtmlMock(),
  isValidTelegramHandle: () => true,
}));

/** Controllable from a test — review finding, HIGH item 1 ("exhausting
 *  the Luma limiter poisons ingest_link_cache", explicitly flagged against
 *  the Telegram path too since it has its own inline loop predating
 *  `runDiscoveredLinksBatch`). Default behavior (false/never-exhausted,
 *  real-ish `enrich`/`enrichResult`) matches the real `LumaEnrichmentLimiter`
 *  closely enough for every OTHER test in this file, which don't exercise
 *  exhaustion at all. */
let telegramEnrichLimiterExhausted = false;
vi.mock('../ingest/enrich', () => ({
  makeSlugResolver: () => async () => undefined,
  LumaEnrichmentLimiter: class {
    get exhausted() {
      return telegramEnrichLimiterExhausted;
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

import { runSource } from '../ingest/pipeline';

function makeXSource(cursor: Record<string, unknown> = {}) {
  sourceRows.set('src-x', {
    id: 'src-x',
    conference: 'Test Conf',
    kind: 'x_account',
    label: '@test',
    config: { handle: 'test', userId: 'uid-1' },
    trust: 'discovery',
    enabled: true,
    cursor,
  });
}

function makeMeetupSource() {
  sourceRows.set('src-meetup', {
    id: 'src-meetup',
    conference: 'Test Conf',
    kind: 'meetup_search',
    label: 'defi',
    config: { query: 'defi' },
    trust: 'discovery',
    enabled: true,
    cursor: {},
  });
}

function makeSponsorPagesSource(cursor: Record<string, unknown> = {}) {
  sourceRows.set('src-sponsor', {
    id: 'src-sponsor',
    conference: 'Test Conf',
    kind: 'sponsor_pages',
    label: 'sponsors',
    config: { urls: [] },
    trust: 'discovery',
    enabled: true,
    cursor,
  });
}

function makeTelegramSource() {
  sourceRows.set('src-telegram', {
    id: 'src-telegram',
    conference: 'Test Conf',
    kind: 'telegram_channel',
    label: '@testchannel',
    config: { handle: 'testchannel' },
    trust: 'discovery',
    enabled: true,
    cursor: {},
  });
}

function onePage(ids: string[], links: string[][], opts: { nextToken?: string | null } = {}) {
  return {
    posts: ids.map((id, i) => ({ id, text: '', links: links[i] ?? [] })),
    newestId: ids[0] ?? null,
    nextToken: opts.nextToken ?? null,
    resultCount: ids.length,
  };
}

beforeEach(() => {
  runRows = [];
  sourceRows = new Map();
  updateSourceCalls = [];
  recordRunXCostCalls = [];
  processDiscoveredLinkCalls = [];
  costPerClassifiedCall = 5;
  checkMonthlyBudgetMock.mockReset().mockResolvedValue({ spentUsd: 0, capUsd: 20, exceeded: false });
  checkMonthlyXBudgetMock.mockReset().mockResolvedValue({ spentUsd: 0, capUsd: 15, exceeded: false });
  processDiscoveredLinkMock.mockClear();
  fetchXUserPostsMock.mockReset();
  isXConfiguredMock.mockReset().mockReturnValue(true);
  searchMeetupEventsMock.mockReset();
  isMeetupConfiguredMock.mockReset().mockReturnValue(true);
  resolveSponsorPageUrlsMock.mockReset();
  fetchSponsorPageLinksMock.mockReset();
  telegramEnrichLimiterExhausted = false;
});

describe('runSource(x_account): cost accounting (re-review item 1, HIGH) and cursor/cost durability (item 2, MEDIUM)', () => {
  it('surfaces the REAL classified cost/tokens on the run row, not hardcoded 0 (HIGH item 1)', async () => {
    makeXSource();
    fetchXUserPostsMock.mockResolvedValueOnce(onePage(['p1', 'p2'], [['https://lu.ma/e1'], ['https://lu.ma/e2']]));

    const result = await runSource('src-x', { trigger: 'cron' });

    expect(result.status).toBe('ok');
    const run = runRows.find((r) => r.id === result.runId)!;
    // Both links classified at $5 each -> $10 total, 100/20 tokens each -> 200/40.
    expect(run.est_cost_usd).toBe(10);
    expect(run.llm_input_tokens).toBe(200);
    expect(run.llm_output_tokens).toBe(40);
  });

  it('the monthly LLM cap stops further classification mid-batch, and only classified calls count toward cost (HIGH item 1)', async () => {
    makeXSource();
    checkMonthlyBudgetMock.mockResolvedValue({ spentUsd: 0, capUsd: 8, exceeded: false }); // trips after 2 calls at $5
    fetchXUserPostsMock.mockResolvedValueOnce(
      onePage(['p1', 'p2', 'p3'], [['https://lu.ma/e1'], ['https://lu.ma/e2'], ['https://lu.ma/e3']])
    );

    const result = await runSource('src-x', { trigger: 'cron' });

    const run = runRows.find((r) => r.id === result.runId)!;
    expect(processDiscoveredLinkCalls).toHaveLength(3);
    expect(processDiscoveredLinkCalls.filter((c) => c.canClassify)).toHaveLength(2); // cap trips after 2
    expect(processDiscoveredLinkCalls[2].canClassify).toBe(false);
    expect(run.est_cost_usd).toBe(10); // only the 2 classified calls' cost
  });

  it('records X spend via recordRunXCost even when link processing throws afterward (MEDIUM item 2)', async () => {
    makeXSource();
    fetchXUserPostsMock.mockResolvedValueOnce(onePage(['p1', 'p2'], [['https://lu.ma/e1'], ['https://lu.ma/e2']]));
    processDiscoveredLinkMock.mockRejectedValueOnce(new Error('boom'));

    const result = await runSource('src-x', { trigger: 'cron' });

    expect(result.status).toBe('error');
    // The paid read (2 posts) still gets recorded, even though processing
    // the links it produced failed afterward.
    expect(recordRunXCostCalls).toHaveLength(1);
    expect(recordRunXCostCalls[0].usage).toEqual({ xPostsRead: 2, xCostUsd: 0.01 });
  });

  it('advances since_id to the first page\'s newestId once the batch is fully processed, not capped (MEDIUM item 2)', async () => {
    makeXSource({ since_id: 'old-cursor' });
    fetchXUserPostsMock.mockResolvedValueOnce(onePage(['p-newest', 'p-older'], [['https://lu.ma/e1'], []]));

    await runSource('src-x', { trigger: 'cron' });

    const cursorUpdate = updateSourceCalls.find((c) => c.id === 'src-x' && 'cursor' in c.patch);
    expect(cursorUpdate?.patch).toEqual({ cursor: { since_id: 'p-newest' } });
  });

  // Re-review (this round, HIGH: "the X cursor can get stuck") - a run
  // whose recent posts have no allowlisted links at all (the common case
  // - most posts aren't event links) must still advance, or the source
  // would re-read and re-bill the exact same window forever.
  it('a no-links run still advances the cursor (does not get stuck)', async () => {
    makeXSource({ since_id: 'old-cursor' });
    fetchXUserPostsMock.mockResolvedValueOnce(onePage(['p1', 'p2'], [[], []]));

    const result = await runSource('src-x', { trigger: 'cron' });

    expect(result.status).toBe('ok');
    expect(processDiscoveredLinkMock).not.toHaveBeenCalled();
    const cursorUpdate = updateSourceCalls.find((c) => c.id === 'src-x' && 'cursor' in c.patch);
    expect(cursorUpdate?.patch).toEqual({ cursor: { since_id: 'p1' } });
  });

  // Re-review (this round, HIGH): first run ever (no cursor at all) reads
  // exactly ONE page - no backfill through the account's whole history -
  // and still sets the cursor from it.
  it('the first run (no cursor yet) reads a single page and sets the cursor - no backfill', async () => {
    makeXSource(); // no cursor at all
    // A full page with a nextToken - if pagination continued, this would
    // page through the account's entire history. It must not.
    fetchXUserPostsMock.mockResolvedValueOnce(
      onePage(Array.from({ length: 10 }, (_, i) => `p-${i}`), [['https://lu.ma/e1']], { nextToken: 'more-history' })
    );

    await runSource('src-x', { trigger: 'cron' });

    expect(fetchXUserPostsMock).toHaveBeenCalledTimes(1); // no backfill pagination
    const cursorUpdate = updateSourceCalls.find((c) => c.id === 'src-x' && 'cursor' in c.patch);
    expect(cursorUpdate?.patch).toEqual({ cursor: { since_id: 'p-0' } });
  });

  // Re-review (this round, HIGH): "when capped: advance to the newest and
  // accept the gap" - simpler and bounded, replacing the previous round's
  // "freeze the cursor when capped" behavior.
  it('a capped run (3 full pages, more available) still advances the cursor', async () => {
    makeXSource({ since_id: 'old-cursor' });
    fetchXUserPostsMock
      .mockResolvedValueOnce(onePage(Array.from({ length: 10 }, (_, i) => `p1-${i}`), [], { nextToken: 't2' }))
      .mockResolvedValueOnce(onePage(Array.from({ length: 10 }, (_, i) => `p2-${i}`), [], { nextToken: 't3' }))
      .mockResolvedValueOnce(onePage(Array.from({ length: 10 }, (_, i) => `p3-${i}`), [], { nextToken: 't4' }));

    await runSource('src-x', { trigger: 'cron' });

    expect(fetchXUserPostsMock).toHaveBeenCalledTimes(3); // capped at X_MAX_PAGES_PER_RUN
    const cursorUpdate = updateSourceCalls.find((c) => c.id === 'src-x' && 'cursor' in c.patch);
    // Advances to the FIRST page's newest id - the gap (unread posts
    // beyond page 3) is accepted, not frozen on.
    expect(cursorUpdate?.patch).toEqual({ cursor: { since_id: 'p1-0' } });
    // All 30 reads are still billed/recorded.
    expect(recordRunXCostCalls[0]?.usage).toEqual({ xPostsRead: 30, xCostUsd: 0.15 });
  });

  // Re-review (this round, HIGH): only a DEADLINE may still leave the
  // cursor unadvanced.
  it('does NOT advance the cursor when the deadline is hit before any processing starts', async () => {
    makeXSource({ since_id: 'old-cursor' });
    fetchXUserPostsMock.mockResolvedValueOnce(onePage(['p1'], [['https://lu.ma/e1']]));

    const result = await runSource('src-x', { trigger: 'cron', deadlineMs: -1 }); // already expired

    expect(result.status).toBe('partial');
    const cursorUpdate = updateSourceCalls.find((c) => c.id === 'src-x' && 'cursor' in c.patch);
    expect(cursorUpdate).toBeUndefined();
  });

  // Re-review (this round, HIGH test list): "two consecutive runs don't
  // re-read the same posts" - the cursor written by run 1 is what run 2
  // actually passes as since_id.
  it('two consecutive runs do not re-read the same posts', async () => {
    makeXSource(); // first run: no cursor
    fetchXUserPostsMock.mockResolvedValueOnce(onePage(['p1'], [['https://lu.ma/e1']]));
    await runSource('src-x', { trigger: 'cron' });
    expect(fetchXUserPostsMock).toHaveBeenNthCalledWith(1, 'uid-1', expect.objectContaining({ sinceId: null }));

    fetchXUserPostsMock.mockResolvedValueOnce(onePage(['p2'], [['https://lu.ma/e2']]));
    await runSource('src-x', { trigger: 'cron' }); // second run: picks up the cursor run 1 just set
    expect(fetchXUserPostsMock).toHaveBeenNthCalledWith(2, 'uid-1', expect.objectContaining({ sinceId: 'p1' }));
  });

  it('skips the discovery-context build entirely when there are no allowlisted links (re-review item 4)', async () => {
    makeXSource();
    fetchXUserPostsMock.mockResolvedValueOnce(onePage(['p1'], [['https://not-an-event-platform.example.com']]));

    const result = await runSource('src-x', { trigger: 'cron' });

    expect(result.status).toBe('ok');
    expect(processDiscoveredLinkMock).not.toHaveBeenCalled();
  });

  // Review finding, LOW-MED item C: Luma budget exhaustion must mark the
  // run partial (there's real leftover work) WITHOUT holding back the X
  // cursor advance — only a genuine wall-clock deadline does that. Before
  // this fix, `runDiscoveredLinksBatch`'s single `hitDeadline` flag
  // conflated the two, so a Luma-only budget crunch made this source
  // re-read (and re-BILL) the exact same already-paid-for X posts on every
  // later run until the Luma budget happened to be free again.
  it('a Luma-budget exhaustion marks the run partial but still advances the X cursor (does not re-pay to re-read the same posts)', async () => {
    makeXSource();
    fetchXUserPostsMock.mockResolvedValueOnce(onePage(['p1'], [['https://lu.ma/exhausted-link']]));
    telegramEnrichLimiterExhausted = true; // shared `../ingest/enrich` mock flag — also governs X's own discovery context.

    const result = await runSource('src-x', { trigger: 'cron' });

    expect(result.status).toBe('partial');
    expect(processDiscoveredLinkMock).not.toHaveBeenCalled(); // the Luma link was skipped, never even attempted.
    // 2026-10-18: the cursor still advances, but the skipped link is
    // carried over in `retry_urls` so it isn't lost with no trace.
    const cursorUpdates = updateSourceCalls.filter((c) => c.id === 'src-x' && 'cursor' in c.patch);
    const finalCursor = cursorUpdates[cursorUpdates.length - 1]?.patch.cursor as Record<string, unknown>;
    expect(finalCursor.since_id).toBe('p1');
    expect(finalCursor.retry_urls).toEqual([
      expect.objectContaining({ url: 'https://lu.ma/exhausted-link', reason: 'luma_budget_exhausted' }),
    ]);
  });

  it('a Luma 429 (deferred) link is persisted in retry_urls and retried FIRST on the next run, even with no new posts', async () => {
    makeXSource();
    fetchXUserPostsMock.mockResolvedValueOnce(onePage(['p1'], [['https://lu.ma/rate-limited']]));
    processDiscoveredLinkMock.mockImplementationOnce((async () => ({ kind: 'deferred', reason: 'Luma returned 429.' })) as never);
    await runSource('src-x', { trigger: 'cron' });
    const afterFirst = sourceRows.get('src-x')!.cursor;
    expect(afterFirst.since_id).toBe('p1');
    expect(afterFirst.retry_urls).toEqual([expect.objectContaining({ url: 'https://lu.ma/rate-limited', reason: 'Luma returned 429.' })]);

    // Next run: no new posts at all — the deferred link is still processed,
    // and once handled it leaves the retry list.
    processDiscoveredLinkCalls = [];
    fetchXUserPostsMock.mockResolvedValueOnce(onePage([], []));
    await runSource('src-x', { trigger: 'cron' });
    expect(processDiscoveredLinkCalls.map((c) => c.url)).toEqual(['https://lu.ma/rate-limited']);
    expect(sourceRows.get('src-x')!.cursor.retry_urls).toEqual([]);
    expect(sourceRows.get('src-x')!.cursor.since_id).toBe('p1');
  });

  // Review finding, LOW item D: the exhaustion skip is Luma-specific —
  // a Partiful/Eventbrite/Meetup/Posh link in the SAME batch is unaffected
  // by the Luma limiter and must still be processed normally.
  it('a non-Luma link in the same batch is still processed once the Luma limiter is exhausted', async () => {
    makeXSource();
    fetchXUserPostsMock.mockResolvedValueOnce(
      onePage(['p1'], [['https://lu.ma/exhausted-link', 'https://partiful.com/e/still-processed']])
    );
    telegramEnrichLimiterExhausted = true;

    const result = await runSource('src-x', { trigger: 'cron' });

    expect(processDiscoveredLinkCalls).toHaveLength(1);
    expect(processDiscoveredLinkCalls[0].url).toBe('https://partiful.com/e/still-processed');
    expect(result.status).toBe('partial'); // the skipped Luma link is still leftover work.
  });
});

describe('runSource(meetup_search): cost accounting (re-review item 1, HIGH)', () => {
  it('surfaces the REAL classified cost/tokens on the run row, not hardcoded 0', async () => {
    makeMeetupSource();
    searchMeetupEventsMock.mockResolvedValueOnce([
      { id: 'mu-1', title: 'DeFi Mixer', eventUrl: 'https://www.meetup.com/defi/events/1/' },
      { id: 'mu-2', title: 'AI Builders', eventUrl: 'https://www.meetup.com/ai/events/2/' },
    ]);

    const result = await runSource('src-meetup', { trigger: 'cron' });

    expect(result.status).toBe('ok');
    const run = runRows.find((r) => r.id === result.runId)!;
    expect(run.est_cost_usd).toBe(10);
    expect(run.llm_input_tokens).toBe(200);
  });

  it('the monthly LLM cap stops further classification mid-batch', async () => {
    makeMeetupSource();
    checkMonthlyBudgetMock.mockResolvedValue({ spentUsd: 0, capUsd: 8, exceeded: false });
    searchMeetupEventsMock.mockResolvedValueOnce([
      { id: 'mu-1', title: 'a', eventUrl: 'https://www.meetup.com/x/events/1/' },
      { id: 'mu-2', title: 'b', eventUrl: 'https://www.meetup.com/x/events/2/' },
      { id: 'mu-3', title: 'c', eventUrl: 'https://www.meetup.com/x/events/3/' },
    ]);

    const result = await runSource('src-meetup', { trigger: 'cron' });

    const run = runRows.find((r) => r.id === result.runId)!;
    expect(processDiscoveredLinkCalls.filter((c) => c.canClassify)).toHaveLength(2);
    expect(run.est_cost_usd).toBe(10);
  });
});

describe('runSource(sponsor_pages): cost accounting (re-review item 1, HIGH) and sponsor rotation (item 8, LOW)', () => {
  it('surfaces the REAL classified cost/tokens on the run row, not hardcoded 0', async () => {
    makeSponsorPagesSource();
    resolveSponsorPageUrlsMock.mockResolvedValueOnce({ urls: ['https://sponsor.example.com/events'], nextOffset: null });
    fetchSponsorPageLinksMock.mockResolvedValueOnce(['https://lu.ma/e1', 'https://partiful.com/e/e2']);

    const result = await runSource('src-sponsor', { trigger: 'cron' });

    expect(result.status).toBe('ok');
    const run = runRows.find((r) => r.id === result.runId)!;
    expect(run.est_cost_usd).toBe(10);
    expect(run.llm_input_tokens).toBe(200);
  });

  it('persists the rotation offset cursor returned by resolveSponsorPageUrls', async () => {
    makeSponsorPagesSource({ sponsor_offset: 1 });
    resolveSponsorPageUrlsMock.mockResolvedValueOnce({ urls: [], nextOffset: 2 });

    await runSource('src-sponsor', { trigger: 'cron' });

    const cursorUpdate = updateSourceCalls.find((c) => c.id === 'src-sponsor' && 'cursor' in c.patch);
    expect(cursorUpdate?.patch).toEqual({ cursor: { sponsor_offset: 2 } });
    expect(resolveSponsorPageUrlsMock).toHaveBeenCalledWith(expect.anything(), 'Test Conf', [], { offset: 1 });
  });

  it('does not persist a cursor when rotation does not apply (nextOffset null)', async () => {
    makeSponsorPagesSource();
    resolveSponsorPageUrlsMock.mockResolvedValueOnce({ urls: [], nextOffset: null });

    await runSource('src-sponsor', { trigger: 'cron' });

    expect(updateSourceCalls.find((c) => c.id === 'src-sponsor' && 'cursor' in c.patch)).toBeUndefined();
  });

  // Re-review item 4 (MEDIUM): checks the deadline with margin for the
  // worst-case page time BEFORE starting a page, not just after it's
  // already passed.
  it('never starts a page fetch when less than SPONSOR_PAGE_WORST_CASE_MS remains before the deadline', async () => {
    makeSponsorPagesSource();
    resolveSponsorPageUrlsMock.mockResolvedValueOnce({
      urls: ['https://sponsor.example.com/events', 'https://sponsor2.example.com/events'],
      nextOffset: null,
    });

    // Deadline is only 1s out - far less than the ~17s worst-case margin -
    // so even the FIRST page must never be started.
    const result = await runSource('src-sponsor', { trigger: 'cron', deadlineMs: 1000 });

    expect(fetchSponsorPageLinksMock).not.toHaveBeenCalled();
    expect(result.status).toBe('partial'); // hitDeadline
  });
});

describe('runSource(telegram_channel): persists LLM cost already spent when a LATER link throws (re-review: "persist LLM cost on a thrown batch ... for all sources including Telegram")', () => {
  it('records the first link\'s classify cost on the run row even though the second link\'s processing throws', async () => {
    makeTelegramSource();
    parseTelegramChannelHtmlMock.mockReturnValueOnce([
      { postRef: 'testchannel/1', url: 'https://t.me/testchannel/1', text: '', links: ['https://lu.ma/e1'] },
      { postRef: 'testchannel/2', url: 'https://t.me/testchannel/2', text: '', links: ['https://lu.ma/e2'] },
    ]);
    processDiscoveredLinkMock
      .mockImplementationOnce(async (url: string) => ({
        kind: 'row' as const,
        row: {
          conference: 'Test Conf',
          canonical_key: url,
          alt_keys: [],
          source_id: null,
          source_kind: 'telegram_channel',
          sources: [],
          source_ref: null,
          event: { name: url, link: url, dateISO: '2027-03-10' },
          content_hash: `h-${url}`,
          status: 'queued' as const,
        },
        classified: true,
        inputTokens: 100,
        outputTokens: 20,
        costUsd: 5,
      }))
      .mockRejectedValueOnce(new Error('simulated: second link processing throws'));

    const result = await runSource('src-telegram', { trigger: 'cron' });

    expect(result.status).toBe('error');
    const errorRun = runRows.find((r) => r.status === 'error');
    expect(errorRun).toBeTruthy();
    // The FIRST link's classify succeeded before the SECOND threw - that
    // cost must still show up on the run row, not $0/0 tokens.
    expect(errorRun!.llm_input_tokens).toBe(100);
    expect(errorRun!.llm_output_tokens).toBe(20);
    expect(errorRun!.est_cost_usd).toBe(5);
  });

  // Review finding, HIGH item 1 ("exhausting the Luma limiter poisons
  // ingest_link_cache ... also a live bug in the Telegram path, since
  // discover.ts is shared"): Telegram's own inline loop must also stop
  // once the shared Luma limiter is exhausted, rather than handing every
  // remaining link to `processDiscoveredLink` and writing bogus error rows.
  it('stops processing links once the Luma enrichment limiter is exhausted, marking the run partial', async () => {
    makeTelegramSource();
    parseTelegramChannelHtmlMock.mockReturnValueOnce([
      { postRef: 'testchannel/1', url: 'https://t.me/testchannel/1', text: '', links: ['https://lu.ma/e1', 'https://lu.ma/e2'] },
    ]);
    telegramEnrichLimiterExhausted = true;

    const result = await runSource('src-telegram', { trigger: 'cron' });

    expect(processDiscoveredLinkMock).not.toHaveBeenCalled();
    expect(result.status).toBe('partial');
  });

  // Review finding, LOW item D: Telegram's own inline loop (predates
  // `runDiscoveredLinksBatch`) must also skip only Luma links once
  // exhausted — a Partiful/Eventbrite/Meetup/Posh link in the same
  // message is unaffected by the Luma limiter and still gets processed.
  it('a non-Luma link in the same message is still processed once the Luma limiter is exhausted', async () => {
    makeTelegramSource();
    parseTelegramChannelHtmlMock.mockReturnValueOnce([
      { postRef: 'testchannel/1', url: 'https://t.me/testchannel/1', text: '', links: ['https://lu.ma/exhausted-link', 'https://partiful.com/e/still-processed'] },
    ]);
    telegramEnrichLimiterExhausted = true;

    const result = await runSource('src-telegram', { trigger: 'cron' });

    expect(processDiscoveredLinkCalls).toHaveLength(1);
    expect(processDiscoveredLinkCalls[0].url).toBe('https://partiful.com/e/still-processed');
    expect(result.status).toBe('partial');
  });
});

describe('runSource(telegram_channel): a Luma 429 (deferred) link survives its post scrolling off the channel page', () => {
  it('persists the deferred link in cursor.retry_urls and retries it on the next run', async () => {
    makeTelegramSource();
    parseTelegramChannelHtmlMock.mockReturnValueOnce([
      { postRef: 'testchannel/1', url: 'https://t.me/testchannel/1', text: '', links: ['https://lu.ma/rate-limited'] },
    ]);
    processDiscoveredLinkMock.mockImplementationOnce((async () => ({ kind: 'deferred', reason: 'Luma returned 429.' })) as never);
    const first = await runSource('src-telegram', { trigger: 'cron' });
    expect(first.counts.deferred).toBe(1);
    expect(sourceRows.get('src-telegram')!.cursor.retry_urls).toEqual([
      expect.objectContaining({ url: 'https://lu.ma/rate-limited', ref: 'https://t.me/testchannel/1' }),
    ]);

    // The post is gone from the page now — the link is still retried.
    processDiscoveredLinkCalls = [];
    parseTelegramChannelHtmlMock.mockReturnValueOnce([]);
    await runSource('src-telegram', { trigger: 'cron' });
    expect(processDiscoveredLinkCalls.map((c) => c.url)).toEqual(['https://lu.ma/rate-limited']);
    expect(sourceRows.get('src-telegram')!.cursor.retry_urls).toEqual([]);
  });
});
