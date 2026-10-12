import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A generic, fully-chainable fake Supabase query builder (same pattern as
 * `ingest-db-phase2.test.ts`): every method chains, and awaiting the chain
 * resolves via a per-table resolver function.
 */
function makeFakeSupabase(resolversByTable: Record<string, () => { data: unknown; error: unknown; count?: number }>) {
  const callsByTable: Record<string, { method: string; args: unknown[] }[]> = {};
  function from(table: string) {
    callsByTable[table] = callsByTable[table] ?? [];
    const chain: Record<string, unknown> = {};
    const methods = ['select', 'eq', 'in', 'not', 'gte', 'order', 'limit', 'is', 'maybeSingle', 'single', 'update', 'upsert', 'insert'];
    for (const m of methods) {
      chain[m] = (...args: unknown[]) => {
        callsByTable[table].push({ method: m, args });
        return chain;
      };
    }
    chain.then = (resolve: (v: { data: unknown; error: unknown; count?: number }) => void) => {
      const resolver = resolversByTable[table] ?? (() => ({ data: [], error: null }));
      return Promise.resolve(resolver()).then(resolve);
    };
    return chain;
  }
  return { client: { from }, callsByTable };
}

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
});

describe('recordSubmissionAttempt (review finding, HIGH item 2 — insert-then-count)', () => {
  it('inserts the attempt and returns its new row id', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { client, callsByTable } = makeFakeSupabase({
      ingest_submission_attempts: () => ({ data: { id: 'attempt-42' }, error: null }),
    });
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);

    const { recordSubmissionAttempt } = await import('../ingest/db');
    const id = await recordSubmissionAttempt('hash-abc', 'ETHDenver');

    expect(id).toBe('attempt-42');
    const insertCalls = callsByTable.ingest_submission_attempts.filter((c) => c.method === 'insert');
    expect(insertCalls).toEqual([{ method: 'insert', args: [{ ip_hash: 'hash-abc', conference: 'ETHDenver' }] }]);
  });

  it('throws a descriptive error when the insert fails', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { client } = makeFakeSupabase({ ingest_submission_attempts: () => ({ data: null, error: { message: 'boom' } }) });
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);
    const { recordSubmissionAttempt } = await import('../ingest/db');
    await expect(recordSubmissionAttempt('hash-abc', null)).rejects.toThrow('boom');
  });
});

describe('recordSubmissionAttemptCost (review finding, MEDIUM item 7 — aggregated, no per-submission ingest_runs row)', () => {
  it('updates the attempt row with cost/token usage, filtered by its id', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { client, callsByTable } = makeFakeSupabase({
      ingest_submission_attempts: () => ({ data: null, error: null }),
    });
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);

    const { recordSubmissionAttemptCost } = await import('../ingest/db');
    await recordSubmissionAttemptCost('attempt-42', { costUsd: 0.0025, inputTokens: 500, outputTokens: 80 });

    const updateCalls = callsByTable.ingest_submission_attempts.filter((c) => c.method === 'update');
    expect(updateCalls).toEqual([{ method: 'update', args: [{ cost_usd: 0.0025, input_tokens: 500, output_tokens: 80 }] }]);
    const eqCalls = callsByTable.ingest_submission_attempts.filter((c) => c.method === 'eq');
    expect(eqCalls).toContainEqual({ method: 'eq', args: ['id', 'attempt-42'] });
  });
});

describe('countRecentSubmissionAttempts / countGlobalRecentSubmissionAttempts / countConferenceRecentSubmissionAttempts', () => {
  it('countRecentSubmissionAttempts filters by ip_hash AND created_at', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { client, callsByTable } = makeFakeSupabase({ ingest_submission_attempts: () => ({ data: null, error: null, count: 3 }) });
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);
    const { countRecentSubmissionAttempts } = await import('../ingest/db');
    const result = await countRecentSubmissionAttempts('hash-abc', 900_000);
    expect(result).toBe(3);
    const eqCalls = callsByTable.ingest_submission_attempts.filter((c) => c.method === 'eq');
    expect(eqCalls).toContainEqual({ method: 'eq', args: ['ip_hash', 'hash-abc'] });
    expect(callsByTable.ingest_submission_attempts.some((c) => c.method === 'gte')).toBe(true);
  });

  it('countGlobalRecentSubmissionAttempts does NOT filter by ip_hash (it is the all-IP ceiling)', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { client, callsByTable } = makeFakeSupabase({ ingest_submission_attempts: () => ({ data: null, error: null, count: 61 }) });
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);
    const { countGlobalRecentSubmissionAttempts } = await import('../ingest/db');
    const result = await countGlobalRecentSubmissionAttempts(3_600_000);
    expect(result).toBe(61);
    expect(callsByTable.ingest_submission_attempts.some((c) => c.method === 'eq')).toBe(false);
  });

  it('countConferenceRecentSubmissionAttempts filters by conference', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { client, callsByTable } = makeFakeSupabase({ ingest_submission_attempts: () => ({ data: null, error: null, count: 12 }) });
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);
    const { countConferenceRecentSubmissionAttempts } = await import('../ingest/db');
    const result = await countConferenceRecentSubmissionAttempts('ETHDenver', 86_400_000);
    expect(result).toBe(12);
    const eqCalls = callsByTable.ingest_submission_attempts.filter((c) => c.method === 'eq');
    expect(eqCalls).toContainEqual({ method: 'eq', args: ['conference', 'ETHDenver'] });
  });

  it('a null count resolves to 0, never throws', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { client } = makeFakeSupabase({ ingest_submission_attempts: () => ({ data: null, error: null, count: undefined }) });
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);
    const { countGlobalRecentSubmissionAttempts } = await import('../ingest/db');
    expect(await countGlobalRecentSubmissionAttempts(1000)).toBe(0);
  });
});

describe('monthlyLlmCostUsd (review finding, MEDIUM item 7 — must include submission-attempt cost too)', () => {
  it('sums ingest_runs.est_cost_usd AND ingest_submission_attempts.cost_usd', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { client } = makeFakeSupabase({
      ingest_runs: () => ({ data: [{ est_cost_usd: 1.5 }, { est_cost_usd: 0.25 }], error: null }),
      ingest_submission_attempts: () => ({ data: [{ cost_usd: 0.1 }, { cost_usd: 0.05 }], error: null }),
    });
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);
    const { monthlyLlmCostUsd } = await import('../ingest/db');
    const total = await monthlyLlmCostUsd();
    expect(total).toBeCloseTo(1.9, 10);
  });

  it('throws if either query fails', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { client } = makeFakeSupabase({
      ingest_runs: () => ({ data: null, error: { message: 'runs failed' } }),
      ingest_submission_attempts: () => ({ data: [], error: null }),
    });
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);
    const { monthlyLlmCostUsd } = await import('../ingest/db');
    await expect(monthlyLlmCostUsd()).rejects.toThrow('runs failed');
  });
});
