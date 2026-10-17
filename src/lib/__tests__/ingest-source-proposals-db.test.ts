// `db.ts`'s calendar-auto-discovery proposal functions (plan item 3):
// insert-or-update-while-proposed semantics, and — the single most
// important guarantee of this feature — a 'dismissed' (or 'accepted') row
// is NEVER touched again by a later `upsertSourceProposal` call, no matter
// how many times that calendar is still found eligible.
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A queue-based fake Supabase query builder: each table gets a QUEUE of
 * canned `{data, error}` responses, consumed in call order — needed here
 * because `upsertSourceProposal` makes TWO sequential calls against the
 * SAME table (a `select` via `getSourceProposal`, then either an `update`
 * or an `insert`) that must return DIFFERENT results.
 */
function makeFakeSupabase(responseQueuesByTable: Record<string, { data: unknown; error: unknown }[]>) {
  const callsByTable: Record<string, { method: string; args: unknown[] }[]> = {};
  function from(table: string) {
    callsByTable[table] = callsByTable[table] ?? [];
    const chain: Record<string, unknown> = {};
    const methods = ['select', 'eq', 'order', 'maybeSingle', 'update', 'insert'];
    for (const m of methods) {
      chain[m] = (...args: unknown[]) => {
        callsByTable[table].push({ method: m, args });
        return chain;
      };
    }
    chain.then = (resolve: (v: { data: unknown; error: unknown }) => void) => {
      const queue = responseQueuesByTable[table];
      const next = queue && queue.length > 0 ? queue.shift()! : { data: null, error: { message: `unexpected extra call to ${table}`, code: 'TEST' } };
      return Promise.resolve(next).then(resolve);
    };
    return chain;
  }
  return { client: { from }, callsByTable };
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

describe('upsertSourceProposal', () => {
  it('inserts a fresh row when none exists yet', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { client, callsByTable } = makeFakeSupabase({
      ingest_source_proposals: [
        { data: null, error: null }, // getSourceProposal: no existing row
        { data: null, error: null }, // insert
      ],
    });
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);

    const { upsertSourceProposal } = await import('../ingest/db');
    await upsertSourceProposal({
      conference: 'DAS London',
      calendar_api_id: 'cal-FU1X0TNBTO8ti2F',
      calendar_name: 'The Best Event',
      evidence: { inWindowCount: 2, newCount: 1, sample: [] },
    });

    const insertCalls = callsByTable.ingest_source_proposals.filter((c) => c.method === 'insert');
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0].args[0]).toMatchObject({
      conference: 'DAS London',
      calendar_api_id: 'cal-FU1X0TNBTO8ti2F',
      status: 'proposed',
    });
  });

  it('updates an existing "proposed" row\'s evidence instead of inserting a duplicate', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { client, callsByTable } = makeFakeSupabase({
      ingest_source_proposals: [
        { data: { id: 'prop-1', status: 'proposed', conference: 'DAS London', calendar_api_id: 'cal-FU1X0TNBTO8ti2F' }, error: null },
        { data: null, error: null }, // update
      ],
    });
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);

    const { upsertSourceProposal } = await import('../ingest/db');
    await upsertSourceProposal({
      conference: 'DAS London',
      calendar_api_id: 'cal-FU1X0TNBTO8ti2F',
      calendar_name: 'The Best Event',
      evidence: { inWindowCount: 5, newCount: 3, sample: [] },
    });

    expect(callsByTable.ingest_source_proposals.some((c) => c.method === 'insert')).toBe(false);
    const updateCalls = callsByTable.ingest_source_proposals.filter((c) => c.method === 'update');
    expect(updateCalls).toHaveLength(1);
    expect((updateCalls[0].args[0] as { evidence: unknown }).evidence).toEqual({ inWindowCount: 5, newCount: 3, sample: [] });
  });

  it('NEVER re-touches a "dismissed" row — no update, no insert, no status change', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { client, callsByTable } = makeFakeSupabase({
      ingest_source_proposals: [
        { data: { id: 'prop-1', status: 'dismissed', conference: 'DAS London', calendar_api_id: 'cal-FU1X0TNBTO8ti2F' }, error: null },
      ],
    });
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);

    const { upsertSourceProposal } = await import('../ingest/db');
    await upsertSourceProposal({
      conference: 'DAS London',
      calendar_api_id: 'cal-FU1X0TNBTO8ti2F',
      calendar_name: 'The Best Event',
      evidence: { inWindowCount: 99, newCount: 99, sample: [] },
    });

    expect(callsByTable.ingest_source_proposals.some((c) => c.method === 'update')).toBe(false);
    expect(callsByTable.ingest_source_proposals.some((c) => c.method === 'insert')).toBe(false);
  });

  it('NEVER re-touches an "accepted" row either', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { client, callsByTable } = makeFakeSupabase({
      ingest_source_proposals: [
        { data: { id: 'prop-1', status: 'accepted', conference: 'DAS London', calendar_api_id: 'cal-FU1X0TNBTO8ti2F' }, error: null },
      ],
    });
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);

    const { upsertSourceProposal } = await import('../ingest/db');
    await upsertSourceProposal({
      conference: 'DAS London',
      calendar_api_id: 'cal-FU1X0TNBTO8ti2F',
      calendar_name: 'The Best Event',
      evidence: { inWindowCount: 99, newCount: 99, sample: [] },
    });

    expect(callsByTable.ingest_source_proposals.some((c) => c.method === 'update')).toBe(false);
    expect(callsByTable.ingest_source_proposals.some((c) => c.method === 'insert')).toBe(false);
  });

  it('degrades gracefully when the table does not exist yet (migration not applied)', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { client } = makeFakeSupabase({
      ingest_source_proposals: [{ data: null, error: missingRelationError() }, { data: null, error: missingRelationError() }],
    });
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);

    const { upsertSourceProposal } = await import('../ingest/db');
    await expect(
      upsertSourceProposal({
        conference: 'DAS London',
        calendar_api_id: 'cal-FU1X0TNBTO8ti2F',
        calendar_name: null,
        evidence: { inWindowCount: 2, newCount: 1, sample: [] },
      })
    ).resolves.toBeUndefined();
  });
});

describe('listSourceProposals / getSourceProposalById / decideSourceProposal', () => {
  it('listSourceProposals filters by status when given one', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { client, callsByTable } = makeFakeSupabase({
      ingest_source_proposals: [{ data: [{ id: 'prop-1', status: 'proposed' }], error: null }],
    });
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);
    const { listSourceProposals } = await import('../ingest/db');
    const rows = await listSourceProposals('DAS London', 'proposed');
    expect(rows).toEqual([{ id: 'prop-1', status: 'proposed' }]);
    expect(callsByTable.ingest_source_proposals.some((c) => c.method === 'eq' && c.args[0] === 'status' && c.args[1] === 'proposed')).toBe(true);
  });

  it('listSourceProposals returns [] when the table does not exist yet', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { client } = makeFakeSupabase({ ingest_source_proposals: [{ data: null, error: missingRelationError() }] });
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);
    const { listSourceProposals } = await import('../ingest/db');
    expect(await listSourceProposals('DAS London')).toEqual([]);
  });

  it('decideSourceProposal writes status/decided_at/decided_by', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { client, callsByTable } = makeFakeSupabase({ ingest_source_proposals: [{ data: null, error: null }] });
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);
    const { decideSourceProposal } = await import('../ingest/db');
    await decideSourceProposal('prop-1', 'dismissed', 'admin');
    const updateCalls = callsByTable.ingest_source_proposals.filter((c) => c.method === 'update');
    expect(updateCalls[0].args[0]).toMatchObject({ status: 'dismissed', decided_by: 'admin' });
  });
});
