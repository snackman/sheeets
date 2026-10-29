import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.CRON_SECRET = 'cron-reliability-secret';

const reapMock = vi.fn(async () => 0);
const listDueSourcesMock = vi.fn(async (..._a: unknown[]) => [] as { id: string; conference: string }[]);
vi.mock('@/lib/ingest/db', () => ({
  reapStaleRunningRuns: () => reapMock(),
  listDueSources: (...a: unknown[]) => listDueSourcesMock(...a),
  listProfiles: vi.fn(async () => []),
}));
vi.mock('@/lib/get-conferences', () => ({
  getAllConferenceTabs: vi.fn(async () => [
    { gid: 1, name: 'Conf', slug: 'c', timezone: 'UTC', dates: [new Date().toISOString().slice(0, 10)], center: { lat: 0, lng: 0 } },
  ]),
}));
vi.mock('@/lib/ingest/dedupe-sweep', () => ({ sweepDuplicateRows: vi.fn() }));
vi.mock('@/lib/fetch-events-cached', () => ({ invalidateEventsCache: vi.fn() }));
const runSourceMock = vi.fn();
vi.mock('@/lib/ingest/pipeline', () => ({ runSource: (...a: unknown[]) => runSourceMock(...a) }));
const sendAlertMock = vi.fn(async (..._a: unknown[]) => true);
vi.mock('@/lib/alert', () => ({ sendAlert: (...a: unknown[]) => sendAlertMock(...a) }));

import { GET } from '../../app/api/cron/ingest/route';

const req = () => new Request('http://localhost/api/cron/ingest', { headers: { authorization: 'Bearer cron-reliability-secret' } });
const sources = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, conference: 'Conf' }));

beforeEach(() => {
  reapMock.mockReset().mockResolvedValue(0);
  listDueSourcesMock.mockReset();
  runSourceMock.mockReset();
  sendAlertMock.mockClear();
});

describe('GET /api/cron/ingest reliability', () => {
  it('returns 500 + alerts when more than half the sources error', async () => {
    listDueSourcesMock.mockResolvedValue(sources(3));
    runSourceMock.mockRejectedValueOnce(new Error('db down')).mockRejectedValueOnce(new Error('db down')).mockResolvedValueOnce({ status: 'ok' });
    const res = await GET(req());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ran).toBe(3);
    expect(sendAlertMock).toHaveBeenCalledWith('cron_errors', expect.any(String));
    expect(JSON.stringify(sendAlertMock.mock.calls)).not.toContain('db down');
  });

  it('counts a runSource result with status "error" as an error too', async () => {
    listDueSourcesMock.mockResolvedValue(sources(2));
    runSourceMock.mockResolvedValue({ status: 'error' });
    expect((await GET(req())).status).toBe(500);
  });

  it('stays 200 with exactly half erroring, and when nothing ran', async () => {
    listDueSourcesMock.mockResolvedValue(sources(2));
    runSourceMock.mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce({ status: 'ok' });
    expect((await GET(req())).status).toBe(200);
    expect(sendAlertMock).not.toHaveBeenCalled();

    listDueSourcesMock.mockResolvedValue([]);
    expect((await GET(req())).status).toBe(200);
  });

  it('survives a reapStaleRunningRuns failure and alerts', async () => {
    reapMock.mockRejectedValue(new Error('reap exploded'));
    listDueSourcesMock.mockResolvedValue(sources(1));
    runSourceMock.mockResolvedValue({ status: 'ok' });
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect((await res.json()).reapedStaleRuns).toBe(0);
    expect(sendAlertMock).toHaveBeenCalledWith('reap_failure', expect.any(String));
  });
});
