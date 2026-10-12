import { describe, it, expect, vi, beforeEach } from 'vitest';

// A minimal chainable fake standing in for the Supabase query builder, just
// accurate enough for the call shapes `db.ts` actually makes
// (`.from(table).select(...).eq().eq().maybeSingle()`,
// `.from(table).upsert(payload, opts).select('*').single()`,
// `.from(table).update(patch).eq().in().select('*').maybeSingle()`,
// `.from(table).update(patch).eq().not('status','in',list).select('*').maybeSingle()`).
interface FakeCall {
  table: string;
  op: 'select' | 'upsert' | 'update' | null;
  payload?: Record<string, unknown>;
  filters: Record<string, unknown>;
  notFilters: Record<string, unknown>;
}

function makeFakeSupabase(resolve: (call: FakeCall) => { data: unknown; error: unknown }) {
  const calls: FakeCall[] = [];
  function from(table: string) {
    const call: FakeCall = { table, op: null, filters: {}, notFilters: {} };
    calls.push(call);
    const chain = {
      select: (..._args: unknown[]) => {
        if (!call.op) call.op = 'select';
        return chain;
      },
      upsert: (payload: Record<string, unknown>) => {
        call.op = 'upsert';
        call.payload = payload;
        return chain;
      },
      update: (payload: Record<string, unknown>) => {
        call.op = 'update';
        call.payload = payload;
        return chain;
      },
      eq: (col: string, val: unknown) => {
        call.filters[col] = val;
        return chain;
      },
      in: (col: string, vals: unknown) => {
        call.filters[col] = vals;
        return chain;
      },
      not: (col: string, _op: string, vals: unknown) => {
        call.notFilters[col] = vals;
        return chain;
      },
      maybeSingle: async () => resolve(call),
      single: async () => resolve(call),
    };
    return chain;
  }
  return { client: { from }, calls };
}

/**
 * Simulates a real table for `upsertCandidate`'s up-to-three-call flow:
 * step 1 tries `.in('status', FINAL)`, step 2 tries
 * `.not('status','in',FINAL)`, step 3 (no existing row at all) upserts.
 * Exactly one of the three calls should ever "match" (return non-null
 * data) for a given `existingStatus`.
 */
function makeUpsertCandidateResolver(existingStatus: string | null) {
  return (call: FakeCall) => {
    if (call.op === 'update' && 'status' in call.filters) {
      // Step 1: .in('status', FINAL_CANDIDATE_STATUSES)
      const finalList = call.filters.status as string[];
      const matches = existingStatus !== null && finalList.includes(existingStatus);
      return matches ? { data: { ...call.payload, id: 'row-1', status: existingStatus }, error: null } : { data: null, error: null };
    }
    if (call.op === 'update' && 'status' in call.notFilters) {
      // Step 2: .not('status', 'in', '("a","b",...)')
      const notList = String(call.notFilters.status).replace(/[()"]/g, '').split(',').filter(Boolean);
      const matches = existingStatus !== null && !notList.includes(existingStatus);
      return matches ? { data: { ...call.payload, id: 'row-1' }, error: null } : { data: null, error: null };
    }
    if (call.op === 'upsert') {
      // Step 3: no existing row at all.
      return { data: { ...call.payload, id: 'row-1' }, error: null };
    }
    return { data: null, error: null };
  };
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}));

beforeEach(() => {
  vi.resetModules();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
});

describe('upsertCandidate: final-status protection (MEDIUM item 1 / CRITICAL item 2)', () => {
  it('writes every field as normal when no existing row (or a non-final one) is found', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { client, calls } = makeFakeSupabase(makeUpsertCandidateResolver('queued'));
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);

    const { upsertCandidate } = await import('../ingest/db');
    const row = { conference: 'Conf', canonical_key: 'luma:evt-1', status: 'auto_rejected', llm_score: 10, event: { name: 'X' } };
    await upsertCandidate(row);

    // Step 1 (final-only) must not have matched; step 2 (non-final) did.
    const nonFinalUpdate = calls.find((c) => c.op === 'update' && 'status' in c.notFilters)!;
    expect(nonFinalUpdate.payload).toMatchObject({ status: 'auto_rejected', llm_score: 10 });
    expect(calls.some((c) => c.op === 'upsert')).toBe(false);
  });

  it('inserts a brand new row when none exists at all', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { client, calls } = makeFakeSupabase(makeUpsertCandidateResolver(null));
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);

    const { upsertCandidate } = await import('../ingest/db');
    const row = { conference: 'Conf', canonical_key: 'luma:evt-new', status: 'new', event: { name: 'Brand new' } };
    const result = await upsertCandidate(row);

    expect(calls.filter((c) => c.op === 'update')).toHaveLength(2); // both conditional updates tried, neither matched
    const insertCall = calls.find((c) => c.op === 'upsert')!;
    expect(insertCall.payload).toMatchObject({ status: 'new' });
    expect(result).toMatchObject({ status: 'new' });
  });

  it('strips event/content_hash and every decision field when the existing row is already final (approved) — only ical_hash/last_seen_at/sources survive', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { client, calls } = makeFakeSupabase(makeUpsertCandidateResolver('approved'));
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);

    const { upsertCandidate } = await import('../ingest/db');
    const row = {
      conference: 'Conf',
      canonical_key: 'luma:evt-1',
      status: 'auto_rejected', // a re-ingest trying to overwrite the decision
      llm_score: 10,
      published_event_id: 'should-not-be-cleared',
      // This is the MEDIUM item 1 bug: event/content_hash must NOT overwrite
      // an enriched/admin-edited snapshot with the bare iCal stub.
      event: { name: 'X refreshed from the bare stub' },
      content_hash: 'new-content-hash',
      ical_hash: 'new-ical-hash',
      sources: [{ source_id: 'src-1', kind: 'luma_ical', ref: 'evt-1@events.lu.ma', seen_at: '2027-01-01T00:00:00.000Z' }],
    };
    await upsertCandidate(row);

    const finalUpdate = calls.find((c) => c.op === 'update' && 'status' in c.filters)!;
    expect(finalUpdate.payload).not.toHaveProperty('status');
    expect(finalUpdate.payload).not.toHaveProperty('llm_score');
    expect(finalUpdate.payload).not.toHaveProperty('published_event_id');
    expect(finalUpdate.payload).not.toHaveProperty('event');
    expect(finalUpdate.payload).not.toHaveProperty('content_hash');
    // Only these three survive.
    expect(finalUpdate.payload).toMatchObject({ ical_hash: 'new-ical-hash', sources: row.sources });
    expect(finalUpdate.payload).toHaveProperty('last_seen_at');
    // Never even attempted the non-final path or an insert.
    expect(calls.some((c) => c.op === 'update' && 'status' in c.notFilters)).toBe(false);
    expect(calls.some((c) => c.op === 'upsert')).toBe(false);
  });

  it.each(['auto_published', 'rejected', 'unpublished', 'unpublished_external'])(
    'also protects status %s',
    async (finalStatus) => {
      const { createClient } = await import('@supabase/supabase-js');
      const { client, calls } = makeFakeSupabase(makeUpsertCandidateResolver(finalStatus));
      (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);

      const { upsertCandidate } = await import('../ingest/db');
      await upsertCandidate({ conference: 'Conf', canonical_key: 'luma:evt-1', status: 'duplicate', event: { name: 'X' }, ical_hash: 'h' });

      const finalUpdate = calls.find((c) => c.op === 'update' && 'status' in c.filters)!;
      expect(finalUpdate.payload).not.toHaveProperty('status');
      expect(finalUpdate.payload).not.toHaveProperty('event');
    }
  );
});

describe('claimCandidateStatus: atomic transition (HIGH item 3)', () => {
  it('returns the updated row when the current status is eligible', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { client } = makeFakeSupabase(() => ({ data: { id: 'c-1', status: 'approved' }, error: null }));
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);

    const { claimCandidateStatus } = await import('../ingest/db');
    const result = await claimCandidateStatus('c-1', ['queued', 'auto_rejected'], 'approved');
    expect(result).toEqual({ id: 'c-1', status: 'approved' });
  });

  it('returns null when the row is not in an eligible status (acts as a lock against a concurrent duplicate claim)', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    // Simulate the conditional update matching zero rows (status already changed).
    const { client } = makeFakeSupabase(() => ({ data: null, error: null }));
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);

    const { claimCandidateStatus } = await import('../ingest/db');
    const result = await claimCandidateStatus('c-1', ['queued'], 'approved');
    expect(result).toBeNull();
  });

  it('filters the update to only the given fromStatuses', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { client, calls } = makeFakeSupabase(() => ({ data: { id: 'c-1' }, error: null }));
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);

    const { claimCandidateStatus } = await import('../ingest/db');
    await claimCandidateStatus('c-1', ['queued', 'auto_rejected', 'error', 'pending_classify'], 'approved', { reviewed_by: 'admin' });

    const updateCall = calls.find((c) => c.op === 'update')!;
    expect(updateCall.payload).toMatchObject({ status: 'approved', reviewed_by: 'admin' });
    expect(updateCall.filters.status).toEqual(['queued', 'auto_rejected', 'error', 'pending_classify']);
    expect(updateCall.filters.id).toBe('c-1');
  });
});

describe('getCachedLumaApiId: tri-state (MEDIUM item 7)', () => {
  it('returns undefined when no cache row exists', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { client } = makeFakeSupabase(() => ({ data: null, error: null }));
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);

    const { getCachedLumaApiId } = await import('../ingest/db');
    expect(await getCachedLumaApiId('luma:never-looked-up')).toBeUndefined();
  });

  it('returns null (a confirmed miss) when a row exists with no luma_api_id', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { client } = makeFakeSupabase(() => ({ data: { luma_api_id: null }, error: null }));
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);

    const { getCachedLumaApiId } = await import('../ingest/db');
    expect(await getCachedLumaApiId('luma:confirmed-miss')).toBeNull();
  });

  it('returns the resolved id when cached', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { client } = makeFakeSupabase(() => ({ data: { luma_api_id: 'evt-ABC' }, error: null }));
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);

    const { getCachedLumaApiId } = await import('../ingest/db');
    expect(await getCachedLumaApiId('luma:some-slug')).toBe('evt-ABC');
  });
});
