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

  it('stops adding examples once the token budget is exceeded', () => {
    const pool: IngestLabelRow[] = [];
    for (let i = 0; i < 4; i++) {
      pool.push(label({ id: `pos-${i}`, label: 'on_theme', example: { name: 'x'.repeat(200) } }));
    }
    // Each example costs ~50+ tokens; a tiny budget should only fit one.
    const examples = selectFewShotExamples(pool, { conference: 'Test Conf', maxTokenBudget: 60 });
    expect(examples.length).toBeLessThan(4);
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

describe('loadLearningContext', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('fetches one label pool and derives both few-shot and host signals from it', async () => {
    const pool = [
      label({ id: 'a', conference: 'Test Conf', label: 'on_theme', example: { name: 'A', organizer: 'Trusted Org' } }),
      label({ id: 'b', conference: 'Test Conf', label: 'on_theme', example: { name: 'B', organizer: 'Trusted Org' } }),
      label({ id: 'c', conference: 'Test Conf', label: 'on_theme', example: { name: 'C', organizer: 'Trusted Org' } }),
    ];
    const listLabelsForFewShotMock = vi.fn(async () => pool);
    vi.doMock('../ingest/db', () => ({ listLabelsForFewShot: listLabelsForFewShotMock }));

    const { loadLearningContext } = await import('../ingest/learning');
    const ctx = await loadLearningContext({ conference: 'Test Conf', themeKey: 'crypto' });

    expect(listLabelsForFewShotMock).toHaveBeenCalledTimes(1);
    expect(ctx.fewShot.length).toBe(3);
    expect(ctx.learnedHosts.trusted.has('trusted org')).toBe(true);
  });
});
