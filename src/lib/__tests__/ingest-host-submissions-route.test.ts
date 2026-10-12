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
  recordSubmissionAttemptMock,
  getOrCreateHostSubmissionSourceMock,
  getProfileMock,
  getCandidateByKeyMock,
  upsertCandidateMock,
  updateCandidateMock,
  recordAdhocCostMock,
} = vi.hoisted(() => ({
  countRecentSubmissionAttemptsMock: vi.fn(async (_ipHash: string, _windowMs: number) => 0),
  recordSubmissionAttemptMock: vi.fn(async (_ipHash: string, _conference: string | null) => {}),
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
  recordAdhocCostMock: vi.fn(async () => {}),
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
  recordAdhocCost: recordAdhocCostMock,
  recordSubmissionAttempt: recordSubmissionAttemptMock,
  countRecentSubmissionAttempts: countRecentSubmissionAttemptsMock,
  getIngestSupabase: () => makeFakeSupabase(),
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
  LumaEnrichmentLimiter: class {},
}));

import { POST } from '../../app/api/host/submissions/route';

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/host/submissions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.7' },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = { conference: 'ETHDenver', url: 'https://lu.ma/discovered-mixer' };

beforeEach(() => {
  vi.clearAllMocks();
  countRecentSubmissionAttemptsMock.mockResolvedValue(0);
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

describe('POST /api/host/submissions — rate limiting (per IP)', () => {
  it('records an attempt for every request, even an invalid one', async () => {
    await POST(postRequest({ conference: 'ETHDenver', url: 'not-a-url' }));
    expect(recordSubmissionAttemptMock).toHaveBeenCalledTimes(1);
  });

  it('returns 429 once the short-window cap is hit, without calling processDiscoveredLink', async () => {
    countRecentSubmissionAttemptsMock.mockResolvedValueOnce(5); // short window
    countRecentSubmissionAttemptsMock.mockResolvedValueOnce(5); // day window
    const res = await POST(postRequest(VALID_BODY));
    expect(res.status).toBe(429);
    expect(recordSubmissionAttemptMock).not.toHaveBeenCalled();
    expect(processDiscoveredLinkMock).not.toHaveBeenCalled();
  });

  it('returns 429 once the daily cap is hit even if the short window is fine', async () => {
    countRecentSubmissionAttemptsMock.mockResolvedValueOnce(1); // short window
    countRecentSubmissionAttemptsMock.mockResolvedValueOnce(15); // day window
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
    expect(recordAdhocCostMock).toHaveBeenCalledTimes(1);
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
});
