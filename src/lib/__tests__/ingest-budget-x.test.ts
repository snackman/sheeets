import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/** Same fully-chainable fake Supabase builder as ingest-db-phase3.test.ts. */
function makeFakeSupabase(
  resolversByTable: Record<string, () => { data: unknown; error: unknown; count?: number }>,
  rpcResolversByFn: Record<string, () => { data: unknown; error: unknown }> = {}
) {
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
  async function rpc(fn: string) {
    const resolver = rpcResolversByFn[fn];
    if (!resolver) throw new Error(`No rpc resolver registered for "${fn}"`);
    return resolver();
  }
  return { client: { from, rpc }, callsByTable };
}

function missingRelationError(code: string = '42P01') {
  return { message: 'relation "x" does not exist', code };
}

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
});

describe('monthlyXCostUsd (Phase 4, §3.7) — kept strictly separate from monthlyLlmCostUsd', () => {
  it('sums via the get_monthly_ingest_x_cost_usd RPC when available', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { client } = makeFakeSupabase({}, { get_monthly_ingest_x_cost_usd: () => ({ data: 1.23, error: null }) });
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);
    const { monthlyXCostUsd } = await import('../ingest/db');
    expect(await monthlyXCostUsd()).toBe(1.23);
  });

  it('falls back to summing ingest_runs.x_cost_usd client-side when the RPC is missing (migration not applied yet)', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { client } = makeFakeSupabase(
      { ingest_runs: () => ({ data: [{ x_cost_usd: 0.05 }, { x_cost_usd: 0.1 }], error: null }) },
      { get_monthly_ingest_x_cost_usd: () => ({ data: null, error: missingRelationError('PGRST202') }) }
    );
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);
    const { monthlyXCostUsd } = await import('../ingest/db');
    expect(await monthlyXCostUsd()).toBeCloseTo(0.15, 6);
  });

  it('returns 0 (never throws) when the x_cost_usd column itself does not exist yet', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { client } = makeFakeSupabase(
      { ingest_runs: () => ({ data: null, error: missingRelationError('42703') }) },
      { get_monthly_ingest_x_cost_usd: () => ({ data: null, error: missingRelationError('PGRST202') }) }
    );
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);
    const { monthlyXCostUsd } = await import('../ingest/db');
    expect(await monthlyXCostUsd()).toBe(0);
  });

  it('propagates a REAL (non-missing-relation) RPC error', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { client } = makeFakeSupabase({}, { get_monthly_ingest_x_cost_usd: () => ({ data: null, error: { message: 'connection refused' } }) });
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);
    const { monthlyXCostUsd } = await import('../ingest/db');
    await expect(monthlyXCostUsd()).rejects.toThrow('connection refused');
  });
});

describe('checkMonthlyXBudget / getXMonthlyCapUsd — a SEPARATE cap from the LLM budget', () => {
  const originalCap = process.env.INGEST_X_MONTHLY_USD_CAP;
  afterEach(() => {
    if (originalCap === undefined) delete process.env.INGEST_X_MONTHLY_USD_CAP;
    else process.env.INGEST_X_MONTHLY_USD_CAP = originalCap;
    // Undo the `vi.doMock('../ingest/db', ...)` a couple of these tests
    // register — otherwise it leaks into LATER describe blocks in this
    // file that need the REAL db.ts (e.g. `recordRunXCost`), which would
    // then be missing from the still-active partial mock.
    vi.doUnmock('../ingest/db');
  });

  it('defaults to $15/month when INGEST_X_MONTHLY_USD_CAP is unset', async () => {
    delete process.env.INGEST_X_MONTHLY_USD_CAP;
    vi.resetModules();
    const { getXMonthlyCapUsd, DEFAULT_X_MONTHLY_CAP_USD } = await import('../ingest/budget');
    expect(getXMonthlyCapUsd()).toBe(DEFAULT_X_MONTHLY_CAP_USD);
    expect(DEFAULT_X_MONTHLY_CAP_USD).toBe(15);
  });

  it('honors a custom INGEST_X_MONTHLY_USD_CAP', async () => {
    process.env.INGEST_X_MONTHLY_USD_CAP = '42';
    vi.resetModules();
    const { getXMonthlyCapUsd } = await import('../ingest/budget');
    expect(getXMonthlyCapUsd()).toBe(42);
  });

  it('reports exceeded once spend reaches the cap, independent of LLM spend', async () => {
    process.env.INGEST_X_MONTHLY_USD_CAP = '10';
    vi.resetModules();
    vi.doMock('../ingest/db', () => ({
      monthlyXCostUsd: vi.fn(async () => 10),
      monthlyLlmCostUsd: vi.fn(async () => 0), // LLM spend is $0 — X cap alone must still trip.
    }));
    const { checkMonthlyXBudget } = await import('../ingest/budget');
    const status = await checkMonthlyXBudget();
    expect(status).toEqual({ spentUsd: 10, capUsd: 10, exceeded: true });
  });

  it('is not exceeded below the cap', async () => {
    process.env.INGEST_X_MONTHLY_USD_CAP = '10';
    vi.resetModules();
    vi.doMock('../ingest/db', () => ({
      monthlyXCostUsd: vi.fn(async () => 2.5),
      monthlyLlmCostUsd: vi.fn(async () => 0),
    }));
    const { checkMonthlyXBudget } = await import('../ingest/budget');
    const status = await checkMonthlyXBudget();
    expect(status).toEqual({ spentUsd: 2.5, capUsd: 10, exceeded: false });
  });
});

describe('recordRunXCost — best-effort, never breaks a run whose kind is not x_account', () => {
  it('writes x_posts_read and x_cost_usd onto the run row', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { client, callsByTable } = makeFakeSupabase({ ingest_runs: () => ({ data: null, error: null }) });
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);
    const { recordRunXCost } = await import('../ingest/db');
    await recordRunXCost('run-1', { xPostsRead: 7, xCostUsd: 0.035 });
    const updateCalls = callsByTable.ingest_runs.filter((c) => c.method === 'update');
    expect(updateCalls).toEqual([{ method: 'update', args: [{ x_posts_read: 7, x_cost_usd: 0.035 }] }]);
  });

  it('is a no-op for a zero-cost, zero-posts call (e.g. a non-X source never calls this at all, but defensively a no-op is safe)', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { client, callsByTable } = makeFakeSupabase({ ingest_runs: () => ({ data: null, error: null }) });
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);
    const { recordRunXCost } = await import('../ingest/db');
    await recordRunXCost('run-1', { xPostsRead: 0, xCostUsd: 0 });
    expect(callsByTable.ingest_runs ?? []).toEqual([]);
  });

  it('swallows a missing-column/table error instead of throwing (migration not applied yet)', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { client } = makeFakeSupabase({ ingest_runs: () => ({ data: null, error: missingRelationError('42703') }) });
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);
    const { recordRunXCost } = await import('../ingest/db');
    await expect(recordRunXCost('run-1', { xPostsRead: 3, xCostUsd: 0.015 })).resolves.toBeUndefined();
  });

  it('propagates a REAL error', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { client } = makeFakeSupabase({ ingest_runs: () => ({ data: null, error: { message: 'boom' } }) });
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);
    const { recordRunXCost } = await import('../ingest/db');
    await expect(recordRunXCost('run-1', { xPostsRead: 3, xCostUsd: 0.015 })).rejects.toThrow('boom');
  });
});

describe('getRunCostBySourceKind (Phase 4, §9.1 item 4 "volume and cost per source type")', () => {
  it('returns rows from the ingest_run_cost_by_source_kind view', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const rows = [{ source_kind: 'x_account', run_count: 4, llm_cost_usd: 0.01, x_cost_usd: 0.05, llm_input_tokens: 100, llm_output_tokens: 20 }];
    const { client } = makeFakeSupabase({ ingest_run_cost_by_source_kind: () => ({ data: rows, error: null }) });
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);
    const { getRunCostBySourceKind } = await import('../ingest/db');
    expect(await getRunCostBySourceKind('ETHDenver')).toEqual(rows);
  });

  it('returns [] when the view does not exist yet, never throws', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { client } = makeFakeSupabase({ ingest_run_cost_by_source_kind: () => ({ data: null, error: missingRelationError() }) });
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);
    const { getRunCostBySourceKind } = await import('../ingest/db');
    expect(await getRunCostBySourceKind('ETHDenver')).toEqual([]);
  });
});
