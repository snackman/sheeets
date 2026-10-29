import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

process.env.ADMIN_PASSWORD = 'queue-perf-password';
process.env.OPENAI_API_KEY = 'test-key';

vi.mock('@/lib/ingest/publisher-lease', () => ({
  withPublisherLease: <T,>(_key: string, fn: () => Promise<T>) => fn(),
  sheetLeaseKey: (gid: number) => `sheet:${gid}`,
}));
vi.mock('@/lib/ingest/cross-conference', () => ({
  requeueCrossConferenceTwins: vi.fn(async () => []),
  hasForceReviewMarker: () => false,
}));
vi.mock('openai', () => ({ default: class FakeOpenAI {} }));

const insertEventRowSortedMock = vi.fn(async (..._a: unknown[]) => 5);
const getSheetTitleMock = vi.fn(async (..._a: unknown[]) => 'Sheet Tab');
vi.mock('@/lib/google-sheets', () => ({
  getSheetTitle: (...a: unknown[]) => getSheetTitleMock(...a),
  insertEventRowSorted: (...a: unknown[]) => insertEventRowSortedMock(...a),
  deleteSheetRow: vi.fn(),
  readRange: vi.fn(async () => []),
}));

// No 4s throttle in unit tests: same publisher, zero spacing.
vi.mock('@/lib/ingest/publish', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ingest/publish')>('@/lib/ingest/publish');
  class FastPublisher extends actual.ThrottledSheetPublisher {
    constructor(sheet: string, gid: number, opts: ConstructorParameters<typeof actual.ThrottledSheetPublisher>[2]) {
      super(sheet, gid, { ...opts, minIntervalMs: 0 });
    }
  }
  return { ...actual, ThrottledSheetPublisher: FastPublisher };
});

const getCandidateMock = vi.fn();
const claimCandidateStatusMock = vi.fn();
const getProfileMock = vi.fn();
const listCandidatesMock = vi.fn();
vi.mock('@/lib/ingest/db', () => ({
  listCandidates: (...a: unknown[]) => listCandidatesMock(...a),
  getCandidate: (...a: unknown[]) => getCandidateMock(...a),
  claimCandidateStatus: (...a: unknown[]) => claimCandidateStatusMock(...a),
  updateCandidate: vi.fn(async () => undefined),
  recordAdhocCost: vi.fn(),
  insertLabel: vi.fn(),
  getProfile: (...a: unknown[]) => getProfileMock(...a),
  upsertProfile: vi.fn(),
  profileRowToThemeProfile: vi.fn(),
  listLabelsForFewShot: vi.fn(async () => []),
  listLabelsForHostSignals: vi.fn(async () => []),
  getCachedLumaApiIdEntry: vi.fn(async () => undefined),
  setCachedLumaApiId: vi.fn(async () => undefined),
  getIngestSupabase: vi.fn(() => ({ from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }) })),
  QUEUE_LIST_COLUMNS: 'id,event',
}));

const getAllConferenceTabsMock = vi.fn(async () => [
  { gid: 1, name: 'Test Conf', slug: 'test', timezone: 'UTC', dates: ['2027-03-10'], center: { lat: 1, lng: 1 } },
]);
vi.mock('@/lib/get-conferences', () => ({ getAllConferenceTabs: () => getAllConferenceTabsMock() }));

const fetchEventsMock = vi.fn(async (..._a: unknown[]) => [] as unknown[]);
vi.mock('@/lib/fetch-events', () => ({
  fetchEvents: (...a: unknown[]) => fetchEventsMock(...a),
  generateEventId: vi.fn((_c: string, _d: string, _t: string, name: string) => `evt-${name}`),
}));
vi.mock('@/lib/fetch-events-cached', () => ({ invalidateEventsCache: vi.fn() }));
vi.mock('@/lib/ingest/budget', () => ({ checkMonthlyBudget: vi.fn() }));
vi.mock('@/lib/ingest/scoring', () => ({ scoreCandidate: vi.fn() }));

import { GET, POST } from '../../app/api/admin/ingest/queue/route';

function candidate(i: number) {
  return {
    id: `3fa85f64-5717-4562-b3fc-2c963f66a${String(i).padStart(3, '0')}`,
    conference: 'Test Conf',
    status: 'queued',
    event: {
      name: `Event ${i}`, sheetDate: 'Mar 10', startTime: '6:00 PM', endTime: '9:00 PM', organizer: 'Alice',
      address: '', cost: 'Free', link: `https://luma.com/event/evt-${i}abcdef${i}`, hosts: [{ name: 'Alice' }],
      dateISO: '2027-03-10', calendar: null, platform: 'luma', descriptionText: '', lat: 1, lng: 1,
    },
    llm_tags: [], llm_score: 90, route: 'publish', possible_duplicate_of: null, classify_attempts: 0,
    review_note: null, reviewed_at: null, reviewed_by: null,
  };
}

function post(body: unknown) {
  return new NextRequest('http://localhost/api/admin/ingest/queue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
function get(qs = '') {
  return new NextRequest(`http://localhost/api/admin/ingest/queue${qs}`, { headers: { 'x-admin-password': 'queue-perf-password' } });
}

beforeEach(() => {
  delete process.env.INGEST_QUEUE_DEADLINE_MS;
  getCandidateMock.mockReset().mockImplementation(async (id: string) => candidate(Number(id.slice(-3))));
  claimCandidateStatusMock.mockReset().mockImplementation(async (id: string) => ({ ...candidate(Number(id.slice(-3))), status: 'approved' }));
  getProfileMock.mockReset().mockResolvedValue({ theme_key: 'crypto', trusted_hosts: [], blocked_hosts: [], auto_publish_enabled: false });
  listCandidatesMock.mockReset();
  insertEventRowSortedMock.mockReset().mockResolvedValue(5);
  getSheetTitleMock.mockClear();
  getAllConferenceTabsMock.mockClear();
  fetchEventsMock.mockReset().mockResolvedValue([]);
});

const ids = (n: number) => Array.from({ length: n }, (_, i) => candidate(i + 1).id);

describe('bulk approve: per-request lookups are hoisted', () => {
  it('reads tabs, profile, sheet title and the sheet once for N ids', async () => {
    const res = await POST(post({ password: 'queue-perf-password', action: 'approve', ids: ids(5) }));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.results).toHaveLength(5);
    expect(insertEventRowSortedMock).toHaveBeenCalledTimes(5);
    expect(getAllConferenceTabsMock).toHaveBeenCalledTimes(1);
    expect(getProfileMock).toHaveBeenCalledTimes(1);
    expect(getSheetTitleMock).toHaveBeenCalledTimes(1);
    expect(fetchEventsMock).toHaveBeenCalledTimes(1);
  });

  it('also hoists the profile lookup for bulk reject', async () => {
    claimCandidateStatusMock.mockImplementation(async (id: string) => ({ ...candidate(Number(id.slice(-3))), status: 'rejected' }));
    const res = await POST(post({ password: 'queue-perf-password', action: 'reject', reason: 'spam', ids: ids(4) }));
    expect((await res.json()).results.every((r: { ok: boolean }) => r.ok)).toBe(true);
    expect(getProfileMock).toHaveBeenCalledTimes(1);
  });
});

describe('bulk approve: deferred_timeout partial results', () => {
  it('stops starting new work past the deadline and returns the rest as deferred_timeout', async () => {
    process.env.INGEST_QUEUE_DEADLINE_MS = '30';
    insertEventRowSortedMock.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 60));
      return 5;
    });
    const res = await POST(post({ password: 'queue-perf-password', action: 'approve', ids: ids(4) }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(false);
    expect(json.results).toHaveLength(4);
    expect(json.results[0]).toMatchObject({ id: ids(4)[0], ok: true });
    for (const r of json.results.slice(1)) expect(r).toMatchObject({ ok: false, error: 'deferred_timeout' });
    // deferred ids were never claimed or published
    expect(claimCandidateStatusMock).toHaveBeenCalledTimes(1);
    expect(insertEventRowSortedMock).toHaveBeenCalledTimes(1);
  });
});

describe('GET queue: projection + pagination', () => {
  it('asks the db for the projected columns by default and keeps the response shape', async () => {
    listCandidatesMock.mockResolvedValue([candidate(1)]);
    const res = await GET(get('?status=queued&conference=Test%20Conf'));
    const json = await res.json();
    expect(listCandidatesMock).toHaveBeenCalledWith(expect.objectContaining({ conference: 'Test Conf', limit: 301, offset: 0, columns: 'id,event' }));
    expect(json.candidates).toHaveLength(1);
    expect(json.nextCursor).toBeUndefined();
  });

  it('?full=1 selects every column', async () => {
    listCandidatesMock.mockResolvedValue([]);
    await GET(get('?full=1'));
    expect(listCandidatesMock.mock.calls[0][0].columns).toBeUndefined();
  });

  it('paginates with limit + cursor', async () => {
    listCandidatesMock.mockResolvedValue([candidate(1), candidate(2), candidate(3)]);
    const json = await (await GET(get('?limit=2'))).json();
    expect(json.candidates).toHaveLength(2);
    expect(json.nextCursor).toBeTruthy();
    listCandidatesMock.mockResolvedValue([candidate(3)]);
    const page2 = await (await GET(get(`?limit=2&cursor=${json.nextCursor}`))).json();
    expect(listCandidatesMock.mock.calls[1][0]).toMatchObject({ limit: 3, offset: 2 });
    expect(page2.nextCursor).toBeUndefined();
  });

  it('rejects a malformed cursor', async () => {
    const res = await GET(get('?cursor=!!!'));
    expect(res.status).toBe(400);
  });
});
