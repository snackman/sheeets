import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

process.env.ADMIN_PASSWORD = 'health-test-password';

// table/rpc name -> PostgREST error to simulate
let failures: Record<string, { code?: string; message: string }> = {};
let lastRun: { started_at: string; finished_at: string | null } | null = null;

function fakeSupabase() {
  return {
    from(table: string) {
      const err = failures[table] ?? null;
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        order: () => chain,
        limit: () => {
          if (table === 'ingest_runs' && !err) {
            return Promise.resolve({ data: lastRun ? [lastRun] : [], error: null });
          }
          return Promise.resolve({ data: [], error: err });
        },
      };
      return chain;
    },
    rpc(name: string) {
      return Promise.resolve({ data: true, error: failures[`rpc:${name}`] ?? null });
    },
  };
}

vi.mock('@/lib/ingest/db', () => ({
  getIngestSupabase: () => fakeSupabase(),
  isMissingRelationError: (e: { code?: string } | null) => !!e?.code && ['42P01', '42703', 'PGRST205', 'PGRST202', '42883'].includes(e.code),
}));

import { GET } from '../../app/api/admin/ingest/health/route';

const req = (pw = 'health-test-password') =>
  new NextRequest('http://localhost/api/admin/ingest/health', { headers: { 'x-admin-password': pw } });

beforeEach(() => {
  failures = {};
  lastRun = null;
});

describe('GET /api/admin/ingest/health', () => {
  it('requires admin auth', async () => {
    const res = await GET(req('wrong'));
    expect(res.status).toBe(401);
  });

  it('reports ok with nothing missing and the last successful cron run', async () => {
    lastRun = { started_at: new Date(Date.now() - 3 * 3_600_000).toISOString(), finished_at: new Date(Date.now() - 2.5 * 3_600_000).toISOString() };
    const res = await GET(req());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.missing).toEqual([]);
    expect(json.lastRunAt).toBe(lastRun.finished_at);
    expect(json.staleHours).toBeCloseTo(2.5, 0);
  });

  it('lists missing tables, columns and RPCs (unapplied migrations)', async () => {
    failures = {
      ingest_publisher_leases: { code: '42P01', message: 'relation does not exist' },
      ingest_candidates: { code: '42703', message: 'column auto_published_at does not exist' },
      'rpc:ingest_try_acquire_publisher_lease': { code: 'PGRST202', message: 'function not found' },
    };
    const json = await (await GET(req())).json();
    expect(res200(json)).toBe(true);
    expect(json.ok).toBe(false);
    expect(json.missing).toEqual(
      expect.arrayContaining(['ingest_publisher_leases', 'ingest_candidates', 'rpc:ingest_try_acquire_publisher_lease'])
    );
    expect(json.lastRunAt).toBeNull();
    expect(json.staleHours).toBeNull();
  });

  it('reports non-missing probe failures as errors, not missing', async () => {
    failures = { ingest_labels: { code: '42501', message: 'permission denied' } };
    const json = await (await GET(req())).json();
    expect(json.ok).toBe(false);
    expect(json.missing).toEqual([]);
    expect(json.errors[0]).toMatch(/ingest_labels/);
  });
});

function res200(json: unknown) {
  return typeof json === 'object' && json !== null;
}
