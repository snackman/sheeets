import { describe, it, expect, vi, beforeEach } from 'vitest';

// A minimal chainable fake standing in for the Supabase query builder, just
// accurate enough for the call shapes `db.ts` actually makes
// (`.from(table).select(...).eq().eq().maybeSingle()`,
// `.from(table).upsert(payload, opts).select('*').single()`,
// `.from(table).update(patch).eq().in().select('*').maybeSingle()`).
interface FakeCall {
  table: string;
  op: 'select' | 'upsert' | 'update' | null;
  payload?: Record<string, unknown>;
  filters: Record<string, unknown>;
}

function makeFakeSupabase(resolve: (call: FakeCall) => { data: unknown; error: unknown }) {
  const calls: FakeCall[] = [];
  function from(table: string) {
    const call: FakeCall = { table, op: null, filters: {} };
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
      maybeSingle: async () => resolve(call),
      single: async () => resolve(call),
    };
    return chain;
  }
  return { client: { from }, calls };
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}));

beforeEach(() => {
  vi.resetModules();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
});

describe('upsertCandidate: final-status protection (CRITICAL item 2)', () => {
  it('writes every field as normal when no existing row (or a non-final one) is found', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { client, calls } = makeFakeSupabase((call) => {
      if (call.op === 'select') return { data: { status: 'queued' }, error: null };
      if (call.op === 'upsert') return { data: { ...call.payload, id: 'row-1' }, error: null };
      return { data: null, error: null };
    });
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);

    const { upsertCandidate } = await import('../ingest/db');
    const row = { conference: 'Conf', canonical_key: 'luma:evt-1', status: 'auto_rejected', llm_score: 10, event: { name: 'X' } };
    await upsertCandidate(row);

    const upsertCall = calls.find((c) => c.op === 'upsert')!;
    expect(upsertCall.payload).toMatchObject({ status: 'auto_rejected', llm_score: 10 });
  });

  it('strips status and every decision field when the existing row is already final (approved)', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { client, calls } = makeFakeSupabase((call) => {
      if (call.op === 'select') return { data: { status: 'approved' }, error: null };
      if (call.op === 'upsert') return { data: { ...call.payload, id: 'row-1' }, error: null };
      return { data: null, error: null };
    });
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);

    const { upsertCandidate } = await import('../ingest/db');
    const row = {
      conference: 'Conf',
      canonical_key: 'luma:evt-1',
      status: 'auto_rejected', // a re-ingest trying to overwrite the decision
      llm_score: 10,
      published_event_id: 'should-not-be-cleared',
      event: { name: 'X refreshed' },
      content_hash: 'new-content-hash',
      ical_hash: 'new-ical-hash',
    };
    await upsertCandidate(row);

    const upsertCall = calls.find((c) => c.op === 'upsert')!;
    expect(upsertCall.payload).not.toHaveProperty('status');
    expect(upsertCall.payload).not.toHaveProperty('llm_score');
    expect(upsertCall.payload).not.toHaveProperty('published_event_id');
    // Only the raw snapshot fields survive.
    expect(upsertCall.payload).toMatchObject({ event: { name: 'X refreshed' }, content_hash: 'new-content-hash', ical_hash: 'new-ical-hash' });
  });

  it.each(['auto_published', 'rejected', 'unpublished', 'unpublished_external'])(
    'also protects status %s',
    async (finalStatus) => {
      const { createClient } = await import('@supabase/supabase-js');
      const { client, calls } = makeFakeSupabase((call) => {
        if (call.op === 'select') return { data: { status: finalStatus }, error: null };
        if (call.op === 'upsert') return { data: { ...call.payload, id: 'row-1' }, error: null };
        return { data: null, error: null };
      });
      (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);

      const { upsertCandidate } = await import('../ingest/db');
      await upsertCandidate({ conference: 'Conf', canonical_key: 'luma:evt-1', status: 'duplicate', event: { name: 'X' } });

      const upsertCall = calls.find((c) => c.op === 'upsert')!;
      expect(upsertCall.payload).not.toHaveProperty('status');
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
