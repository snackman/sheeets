import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

process.env.OPENAI_API_KEY = 'test-key';

vi.mock('openai', () => ({ default: class FakeOpenAI {} }));

/** Minimal chainable fake Supabase client — every `.from()` call returns an
 *  object that answers every chained method call and resolves (as a
 *  promise) to `{ data: [], error: null, count: 0 }` regardless of table.
 *  Good enough here because the route's own Supabase calls (verified-host
 *  lookups) aren't the focus of these tests (validation + rate limiting +
 *  never publishing) — `processDiscoveredLink` itself is mocked below. */
function makeFakeSupabase() {
  const chain: Record<string, unknown> = {};
  const resolved = Promise.resolve({ data: [], error: null, count: 0 });
  for (const method of ['select', 'eq', 'is', 'gte', 'order', 'limit', 'maybeSingle', 'single', 'insert', 'update', 'upsert']) {
    chain[method] = vi.fn(() => chain);
  }
  // Make the chain itself thenable so `await supabase.from(...).select(...)` resolves.
  (chain as { then: typeof Promise.prototype.then }).then = resolved.then.bind(resolved);
  return {
    from: vi.fn(() => chain),
    auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: null })) },
  };
}

// `vi.hoisted` — the `vi.mock('@/lib/ingest/db', ...)` factory below is
// hoisted above regular top-level `const`s, so the mock fns it closes over
// must be declared this way (not plain `const ... = vi.fn()`) or the
// factory sees them before initialization (Vitest's documented fix for
// exactly this "Cannot access '...' before initialization" error).
const {
  countRecentSubmissionAttemptsMock,
  countGlobalRecentSubmissionAttemptsMock,
  countConferenceRecentSubmissionAttemptsMock,
  recordSubmissionAttemptMock,
  recordSubmissionAttemptCostMock,
  getOrCreateHostSubmissionSourceMock,
  getProfileMock,
  getCandidateByKeyMock,
  upsertCandidateMock,
  updateCandidateMock,
  checkMonthlyBudgetMock,
} = vi.hoisted(() => ({
  countRecentSubmissionAttemptsMock: vi.fn(async (_ipHash: string, _windowMs: number) => 1),
  countGlobalRecentSubmissionAttemptsMock: vi.fn(async (_windowMs: number) => 1),
  countConferenceRecentSubmissionAttemptsMock: vi.fn(async (_conference: string, _windowMs: number) => 1),
  recordSubmissionAttemptMock: vi.fn(async (_ipHash: string, _conference: string | null) => 'attempt-1'),
  recordSubmissionAttemptCostMock: vi.fn(async (_attemptId: string, _usage: { costUsd: number; inputTokens: number; outputTokens: number }) => {}),
  getOrCreateHostSubmissionSourceMock: vi.fn(async (conference: string) => ({
    id: 'source-1',
    conference,
    kind: 'host_submission',
    label: 'Host submissions',
    config: {},
    trust: 'discovery',
    enabled: true,
    added_by: 'system',
    cursor: {},
    last_run_at: null,
    last_status: null,
    last_error: null,
    created_at: new Date().toISOString(),
  })),
  getProfileMock: vi.fn(async () => ({
    conference: 'ETHDenver',
    theme_key: 'crypto',
    theme_description: 'Crypto side events',
    include_keywords: [] as string[],
    exclude_keywords: [] as string[],
    trusted_hosts: [] as { kind: string; id?: string; name: string }[],
    blocked_hosts: [] as { kind: string; id?: string; name: string }[],
    publish_threshold: 85,
    review_threshold: 40,
    auto_publish_enabled: false,
    radius_km: 40,
    window_pre_days: 3,
    window_post_days: 1,
    allow_online: false,
    max_llm_calls_per_run: 150,
    max_publish_per_run: 25,
    enabled: true,
    auto_publish_killed_at: null as string | null,
    auto_publish_kill_reason: null as string | null,
    auto_publish_enabled_at: null as string | null,
    updated_at: new Date().toISOString(),
  })),
  getCandidateByKeyMock: vi.fn(async () => null as Record<string, unknown> | null),
  upsertCandidateMock: vi.fn(async (row: unknown) => row),
  updateCandidateMock: vi.fn(async (_id: string, _patch: Record<string, unknown>) => {}),
  checkMonthlyBudgetMock: vi.fn(async () => ({ spentUsd: 0, capUsd: 20, exceeded: false })),
}));

vi.mock('@/lib/ingest/db', () => ({
  getProfile: getProfileMock,
  profileRowToThemeProfile: (row: { theme_key: string; theme_description: string; include_keywords: string[]; exclude_keywords: string[]; publish_threshold: number; review_threshold: number }) => ({
    themeKey: row.theme_key,
    themeName: 'Crypto',
    themeDescription: row.theme_description,
    includeKeywords: row.include_keywords,
    excludeKeywords: row.exclude_keywords,
    publishThreshold: row.publish_threshold,
    reviewThreshold: row.review_threshold,
  }),
  getOrCreateHostSubmissionSource: getOrCreateHostSubmissionSourceMock,
  getCandidateByKey: getCandidateByKeyMock,
  upsertCandidate: upsertCandidateMock,
  updateCandidate: updateCandidateMock,
  listRecentCandidatesForDedupe: vi.fn(async () => []),
  recordSubmissionAttempt: recordSubmissionAttemptMock,
  recordSubmissionAttemptCost: recordSubmissionAttemptCostMock,
  countRecentSubmissionAttempts: countRecentSubmissionAttemptsMock,
  countGlobalRecentSubmissionAttempts: countGlobalRecentSubmissionAttemptsMock,
  countConferenceRecentSubmissionAttempts: countConferenceRecentSubmissionAttemptsMock,
  getIngestSupabase: () => makeFakeSupabase(),
}));

vi.mock('@/lib/ingest/budget', () => ({
  checkMonthlyBudget: checkMonthlyBudgetMock,
}));

vi.mock('@/lib/get-conferences', () => ({
  getConferenceTabs: vi.fn(async () => [
    { gid: 1, name: 'ETHDenver', slug: 'ethdenver', timezone: 'America/Denver', dates: ['2026-03-10', '2026-03-11'], center: { lat: 39.74, lng: -104.99 } },
  ]),
}));

vi.mock('@/lib/fetch-events', () => ({
  fetchEvents: vi.fn(async () => []),
}));

vi.mock('@/lib/server-auth', () => ({
  getBearerToken: vi.fn(() => null),
}));

vi.mock('@/lib/ingest/dedupe', () => ({
  buildSheetLinkIndex: vi.fn(async () => ({ byKey: new Map() })),
}));

vi.mock('@/lib/ingest/sponsors', () => ({
  getSponsorNamesForConference: vi.fn(async () => []),
}));

vi.mock('@/lib/ingest/learning', () => ({
  loadLearningContext: vi.fn(async () => ({ fewShot: [], learnedHosts: { trusted: new Set(), blocked: new Set() } })),
}));

const { processDiscoveredLinkMock } = vi.hoisted(() => ({ processDiscoveredLinkMock: vi.fn() }));
vi.mock('@/lib/ingest/discover', () => ({
  processDiscoveredLink: (...a: unknown[]) => processDiscoveredLinkMock(...a),
  PacedLinkLimiter: class {},
  buildHostSignalComputer: () => () => ({ isTrustedHost: false, isBlockedHost: false, isLearnedBlockedHost: false }),
}));

vi.mock('@/lib/ingest/enrich', () => ({
  HourlyWindowLumaLimiter: class {},
}));

import { POST } from '../../app/api/host/submissions/route';

function postRequest(body: unknown, headers: Record<string, string> = { 'x-forwarded-for': '203.0.113.7' }) {
  return new NextRequest('http://localhost/api/host/submissions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = { conference: 'ETHDenver', url: 'https://lu.ma/discovered-mixer' };

beforeEach(() => {
  vi.clearAllMocks();
  // Defaults: well within every rate limit (the route compares with `>`,
  // so 1 is "the request we're about to make is the only/first one").
  countRecentSubmissionAttemptsMock.mockResolvedValue(1);
  countGlobalRecentSubmissionAttemptsMock.mockResolvedValue(1);
  countConferenceRecentSubmissionAttemptsMock.mockResolvedValue(1);
  recordSubmissionAttemptMock.mockResolvedValue('attempt-1');
  checkMonthlyBudgetMock.mockResolvedValue({ spentUsd: 0, capUsd: 20, exceeded: false });
  getCandidateByKeyMock.mockResolvedValue(null);
  processDiscoveredLinkMock.mockResolvedValue({ kind: 'invalid' });
});

describe('POST /api/host/submissions — validation', () => {
  it('rejects a missing conference', async () => {
    const res = await POST(postRequest({ url: 'https://lu.ma/abc' }));
    expect(res.status).toBe(400);
  });

  it('rejects a missing/empty url', async () => {
    const res = await POST(postRequest({ conference: 'ETHDenver', url: '' }));
    expect(res.status).toBe(400);
  });

  it('rejects a non-allowlisted platform link (plan §3.2/§10 — only Luma/Partiful/Eventbrite/Meetup/Posh)', async () => {
    const res = await POST(postRequest({ conference: 'ETHDenver', url: 'https://example-blog.com/post/123' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/supported event platform/i);
    expect(processDiscoveredLinkMock).not.toHaveBeenCalled();
  });

  it('rejects an unknown conference', async () => {
    const res = await POST(postRequest({ conference: 'NotARealConference', url: 'https://lu.ma/abc' }));
    expect(res.status).toBe(400);
  });

  it('rejects when there is no enabled ingest profile for the conference', async () => {
    getProfileMock.mockResolvedValueOnce(null as unknown as Awaited<ReturnType<typeof getProfileMock>>);
    const res = await POST(postRequest(VALID_BODY));
    expect(res.status).toBe(400);
  });

  it('rejects when the host-submission source has been disabled by an admin', async () => {
    getOrCreateHostSubmissionSourceMock.mockResolvedValueOnce({
      id: 'source-1', conference: 'ETHDenver', kind: 'host_submission', label: 'Host submissions', config: {},
      trust: 'discovery', enabled: false, added_by: 'system', cursor: {}, last_run_at: null, last_status: null,
      last_error: null, created_at: new Date().toISOString(),
    });
    const res = await POST(postRequest(VALID_BODY));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/temporarily closed/i);
  });
});

describe('POST /api/host/submissions — rate limiting', () => {
  it('records an attempt for every request, even an invalid one, BEFORE counting (review finding, HIGH item 2)', async () => {
    await POST(postRequest({ conference: 'ETHDenver', url: 'not-a-url' }));
    expect(recordSubmissionAttemptMock).toHaveBeenCalledTimes(1);
    // The count calls happen only after the insert — assert call order via
    // mock invocation order timestamps isn't available, so we instead
    // assert both were called (ordering is enforced by the `await` chain
    // in the route itself; see the next test for a case that depends on it).
    expect(countRecentSubmissionAttemptsMock).toHaveBeenCalled();
  });

  it('returns 429 once the per-IP short-window cap is exceeded (count includes the just-recorded attempt, so `> max` is the right comparison)', async () => {
    countRecentSubmissionAttemptsMock.mockImplementation(async (_ipHash: string, windowMs: number) =>
      windowMs <= 15 * 60 * 1000 ? 6 : 1
    );
    const res = await POST(postRequest(VALID_BODY));
    expect(res.status).toBe(429);
    // The attempt is still recorded (it happens BEFORE the count check).
    expect(recordSubmissionAttemptMock).toHaveBeenCalledTimes(1);
    expect(processDiscoveredLinkMock).not.toHaveBeenCalled();
  });

  it('returns 429 once the per-IP daily cap is exceeded even if the short window is fine', async () => {
    countRecentSubmissionAttemptsMock.mockImplementation(async (_ipHash: string, windowMs: number) =>
      windowMs <= 15 * 60 * 1000 ? 1 : 16
    );
    const res = await POST(postRequest(VALID_BODY));
    expect(res.status).toBe(429);
  });

  it('returns 429 once the GLOBAL hourly ceiling is exceeded, even with a fresh IP', async () => {
    countGlobalRecentSubmissionAttemptsMock.mockResolvedValueOnce(61);
    const res = await POST(postRequest(VALID_BODY));
    expect(res.status).toBe(429);
  });

  it('returns 429 once the per-conference daily ceiling is exceeded', async () => {
    countConferenceRecentSubmissionAttemptsMock.mockResolvedValueOnce(101);
    const res = await POST(postRequest(VALID_BODY));
    expect(res.status).toBe(429);
  });

  it('hashes the IP rather than storing it raw', async () => {
    await POST(postRequest(VALID_BODY));
    const ipHashArg = recordSubmissionAttemptMock.mock.calls[0]?.[0];
    expect(ipHashArg).not.toBe('203.0.113.7');
    expect(typeof ipHashArg).toBe('string');
    expect((ipHashArg as string).length).toBe(64); // sha256 hex
  });

  it('prefers x-real-ip over the (spoofable) first x-forwarded-for entry (review finding, HIGH item 2)', async () => {
    await POST(postRequest(VALID_BODY, { 'x-real-ip': '203.0.113.99', 'x-forwarded-for': '1.2.3.4' }));
    const hashA = recordSubmissionAttemptMock.mock.calls[0]?.[0];

    vi.clearAllMocks();
    countRecentSubmissionAttemptsMock.mockResolvedValue(1);
    countGlobalRecentSubmissionAttemptsMock.mockResolvedValue(1);
    countConferenceRecentSubmissionAttemptsMock.mockResolvedValue(1);
    recordSubmissionAttemptMock.mockResolvedValue('attempt-2');
    getCandidateByKeyMock.mockResolvedValue(null);
    processDiscoveredLinkMock.mockResolvedValue({ kind: 'invalid' });

    // SAME x-real-ip, but a DIFFERENT (attacker-controlled) first XFF
    // entry. If the route used the XFF entry, these two hashes would
    // differ; since it prefers x-real-ip, they must be identical.
    await POST(postRequest(VALID_BODY, { 'x-real-ip': '203.0.113.99', 'x-forwarded-for': '9.9.9.9' }));
    const hashB = recordSubmissionAttemptMock.mock.calls[0]?.[0];
    expect(hashB).toBe(hashA);
  });

  it('falls back to the first x-forwarded-for entry when no x-real-ip is present', async () => {
    await POST(postRequest(VALID_BODY, { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }));
    expect(recordSubmissionAttemptMock).toHaveBeenCalled();
  });

  it('buckets two IPv6 addresses in the same /64 to the SAME hash', async () => {
    await POST(postRequest(VALID_BODY, { 'x-real-ip': '2001:db8:1234:5678:aaaa:bbbb:cccc:0001' }));
    const first = recordSubmissionAttemptMock.mock.calls[0]?.[0];

    vi.clearAllMocks();
    countRecentSubmissionAttemptsMock.mockResolvedValue(1);
    countGlobalRecentSubmissionAttemptsMock.mockResolvedValue(1);
    countConferenceRecentSubmissionAttemptsMock.mockResolvedValue(1);
    recordSubmissionAttemptMock.mockResolvedValue('attempt-2');
    getCandidateByKeyMock.mockResolvedValue(null);
    processDiscoveredLinkMock.mockResolvedValue({ kind: 'invalid' });

    await POST(postRequest(VALID_BODY, { 'x-real-ip': '2001:db8:1234:5678:1111:2222:3333:4444' }));
    const second = recordSubmissionAttemptMock.mock.calls[0]?.[0];
    expect(second).toBe(first);
  });

  it('buckets two IPv6 addresses in DIFFERENT /64s to DIFFERENT hashes', async () => {
    await POST(postRequest(VALID_BODY, { 'x-real-ip': '2001:db8:1234:5678::1' }));
    const first = recordSubmissionAttemptMock.mock.calls[0]?.[0];

    vi.clearAllMocks();
    countRecentSubmissionAttemptsMock.mockResolvedValue(1);
    countGlobalRecentSubmissionAttemptsMock.mockResolvedValue(1);
    countConferenceRecentSubmissionAttemptsMock.mockResolvedValue(1);
    recordSubmissionAttemptMock.mockResolvedValue('attempt-2');
    getCandidateByKeyMock.mockResolvedValue(null);
    processDiscoveredLinkMock.mockResolvedValue({ kind: 'invalid' });

    await POST(postRequest(VALID_BODY, { 'x-real-ip': '2001:db8:9999:0000::1' }));
    const second = recordSubmissionAttemptMock.mock.calls[0]?.[0];
    expect(second).not.toBe(first);
  });
});

describe('POST /api/host/submissions — the monthly LLM budget cap applies (review finding, HIGH item 2)', () => {
  it('wires canClassify() to the monthly budget check', async () => {
    checkMonthlyBudgetMock.mockResolvedValueOnce({ spentUsd: 25, capUsd: 20, exceeded: true });
    processDiscoveredLinkMock.mockResolvedValueOnce({
      kind: 'row',
      row: { conference: 'ETHDenver', canonical_key: 'luma:discovered-mixer', status: 'queued', event: { name: 'X' } },
      classified: false,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    });
    await POST(postRequest(VALID_BODY));
    const ctxArg = processDiscoveredLinkMock.mock.calls[0][2];
    expect(ctxArg.canClassify()).toBe(false);
  });

  it('canClassify() is true when the budget has room', async () => {
    checkMonthlyBudgetMock.mockResolvedValueOnce({ spentUsd: 1, capUsd: 20, exceeded: false });
    processDiscoveredLinkMock.mockResolvedValueOnce({ kind: 'invalid' });
    await POST(postRequest(VALID_BODY));
    const ctxArg = processDiscoveredLinkMock.mock.calls[0][2];
    expect(ctxArg.canClassify()).toBe(true);
  });

  it('records cost even when the outcome was NOT classified, as long as there is billed usage (a ClassifierError with usage)', async () => {
    processDiscoveredLinkMock.mockResolvedValueOnce({
      kind: 'row',
      row: { conference: 'ETHDenver', canonical_key: 'luma:discovered-mixer', status: 'error', event: { name: 'X' } },
      classified: false,
      inputTokens: 42,
      outputTokens: 7,
      costUsd: 0.0005,
    });
    await POST(postRequest(VALID_BODY));
    expect(recordSubmissionAttemptCostMock).toHaveBeenCalledWith('attempt-1', { costUsd: 0.0005, inputTokens: 42, outputTokens: 7 });
  });

  it('does NOT record cost when there was no usage at all (e.g. filtered out before classifying)', async () => {
    processDiscoveredLinkMock.mockResolvedValueOnce({
      kind: 'row',
      row: { conference: 'ETHDenver', canonical_key: 'luma:discovered-mixer', status: 'filtered_out', event: { name: 'X' } },
      classified: false,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    });
    await POST(postRequest(VALID_BODY));
    expect(recordSubmissionAttemptCostMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/host/submissions — never auto-publishes, always discovery trust (§10 item 4)', () => {
  it('passes sourceTrust: "discovery" and sourceKind: "host_submission" to the shared engine', async () => {
    processDiscoveredLinkMock.mockResolvedValueOnce({
      kind: 'row',
      row: { conference: 'ETHDenver', canonical_key: 'luma:discovered-mixer', status: 'queued', event: { name: 'X' } },
      classified: true,
      inputTokens: 10,
      outputTokens: 5,
      costUsd: 0.001,
    });
    await POST(postRequest(VALID_BODY));
    expect(processDiscoveredLinkMock).toHaveBeenCalledTimes(1);
    const ctxArg = processDiscoveredLinkMock.mock.calls[0][2];
    expect(ctxArg.sourceTrust).toBe('discovery');
    expect(ctxArg.sourceKind).toBe('host_submission');
  });

  it('reports a "queued" status to the client when the engine routes to review, and persists the candidate', async () => {
    processDiscoveredLinkMock.mockResolvedValueOnce({
      kind: 'row',
      row: { conference: 'ETHDenver', canonical_key: 'luma:discovered-mixer', status: 'queued', event: { name: 'X' } },
      classified: true,
      inputTokens: 10,
      outputTokens: 5,
      costUsd: 0.001,
    });
    const res = await POST(postRequest(VALID_BODY));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.status).toBe('queued');
    expect(upsertCandidateMock).toHaveBeenCalledTimes(1);
    expect(recordSubmissionAttemptCostMock).toHaveBeenCalledTimes(1);
  });

  it('reports a "rejected" status when the engine auto-rejects (never "approved"/"auto_published")', async () => {
    processDiscoveredLinkMock.mockResolvedValueOnce({
      kind: 'row',
      row: { conference: 'ETHDenver', canonical_key: 'luma:discovered-mixer', status: 'auto_rejected', event: { name: 'X' } },
      classified: true,
      inputTokens: 10,
      outputTokens: 5,
      costUsd: 0.001,
    });
    const res = await POST(postRequest(VALID_BODY));
    const json = await res.json();
    expect(json.status).toBe('rejected');
  });

  it('treats a "skipped_final"/"unchanged" outcome as a friendly duplicate, without a fresh upsert', async () => {
    getCandidateByKeyMock.mockResolvedValueOnce({ id: 'cand-existing', status: 'approved', canonical_key: 'luma:discovered-mixer', classify_attempts: 1 } as unknown as Awaited<ReturnType<typeof getCandidateByKeyMock>>);
    processDiscoveredLinkMock.mockResolvedValueOnce({ kind: 'skipped_final' });
    const res = await POST(postRequest(VALID_BODY));
    const json = await res.json();
    expect(json.status).toBe('duplicate');
    expect(upsertCandidateMock).not.toHaveBeenCalled();
    expect(updateCandidateMock).toHaveBeenCalledWith('cand-existing', expect.objectContaining({ last_seen_at: expect.any(String) }));
  });

  it('returns a friendly error for an "invalid" outcome (e.g. enrichment/extraction failed)', async () => {
    processDiscoveredLinkMock.mockResolvedValueOnce({ kind: 'invalid' });
    const res = await POST(postRequest(VALID_BODY));
    expect(res.status).toBe(400);
  });

  it('a "protected" outcome (the link already belongs to a higher-trust candidate — review finding, MEDIUM item 4) only merges sources, never upserts a fresh row', async () => {
    getCandidateByKeyMock.mockResolvedValueOnce({ id: 'cand-curated', status: 'auto_rejected', canonical_key: 'luma:discovered-mixer', classify_attempts: 1, source_kind: 'luma_ical', sources: [] } as unknown as Awaited<ReturnType<typeof getCandidateByKeyMock>>);
    const mergedSources = [{ source_id: 'source-1', kind: 'host_submission', ref: null, seen_at: new Date().toISOString() }];
    processDiscoveredLinkMock.mockResolvedValueOnce({ kind: 'protected', existingId: 'cand-curated', sources: mergedSources });
    const res = await POST(postRequest(VALID_BODY));
    const json = await res.json();
    expect(json.status).toBe('duplicate');
    expect(upsertCandidateMock).not.toHaveBeenCalled();
    expect(updateCandidateMock).toHaveBeenCalledWith('cand-curated', { sources: mergedSources, last_seen_at: expect.any(String) });
  });
});
