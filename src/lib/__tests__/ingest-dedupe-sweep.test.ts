import { describe, it, expect, vi } from 'vitest';

vi.mock('../ingest/db', () => ({
  listCandidates: vi.fn(),
  claimCandidateStatus: vi.fn(),
  updateCandidate: vi.fn(),
}));
vi.mock('../google-sheets', () => ({
  deleteSheetRow: vi.fn(),
  getSheetTitle: vi.fn(),
  readRange: vi.fn(),
}));

import { findSweepMatches, sweepDuplicateRows, type SweepCandidate, type SweepDeps } from '../ingest/dedupe-sweep';

const EVT = 'https://luma.com/event/evt-AAA111BBB222';

function cand(over: Partial<SweepCandidate> = {}): SweepCandidate {
  return {
    id: 'c1',
    canonical_key: 'luma:evt-aaa111bbb222',
    alt_keys: ['luma:e9iw08nn'],
    status: 'auto_published',
    event: { link: EVT, name: 'Solana Mixer 🎉', dateISO: '2026-12-10', sheetDate: 'Thu, December 10' },
    ...over,
  };
}

// cols: A date, B start, C end, D organizer, E name, F addr, G cost, H tags, I link
function row(date: string, name: string, link: string): string[] {
  return [date, '7:00 PM', '', 'Org', name, '', 'Free', '', link];
}

const header = ['Date', 'Start Time', 'End Time', 'Organizer', 'Event Name', 'Address', 'Cost', 'Tags', 'Link'];

describe('findSweepMatches', () => {
  it('matches a hand-added short link to the candidate alt_key (slug)', () => {
    const rows = [header, row('Thu, December 10', 'Solana Mixer', EVT), row('Fri, December 11', 'Other', 'https://luma.com/e9iw08nn')];
    const m = findSweepMatches(rows, [cand()]);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ candidateId: 'c1', rowIndex: 1, pipelineLink: EVT, handAddedRowIndex: 2, reason: 'slug' });
  });

  it('matches by canonical_key too (lu.ma alias, case-insensitive)', () => {
    const rows = [row('x', 'A', EVT), row('y', 'B', 'https://lu.ma/event/EVT-AAA111BBB222?ref=x')];
    // second row is a different URL for the same event id -> hand-added dup
    expect(findSweepMatches(rows, [cand()])).toHaveLength(1);
  });

  it('matches by normalized name + same date', () => {
    const rows = [row('Thu, December 10', 'Solana Mixer', EVT), row('Thu, December 10', 'solana mixer!!', 'https://luma.com/zzzz')];
    const m = findSweepMatches(rows, [cand()]);
    expect(m).toHaveLength(1);
    expect(m[0].reason).toBe('name_date');
  });

  it('does not match same name on a different date', () => {
    const rows = [row('Thu, December 10', 'Solana Mixer', EVT), row('Fri, December 11', 'Solana Mixer', 'https://luma.com/zzzz')];
    expect(findSweepMatches(rows, [cand()])).toHaveLength(0);
  });

  it('ignores hand-added rows at/below the Add Events Here staging section', () => {
    const rows = [
      row('Thu, December 10', 'Solana Mixer', EVT),
      ['Add Events Here'],
      header,
      row('Thu, December 10', 'Solana Mixer', 'https://luma.com/e9iw08nn'),
    ];
    expect(findSweepMatches(rows, [cand()])).toHaveLength(0);
  });

  it('never targets a pipeline row sitting in the staging section', () => {
    const rows = [['Add Events Here'], row('Thu, December 10', 'Solana Mixer', EVT), row('Thu, December 10', 'Solana Mixer', 'https://luma.com/e9iw08nn')];
    expect(findSweepMatches(rows, [cand()])).toHaveLength(0);
  });

  it('only deletes the pipeline row, never the hand-added one', () => {
    const rows = [row('Thu, December 10', 'Solana Mixer', 'https://luma.com/e9iw08nn'), row('Thu, December 10', 'Solana Mixer', EVT)];
    const m = findSweepMatches(rows, [cand()]);
    expect(m).toHaveLength(1);
    expect(m[0].rowIndex).toBe(1);
    expect(m[0].pipelineLink).toBe(EVT);
  });

  it('leaves two hand-added duplicates of each other alone when no pipeline row exists', () => {
    const rows = [row('Thu, December 10', 'Party', 'https://luma.com/aaaa'), row('Thu, December 10', 'Party', 'https://luma.com/bbbb')];
    expect(findSweepMatches(rows, [cand()])).toHaveLength(0);
    expect(findSweepMatches(rows, [])).toHaveLength(0);
  });

  it('removes the pipeline row once even if two hand-added rows duplicate it', () => {
    const rows = [
      row('Thu, December 10', 'Solana Mixer', EVT),
      row('Thu, December 10', 'Solana Mixer', 'https://luma.com/e9iw08nn'),
      row('Thu, December 10', 'Solana Mixer', 'https://luma.com/other'),
    ];
    expect(findSweepMatches(rows, [cand()])).toHaveLength(1);
  });

  it('treats another candidate\'s pipeline row as not hand-added', () => {
    const other = cand({ id: 'c2', canonical_key: 'luma:evt-zzz', alt_keys: [], event: { link: 'https://luma.com/event/evt-ZZZ', name: 'Solana Mixer', dateISO: '2026-12-10', sheetDate: 'Thu, December 10' } });
    const rows = [row('Thu, December 10', 'Solana Mixer', EVT), row('Thu, December 10', 'Solana Mixer', other.event.link)];
    expect(findSweepMatches(rows, [cand(), other])).toHaveLength(0);
  });

  it('skips when the candidate link appears on more than one row (ambiguous)', () => {
    const rows = [row('a', 'X', EVT), row('b', 'X', EVT), row('c', 'X', 'https://luma.com/e9iw08nn')];
    expect(findSweepMatches(rows, [cand()])).toHaveLength(0);
  });

  it('ignores candidates that are not approved/auto_published', () => {
    const rows = [row('a', 'X', EVT), row('b', 'X', 'https://luma.com/e9iw08nn')];
    expect(findSweepMatches(rows, [cand({ status: 'unpublished' })])).toHaveLength(0);
  });
});

function makeDeps(sheets: string[][][], candidates: SweepCandidate[]): SweepDeps & { deleted: number[]; claim: ReturnType<typeof vi.fn>; upd: ReturnType<typeof vi.fn> } {
  const deleted: number[] = [];
  let reads = 0;
  const claim = vi.fn(async () => ({}) as never);
  const upd = vi.fn(async () => {});
  return {
    deleted,
    claim,
    upd,
    listCandidates: vi.fn(async () => candidates as never),
    claimCandidateStatus: claim as never,
    updateCandidate: upd as never,
    getSheetTitle: vi.fn(async () => 'Tab'),
    readRange: vi.fn(async () => sheets[Math.min(reads++, sheets.length - 1)]),
    deleteSheetRow: vi.fn(async (_gid: number, idx: number) => {
      deleted.push(idx);
    }),
    sleep: async () => {},
  };
}

describe('sweepDuplicateRows', () => {
  const tab = { gid: 7, name: 'Solana Breakpoint' };
  const sheet = [row('Thu, December 10', 'Solana Mixer', EVT), row('Thu, December 10', 'Solana Mixer', 'https://luma.com/e9iw08nn')];

  it('deletes the pipeline row and marks the candidate duplicate (not unpublished)', async () => {
    const deps = makeDeps([sheet], [cand()]);
    const r = await sweepDuplicateRows(tab, deps);
    expect(r.removed).toBe(1);
    expect(deps.deleted).toEqual([0]);
    expect(deps.claim).toHaveBeenCalledWith('c1', ['approved', 'auto_published'], 'duplicate', expect.objectContaining({ duplicate_of: 'https://luma.com/e9iw08nn' }));
  });

  it('re-reads and re-locates by link: skips when the hand-added row vanished', async () => {
    const deps = makeDeps([sheet, [row('Thu, December 10', 'Solana Mixer', EVT)]], [cand()]);
    const r = await sweepDuplicateRows(tab, deps);
    expect(r.removed).toBe(0);
    expect(deps.deleted).toEqual([]);
  });

  it('uses the shifted row index from the fresh read', async () => {
    const shifted = [row('z', 'Zed', 'https://luma.com/zed'), ...sheet];
    const deps = makeDeps([sheet, shifted], [cand()]);
    await sweepDuplicateRows(tab, deps);
    expect(deps.deleted).toEqual([1]);
  });

  it('deletes bottom-up when several', async () => {
    const c2 = cand({ id: 'c2', canonical_key: 'luma:evt-two', alt_keys: ['luma:two22222'], event: { link: 'https://luma.com/event/evt-TWO', name: 'Two', dateISO: '2026-12-10', sheetDate: 'Thu, December 10' } });
    const s = [row('a', 'Solana Mixer', EVT), row('a', 'Two', c2.event.link), row('a', 'x', 'https://luma.com/e9iw08nn'), row('a', 'y', 'https://luma.com/two22222')];
    const deps = makeDeps([s], [cand(), c2]);
    const r = await sweepDuplicateRows(tab, deps);
    expect(r.removed).toBe(2);
    expect(deps.deleted).toEqual([1, 0]);
  });

  it('respects the max-deletes cap', async () => {
    const deps = makeDeps([sheet], [cand()]);
    const r = await sweepDuplicateRows(tab, deps, 0);
    expect(r.removed).toBe(0);
    expect(r.skipped).toBe(1);
  });

  it('reverts the candidate if the sheet delete fails, and does not throw', async () => {
    const deps = makeDeps([sheet], [cand()]);
    deps.deleteSheetRow = vi.fn(async () => {
      throw new Error('boom');
    });
    const r = await sweepDuplicateRows(tab, deps);
    expect(r.removed).toBe(0);
    expect(r.errors).toBe(1);
    expect(deps.upd).toHaveBeenCalledWith('c1', expect.objectContaining({ status: 'auto_published' }));
  });

  it('swallows a sheet read error', async () => {
    const deps = makeDeps([sheet], [cand()]);
    deps.readRange = vi.fn(async () => {
      throw new Error('sheets 500');
    });
    const r = await sweepDuplicateRows(tab, deps);
    expect(r.errors).toBe(1);
    expect(r.removed).toBe(0);
  });
});
