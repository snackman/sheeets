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
  listRecentCandidatesForDedupe: vi.fn(async () => []),
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

let processDiscoveredLinkCalls: { url: string; sourceKind: string; sourceRef: string | null }[];
const processDiscoveredLinkMock = vi.fn(
  async (url: string, _existing: unknown, ctx: { conference: string; sourceKind: string; sourceRef: string | null }) => {
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
  processDiscoveredLink: (...args: unknown[]) => (processDiscoveredLinkMock as (...a: unknown[]) => unknown)(...args),
  PacedLinkLimiter: class PacedLinkLimiter {},
  buildHostSignalComputer: vi.fn(() => () => ({ isTrustedHost: false, isBlockedHost: false })),
}));

const fetchMiraSeriesEventsMock = vi.fn();
vi.mock('../ingest/sources/mira', () => ({
  fetchMiraSeriesEvents: (...a: unknown[]) => fetchMiraSeriesEventsMock(...a),
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
