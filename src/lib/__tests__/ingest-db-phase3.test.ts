import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A generic, fully-chainable fake Supabase query builder (same pattern as
 * `ingest-db-phase2.test.ts`): every `.from(table)` method chains, and
 * awaiting the chain resolves via a per-table resolver function. `rpc`
 * resolves via its own resolver, keyed by function name.
 */
function makeFakeSupabase(
  resolversByTable: Record<string, () => { data: unknown; error: unknown; count?: number }>,
  rpcResolversByFn: Record<string, () => { data: unknown; error: unknown }> = {}
) {
  const callsByTable: Record<string, { method: string; args: unknown[] }[]> = {};
  const rpcCalls: { fn: string; args: unknown }[] = [];
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
  async function rpc(fn: string, args: unknown) {
    rpcCalls.push({ fn, args });
    const resolver = rpcResolversByFn[fn];
    if (!resolver) throw new Error(`No rpc resolver registered for "${fn}"`);
    return resolver();
  }
  return { client: { from, rpc }, callsByTable, rpcCalls };
}

/** Postgres/PostgREST "doesn't exist (yet)" error, same codes `db.ts`'s
 *  `isMissingRelationError` checks (re-review finding C). */
function missingRelationError(code: string = '42P01') {
  return { message: 'relation "x" does not exist', code };
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

describe('markSubmissionAttemptRejected (re-review finding A)', () => {
  it('updates the attempt row with rejected: true, filtered by its id', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { client, callsByTable } = makeFakeSupabase({ ingest_submission_attempts: () => ({ data: null, error: null }) });
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);
    const { markSubmissionAttemptRejected } = await import('../ingest/db');
    await markSubmissionAttemptRejected('attempt-42');
    const updateCalls = callsByTable.ingest_submission_attempts.filter((c) => c.method === 'update');
    expect(updateCalls).toEqual([{ method: 'update', args: [{ rejected: true }] }]);
    const eqCalls = callsByTable.ingest_submission_attempts.filter((c) => c.method === 'eq');
    expect(eqCalls).toContainEqual({ method: 'eq', args: ['id', 'attempt-42'] });
  });

  it('throws a descriptive error on failure', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { client } = makeFakeSupabase({ ingest_submission_attempts: () => ({ data: null, error: { message: 'boom' } }) });
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);
    const { markSubmissionAttemptRejected } = await import('../ingest/db');
    await expect(markSubmissionAttemptRejected('attempt-42')).rejects.toThrow('boom');
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
  it('countRecentSubmissionAttempts filters by ip_hash AND created_at, but NOT rejected (a flood should keep counting against its own IP)', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { client, callsByTable } = makeFakeSupabase({ ingest_submission_attempts: () => ({ data: null, error: null, count: 3 }) });
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);
    const { countRecentSubmissionAttempts } = await import('../ingest/db');
    const result = await countRecentSubmissionAttempts('hash-abc', 900_000);
    expect(result).toBe(3);
    const eqCalls = callsByTable.ingest_submission_attempts.filter((c) => c.method === 'eq');
    expect(eqCalls).toContainEqual({ method: 'eq', args: ['ip_hash', 'hash-abc'] });
    expect(eqCalls.some((c) => c.args[0] === 'rejected')).toBe(false);
    expect(callsByTable.ingest_submission_attempts.some((c) => c.method === 'gte')).toBe(true);
  });

  it('countGlobalRecentSubmissionAttempts does NOT filter by ip_hash (it is the all-IP ceiling), but DOES filter rejected=false (re-review finding A)', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { client, callsByTable } = makeFakeSupabase({ ingest_submission_attempts: () => ({ data: null, error: null, count: 61 }) });
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);
    const { countGlobalRecentSubmissionAttempts } = await import('../ingest/db');
    const result = await countGlobalRecentSubmissionAttempts(3_600_000);
    expect(result).toBe(61);
    const eqCalls = callsByTable.ingest_submission_attempts.filter((c) => c.method === 'eq');
    expect(eqCalls.some((c) => c.args[0] === 'ip_hash')).toBe(false);
    expect(eqCalls).toContainEqual({ method: 'eq', args: ['rejected', false] });
  });

  it('countConferenceRecentSubmissionAttempts filters by conference AND rejected=false (re-review finding A)', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { client, callsByTable } = makeFakeSupabase({ ingest_submission_attempts: () => ({ data: null, error: null, count: 12 }) });
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);
    const { countConferenceRecentSubmissionAttempts } = await import('../ingest/db');
    const result = await countConferenceRecentSubmissionAttempts('ETHDenver', 86_400_000);
    expect(result).toBe(12);
    const eqCalls = callsByTable.ingest_submission_attempts.filter((c) => c.method === 'eq');
    expect(eqCalls).toContainEqual({ method: 'eq', args: ['conference', 'ETHDenver'] });
    expect(eqCalls).toContainEqual({ method: 'eq', args: ['rejected', false] });
  });

  it('a null count resolves to 0, never throws', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { client } = makeFakeSupabase({ ingest_submission_attempts: () => ({ data: null, error: null, count: undefined }) });
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);
    const { countGlobalRecentSubmissionAttempts } = await import('../ingest/db');
    expect(await countGlobalRecentSubmissionAttempts(1000)).toBe(0);
  });
});

describe('monthlyLlmCostUsd (re-review findings B + C — SQL-side sum, graceful degradation pre-migration)', () => {
  it('uses the get_monthly_ingest_cost_usd RPC when it is available (no 1000-row client-side truncation)', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { client, rpcCalls } = makeFakeSupabase({}, { get_monthly_ingest_cost_usd: () => ({ data: 12.3456, error: null }) });
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);
    const { monthlyLlmCostUsd } = await import('../ingest/db');
    const total = await monthlyLlmCostUsd();
    expect(total).toBeCloseTo(12.3456, 10);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe('get_monthly_ingest_cost_usd');
  });

  it('throws if the RPC fails for a reason OTHER than "doesn\'t exist yet"', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { client } = makeFakeSupabase({}, { get_monthly_ingest_cost_usd: () => ({ data: null, error: { message: 'permission denied', code: '42501' } }) });
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);
    const { monthlyLlmCostUsd } = await import('../ingest/db');
    await expect(monthlyLlmCostUsd()).rejects.toThrow('permission denied');
  });

  it('falls back to summing both tables client-side when the RPC itself does not exist yet (pre-migration)', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { client } = makeFakeSupabase(
      {
        ingest_runs: () => ({ data: [{ est_cost_usd: 1.5 }, { est_cost_usd: 0.25 }], error: null }),
        ingest_submission_attempts: () => ({ data: [{ cost_usd: 0.1 }, { cost_usd: 0.05 }], error: null }),
      },
      { get_monthly_ingest_cost_usd: () => ({ data: null, error: { message: 'function not found', code: 'PGRST202' } }) }
    );
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);
    const { monthlyLlmCostUsd } = await import('../ingest/db');
    const total = await monthlyLlmCostUsd();
    expect(total).toBeCloseTo(1.9, 10);
  });

  it('in the fallback, treats a missing ingest_submission_attempts table as $0 (re-review finding C) — the already-live cron must not break', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { client } = makeFakeSupabase(
      {
        ingest_runs: () => ({ data: [{ est_cost_usd: 3 }], error: null }),
        ingest_submission_attempts: () => ({ data: null, error: missingRelationError('42P01') }),
      },
      { get_monthly_ingest_cost_usd: () => ({ data: null, error: missingRelationError('PGRST202') }) }
    );
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);
    const { monthlyLlmCostUsd } = await import('../ingest/db');
    expect(await monthlyLlmCostUsd()).toBe(3);
  });

  it('in the fallback, STILL throws if ingest_runs itself fails (that table has existed since Phase 1b)', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { client } = makeFakeSupabase(
      {
        ingest_runs: () => ({ data: null, error: { message: 'runs failed', code: '42501' } }),
        ingest_submission_attempts: () => ({ data: [], error: null }),
      },
      { get_monthly_ingest_cost_usd: () => ({ data: null, error: missingRelationError('PGRST202') }) }
    );
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);
    const { monthlyLlmCostUsd } = await import('../ingest/db');
    await expect(monthlyLlmCostUsd()).rejects.toThrow('runs failed');
  });

  it('in the fallback, throws if ingest_submission_attempts fails for a reason OTHER than "missing"', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { client } = makeFakeSupabase(
      {
        ingest_runs: () => ({ data: [{ est_cost_usd: 1 }], error: null }),
        ingest_submission_attempts: () => ({ data: null, error: { message: 'permission denied', code: '42501' } }),
      },
      { get_monthly_ingest_cost_usd: () => ({ data: null, error: missingRelationError('PGRST202') }) }
    );
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);
    const { monthlyLlmCostUsd } = await import('../ingest/db');
    await expect(monthlyLlmCostUsd()).rejects.toThrow('permission denied');
  });
});
