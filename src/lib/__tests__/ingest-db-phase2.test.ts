import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A generic, fully-chainable fake Supabase query builder: every method
 * (`select`, `eq`, `in`, `order`, `limit`, ...) returns `this` so any call
 * shape chains without the method-specific fakes `ingest-db.test.ts` needs
 * for `upsertCandidate`'s conditional-update dance. Awaiting the chain
 * (`then`) resolves via a per-table resolver, so each test only needs to
 * say what each table should return, not reproduce the exact chain.
 */
function makeFakeSupabase(resolversByTable: Record<string, () => { data: unknown; error: unknown }>) {
  const callsByTable: Record<string, { method: string; args: unknown[] }[]> = {};
  function from(table: string) {
    callsByTable[table] = callsByTable[table] ?? [];
    const chain: Record<string, unknown> = {};
    const methods = ['select', 'eq', 'in', 'not', 'order', 'limit', 'is', 'maybeSingle', 'single'];
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

describe('listLabelsForFewShot', () => {
  it('filters by theme_key, label_kind=theme and excluded_from_fewshot=false', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { client, callsByTable } = makeFakeSupabase({
      ingest_labels: () => ({ data: [{ id: 'l1' }], error: null }),
    });
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);

    const { listLabelsForFewShot } = await import('../ingest/db');
    const result = await listLabelsForFewShot('crypto');

    expect(result).toEqual([{ id: 'l1' }]);
    const eqCalls = callsByTable.ingest_labels.filter((c) => c.method === 'eq');
    expect(eqCalls).toContainEqual({ method: 'eq', args: ['theme_key', 'crypto'] });
    expect(eqCalls).toContainEqual({ method: 'eq', args: ['label_kind', 'theme'] });
    expect(eqCalls).toContainEqual({ method: 'eq', args: ['excluded_from_fewshot', false] });
  });

  it('throws a descriptive error when the query fails', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { client } = makeFakeSupabase({ ingest_labels: () => ({ data: null, error: { message: 'boom' } }) });
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);
    const { listLabelsForFewShot } = await import('../ingest/db');
    await expect(listLabelsForFewShot('crypto')).rejects.toThrow('boom');
  });
});

describe('getPrecisionRows', () => {
  it('selects all ingest_precision rows for the conference', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { client, callsByTable } = makeFakeSupabase({
      ingest_precision: () => ({ data: [{ conference: 'Test Conf', shadow_publish_candidates: 10 }], error: null }),
    });
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);

    const { getPrecisionRows } = await import('../ingest/db');
    const result = await getPrecisionRows('Test Conf');

    expect(result).toHaveLength(1);
    expect(callsByTable.ingest_precision).toContainEqual({ method: 'eq', args: ['conference', 'Test Conf'] });
  });
});

describe('getRecentAutoPublishOutcomes', () => {
  it('filters to auto_published/unpublished/unpublished_external, ordered by published_at desc', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { client, callsByTable } = makeFakeSupabase({
      ingest_candidates: () => ({ data: [{ status: 'auto_published' }], error: null }),
    });
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);

    const { getRecentAutoPublishOutcomes } = await import('../ingest/db');
    const result = await getRecentAutoPublishOutcomes('Test Conf', 25);

    expect(result).toEqual([{ status: 'auto_published' }]);
    const calls = callsByTable.ingest_candidates;
    expect(calls).toContainEqual({ method: 'in', args: ['status', ['auto_published', 'unpublished', 'unpublished_external']] });
    expect(calls).toContainEqual({ method: 'order', args: ['published_at', { ascending: false }] });
    expect(calls).toContainEqual({ method: 'limit', args: [25] });
  });
});

describe('getCandidateVolumeBySource', () => {
  it('aggregates candidate counts per source and joins in the source label/kind', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    // Both `ingest_candidates` (the raw rows this aggregates) and
    // `ingest_sources` (which the real, un-mocked `listSources` queries for
    // the label/kind join) go through the SAME fake client — no need to
    // mock `db.ts` itself (and self-mocking the module under test doesn't
    // work anyway: `getCandidateVolumeBySource`'s own internal call to
    // `listSources` is an in-module reference, not a re-imported one, so a
    // `vi.doMock` on this module would only affect OTHER importers, while
    // also leaking into later tests in this file since nothing undoes it).
    const { client } = makeFakeSupabase({
      ingest_candidates: () => ({
        data: [
          { source_id: 'src-1', status: 'auto_published' },
          { source_id: 'src-1', status: 'queued' },
          { source_id: 'src-1', status: 'rejected' },
          { source_id: 'src-2', status: 'approved' },
          { source_id: null, status: 'filtered_out' }, // no source_id -> excluded
        ],
        error: null,
      }),
      ingest_sources: () => ({
        data: [
          { id: 'src-1', conference: 'Test Conf', kind: 'luma_ical', label: 'Main Calendar' },
          { id: 'src-2', conference: 'Test Conf', kind: 'luma_ical', label: '' },
        ],
        error: null,
      }),
    });
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);

    const { getCandidateVolumeBySource } = await import('../ingest/db');
    const result = await getCandidateVolumeBySource('Test Conf');

    const src1 = result.find((r) => r.source_id === 'src-1')!;
    expect(src1.total).toBe(3);
    expect(src1.published).toBe(1);
    expect(src1.queued).toBe(1);
    expect(src1.rejected).toBe(1);
    expect(src1.label).toBe('Main Calendar');

    const src2 = result.find((r) => r.source_id === 'src-2')!;
    expect(src2.total).toBe(1);
    expect(src2.published).toBe(1);
    expect(src2.label).toBe('luma_ical'); // falls back to kind when label is blank
  });
});

describe('listRecentLabelMismatches', () => {
  it('queries false positives (admin_unpublish) and false negatives (on_theme + model_route=reject) independently', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { client, callsByTable } = makeFakeSupabase({
      ingest_labels: () => ({ data: [{ id: 'l1' }], error: null }),
    });
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);

    const { listRecentLabelMismatches } = await import('../ingest/db');
    const result = await listRecentLabelMismatches('Test Conf', 5);

    expect(result.falsePositives).toEqual([{ id: 'l1' }]);
    expect(result.falseNegatives).toEqual([{ id: 'l1' }]);
    const eqCalls = callsByTable.ingest_labels.filter((c) => c.method === 'eq');
    expect(eqCalls).toContainEqual({ method: 'eq', args: ['source', 'admin_unpublish'] });
    expect(eqCalls).toContainEqual({ method: 'eq', args: ['label', 'on_theme'] });
    expect(eqCalls).toContainEqual({ method: 'eq', args: ['model_route', 'reject'] });
  });
});
