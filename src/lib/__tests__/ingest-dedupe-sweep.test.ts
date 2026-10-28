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
    event: { link: EVT, name: 'Solana Mixer 🎉', dateISO: '2026-12-10', sheetDate: 'Thu, December 10', startTime: '7:00 PM' },
    ...over,
  };
}

// cols: A date, B start, C end, D organizer, E name, F addr, G cost, H tags, I link
function row(date: string, name: string, link: string, start = '7:00 PM'): string[] {
  return [date, start, '', 'Org', name, '', 'Free', '', link];
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
    const rows = [row('x', 'Solana Mixer', EVT), row('y', 'B', 'https://lu.ma/event/EVT-AAA111BBB222?ref=x')];
    // second row is a different URL for the same event id -> hand-added dup
    expect(findSweepMatches(rows, [cand()])).toHaveLength(1);
  });

  it('matches by normalized name + same date', () => {
    const rows = [row('Thu, December 10', 'Solana Mixer', EVT), row('Thu, December 10', 'solana mixer!!', 'https://luma.com/zzzz')];
    const m = findSweepMatches(rows, [cand({ alt_keys: [] })]);
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
    const other = cand({ id: 'c2', canonical_key: 'luma:evt-zzz', alt_keys: [], event: { link: 'https://luma.com/event/evt-ZZZ', name: 'Solana Mixer', dateISO: '2026-12-10', sheetDate: 'Thu, December 10', startTime: '7:00 PM' } });
    const rows = [row('Thu, December 10', 'Solana Mixer', EVT), row('Thu, December 10', 'Solana Mixer', other.event.link)];
    expect(findSweepMatches(rows, [cand(), other])).toHaveLength(0);
  });

  it('skips when the candidate link appears on more than one row (ambiguous)', () => {
    const rows = [row('a', 'Solana Mixer', EVT), row('b', 'X', EVT), row('c', 'X', 'https://luma.com/e9iw08nn')];
    expect(findSweepMatches(rows, [cand()])).toHaveLength(0);
  });

  it('ignores candidates that are not approved/auto_published', () => {
    const rows = [row('a', 'Solana Mixer', EVT), row('b', 'X', 'https://luma.com/e9iw08nn')];
    expect(findSweepMatches(rows, [cand({ status: 'unpublished' })])).toHaveLength(0);
  });
});

describe('review fixes', () => {
  const mk = (id: string, link: string, name: string, start: string, extra: Partial<SweepCandidate> = {}): SweepCandidate => ({
    id,
    canonical_key: `luma:${link.split('/').pop()!.toLowerCase()}`,
    alt_keys: [],
    status: 'auto_published',
    event: { link, name, dateISO: '2026-12-10', sheetDate: 'Thu, December 10', startTime: start },
    ...extra,
  });
  const D = 'Thu, December 10';

  it('does not delete a different session of a recurring same-name same-day event (different time)', () => {
    const c = mk('p', 'https://luma.com/event/evt-PM', 'Dynamic Pilates', '2:00 PM');
    const rows = [row(D, 'Dynamic Pilates', c.event.link, '2:00 PM'), row(D, 'Dynamic Pilates', 'https://luma.com/am1', '10:00 AM')];
    expect(findSweepMatches(rows, [c])).toHaveLength(0);
  });

  it('does not name+date merge two known-distinct luma events (different evt ids / different slugs)', () => {
    const c = mk('p', 'https://luma.com/event/evt-AAA', 'Show', '7:00 PM');
    const rows = [row(D, 'Show', c.event.link), row(D, 'Show', 'https://luma.com/event/evt-BBB')];
    expect(findSweepMatches(rows, [c])).toHaveLength(0);
    const c2 = mk('p2', 'https://luma.com/event/evt-AAA', 'Show', '7:00 PM', { alt_keys: ['luma:slugone'] });
    expect(findSweepMatches([row(D, 'Show', c2.event.link), row(D, 'Show', 'https://luma.com/slugtwo')], [c2])).toHaveLength(0);
  });

  it('one hand-added row vs two pipeline rows: at most one delete, only the time-matching one', () => {
    const am = mk('am', 'https://luma.com/event/evt-AM', 'Yoga', '10:00 AM');
    const pm = mk('pm', 'https://luma.com/event/evt-PM', 'Yoga', '2:00 PM');
    const rows = [row(D, 'Yoga', am.event.link, '10:00 AM'), row(D, 'Yoga', pm.event.link, '2:00 PM'), row(D, 'Yoga', 'https://luma.com/hand', '2:00 PM')];
    const m = findSweepMatches(rows, [am, pm]);
    expect(m).toHaveLength(1);
    expect(m[0].candidateId).toBe('pm');
  });

  it('1:1 even for slug matches sharing one hand-added row', () => {
    const a = mk('a', 'https://luma.com/event/evt-A', 'A', '7:00 PM', { alt_keys: ['luma:shared'] });
    const b = mk('b', 'https://luma.com/event/evt-B', 'B', '7:00 PM', { alt_keys: ['luma:shared'] });
    const rows = [row(D, 'A', a.event.link), row(D, 'B', b.event.link), row(D, 'Hand', 'https://luma.com/shared')];
    expect(findSweepMatches(rows, [a, b])).toHaveLength(1);
  });

  it('detects the staging marker with a prefix', () => {
    const c = cand();
    const rows = [row(D, 'Solana Mixer', EVT), ['⬇️ Add Events Here ⬇️'], row(D, 'Solana Mixer', 'https://luma.com/e9iw08nn')];
    expect(findSweepMatches(rows, [c])).toHaveLength(0);
  });

  it('does not treat a curator row with the identical pipeline link as the pipeline row unless name+time match', () => {
    const c = cand();
    // single row with the link but a different name/time (curator reused the URL for another session)
    const rows = [row(D, 'Totally Other', EVT, '9:00 AM'), row(D, 'Hand', 'https://luma.com/e9iw08nn')];
    expect(findSweepMatches(rows, [c])).toHaveLength(0);
    // two rows carrying the exact link: ambiguous
    expect(findSweepMatches([row(D, 'Solana Mixer', EVT), row(D, 'Solana Mixer', EVT), row(D, 'H', 'https://luma.com/e9iw08nn')], [c])).toHaveLength(0);
  });

  it('a lu.ma variant of the pipeline link is hand-added, so the pipeline row (exact link) is the one removed', () => {
    const rows = [row(D, 'Solana Mixer', EVT), row(D, 'Solana Mixer', 'https://lu.ma/event/evt-AAA111BBB222')];
    const m = findSweepMatches(rows, [cand()]);
    expect(m).toHaveLength(1);
    expect(m[0].rowIndex).toBe(0);
  });

  it('re-check uses the full candidate list and requires the same hand-added link', async () => {
    const tab = { gid: 7, name: 'T' };
    const a = cand();
    const b = cand({ id: 'c2', canonical_key: 'luma:evt-other', alt_keys: [], event: { link: 'https://luma.com/event/evt-OTHER', name: 'Other', dateISO: '2026-12-10', sheetDate: D, startTime: '7:00 PM' } });
    const first = [row(D, 'Solana Mixer', EVT), row(D, 'Other', b.event.link), row(D, 'h', 'https://luma.com/e9iw08nn')];
    // fresh read: the hand-added row now has a different link -> must not delete
    const fresh = [row(D, 'Solana Mixer', EVT), row(D, 'Other', b.event.link), row(D, 'h', 'https://luma.com/e9iw08nn-x')];
    const deps = makeDeps([first, fresh], [a, b]);
    const r = await sweepDuplicateRows(tab, deps);
    expect(r.removed).toBe(0);
    expect(deps.deleted).toEqual([]);
  });

  it('claims the candidate BEFORE the fresh read and deletes right after it', async () => {
    const order: string[] = [];
    const deps = makeDeps([[row(D, 'Solana Mixer', EVT), row(D, 'h', 'https://luma.com/e9iw08nn')]], [cand()]);
    const read = deps.readRange;
    let reads = 0;
    deps.readRange = vi.fn(async (...a: Parameters<typeof read>) => {
      order.push(`read${++reads}`);
      return read(...a);
    });
    deps.claimCandidateStatus = vi.fn(async () => {
      order.push('claim');
      return {} as never;
    });
    deps.deleteSheetRow = vi.fn(async () => {
      order.push('delete');
    });
    await sweepDuplicateRows({ gid: 1, name: 'T' }, deps);
    expect(order).toEqual(['read1', 'claim', 'read2', 'delete']);
  });

  it('stops deleting once the deadline passes inside a conference', async () => {
    const c2 = cand({ id: 'c2', canonical_key: 'luma:evt-two', alt_keys: ['luma:two22222'], event: { link: 'https://luma.com/event/evt-TWO', name: 'Two', dateISO: '2026-12-10', sheetDate: D, startTime: '7:00 PM' } });
    const s = [row(D, 'Solana Mixer', EVT), row(D, 'Two', c2.event.link), row(D, 'x', 'https://luma.com/e9iw08nn'), row(D, 'y', 'https://luma.com/two22222')];
    const deps = makeDeps([s], [cand(), c2]);
    let t = 0;
    deps.now = () => t++ * 100; // first check 0, second 100...
    const r = await sweepDuplicateRows({ gid: 1, name: 'T' }, deps, 25, 50);
    expect(r.removed).toBe(1);
    expect(r.skipped).toBe(1);
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
    now: () => Date.now(),
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
    expect(deps.upd).toHaveBeenCalledWith('c1', expect.objectContaining({ status: 'auto_published' })); // claim reverted
  });

  it('uses the shifted row index from the fresh read', async () => {
    const shifted = [row('z', 'Zed', 'https://luma.com/zed'), ...sheet];
    const deps = makeDeps([sheet, shifted], [cand()]);
    await sweepDuplicateRows(tab, deps);
    expect(deps.deleted).toEqual([1]);
  });

  it('deletes bottom-up when several', async () => {
    const c2 = cand({ id: 'c2', canonical_key: 'luma:evt-two', alt_keys: ['luma:two22222'], event: { link: 'https://luma.com/event/evt-TWO', name: 'Two', dateISO: '2026-12-10', sheetDate: 'Thu, December 10', startTime: '7:00 PM' } });
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
