import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

process.env.ADMIN_PASSWORD = 'queue-test-password';
process.env.OPENAI_API_KEY = 'test-key';
// Publisher lease (publisher-lease.ts) needs Supabase RPCs; run the
// critical section directly here.
vi.mock('@/lib/ingest/publisher-lease', () => ({
  withPublisherLease: <T,>(_key: string, fn: () => Promise<T>) => fn(),
  sheetLeaseKey: (gid: number) => `sheet:${gid}`,
}));
const requeueCrossConferenceTwinsMock = vi.fn(async (..._a: unknown[]) => [] as string[]);
vi.mock('@/lib/ingest/cross-conference', () => ({
  requeueCrossConferenceTwins: (...a: unknown[]) => requeueCrossConferenceTwinsMock(...a),
  hasForceReviewMarker: (c: { edits?: Record<string, unknown> | null } | null) => !!c?.edits?.force_review,
}));
vi.mock('openai', () => ({ default: class FakeOpenAI {} }));

function baseCandidate(overrides: Record<string, unknown> = {}) {
  return {
    id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    conference: 'Test Conf',
    status: 'queued',
    event: {
      name: 'ETH Builders Mixer',
      sheetDate: 'Mar 10',
      startTime: '6:00 PM',
      endTime: '9:00 PM',
      organizer: 'Alice',
      address: '',
      cost: 'Free',
      link: 'https://luma.com/event/evt-abc123def456',
      hosts: [{ name: 'Alice' }],
      dateISO: '2027-03-10',
      calendar: null,
      platform: 'luma',
      descriptionText: '',
      lat: 43.5528,
      lng: 7.0174,
    },
    llm_tags: ['ETH'],
    llm_score: 90,
    route: 'publish',
    possible_duplicate_of: null,
    classify_attempts: 0,
    review_note: null,
    reviewed_at: null,
    reviewed_by: null,
    ...overrides,
  };
}

const getCandidateMock = vi.fn();
const claimCandidateStatusMock = vi.fn();
const updateCandidateMock = vi.fn();
const insertLabelMock = vi.fn();
const getProfileMock = vi.fn();
const upsertProfileMock = vi.fn();
const listCandidatesMock = vi.fn();
const recordAdhocCostMock = vi.fn();
const profileRowToThemeProfileMock = vi.fn((..._args: unknown[]) => ({
  themeKey: 'crypto', themeName: 'Crypto', themeDescription: '', includeKeywords: [], excludeKeywords: [], publishThreshold: 85, reviewThreshold: 40,
}));

vi.mock('@/lib/ingest/db', () => ({
  listCandidates: (...a: unknown[]) => listCandidatesMock(...a),
  getCandidate: (...a: unknown[]) => getCandidateMock(...a),
  claimCandidateStatus: (...a: unknown[]) => claimCandidateStatusMock(...a),
  updateCandidate: (...a: unknown[]) => updateCandidateMock(...a),
  recordAdhocCost: (...a: unknown[]) => recordAdhocCostMock(...a),
  insertLabel: (...a: unknown[]) => insertLabelMock(...a),
  getProfile: (...a: unknown[]) => getProfileMock(...a),
  upsertProfile: (...a: unknown[]) => upsertProfileMock(...a),
  profileRowToThemeProfile: (...a: unknown[]) => profileRowToThemeProfileMock(...a),
  // Phase 2: rescore now loads a learning context (`learning.ts`, which
  // imports `listLabelsForFewShot` from this same module) and a sponsor
  // name list (`sponsors.ts`, which calls `getIngestSupabase()`) — empty
  // pools here, same as `ingest-pipeline.test.ts`'s db mock.
  listLabelsForFewShot: vi.fn(async () => []),
  listLabelsForHostSignals: vi.fn(async () => []),
  // Luma slug->api-id cache (`dedupe.ts#buildSheetLinkIndex`, Part A item
  // 1) — "never looked up" every time; the approve route builds its link
  // index with `maxResolutions: 0` regardless, so this is never actually
  // resolved live in these tests, just read.
  getCachedLumaApiIdEntry: vi.fn(async () => undefined),
  setCachedLumaApiId: vi.fn(async () => undefined),
  getIngestSupabase: vi.fn(() => ({
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve({ data: [], error: null }),
      }),
    }),
  })),
}));

vi.mock('@/lib/get-conferences', () => ({
  getAllConferenceTabs: vi.fn(async () => [
    { gid: 1, name: 'Test Conf', slug: 'test', timezone: 'UTC', dates: ['2027-03-10'], center: { lat: 43.5528, lng: 7.0174 } },
  ]),
}));

const fetchEventsMock = vi.fn(async (..._args: unknown[]) => [] as { id: string; link: string; name?: string; dateISO?: string }[]);
vi.mock('@/lib/fetch-events', () => ({
  fetchEvents: (...a: unknown[]) => fetchEventsMock(...a),
  generateEventId: vi.fn((conference: string, date: string, time: string, name: string) => `evt-generated-${name.length}`),
}));

const insertEventRowSortedMock = vi.fn(async (..._args: unknown[]) => 5);
const readRangeMock = vi.fn(async (..._args: unknown[]) => [] as string[][]);
const deleteSheetRowMock = vi.fn(async (..._args: unknown[]) => {});
vi.mock('@/lib/google-sheets', () => ({
  getSheetTitle: vi.fn(async () => 'Sheet Tab'),
  insertEventRowSorted: (...a: unknown[]) => insertEventRowSortedMock(...a),
  deleteSheetRow: (...a: unknown[]) => deleteSheetRowMock(...a),
  readRange: (...a: unknown[]) => readRangeMock(...a),
}));

vi.mock('@/lib/fetch-events-cached', () => ({
  invalidateEventsCache: vi.fn(),
}));

const checkMonthlyBudgetMock = vi.fn(async () => ({ spentUsd: 0, capUsd: 20, exceeded: false }));
vi.mock('@/lib/ingest/budget', () => ({
  checkMonthlyBudget: () => checkMonthlyBudgetMock(),
}));

const scoreCandidateMock = vi.fn(async (..._args: unknown[]) => ({
  classifier: { output: { theme_score: 60, reason: 'ok', suggested_tags: [], flags: [], is_event: true, data_quality: 'sufficient' }, inputTokens: 50, outputTokens: 10, model: 'gpt-5-mini', promptVersion: '1a-v2-openai' },
  signals: { breakdown: {} },
  finalScore: 60,
  route: 'review',
  shadowRoute: 'review',
}));
vi.mock('@/lib/ingest/scoring', () => ({
  scoreCandidate: (...a: unknown[]) => scoreCandidateMock(...a),
}));

import { POST } from '../../app/api/admin/ingest/queue/route';
import { ClassifierError } from '../ingest/classifier';

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/admin/ingest/queue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  getCandidateMock.mockReset();
  claimCandidateStatusMock.mockReset();
  updateCandidateMock.mockReset().mockResolvedValue(undefined);
  insertLabelMock.mockReset();
  getProfileMock.mockReset().mockResolvedValue({ theme_key: 'crypto', trusted_hosts: [], blocked_hosts: [], include_keywords: [], exclude_keywords: [], publish_threshold: 85, review_threshold: 40 });
  upsertProfileMock.mockReset();
  listCandidatesMock.mockReset();
  recordAdhocCostMock.mockReset();
  fetchEventsMock.mockReset().mockResolvedValue([]);
  insertEventRowSortedMock.mockReset().mockResolvedValue(5);
  readRangeMock.mockReset().mockResolvedValue([]);
  deleteSheetRowMock.mockReset();
  checkMonthlyBudgetMock.mockReset().mockResolvedValue({ spentUsd: 0, capUsd: 20, exceeded: false });
  scoreCandidateMock.mockClear();
});

describe('POST /api/admin/ingest/queue: approve (HIGH item 3)', () => {
  it('rejects a bulk approve over the cap before touching any candidate', async () => {
    const ids = Array.from({ length: 41 }, (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`);
    const res = await POST(postRequest({ password: 'queue-test-password', action: 'approve', ids }));
    expect(res.status).toBe(400);
    expect(getCandidateMock).not.toHaveBeenCalled();
  });

  it('never publishes when the atomic claim fails (candidate already handled concurrently)', async () => {
    getCandidateMock.mockResolvedValue(baseCandidate());
    claimCandidateStatusMock.mockResolvedValue(null); // the lock: someone else already claimed it

    const res = await POST(postRequest({ password: 'queue-test-password', action: 'approve', ids: ['3fa85f64-5717-4562-b3fc-2c963f66afa6'] }));
    const json = await res.json();
    expect(json.results[0].ok).toBe(false);
    expect(json.results[0].error).toMatch(/not approvable/);
    expect(insertEventRowSortedMock).not.toHaveBeenCalled();
  });

  it('publishes when the claim succeeds', async () => {
    getCandidateMock.mockResolvedValue(baseCandidate());
    claimCandidateStatusMock.mockResolvedValue(baseCandidate({ status: 'approved' }));

    const res = await POST(postRequest({ password: 'queue-test-password', action: 'approve', ids: ['3fa85f64-5717-4562-b3fc-2c963f66afa6'] }));
    const json = await res.json();
    expect(json.results[0].ok).toBe(true);
    expect(insertEventRowSortedMock).toHaveBeenCalledTimes(1);
  });

  it('skips inserting a sheet row (reuses the existing one) when the link is already in the sheet', async () => {
    getCandidateMock.mockResolvedValue(baseCandidate());
    claimCandidateStatusMock.mockResolvedValue(baseCandidate({ status: 'approved' }));
    // The event's link is already present in the sheet.
    fetchEventsMock.mockResolvedValue([{ id: 'evt-already-there', link: 'https://luma.com/event/evt-abc123def456' }]);

    const res = await POST(postRequest({ password: 'queue-test-password', action: 'approve', ids: ['3fa85f64-5717-4562-b3fc-2c963f66afa6'] }));
    const json = await res.json();
    expect(json.results[0].ok).toBe(true);
    expect(insertEventRowSortedMock).not.toHaveBeenCalled();
    expect(updateCandidateMock).toHaveBeenCalledWith('3fa85f64-5717-4562-b3fc-2c963f66afa6', expect.objectContaining({ published_event_id: 'evt-already-there' }));
  });

  it('refuses and marks duplicate when name+date matches a sheet row even though the link differs (Part A item 2 — fallback dedupe guard)', async () => {
    getCandidateMock.mockResolvedValue(baseCandidate());
    claimCandidateStatusMock.mockResolvedValue(baseCandidate({ status: 'approved' }));
    // A curator already hand-added this event under a short Luma link that
    // bears no resemblance to the candidate's canonical /event/evt-… link —
    // exactly the Devcon 8 / Breakpoint incident shape. The link index
    // alone would miss this; the name+date fallback must not.
    fetchEventsMock.mockResolvedValue([
      { id: 'evt-curator-row', link: 'https://luma.com/3doehm1b', name: 'ETH Builders Mixer', dateISO: '2027-03-10' },
    ]);

    const res = await POST(postRequest({ password: 'queue-test-password', action: 'approve', ids: ['3fa85f64-5717-4562-b3fc-2c963f66afa6'] }));
    const json = await res.json();
    expect(json.results[0].ok).toBe(false);
    expect(json.results[0].error).toMatch(/Duplicate/);
    expect(insertEventRowSortedMock).not.toHaveBeenCalled();
    expect(updateCandidateMock).toHaveBeenCalledWith(
      '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      expect.objectContaining({ status: 'duplicate', duplicate_of: 'evt-curator-row' })
    );
  });

  it('rolls back the claim to the original status when the publish fails', async () => {
    getCandidateMock.mockResolvedValue(baseCandidate({ status: 'queued' }));
    claimCandidateStatusMock.mockResolvedValue(baseCandidate({ status: 'approved' }));
    insertEventRowSortedMock.mockRejectedValue(new Error('Sheets API exploded'));

    const res = await POST(postRequest({ password: 'queue-test-password', action: 'approve', ids: ['3fa85f64-5717-4562-b3fc-2c963f66afa6'] }));
    const json = await res.json();
    expect(json.results[0].ok).toBe(false);
    expect(updateCandidateMock).toHaveBeenCalledWith('3fa85f64-5717-4562-b3fc-2c963f66afa6', expect.objectContaining({ status: 'queued' }));
  });
});

describe('POST /api/admin/ingest/queue: reject/restore status guards (MEDIUM item 2)', () => {
  it('rejects only from a non-final (approvable) status, using the atomic claim as a lock', async () => {
    getCandidateMock.mockResolvedValue(baseCandidate({ status: 'queued' }));
    claimCandidateStatusMock.mockResolvedValue(baseCandidate({ status: 'rejected' }));
    const res = await POST(postRequest({ password: 'queue-test-password', action: 'reject', ids: ['3fa85f64-5717-4562-b3fc-2c963f66afa6'], reason: 'off_theme' }));
    const json = await res.json();
    expect(json.results[0].ok).toBe(true);
    expect(claimCandidateStatusMock).toHaveBeenCalledWith(
      '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      expect.arrayContaining(['queued', 'auto_rejected', 'error', 'pending_classify']),
      'rejected',
      expect.any(Object)
    );
    expect(insertLabelMock).toHaveBeenCalled();
  });

  it('a reject re-visits cross-conference twins demoted in favour of this candidate (passes the reason through)', async () => {
    requeueCrossConferenceTwinsMock.mockClear();
    const cand = baseCandidate({ status: 'queued' });
    getCandidateMock.mockResolvedValue(cand);
    claimCandidateStatusMock.mockResolvedValue(baseCandidate({ status: 'rejected' }));
    await POST(postRequest({ password: 'queue-test-password', action: 'reject', ids: ['3fa85f64-5717-4562-b3fc-2c963f66afa6'], reason: 'wrong_city' }));
    expect(requeueCrossConferenceTwinsMock).toHaveBeenCalledWith(cand, 'wrong_city');
  });

  it('refuses to reject a published candidate — must go through unpublish instead', async () => {
    getCandidateMock.mockResolvedValue(baseCandidate({ status: 'approved' }));
    claimCandidateStatusMock.mockResolvedValue(null); // 'approved' is not in the allowed fromStatuses, so the claim fails
    const res = await POST(postRequest({ password: 'queue-test-password', action: 'reject', ids: ['3fa85f64-5717-4562-b3fc-2c963f66afa6'], reason: 'off_theme' }));
    const json = await res.json();
    expect(json.results[0].ok).toBe(false);
    expect(json.results[0].error).toMatch(/not rejectable|unpublish/i);
    expect(insertLabelMock).not.toHaveBeenCalled();
  });

  it('restores only from rejected/auto_rejected', async () => {
    getCandidateMock.mockResolvedValue(baseCandidate({ status: 'rejected' }));
    claimCandidateStatusMock.mockResolvedValue(baseCandidate({ status: 'queued' }));
    const res = await POST(postRequest({ password: 'queue-test-password', action: 'restore', ids: ['3fa85f64-5717-4562-b3fc-2c963f66afa6'] }));
    const json = await res.json();
    expect(json.results[0].ok).toBe(true);
    expect(claimCandidateStatusMock).toHaveBeenCalledWith('3fa85f64-5717-4562-b3fc-2c963f66afa6', ['rejected', 'auto_rejected'], 'queued', expect.any(Object));
  });

  it('refuses to restore a published candidate', async () => {
    getCandidateMock.mockResolvedValue(baseCandidate({ status: 'approved' }));
    claimCandidateStatusMock.mockResolvedValue(null);
    const res = await POST(postRequest({ password: 'queue-test-password', action: 'restore', ids: ['3fa85f64-5717-4562-b3fc-2c963f66afa6'] }));
    const json = await res.json();
    expect(json.results[0].ok).toBe(false);
    expect(json.results[0].error).toMatch(/not restorable/i);
  });
});

describe('POST /api/admin/ingest/queue: rescore (HIGH item 4)', () => {
  it('refuses to rescore a finalized candidate', async () => {
    getCandidateMock.mockResolvedValue(baseCandidate({ status: 'approved' }));
    const res = await POST(postRequest({ password: 'queue-test-password', action: 'rescore', ids: ['3fa85f64-5717-4562-b3fc-2c963f66afa6'] }));
    const json = await res.json();
    expect(json.results[0].ok).toBe(false);
    expect(json.results[0].error).toMatch(/finalized/);
    expect(scoreCandidateMock).not.toHaveBeenCalled();
  });

  it('refuses to rescore when the monthly budget is already exceeded', async () => {
    getCandidateMock.mockResolvedValue(baseCandidate({ status: 'queued' }));
    checkMonthlyBudgetMock.mockResolvedValue({ spentUsd: 25, capUsd: 20, exceeded: true });
    const res = await POST(postRequest({ password: 'queue-test-password', action: 'rescore', ids: ['3fa85f64-5717-4562-b3fc-2c963f66afa6'] }));
    const json = await res.json();
    expect(json.results[0].ok).toBe(false);
    expect(json.results[0].error).toMatch(/budget/i);
    expect(scoreCandidateMock).not.toHaveBeenCalled();
  });

  it('records the rescore cost against the budget ledger', async () => {
    getCandidateMock.mockResolvedValue(baseCandidate({ status: 'queued' }));
    const res = await POST(postRequest({ password: 'queue-test-password', action: 'rescore', ids: ['3fa85f64-5717-4562-b3fc-2c963f66afa6'] }));
    const json = await res.json();
    expect(json.results[0].ok).toBe(true);
    expect(recordAdhocCostMock).toHaveBeenCalledWith(
      expect.objectContaining({ conference: 'Test Conf', inputTokens: 50, outputTokens: 10 })
    );
  });

  it('still records cost when the classifier call fails with usage info attached (LOW item 5)', async () => {
    getCandidateMock.mockResolvedValue(baseCandidate({ status: 'queued' }));
    const classifierError = new ClassifierError('Schema validation failed.', undefined, {
      inputTokens: 77,
      outputTokens: 33,
      model: 'gpt-5-mini',
    });
    scoreCandidateMock.mockRejectedValueOnce(classifierError);

    const res = await POST(postRequest({ password: 'queue-test-password', action: 'rescore', ids: ['3fa85f64-5717-4562-b3fc-2c963f66afa6'] }));
    const json = await res.json();
    expect(json.results[0].ok).toBe(false);
    expect(recordAdhocCostMock).toHaveBeenCalledWith(
      expect.objectContaining({ conference: 'Test Conf', inputTokens: 77, outputTokens: 33, status: 'error' })
    );
  });
});

describe('POST /api/admin/ingest/queue: unpublish (HIGH item 9)', () => {
  it('refuses when the candidate is not actually published', async () => {
    getCandidateMock.mockResolvedValue(baseCandidate({ status: 'queued' }));
    const res = await POST(postRequest({ password: 'queue-test-password', action: 'unpublish', ids: ['3fa85f64-5717-4562-b3fc-2c963f66afa6'] }));
    const json = await res.json();
    expect(json.results[0].ok).toBe(false);
    expect(json.results[0].error).toMatch(/not published/);
    expect(claimCandidateStatusMock).not.toHaveBeenCalled();
  });

  it('refuses when the candidate has no resolvable link', async () => {
    getCandidateMock.mockResolvedValue(baseCandidate({ status: 'approved', event: { ...baseCandidate().event, link: '' } }));
    const res = await POST(postRequest({ password: 'queue-test-password', action: 'unpublish', ids: ['3fa85f64-5717-4562-b3fc-2c963f66afa6'] }));
    const json = await res.json();
    expect(json.results[0].ok).toBe(false);
    expect(json.results[0].error).toMatch(/no resolvable link/);
  });

  it('deletes a row matched by link key alone, even with a blank name (MEDIUM item 1: link-only matching)', async () => {
    getCandidateMock.mockResolvedValue(baseCandidate({ status: 'approved' }));
    claimCandidateStatusMock.mockResolvedValue(baseCandidate({ status: 'unpublished' }));
    readRangeMock.mockResolvedValue([
      ['Mar 10', '6:00 PM', '', '', '', '', '', '', 'https://luma.com/event/evt-abc123def456', '', '', ''],
    ]);
    const res = await POST(postRequest({ password: 'queue-test-password', action: 'unpublish', ids: ['3fa85f64-5717-4562-b3fc-2c963f66afa6'] }));
    const json = await res.json();
    expect(json.results[0].ok).toBe(true);
    expect(deleteSheetRowMock).toHaveBeenCalledWith(1, 0);
  });

  it('rolls back the claim and refuses when ZERO rows match the link (MEDIUM item 1)', async () => {
    getCandidateMock.mockResolvedValue(baseCandidate({ status: 'approved' }));
    claimCandidateStatusMock.mockResolvedValue(baseCandidate({ status: 'unpublished' }));
    readRangeMock.mockResolvedValue([
      ['Mar 10', '6:00 PM', '', 'Bob', 'Some Other Event', '', '', '', 'https://luma.com/event/evt-totallyunrelated', '', '', ''],
    ]);
    const res = await POST(postRequest({ password: 'queue-test-password', action: 'unpublish', ids: ['3fa85f64-5717-4562-b3fc-2c963f66afa6'] }));
    const json = await res.json();
    expect(json.results[0].ok).toBe(false);
    expect(json.results[0].error).toMatch(/could not find/i);
    expect(deleteSheetRowMock).not.toHaveBeenCalled();
    expect(insertLabelMock).not.toHaveBeenCalled();
    // Rolled back to the original (published) status, not left "unpublished".
    expect(updateCandidateMock).toHaveBeenCalledWith('3fa85f64-5717-4562-b3fc-2c963f66afa6', expect.objectContaining({ status: 'approved' }));
  });

  it('rolls back the claim and refuses when MORE THAN ONE row matches the link (MEDIUM item 1)', async () => {
    getCandidateMock.mockResolvedValue(baseCandidate({ status: 'approved' }));
    claimCandidateStatusMock.mockResolvedValue(baseCandidate({ status: 'unpublished' }));
    readRangeMock.mockResolvedValue([
      ['Mar 10', '6:00 PM', '', 'Alice', 'ETH Builders Mixer', '', '', '', 'https://luma.com/event/evt-abc123def456', '', '', ''],
      ['Mar 11', '7:00 PM', '', 'Alice', 'ETH Builders Mixer (duplicate row)', '', '', '', 'https://luma.com/event/evt-abc123def456', '', '', ''],
    ]);
    const res = await POST(postRequest({ password: 'queue-test-password', action: 'unpublish', ids: ['3fa85f64-5717-4562-b3fc-2c963f66afa6'] }));
    const json = await res.json();
    expect(json.results[0].ok).toBe(false);
    expect(json.results[0].error).toMatch(/found 2 sheet rows/i);
    expect(deleteSheetRowMock).not.toHaveBeenCalled();
    expect(insertLabelMock).not.toHaveBeenCalled();
    expect(updateCandidateMock).toHaveBeenCalledWith('3fa85f64-5717-4562-b3fc-2c963f66afa6', expect.objectContaining({ status: 'approved' }));
  });
});

describe('POST /api/admin/ingest/queue: trust_host / block_host (review finding, MEDIUM item 2c)', () => {
  it('rejects trust_host while auto-publish is enabled for the candidate\'s conference (adding a trusted host only raises scores)', async () => {
    getCandidateMock.mockResolvedValue(baseCandidate());
    getProfileMock.mockResolvedValue({ theme_key: 'crypto', trusted_hosts: [], blocked_hosts: [], include_keywords: [], exclude_keywords: [], publish_threshold: 85, review_threshold: 40, auto_publish_enabled: true });

    const res = await POST(postRequest({ password: 'queue-test-password', action: 'trust_host', ids: ['3fa85f64-5717-4562-b3fc-2c963f66afa6'] }));
    const json = await res.json();

    expect(json.results[0].ok).toBe(false);
    expect(json.results[0].error).toMatch(/Cannot trust a new host while auto-publish is enabled/);
    expect(upsertProfileMock).not.toHaveBeenCalled();
  });

  it('allows trust_host when auto-publish is off for that conference', async () => {
    getCandidateMock.mockResolvedValue(baseCandidate());
    getProfileMock.mockResolvedValue({ theme_key: 'crypto', trusted_hosts: [], blocked_hosts: [], include_keywords: [], exclude_keywords: [], publish_threshold: 85, review_threshold: 40, auto_publish_enabled: false });

    const res = await POST(postRequest({ password: 'queue-test-password', action: 'trust_host', ids: ['3fa85f64-5717-4562-b3fc-2c963f66afa6'] }));
    const json = await res.json();

    expect(json.results[0].ok).toBe(true);
    expect(upsertProfileMock).toHaveBeenCalledWith(expect.objectContaining({ trusted_hosts: expect.any(Array) }));
  });

  it('allows block_host even while auto-publish is enabled (only lowers scores — not guarded)', async () => {
    getCandidateMock.mockResolvedValue(baseCandidate());
    getProfileMock.mockResolvedValue({ theme_key: 'crypto', trusted_hosts: [], blocked_hosts: [], include_keywords: [], exclude_keywords: [], publish_threshold: 85, review_threshold: 40, auto_publish_enabled: true });

    const res = await POST(postRequest({ password: 'queue-test-password', action: 'block_host', ids: ['3fa85f64-5717-4562-b3fc-2c963f66afa6'] }));
    const json = await res.json();

    expect(json.results[0].ok).toBe(true);
    expect(upsertProfileMock).toHaveBeenCalledWith(expect.objectContaining({ blocked_hosts: expect.any(Array) }));
  });
});
