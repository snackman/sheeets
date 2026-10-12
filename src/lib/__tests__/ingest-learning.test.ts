import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  estimateTokens,
  buildFewShotSummary,
  buildFewShotReason,
  isHardExample,
  rankLabelsForFewShot,
  selectFewShotExamples,
  deriveLearnedHostSignals,
  learnedHostSignalMatches,
  LEARNED_HOST_MIN_DECISIONS,
} from '../ingest/learning';
import type { IngestLabelRow } from '../ingest/types';

function label(overrides: Partial<IngestLabelRow> = {}): IngestLabelRow {
  return {
    id: overrides.id ?? `lbl-${Math.random()}`,
    candidate_id: 'cand-1',
    conference: 'Test Conf',
    theme_key: 'crypto',
    label: 'on_theme',
    label_kind: 'theme',
    source: 'admin_review',
    reason: null,
    example: { name: 'ETH Builders Mixer', hosts: ['Alice'] },
    model_score: 90,
    model_route: 'publish',
    excluded_from_fewshot: false,
    created_at: '2027-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('estimateTokens', () => {
  it('is roughly chars/4', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcdefgh')).toBe(2);
    expect(estimateTokens('')).toBe(0);
  });
});

describe('buildFewShotSummary / buildFewShotReason', () => {
  it('builds "name | hosts" from the example snapshot', () => {
    const l = label({ example: { name: 'ETH Mixer', hosts: ['Alice', 'Bob'] } });
    expect(buildFewShotSummary(l)).toBe('ETH Mixer | Alice, Bob');
  });

  it('falls back to the calendar name when there are no hosts', () => {
    const l = label({ example: { name: 'ETH Mixer', calendar: 'ETHGlobal Calendar' } });
    expect(buildFewShotSummary(l)).toBe('ETH Mixer | ETHGlobal Calendar');
  });

  it('falls back to just the name with no hosts or calendar', () => {
    const l = label({ example: { name: 'Solo Event' } });
    expect(buildFewShotSummary(l)).toBe('Solo Event');
  });

  it('uses "(untitled)" when the example has no name', () => {
    expect(buildFewShotSummary(label({ example: {} }))).toBe('(untitled)');
  });

  it('prefers the admin reason over the model reason', () => {
    const l = label({ reason: 'off-theme, generic city party', example: { llmReason: 'model thought it fit' } });
    expect(buildFewShotReason(l)).toBe('off-theme, generic city party');
  });

  it('falls back to the model reason when there is no admin reason', () => {
    const l = label({ reason: null, example: { llmReason: 'model thought it fit' } });
    expect(buildFewShotReason(l)).toBe('model thought it fit');
  });

  it('falls back to a generic reason when neither is present', () => {
    expect(buildFewShotReason(label({ reason: null, example: {} }))).toBe('admin decision');
  });
});

describe('isHardExample', () => {
  it('an on_theme label the model routed to publish is NOT hard', () => {
    expect(isHardExample({ label: 'on_theme', model_route: 'publish' })).toBe(false);
  });

  it('an on_theme label the model routed to reject/review IS hard', () => {
    expect(isHardExample({ label: 'on_theme', model_route: 'reject' })).toBe(true);
    expect(isHardExample({ label: 'on_theme', model_route: 'review' })).toBe(true);
  });

  it('an off_theme label the model routed to reject is NOT hard', () => {
    expect(isHardExample({ label: 'off_theme', model_route: 'reject' })).toBe(false);
  });

  it('an off_theme label the model routed to publish/review IS hard', () => {
    expect(isHardExample({ label: 'off_theme', model_route: 'publish' })).toBe(true);
  });

  it('a label with no model_route is never hard (nothing to have disagreed with)', () => {
    expect(isHardExample({ label: 'on_theme', model_route: null })).toBe(false);
    expect(isHardExample({ label: 'off_theme', model_route: null })).toBe(false);
  });
});

describe('rankLabelsForFewShot', () => {
  it('ranks same-conference before other-conference', () => {
    const a = label({ id: 'a', conference: 'Other Conf', created_at: '2027-01-02T00:00:00.000Z' });
    const b = label({ id: 'b', conference: 'Test Conf', created_at: '2027-01-01T00:00:00.000Z' });
    const ranked = rankLabelsForFewShot([a, b], 'Test Conf');
    expect(ranked.map((l) => l.id)).toEqual(['b', 'a']);
  });

  it('within the same group, ranks hard examples before easy ones', () => {
    const easy = label({ id: 'easy', model_route: 'publish', created_at: '2027-01-05T00:00:00.000Z' });
    const hard = label({ id: 'hard', model_route: 'reject', created_at: '2027-01-01T00:00:00.000Z' });
    const ranked = rankLabelsForFewShot([easy, hard], 'Test Conf');
    expect(ranked.map((l) => l.id)).toEqual(['hard', 'easy']);
  });

  it('within the same hardness, ranks most recent first', () => {
    const older = label({ id: 'older', created_at: '2027-01-01T00:00:00.000Z' });
    const newer = label({ id: 'newer', created_at: '2027-02-01T00:00:00.000Z' });
    const ranked = rankLabelsForFewShot([older, newer], 'Test Conf');
    expect(ranked.map((l) => l.id)).toEqual(['newer', 'older']);
  });
});

describe('selectFewShotExamples', () => {
  it('takes up to maxPerLabel positives and negatives', () => {
    const pool: IngestLabelRow[] = [];
    for (let i = 0; i < 6; i++) pool.push(label({ id: `pos-${i}`, label: 'on_theme' }));
    for (let i = 0; i < 6; i++) pool.push(label({ id: `neg-${i}`, label: 'off_theme' }));
    const examples = selectFewShotExamples(pool, { conference: 'Test Conf', maxPerLabel: 4, maxTokenBudget: 10_000 });
    const positives = examples.filter((e) => e.label === 'on_theme');
    const negatives = examples.filter((e) => e.label === 'off_theme');
    expect(positives).toHaveLength(4);
    expect(negatives).toHaveLength(4);
  });

  it('excludes a label tied to excludeCandidateId', () => {
    const pool = [label({ id: 'self', candidate_id: 'cand-self' }), label({ id: 'other', candidate_id: 'cand-other' })];
    const examples = selectFewShotExamples(pool, { conference: 'Test Conf', excludeCandidateId: 'cand-self' });
    expect(examples).toHaveLength(1);
  });

  it('a tiny budget still cuts off eventually (sanity check)', () => {
    const pool: IngestLabelRow[] = [];
    for (let i = 0; i < 4; i++) {
      pool.push(label({ id: `pos-${i}`, label: 'on_theme', example: { name: 'x'.repeat(200) } }));
    }
    const examples = selectFewShotExamples(pool, { conference: 'Test Conf', maxTokenBudget: 60 });
    expect(examples.length).toBeLessThan(4);
  });

  it('SKIPS an example that does not fit instead of stopping — a later, smaller example still gets in (review finding, LOW item 9)', () => {
    const pool: IngestLabelRow[] = [
      // Ranked first (most recent) but far too large to fit the budget on its own.
      label({ id: 'huge', label: 'on_theme', created_at: '2027-03-01T00:00:00.000Z', example: { name: 'x'.repeat(400) } }),
      // Ranked second, small enough to fit — must NOT be cut off by the huge one ahead of it.
      label({ id: 'small', label: 'on_theme', created_at: '2027-01-01T00:00:00.000Z', example: { name: 'small event' } }),
    ];
    const examples = selectFewShotExamples(pool, { conference: 'Test Conf', maxTokenBudget: 40 });
    expect(examples.some((e) => e.summary === 'small event')).toBe(true);
    expect(examples.some((e) => e.summary.startsWith('x'))).toBe(false); // the huge one never fit
  });

  it('INTERLEAVES positives and negatives rather than taking all positives first (review finding, LOW item 9)', () => {
    // 4 positives (P1..P4) and 4 negatives (N1..N4), each the same length so
    // every example costs the same number of tokens — distinct `created_at`
    // controls rank order within each label so this is deterministic.
    const pool: IngestLabelRow[] = [];
    for (let i = 1; i <= 4; i++) {
      pool.push(label({ id: `p${i}`, label: 'on_theme', created_at: `2027-01-0${i}T00:00:00.000Z`, example: { name: `P${i}` } }));
      pool.push(label({ id: `n${i}`, label: 'off_theme', created_at: `2027-01-0${i}T00:00:00.000Z`, example: { name: `N${i}` } }));
    }
    // rankLabelsForFewShot ranks most-recent-first, so within each label the
    // order is P4,P3,P2,P1 / N4,N3,N2,N1 — interleaved: P4,N4,P3,N3,P2,N2,P1,N1.
    const oneExampleCost = estimateTokens('P4 -> on_theme (admin decision)');
    const budgetForExactlyFour = oneExampleCost * 4;
    const examples = selectFewShotExamples(pool, { conference: 'Test Conf', maxPerLabel: 4, maxTokenBudget: budgetForExactlyFour });

    expect(examples).toHaveLength(4);
    const summaries = examples.map((e) => e.summary);
    expect(summaries).toEqual(['P4', 'N4', 'P3', 'N3']); // the first 4 of the interleaved sequence, not all-positives-first
  });

  it('returns an empty array for an empty pool', () => {
    expect(selectFewShotExamples([], { conference: 'Test Conf' })).toEqual([]);
  });
});

describe('deriveLearnedHostSignals', () => {
  it('trusts a host with enough one-sided approvals', () => {
    const labels = Array.from({ length: LEARNED_HOST_MIN_DECISIONS }, (_, i) =>
      label({ id: `l${i}`, label: 'on_theme', example: { organizer: 'DeFi Collective' } })
    );
    const signals = deriveLearnedHostSignals(labels);
    expect(signals.trusted.has('defi collective')).toBe(true);
    expect(signals.blocked.has('defi collective')).toBe(false);
  });

  it('blocks a host with enough one-sided rejections', () => {
    const labels = Array.from({ length: LEARNED_HOST_MIN_DECISIONS }, (_, i) =>
      label({ id: `l${i}`, label: 'off_theme', example: { organizer: 'Spammy Promos' } })
    );
    const signals = deriveLearnedHostSignals(labels);
    expect(signals.blocked.has('spammy promos')).toBe(true);
  });

  it('does not trust/block below the minimum decision count', () => {
    const labels = Array.from({ length: LEARNED_HOST_MIN_DECISIONS - 1 }, (_, i) =>
      label({ id: `l${i}`, label: 'on_theme', example: { organizer: 'DeFi Collective' } })
    );
    const signals = deriveLearnedHostSignals(labels);
    expect(signals.trusted.size).toBe(0);
  });

  it('does not trust/block a host with mixed (non-one-sided) decisions', () => {
    const labels = [
      ...Array.from({ length: LEARNED_HOST_MIN_DECISIONS }, (_, i) => label({ id: `p${i}`, label: 'on_theme', example: { organizer: 'Mixed Org' } })),
      label({ id: 'n1', label: 'off_theme', example: { organizer: 'Mixed Org' } }),
    ];
    const signals = deriveLearnedHostSignals(labels);
    expect(signals.trusted.has('mixed org')).toBe(false);
    expect(signals.blocked.has('mixed org')).toBe(false);
  });

  it('ignores non_theme labels entirely', () => {
    const labels = Array.from({ length: LEARNED_HOST_MIN_DECISIONS }, (_, i) =>
      label({ id: `l${i}`, label: 'off_theme', label_kind: 'non_theme', example: { organizer: 'Duplicate Org' } })
    );
    const signals = deriveLearnedHostSignals(labels);
    expect(signals.blocked.size).toBe(0);
  });

  it('attributes ONLY to the primary organizer, never a co-host (review finding, MEDIUM item 6)', () => {
    // "Prolific Cohost" appears as a CO-HOST on every one of these
    // approved events, but is never the organizer — must not be learned
    // as trusted from that alone. "Real Organizer" IS the organizer every
    // time and should be learned trusted.
    const labels = Array.from({ length: LEARNED_HOST_MIN_DECISIONS }, (_, i) =>
      label({ id: `l${i}`, label: 'on_theme', example: { organizer: 'Real Organizer', hosts: ['Prolific Cohost'] } })
    );
    const signals = deriveLearnedHostSignals(labels);
    expect(signals.trusted.has('real organizer')).toBe(true);
    expect(signals.trusted.has('prolific cohost')).toBe(false);
  });
});

describe('learnedHostSignalMatches', () => {
  it('matches any name in the list, case/whitespace-insensitively', () => {
    const signals = { trusted: new Set(['defi collective']), blocked: new Set<string>() };
    expect(learnedHostSignalMatches(signals, 'trusted', ['Someone', ' DeFi Collective '])).toBe(true);
  });

  it('returns false for an empty signal set without scanning names', () => {
    const signals = { trusted: new Set<string>(), blocked: new Set<string>() };
    expect(learnedHostSignalMatches(signals, 'trusted', ['Anyone'])).toBe(false);
  });
});

describe('loadLearningContext (review finding, MEDIUM item 6: two SEPARATE pools)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('fetches few-shot and host-signal pools SEPARATELY, from the right functions, and derives each from its own pool', async () => {
    const fewShotPool = [
      label({ id: 'a', conference: 'Test Conf', label: 'on_theme', example: { name: 'A', organizer: 'FewShot Org' } }),
      label({ id: 'b', conference: 'Test Conf', label: 'on_theme', example: { name: 'B', organizer: 'FewShot Org' } }),
      label({ id: 'c', conference: 'Test Conf', label: 'on_theme', example: { name: 'C', organizer: 'FewShot Org' } }),
    ];
    // A label pool deliberately DIFFERENT from the few-shot pool, to prove
    // the two aren't just the same fetch reused — e.g. this includes a
    // label that would have been excluded from few-shot (but
    // `listLabelsForHostSignals` itself is responsible for not filtering
    // on that; this test only needs to show the two results differ).
    const hostSignalPool = Array.from({ length: LEARNED_HOST_MIN_DECISIONS }, (_, i) =>
      label({ id: `h${i}`, conference: 'Test Conf', label: 'on_theme', example: { organizer: 'HostSignal Org' } })
    );
    const listLabelsForFewShotMock = vi.fn(async () => fewShotPool);
    const listLabelsForHostSignalsMock = vi.fn(async () => hostSignalPool);
    vi.doMock('../ingest/db', () => ({
      listLabelsForFewShot: listLabelsForFewShotMock,
      listLabelsForHostSignals: listLabelsForHostSignalsMock,
    }));

    const { loadLearningContext } = await import('../ingest/learning');
    const ctx = await loadLearningContext({ conference: 'Test Conf', themeKey: 'crypto' });

    expect(listLabelsForFewShotMock).toHaveBeenCalledWith('crypto');
    expect(listLabelsForHostSignalsMock).toHaveBeenCalledWith('Test Conf');
    expect(ctx.fewShot.length).toBe(3);
    // Learned hosts come from the HOST-SIGNAL pool, not the few-shot pool.
    expect(ctx.learnedHosts.trusted.has('hostsignal org')).toBe(true);
    expect(ctx.learnedHosts.trusted.has('fewshot org')).toBe(false);
  });
});
