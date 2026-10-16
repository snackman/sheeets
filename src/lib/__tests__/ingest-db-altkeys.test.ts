import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A generic, fully-chainable fake Supabase query builder (same pattern as
 * `ingest-db-phase3.test.ts`): every `.from(table)` method chains, and
 * awaiting the chain resolves via a per-table resolver function. Includes
 * `contains` (not in that file's method list) — needed for
 * `getCandidateByKeyOrAltKey`'s `alt_keys` lookup.
 */
function makeFakeSupabase(resolversByTable: Record<string, () => { data: unknown; error: unknown }>) {
  const callsByTable: Record<string, { method: string; args: unknown[] }[]> = {};
  function from(table: string) {
    callsByTable[table] = callsByTable[table] ?? [];
    const chain: Record<string, unknown> = {};
    const methods = ['select', 'eq', 'in', 'not', 'contains', 'gte', 'order', 'limit', 'is', 'maybeSingle', 'single', 'update', 'upsert', 'insert'];
    for (const m of methods) {
      chain[m] = (...args: unknown[]) => {
        callsByTable[table].push({ method: m, args });
        return chain;
      };
    }
    chain.then = (resolve: (v: { data: unknown; error: unknown }) => void) => {
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

// Bug: "short Luma links bypass dedupe" — `alt_keys` (gin-indexed on
// `ingest_candidates`) was written (by the curated iCal path, for a Luma
// vanity-slug alias) but never actually QUERIED anywhere, so a short link
// resolved to the same evt- api id as an existing candidate could never be
// found via its alt key. `getCandidateByKeyOrAltKey` is the fix.
describe('getCandidateByKeyOrAltKey', () => {
  it('returns the exact canonical_key match directly, without ever querying alt_keys', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { client, callsByTable } = makeFakeSupabase({
      ingest_candidates: () => ({ data: { id: 'row-1', canonical_key: 'luma:evt-abc123', alt_keys: [] }, error: null }),
    });
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);

    const { getCandidateByKeyOrAltKey } = await import('../ingest/db');
    const result = await getCandidateByKeyOrAltKey('ETHDenver', 'luma:evt-abc123');

    expect(result).toEqual({ id: 'row-1', canonical_key: 'luma:evt-abc123', alt_keys: [] });
    expect(callsByTable.ingest_candidates.some((c) => c.method === 'contains')).toBe(false);
  });

  it('falls back to an alt_keys match when there is no exact canonical_key match', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    let call = 0;
    const { client, callsByTable } = makeFakeSupabase({
      ingest_candidates: () => {
        call++;
        // Call 1: getCandidateByKey's exact-match `.maybeSingle()` — no row.
        if (call === 1) return { data: null, error: null };
        // Call 2: the alt_keys `.contains(...).limit(1)` fallback — one match.
        return { data: [{ id: 'row-1', canonical_key: 'luma:evt-abc123', alt_keys: ['luma:discovered-mixer'] }], error: null };
      },
    });
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);

    const { getCandidateByKeyOrAltKey } = await import('../ingest/db');
    const result = await getCandidateByKeyOrAltKey('ETHDenver', 'luma:discovered-mixer');

    expect(result).toEqual({ id: 'row-1', canonical_key: 'luma:evt-abc123', alt_keys: ['luma:discovered-mixer'] });
    const altKeysCall = callsByTable.ingest_candidates.find((c) => c.method === 'contains');
    expect(altKeysCall?.args).toEqual(['alt_keys', ['luma:discovered-mixer']]);
  });

  it('returns null when neither the exact key nor any alt_keys match', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { client } = makeFakeSupabase({
      ingest_candidates: () => ({ data: null, error: null }),
    });
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);

    const { getCandidateByKeyOrAltKey } = await import('../ingest/db');
    const result = await getCandidateByKeyOrAltKey('ETHDenver', 'luma:nope');

    expect(result).toBeNull();
  });
});
