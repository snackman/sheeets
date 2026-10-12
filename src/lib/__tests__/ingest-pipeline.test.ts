import { describe, it, expect, vi, beforeEach } from 'vitest';

// `new OpenAI(...)` validates an api key is present AND refuses to
// construct under jsdom (vitest's test environment) as a browser-safety
// check — `scoreCandidate` is mocked below and never actually uses this
// client, so a trivial stand-in avoids both without `dangerouslyAllowBrowser`.
process.env.OPENAI_API_KEY = 'test-key';
vi.mock('openai', () => ({ default: class FakeOpenAI {} }));

// ---------------------------------------------------------------------------
// In-memory candidate store, standing in for Supabase so `runSource` can be
// exercised end-to-end (including a real second run over the same feed)
// without a database.
// ---------------------------------------------------------------------------
interface FakeRow {
  conference: string;
  canonical_key: string;
  status: string;
  ical_hash?: string | null;
  content_hash?: string;
  classify_attempts?: number;
  [key: string]: unknown;
}

let candidateStore: Map<string, FakeRow>;
let runRows: { id: string; status: string }[];
let runningGuard: boolean;

function keyFor(conference: string, canonicalKey: string) {
  return `${conference}::${canonicalKey}`;
}

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
  radius_km: 1000,
  window_pre_days: 30,
  window_post_days: 30,
  allow_online: true,
  max_llm_calls_per_run: 150,
  max_publish_per_run: 25,
  enabled: true,
  auto_publish_killed_at: null as string | null,
  auto_publish_kill_reason: null as string | null,
  auto_publish_enabled_at: null as string | null,
};
const getProfileMock = vi.fn(async () => defaultProfile);
// Phase 2 kill switch (`gate.ts#checkAutoPublishKillSwitch`, real
// implementation — not mocked in this file, only its DB calls are): named
// so tests can assert it's actually invoked, and control its outcome.
const getRecentAutoPublishOutcomesMock = vi.fn(async () => [] as { status: string; event?: { dateISO?: string | null }; updated_at?: string }[]);
const updateProfilePatchMock = vi.fn(async () => ({}));

vi.mock('../ingest/db', () => ({
  getSource: vi.fn(async () => ({
    id: 'src-1',
    conference: 'Test Conf',
    kind: 'luma_ical',
    label: 'Test Calendar',
    config: { calendar_api_id: 'cal-TEST1234' },
    trust: 'curated',
    enabled: true,
  })),
  getProfile: (...a: unknown[]) => getProfileMock(...(a as [])),
  getCandidateByKey: vi.fn(async (conference: string, canonicalKey: string) => candidateStore.get(keyFor(conference, canonicalKey)) ?? null),
  upsertCandidate: vi.fn(async (row: FakeRow) => {
    const k = keyFor(row.conference, row.canonical_key);
    const existing = candidateStore.get(k);
    const merged = { ...existing, ...row, status: row.status ?? existing?.status ?? 'new' };
    candidateStore.set(k, merged);
    return merged;
  }),
  updateCandidate: vi.fn(async (id: string, patch: Record<string, unknown>) => {
    for (const [k, v] of candidateStore) {
      if (v.canonical_key === id || k === id) candidateStore.set(k, { ...v, ...patch });
    }
  }),
  listRecentCandidatesForDedupe: vi.fn(async () => []),
  createRun: vi.fn(async () => {
    const run = { id: `run-${runRows.length + 1}`, status: 'running' };
    runRows.push(run);
    return run;
  }),
  finishRun: vi.fn(async (id: string, patch: { status: string }) => {
    const run = runRows.find((r) => r.id === id);
    if (run) run.status = patch.status;
  }),
  hasRecentRunningRun: vi.fn(async () => runningGuard),
  updateSource: vi.fn(async () => {}),
  profileRowToThemeProfile: vi.fn((row: { theme_key: string; theme_description: string; include_keywords: string[]; exclude_keywords: string[]; publish_threshold: number; review_threshold: number }) => ({
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
  // Phase 2 learning loop / gate additions (`learning.ts`, `gate.ts`) — empty
  // pools/outcomes so the pipeline's new calls are no-ops in these tests,
  // which predate the learning loop and don't exercise it directly (see
  // `ingest-learning.test.ts`/`ingest-gate.test.ts` for that logic).
  listLabelsForFewShot: vi.fn(async () => []),
  listLabelsForHostSignals: vi.fn(async () => []),
  getRecentAutoPublishOutcomes: (...a: unknown[]) => getRecentAutoPublishOutcomesMock(...(a as [])),
  getPrecisionRows: vi.fn(async () => []),
  upsertProfile: vi.fn(async () => ({})),
  updateProfilePatch: (...a: unknown[]) => updateProfilePatchMock(...(a as [])),
}));

vi.mock('../ingest/budget', () => ({
  checkMonthlyBudget: vi.fn(async () => ({ spentUsd: 0, capUsd: 20, exceeded: false })),
}));

vi.mock('../get-conferences', () => ({
  getAllConferenceTabs: vi.fn(async () => [
    {
      gid: 1,
      name: 'Test Conf',
      slug: 'test-conf',
      timezone: 'UTC',
      dates: ['2027-03-10'],
      center: { lat: 43.5528, lng: 7.0174 },
    },
  ]),
}));

vi.mock('../fetch-events', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../fetch-events')>();
  return {
    fetchEvents: vi.fn(async () => []),
    generateEventId: actual.generateEventId, // real, pure implementation
  };
});

vi.mock('../google-sheets', () => ({
  getSheetTitle: vi.fn(async () => 'Test Sheet Tab'),
  insertEventRowSorted: vi.fn(async () => 1),
}));

vi.mock('../fetch-events-cached', () => ({
  invalidateEventsCache: vi.fn(),
}));

const fetchLumaEventMock = vi.fn(async (..._args: unknown[]) => ({
  api_id: 'evt-ABC123DEF456',
  event: { api_id: 'evt-ABC123DEF456', name: 'ETH Builders Mixer' },
  hosts: [{ api_id: 'usr-1', name: 'Alice' }],
  description_mirror: null,
}));
vi.mock('../luma-server', () => ({
  fetchLumaEvent: (...args: unknown[]) => fetchLumaEventMock(...args),
  LumaFetchError: class LumaFetchError extends Error {},
}));

const DEFAULT_VEVENT = {
  uid: 'evt-ABC123DEF456@events.lu.ma',
  summary: 'ETH Builders Mixer',
  description: 'Get up-to-date information at: https://luma.com/ethcc-mixer\n\nHosted by Alice',
  dtstart: '2027-03-10T18:00:00.000Z',
  dtstartIsDateOnly: false,
  dtend: '2027-03-10T21:00:00.000Z',
  location: 'https://luma.com/event/evt-ABC123DEF456',
  geo: { lat: 43.5528, lng: 7.0174 },
  sequence: 0,
  status: 'CONFIRMED',
  dtstamp: '2027-03-01T00:00:00.000Z',
};
// Named so individual tests (e.g. the publish-cap test below, which needs
// TWO distinct events in one feed) can override the default single-event
// feed via `.mockResolvedValueOnce`/`.mockResolvedValue`.
const fetchLumaIcalFeedMock = vi.fn(async () => [DEFAULT_VEVENT]);
vi.mock('../ingest/sources/luma-ical', () => ({
  fetchLumaIcalFeed: (...a: unknown[]) => fetchLumaIcalFeedMock(...(a as [])),
  // apiId derived from each event's own `uid` (not a fixed constant) so
  // two different events in the same feed get distinct canonical keys —
  // `evt-ABC123DEF456@events.lu.ma` -> `evt-ABC123DEF456`, matching the
  // existing hardcoded behavior for the single-event default feed above.
  toIcalCandidates: vi.fn((events: { uid: string; description: string }[]) =>
    events.map((vevent) => ({ vevent, apiId: vevent.uid.split('@')[0], slug: 'ethcc-mixer' }))
  ),
}));

const scoreCandidateMock = vi.fn(async (..._args: unknown[]) => ({
  classifier: {
    output: { theme_score: 50, reason: 'ok', suggested_tags: [], flags: [], is_event: true, data_quality: 'sufficient' },
    injectionDetected: false,
    inputTokens: 100,
    outputTokens: 20,
    model: 'gpt-5-mini',
    promptVersion: '1a-v2-openai',
  },
  signals: { breakdown: {}, total: 0, hardReject: false, capRouteAtReview: false },
  finalScore: 50,
  route: 'review' as 'review' | 'publish' | 'reject',
  shadowRoute: 'review' as 'review' | 'publish' | 'reject',
}));
vi.mock('../ingest/scoring', () => ({
  scoreCandidate: (...args: unknown[]) => scoreCandidateMock(...args),
}));

vi.mock('../ingest/reconcile', () => ({
  reconcileConference: vi.fn(async () => ({ checked: 0, linked: 0, unpublishedExternal: 0, skipped: true })),
}));

import { runSource } from '../ingest/pipeline';

beforeEach(() => {
  candidateStore = new Map();
  runRows = [];
  runningGuard = false;
  fetchLumaEventMock.mockClear();
  scoreCandidateMock.mockClear();
  getProfileMock.mockReset().mockResolvedValue(defaultProfile);
  getRecentAutoPublishOutcomesMock.mockReset().mockResolvedValue([]);
  updateProfilePatchMock.mockClear();
  fetchLumaIcalFeedMock.mockReset().mockResolvedValue([DEFAULT_VEVENT]);
});

describe('runSource: change detection (CRITICAL item 1 — ical_hash vs content_hash)', () => {
  it('a second run over the same unchanged feed gives `unchanged`, with 0 enrichment calls and 0 LLM calls', async () => {
    const first = await runSource('src-1', { trigger: 'manual' });
    expect(first.status).toBe('ok');
    expect(first.counts.new).toBe(1);
    expect(fetchLumaEventMock).toHaveBeenCalledTimes(1); // enrichment on the new candidate
    expect(scoreCandidateMock).toHaveBeenCalledTimes(1);

    fetchLumaEventMock.mockClear();
    scoreCandidateMock.mockClear();

    const second = await runSource('src-1', { trigger: 'manual' });
    expect(second.status).toBe('ok');
    expect(second.counts.unchanged).toBe(1);
    expect(second.counts.new ?? 0).toBe(0);
    // The bug (CRITICAL item 1): comparing the pre-enrichment stub hash
    // against the post-enrichment content_hash meant this NEVER matched,
    // so every run re-enriched and re-classified from scratch.
    expect(fetchLumaEventMock).not.toHaveBeenCalled();
    expect(scoreCandidateMock).not.toHaveBeenCalled();
  });

  it('stores a non-null ical_hash on the persisted candidate', async () => {
    await runSource('src-1', { trigger: 'manual' });
    const row = candidateStore.get('Test Conf::luma:evt-abc123def456');
    expect(row?.ical_hash).toBeTruthy();
  });
});

describe('runSource: final-status protection (CRITICAL item 2)', () => {
  it('never re-processes (or touches status on) an already-approved candidate, and never overwrites its event snapshot (MEDIUM item 1)', async () => {
    const adminEditedEvent = { name: 'ETH Builders Mixer (admin-edited title)', hosts: [{ name: 'Alice' }] };
    candidateStore.set('Test Conf::luma:evt-abc123def456', {
      conference: 'Test Conf',
      canonical_key: 'luma:evt-abc123def456',
      status: 'approved',
      ical_hash: 'stale-hash-from-a-previous-run',
      published_event_id: 'evt-xyz',
      event: adminEditedEvent,
      content_hash: 'stale-content-hash',
    });

    const result = await runSource('src-1', { trigger: 'manual' });
    expect(result.status).toBe('ok');
    expect(result.counts.skipped_final).toBe(1);
    expect(fetchLumaEventMock).not.toHaveBeenCalled();
    expect(scoreCandidateMock).not.toHaveBeenCalled();

    const row = candidateStore.get('Test Conf::luma:evt-abc123def456');
    expect(row?.status).toBe('approved'); // never changed
    expect(row?.published_event_id).toBe('evt-xyz'); // never touched
    // The re-ingest must never replace an enriched/admin-edited event
    // snapshot with the bare iCal stub (MEDIUM item 1 — this was the bug:
    // the final-status refresh used to pass `event`/`content_hash` too).
    expect(row?.event).toEqual(adminEditedEvent);
    expect(row?.content_hash).toBe('stale-content-hash');
    // Only these are allowed to refresh.
    expect(row?.ical_hash).not.toBe('stale-hash-from-a-previous-run');
  });

  it('never re-processes an unpublished candidate (never resurrects it)', async () => {
    candidateStore.set('Test Conf::luma:evt-abc123def456', {
      conference: 'Test Conf',
      canonical_key: 'luma:evt-abc123def456',
      status: 'unpublished',
      ical_hash: 'stale-hash',
    });

    const result = await runSource('src-1', { trigger: 'manual' });
    expect(result.counts.skipped_final).toBe(1);
    expect(candidateStore.get('Test Conf::luma:evt-abc123def456')?.status).toBe('unpublished');
  });
});

describe('runSource: retry statuses excluded from the unchanged shortcut (MEDIUM item 6)', () => {
  it('retries a candidate stuck in pending_classify even when the hash matches', async () => {
    // Run once to compute the real ical_hash for this feed, then force the
    // status to pending_classify with that same hash.
    await runSource('src-1', { trigger: 'manual' });
    const key = 'Test Conf::luma:evt-abc123def456';
    const row = candidateStore.get(key)!;
    candidateStore.set(key, { ...row, status: 'pending_classify' });

    fetchLumaEventMock.mockClear();
    scoreCandidateMock.mockClear();

    const result = await runSource('src-1', { trigger: 'manual' });
    expect(result.counts.unchanged ?? 0).toBe(0);
    expect(result.counts.new).toBe(1); // retried, not short-circuited
    expect(scoreCandidateMock).toHaveBeenCalledTimes(1);
  });
});

describe('runSource: dry run (MEDIUM item 5)', () => {
  it('writes no candidates, but still creates a real run row and respects the overlap guard', async () => {
    const result = await runSource('src-1', { trigger: 'manual', dryRun: true });
    expect(result.status).toBe('ok');
    expect(candidateStore.size).toBe(0); // nothing persisted
    expect(result.previews?.length).toBe(1);
    expect(runRows.length).toBe(1); // a real ingest_runs row was created
    expect(runRows[0].status).toBe('ok');
  });

  it('is skipped by the overlap guard just like a real run', async () => {
    runningGuard = true;
    const result = await runSource('src-1', { trigger: 'manual', dryRun: true });
    expect(result.status).toBe('skipped');
  });
});

describe('runSource: overlap guard (applies regardless of dryRun)', () => {
  it('skips a real run too when one is already running', async () => {
    runningGuard = true;
    const result = await runSource('src-1', { trigger: 'manual' });
    expect(result.status).toBe('skipped');
  });
});

describe('runSource: auto-publish records the real sheet event id (LOW item 3)', () => {
  it('stores published_event_id computed via generateEventId, not the internal canonical_key', async () => {
    getProfileMock.mockResolvedValue({ ...defaultProfile, auto_publish_enabled: true });
    scoreCandidateMock.mockResolvedValueOnce({
      classifier: {
        output: { theme_score: 95, reason: 'great fit', suggested_tags: [], flags: [], is_event: true, data_quality: 'sufficient' },
        injectionDetected: false,
        inputTokens: 100,
        outputTokens: 20,
        model: 'gpt-5-mini',
        promptVersion: '1a-v2-openai',
      },
      signals: { breakdown: {}, total: 0, hardReject: false, capRouteAtReview: false },
      finalScore: 95,
      route: 'publish',
      shadowRoute: 'publish',
    });

    const result = await runSource('src-1', { trigger: 'manual' });
    expect(result.status).toBe('ok');
    expect(result.counts.published).toBe(1);

    const row = candidateStore.get('Test Conf::luma:evt-abc123def456');
    expect(row?.status).toBe('auto_published');
    expect(row?.published_event_id).toBeTruthy();
    // Never the ingestion-internal canonical key — that's not an id gviz
    // (or the sheet) would ever produce (review finding, LOW item 3).
    expect(row?.published_event_id).not.toBe('luma:evt-abc123def456');
    expect(String(row?.published_event_id)).toMatch(/^evt-/);
  });
});

describe('runSource: kill switch wiring (review finding, HIGH item 2 / LOW item 10)', () => {
  function publishableScoreResult() {
    return {
      classifier: {
        output: { theme_score: 95, reason: 'great fit', suggested_tags: [], flags: [], is_event: true, data_quality: 'sufficient' },
        injectionDetected: false,
        inputTokens: 100,
        outputTokens: 20,
        model: 'gpt-5-mini',
        promptVersion: '2-v1-openai',
      },
      signals: { breakdown: {}, total: 0, hardReject: false, capRouteAtReview: false },
      finalScore: 95,
      route: 'publish' as const,
      shadowRoute: 'publish' as const,
    };
  }

  it('sets auto_published_at (distinct from published_at only in spirit — both set together on a real auto-publish)', async () => {
    getProfileMock.mockResolvedValue({ ...defaultProfile, auto_publish_enabled: true });
    scoreCandidateMock.mockResolvedValueOnce(publishableScoreResult());

    await runSource('src-1', { trigger: 'manual' });
    const row = candidateStore.get('Test Conf::luma:evt-abc123def456');
    expect(row?.status).toBe('auto_published');
    expect(row?.auto_published_at).toBeTruthy();
    expect(row?.auto_published_at).toBe(row?.published_at);
  });

  it('re-checks the kill switch right before the publish attempt, passing the profile\'s auto_publish_enabled_at as sinceIso (LOW item 10 / HIGH item 2)', async () => {
    getProfileMock.mockResolvedValue({ ...defaultProfile, auto_publish_enabled: true, auto_publish_enabled_at: '2027-05-01T00:00:00.000Z' });
    scoreCandidateMock.mockResolvedValueOnce(publishableScoreResult());

    await runSource('src-1', { trigger: 'manual' });

    expect(getRecentAutoPublishOutcomesMock).toHaveBeenCalledWith(
      'Test Conf',
      expect.objectContaining({ sinceIso: '2027-05-01T00:00:00.000Z' })
    );
  });

  it('does NOT check the kill switch for a dry run (must never have a side effect)', async () => {
    getProfileMock.mockResolvedValue({ ...defaultProfile, auto_publish_enabled: true });
    scoreCandidateMock.mockResolvedValueOnce(publishableScoreResult());

    await runSource('src-1', { trigger: 'manual', dryRun: true });
    expect(getRecentAutoPublishOutcomesMock).not.toHaveBeenCalled();
  });

  it('when the kill switch fires mid-run, the candidate about to publish is queued instead, and no DB write flips auto_publish_enabled off a second time from this module (gate.ts owns that write)', async () => {
    getProfileMock.mockResolvedValue({ ...defaultProfile, auto_publish_enabled: true });
    // 50 bad outcomes -> checkAutoPublishKillSwitch (the REAL implementation,
    // only its DB calls are mocked here) decides to kill.
    getRecentAutoPublishOutcomesMock.mockResolvedValue(
      Array.from({ length: 50 }, () => ({ status: 'unpublished', event: { dateISO: '2027-06-01' }, updated_at: '2027-06-01T00:00:00Z' }))
    );
    scoreCandidateMock.mockResolvedValueOnce(publishableScoreResult());

    const result = await runSource('src-1', { trigger: 'manual' });
    expect(result.status).toBe('ok');
    expect(result.counts.published ?? 0).toBe(0);
    expect(result.counts.queued).toBe(1);
    const row = candidateStore.get('Test Conf::luma:evt-abc123def456');
    expect(row?.status).toBe('queued');
    // gate.ts's checkAutoPublishKillSwitch is what writes the DB row back
    // to shadow mode — confirm it actually did.
    expect(updateProfilePatchMock).toHaveBeenCalledWith('Test Conf', expect.objectContaining({ auto_publish_enabled: false }));
  });

  it('skips the kill-switch query entirely once the per-run publish cap is reached (review finding, LOW item)', async () => {
    // Two distinct events in the feed, a publish cap of 1: the first
    // publishes (querying the kill switch once); the second must be
    // queued WITHOUT a second kill-switch query, since nothing more can
    // publish this run regardless of what it would say.
    fetchLumaIcalFeedMock.mockResolvedValue([
      DEFAULT_VEVENT,
      { ...DEFAULT_VEVENT, uid: 'evt-SECOND0000000@events.lu.ma', location: 'https://luma.com/event/evt-SECOND0000000' },
    ]);
    getProfileMock.mockResolvedValue({ ...defaultProfile, auto_publish_enabled: true, max_publish_per_run: 1 });
    scoreCandidateMock.mockResolvedValue(publishableScoreResult());
    // Distinct enriched names per event (the enrichment mock otherwise
    // returns the SAME hardcoded name for every call) — otherwise the
    // second candidate would fuzzy-dedupe against the first (same name,
    // same date) and never reach the publish-routing code this test is
    // actually exercising.
    fetchLumaEventMock
      .mockImplementationOnce(async () => ({
        api_id: 'evt-ABC123DEF456',
        event: { api_id: 'evt-ABC123DEF456', name: 'ETH Builders Mixer' },
        hosts: [{ api_id: 'usr-1', name: 'Alice' }],
        description_mirror: null,
      }))
      .mockImplementationOnce(async () => ({
        api_id: 'evt-SECOND0000000',
        event: { api_id: 'evt-SECOND0000000', name: 'A Totally Different Second Mixer' },
        hosts: [{ api_id: 'usr-2', name: 'Bob' }],
        description_mirror: null,
      }));

    const result = await runSource('src-1', { trigger: 'manual' });
    expect(result.status).toBe('ok');
    expect(result.counts.published).toBe(1);
    expect(result.counts.queued).toBe(1);
    expect(getRecentAutoPublishOutcomesMock).toHaveBeenCalledTimes(1);
  });
});
