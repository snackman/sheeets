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
    const methods = ['select', 'eq', 'order', 'maybeSingle', 'update', 'insert', 'like', 'limit', 'range', 'in', 'single'];
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

// Review finding, MEDIUM item 2: a Luma candidate already rejected as
// spam/off-theme is a bad signal that its calendar is worth proposing —
// excluded from the pool `discover-calendars.ts` walks.
describe('listLumaCandidatesForConference', () => {
  it('excludes a candidate rejected with reason "spam" or "off_theme"', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const rows = [
      { id: 'c1', canonical_key: 'luma:evt-a', status: 'rejected', reject_reason: 'spam' },
      { id: 'c2', canonical_key: 'luma:evt-b', status: 'rejected', reject_reason: 'off_theme' },
      { id: 'c3', canonical_key: 'luma:evt-c', status: 'rejected', reject_reason: 'duplicate' }, // not a theme reason — kept
      { id: 'c4', canonical_key: 'luma:evt-d', status: 'queued', reject_reason: null },
    ];
    const { client } = makeFakeSupabase({ ingest_candidates: [{ data: rows, error: null }] });
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);
    const { listLumaCandidatesForConference } = await import('../ingest/db');
    const result = await listLumaCandidatesForConference('DAS London');
    expect(result.map((r) => r.id)).toEqual(['c3', 'c4']);
  });
});

// Review finding, LOW item 4: PostgREST's own default row cap is 1000 —
// without explicit pagination, a conference with more Luma candidates than
// that silently lost everything past the first page.
describe('listKnownLumaCandidateKeys (pagination)', () => {
  it('pages past 1000 rows, combining canonical_key + alt_keys across every page', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const page1 = Array.from({ length: 1000 }, (_, i) => ({ canonical_key: `luma:evt-p1-${i}`, alt_keys: [] }));
    const page2 = [{ canonical_key: 'luma:evt-p2-0', alt_keys: ['luma:short-slug'] }];
    const { client, callsByTable } = makeFakeSupabase({
      ingest_candidates: [
        { data: page1, error: null },
        { data: page2, error: null },
      ],
    });
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);
    const { listKnownLumaCandidateKeys } = await import('../ingest/db');
    const keys = await listKnownLumaCandidateKeys('DAS London');
    expect(keys.has('luma:evt-p1-0')).toBe(true);
    expect(keys.has('luma:evt-p1-999')).toBe(true);
    expect(keys.has('luma:evt-p2-0')).toBe(true);
    expect(keys.has('luma:short-slug')).toBe(true);
    expect(keys.size).toBe(1002);
    const rangeCalls = callsByTable.ingest_candidates.filter((c) => c.method === 'range');
    expect(rangeCalls).toEqual([
      { method: 'range', args: [0, 999] },
      { method: 'range', args: [1000, 1999] },
    ]);
  });

  it('stops after one page when it comes back short (the last page)', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { client, callsByTable } = makeFakeSupabase({
      ingest_candidates: [{ data: [{ canonical_key: 'luma:evt-only', alt_keys: [] }], error: null }],
    });
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);
    const { listKnownLumaCandidateKeys } = await import('../ingest/db');
    await listKnownLumaCandidateKeys('DAS London');
    const rangeCalls = callsByTable.ingest_candidates.filter((c) => c.method === 'range');
    expect(rangeCalls).toHaveLength(1);
  });

  // Minor review finding: an explicit `.order()` so `.range()` pagination
  // is actually stable across pages — without it, Postgres makes no
  // ordering guarantee for an unordered select, so two pages could
  // overlap or skip rows non-deterministically.
  it('applies an explicit .order() before paginating', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { client, callsByTable } = makeFakeSupabase({
      ingest_candidates: [{ data: [], error: null }],
    });
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);
    const { listKnownLumaCandidateKeys } = await import('../ingest/db');
    await listKnownLumaCandidateKeys('DAS London');
    expect(callsByTable.ingest_candidates.some((c) => c.method === 'order')).toBe(true);
  });
});

// Review finding, HIGH item A ("links can be starved"): the GENERAL,
// un-prefixed version of the same pagination core, across every platform
// and every status — what `pipeline.ts#runDiscoveredLinksBatch`'s
// unseen-first ordering actually needs.
describe('listAllCandidateKeysForConference', () => {
  it('combines canonical_key + alt_keys across EVERY platform (no luma: prefix filter)', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const rows = [
      { canonical_key: 'luma:evt-abc123', alt_keys: ['luma:short-slug'] },
      { canonical_key: 'eventbrite:987654321', alt_keys: [] },
      { canonical_key: 'partiful.com/e/xyz', alt_keys: [] },
    ];
    const { client, callsByTable } = makeFakeSupabase({ ingest_candidates: [{ data: rows, error: null }] });
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);
    const { listAllCandidateKeysForConference } = await import('../ingest/db');
    const keys = await listAllCandidateKeysForConference('DAS London');
    expect(keys).toEqual(new Set(['luma:evt-abc123', 'luma:short-slug', 'eventbrite:987654321', 'partiful.com/e/xyz']));
    expect(callsByTable.ingest_candidates.some((c) => c.method === 'like')).toBe(false);
  });

  it('pages past 1000 rows the same way listKnownLumaCandidateKeys does', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const page1 = Array.from({ length: 1000 }, (_, i) => ({ canonical_key: `cal:${i}`, alt_keys: [] }));
    const page2 = [{ canonical_key: 'cal:1000', alt_keys: [] }];
    const { client, callsByTable } = makeFakeSupabase({
      ingest_candidates: [
        { data: page1, error: null },
        { data: page2, error: null },
      ],
    });
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);
    const { listAllCandidateKeysForConference } = await import('../ingest/db');
    const keys = await listAllCandidateKeysForConference('DAS London');
    expect(keys.size).toBe(1001);
    const rangeCalls = callsByTable.ingest_candidates.filter((c) => c.method === 'range');
    expect(rangeCalls).toHaveLength(2);
  });
});

// Review finding, LOW item 5: accepting a proposal whose calendar already
// exists as a source (an admin added it by hand, or a prior partial
// Accept) must be a no-op success, not a 500.
describe('createLumaIcalSourceIdempotent', () => {
  it('creates a new source normally when none exists yet', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { client, callsByTable } = makeFakeSupabase({
      ingest_sources: [{ data: { id: 'src-1', kind: 'luma_ical' }, error: null }],
    });
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);
    const { createLumaIcalSourceIdempotent } = await import('../ingest/db');
    const result = await createLumaIcalSourceIdempotent({
      conference: 'DAS London',
      label: 'The Best Event',
      calendar_api_id: 'cal-abc',
      calendar_name: 'The Best Event',
      trust: 'curated',
    });
    expect(result).toEqual({ id: 'src-1', kind: 'luma_ical' });
    expect(callsByTable.ingest_sources.some((c) => c.method === 'insert')).toBe(true);
  });

  it('on a unique-constraint violation (23505), returns the EXISTING source instead of throwing', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const existingSource = { id: 'src-existing', kind: 'luma_ical', config: { calendar_api_id: 'cal-abc' } };
    const { client } = makeFakeSupabase({
      ingest_sources: [
        { data: null, error: { message: 'duplicate key', code: '23505' } }, // the insert
        { data: [existingSource], error: null }, // listSources' re-select
      ],
    });
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);
    const { createLumaIcalSourceIdempotent } = await import('../ingest/db');
    const result = await createLumaIcalSourceIdempotent({
      conference: 'DAS London',
      label: 'The Best Event',
      calendar_api_id: 'cal-abc',
      calendar_name: 'The Best Event',
      trust: 'curated',
    });
    expect(result).toEqual(existingSource);
  });

  it('a unique-constraint violation with no matching existing source still throws', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { client } = makeFakeSupabase({
      ingest_sources: [
        { data: null, error: { message: 'duplicate key', code: '23505' } },
        { data: [], error: null }, // re-select finds nothing matching
      ],
    });
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(client);
    const { createLumaIcalSourceIdempotent } = await import('../ingest/db');
    await expect(
      createLumaIcalSourceIdempotent({ conference: 'DAS London', label: 'x', calendar_api_id: 'cal-abc', calendar_name: null, trust: 'curated' })
    ).rejects.toThrow('duplicate key');
  });
});
