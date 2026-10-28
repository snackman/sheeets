import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  computePrecision,
  summarizeShadowSample,
  summarizeRealOutcomeSample,
  summarizeReviewApproval,
  evaluateGate,
  isAutoPublishFailure,
  computePrecisionRowsFromCandidates,
  AUTO_PUBLISH_PRECISION_THRESHOLD,
  AUTO_PUBLISH_MIN_SAMPLE_SIZE,
  type PrecisionViewCandidateInput,
} from '../ingest/gate';

describe('computePrecision', () => {
  it('returns null for a zero sample (never divide by zero)', () => {
    expect(computePrecision(0, 0)).toBeNull();
  });

  it('computes positive/sampleSize otherwise', () => {
    expect(computePrecision(50, 48)).toBeCloseTo(0.96);
    expect(computePrecision(10, 5)).toBe(0.5);
  });

  it('clamps to 100% rather than ever reporting more (review finding, CRITICAL item 1)', () => {
    // Shouldn't happen with correct callers, but the invariant must hold
    // even if a future bug feeds it a numerator bigger than the sample.
    expect(computePrecision(10, 15)).toBe(1);
  });
});

function candidate(overrides: Partial<PrecisionViewCandidateInput> = {}): PrecisionViewCandidateInput {
  return {
    conference: 'Test Conf',
    source_kind: 'luma_ical',
    final_score: 90,
    status: 'queued',
    reject_reason: null,
    shadow_route: null,
    ...overrides,
  };
}

describe('summarizeShadowSample (§11 "shadow precision", review finding CRITICAL item 1)', () => {
  it('the OLD bug: shadow_publish_candidates (status=queued, UNDECIDED) must never be the denominator', () => {
    // 20 items still sitting undecided in the queue, routed shadow=publish,
    // and SEPARATELY 10 decided items (9 approved, 1 theme-rejected) also
    // routed shadow=publish. The old code divided shadow_publish_approved
    // (9) by shadow_publish_candidates (20, the UNDECIDED queued count) —
    // two disjoint sets that have nothing to do with each other — giving a
    // nonsensical 45%. The fix: denominator is the DECIDED set only
    // (9 approved + 1 rejected = 10), giving 90%.
    const candidates: PrecisionViewCandidateInput[] = [
      ...Array.from({ length: 20 }, () => candidate({ status: 'queued', shadow_route: 'publish' })),
      ...Array.from({ length: 9 }, () => candidate({ status: 'approved', shadow_route: 'publish' })),
      candidate({ status: 'rejected', reject_reason: 'off_theme', shadow_route: 'publish' }),
    ];
    const rows = computePrecisionRowsFromCandidates(candidates);
    const sample = summarizeShadowSample(rows);
    expect(sample.sampleSize).toBe(10); // 9 approved + 1 rejected-theme, NOT 20
    expect(sample.positive).toBe(9);
    expect(sample.precision).toBeCloseTo(0.9);
    expect(sample.precision!).toBeLessThanOrEqual(1);
  });

  it('never exceeds 100% even with many more approved than rejected', () => {
    const candidates: PrecisionViewCandidateInput[] = Array.from({ length: 60 }, () =>
      candidate({ status: 'approved', shadow_route: 'publish' })
    );
    const rows = computePrecisionRowsFromCandidates(candidates);
    const sample = summarizeShadowSample(rows);
    expect(sample.precision).toBe(1);
  });

  it('a pending (queued) item never counts on either side', () => {
    const candidates: PrecisionViewCandidateInput[] = [
      candidate({ status: 'queued', shadow_route: 'publish' }),
      candidate({ status: 'queued', shadow_route: 'publish' }),
    ];
    const rows = computePrecisionRowsFromCandidates(candidates);
    const sample = summarizeShadowSample(rows);
    expect(sample.sampleSize).toBe(0);
    expect(sample.precision).toBeNull();
  });

  it('non-theme rejections (duplicate/wrong_city/...) are excluded from the denominator', () => {
    const candidates: PrecisionViewCandidateInput[] = [
      candidate({ status: 'approved', shadow_route: 'publish' }),
      candidate({ status: 'rejected', reject_reason: 'duplicate', shadow_route: 'publish' }),
      candidate({ status: 'rejected', reject_reason: 'wrong_city', shadow_route: 'publish' }),
    ];
    const rows = computePrecisionRowsFromCandidates(candidates);
    const sample = summarizeShadowSample(rows);
    expect(sample.sampleSize).toBe(1); // only the approved row
    expect(sample.precision).toBe(1);
  });

  it('a row whose shadow_route was NOT publish never counts, regardless of status', () => {
    const candidates: PrecisionViewCandidateInput[] = [
      candidate({ status: 'approved', shadow_route: 'review' }),
      candidate({ status: 'rejected', reject_reason: 'off_theme', shadow_route: 'reject' }),
    ];
    const rows = computePrecisionRowsFromCandidates(candidates);
    const sample = summarizeShadowSample(rows);
    expect(sample.sampleSize).toBe(0);
  });
});

describe('summarizeReviewApproval', () => {
  it('sums reviewed_on_theme / (on_theme + off_theme) across rows', () => {
    const candidates: PrecisionViewCandidateInput[] = [
      ...Array.from({ length: 8 }, () => candidate({ status: 'approved' })),
      ...Array.from({ length: 2 }, () => candidate({ status: 'rejected', reject_reason: 'off_theme' })),
    ];
    const rows = computePrecisionRowsFromCandidates(candidates);
    const sample = summarizeReviewApproval(rows);
    expect(sample.sampleSize).toBe(10);
    expect(sample.positive).toBe(8);
    expect(sample.precision).toBeCloseTo(0.8);
  });
});

describe('isAutoPublishFailure (review finding, HIGH item 2: "decide what counts as a failure explicitly")', () => {
  it('auto_published (still live) is a success', () => {
    expect(isAutoPublishFailure({ status: 'auto_published' })).toBe(false);
  });

  it('unpublished (admin explicitly pulled it) is ALWAYS a failure', () => {
    expect(isAutoPublishFailure({ status: 'unpublished', eventDateISO: '2020-01-01', detectedAtIso: '2099-01-01T00:00:00Z' })).toBe(true);
  });

  it('unpublished_external removed BEFORE the event happened is a failure', () => {
    expect(
      isAutoPublishFailure({ status: 'unpublished_external', eventDateISO: '2027-06-01', detectedAtIso: '2027-05-01T00:00:00Z' })
    ).toBe(true);
  });

  it('unpublished_external removed AFTER the event already happened is NOT a failure', () => {
    expect(
      isAutoPublishFailure({ status: 'unpublished_external', eventDateISO: '2027-05-01', detectedAtIso: '2027-06-01T00:00:00Z' })
    ).toBe(false);
  });

  it('unpublished_external removed on the SAME day as the event counts as a failure (boundary inclusive)', () => {
    expect(
      isAutoPublishFailure({ status: 'unpublished_external', eventDateISO: '2027-06-01', detectedAtIso: '2027-06-01T23:00:00Z' })
    ).toBe(true);
  });

  it('unpublished_external with an unknown event date is conservatively a failure', () => {
    expect(isAutoPublishFailure({ status: 'unpublished_external', eventDateISO: null, detectedAtIso: '2027-06-01T00:00:00Z' })).toBe(true);
  });
});

describe('summarizeRealOutcomeSample (review finding, HIGH item 2)', () => {
  it('counts auto_published as positive and unpublished as a failure', () => {
    const rows = [
      { status: 'auto_published', event: { dateISO: '2027-06-01' }, updated_at: '2027-06-01T00:00:00Z' },
      { status: 'auto_published', event: { dateISO: '2027-06-01' }, updated_at: '2027-06-01T00:00:00Z' },
      { status: 'unpublished', event: { dateISO: '2027-06-01' }, updated_at: '2027-06-01T00:00:00Z' },
    ];
    const sample = summarizeRealOutcomeSample(rows);
    expect(sample.sampleSize).toBe(3);
    expect(sample.positive).toBe(2);
  });

  it('drops a post-event unpublished_external row from the sample entirely (not a failure, not informative)', () => {
    const rows = [
      { status: 'auto_published', event: { dateISO: '2027-06-01' }, updated_at: '2027-06-01T00:00:00Z' },
      // Removed a month after the event already happened -> routine cleanup, excluded.
      { status: 'unpublished_external', event: { dateISO: '2027-05-01' }, updated_at: '2027-06-01T00:00:00Z' },
    ];
    const sample = summarizeRealOutcomeSample(rows);
    expect(sample.sampleSize).toBe(1); // only the auto_published row
    expect(sample.positive).toBe(1);
  });

  it('counts a pre-event unpublished_external row as a failure', () => {
    const rows = [
      { status: 'auto_published', event: { dateISO: '2027-06-01' }, updated_at: '2027-06-01T00:00:00Z' },
      { status: 'unpublished_external', event: { dateISO: '2027-07-01' }, updated_at: '2027-06-01T00:00:00Z' },
    ];
    const sample = summarizeRealOutcomeSample(rows);
    expect(sample.sampleSize).toBe(2);
    expect(sample.positive).toBe(1);
  });
});

describe('evaluateGate (§13.2: refuse under 50 labels OR under 95%)', () => {
  it('refuses with 49 items even at 100% precision (just under the sample-size floor)', () => {
    const result = evaluateGate({ sampleSize: 49, positive: 49, precision: 1 });
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/50\+ labeled items/);
  });

  it('allows exactly 50 items at exactly 95% precision (both boundaries inclusive)', () => {
    const result = evaluateGate({ sampleSize: 50, positive: 47.5, precision: 0.95 });
    expect(result.eligible).toBe(true);
  });

  it('refuses 50 items at 94.9% precision (just under the precision floor)', () => {
    const result = evaluateGate({ sampleSize: 50, positive: 47, precision: 47 / 50 });
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/Precision is/);
  });

  it('refuses a null-precision (zero-sample) result even if sampleSize was forced >= min', () => {
    const result = evaluateGate({ sampleSize: 50, positive: 0, precision: null });
    expect(result.eligible).toBe(false);
  });

  it('uses the module constants as defaults', () => {
    const result = evaluateGate({ sampleSize: AUTO_PUBLISH_MIN_SAMPLE_SIZE, positive: AUTO_PUBLISH_MIN_SAMPLE_SIZE, precision: 1 });
    expect(result.minSampleSize).toBe(AUTO_PUBLISH_MIN_SAMPLE_SIZE);
    expect(result.threshold).toBe(AUTO_PUBLISH_PRECISION_THRESHOLD);
    expect(result.eligible).toBe(true);
  });

  it('honors custom minSampleSize/threshold overrides', () => {
    const result = evaluateGate({ sampleSize: 10, positive: 9, precision: 0.9 }, { minSampleSize: 10, threshold: 0.9 });
    expect(result.eligible).toBe(true);
  });

  it('end to end against realistic candidate rows: exactly meets the gate at 50 decided items, 95% approved', () => {
    const candidates: PrecisionViewCandidateInput[] = [
      ...Array.from({ length: 48 }, () => candidate({ status: 'approved', shadow_route: 'publish' })),
      ...Array.from({ length: 2 }, () => candidate({ status: 'rejected', reject_reason: 'off_theme', shadow_route: 'publish' })),
      // Noise that must NOT affect the gate: undecided queued items, and decided items whose shadow route wasn't publish.
      ...Array.from({ length: 500 }, () => candidate({ status: 'queued', shadow_route: 'publish' })),
      candidate({ status: 'approved', shadow_route: 'review' }),
    ];
    const rows = computePrecisionRowsFromCandidates(candidates);
    const result = evaluateGate(summarizeShadowSample(rows));
    expect(result.sample.sampleSize).toBe(50);
    expect(result.eligible).toBe(true);
  });
});

describe('evaluateAutoPublishEnableGate (db-backed)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('rolls up ingest_precision rows (approved + theme-rejected, shadow_route=publish) for the conference into the shadow gate', async () => {
    const getPrecisionRowsMock = vi.fn(async () => [
      { shadow_publish_candidates: 1000, shadow_publish_approved: 29, shadow_publish_rejected_theme: 1 },
      { shadow_publish_candidates: 500, shadow_publish_approved: 24, shadow_publish_rejected_theme: 1 },
    ]);
    vi.doMock('../ingest/db', () => ({
      getPrecisionRows: getPrecisionRowsMock,
      getRecentAutoPublishOutcomes: vi.fn(async () => []),
      updateProfilePatch: vi.fn(async () => ({})),
    }));
    const { evaluateAutoPublishEnableGate } = await import('../ingest/gate');
    const result = await evaluateAutoPublishEnableGate('Test Conf');
    expect(getPrecisionRowsMock).toHaveBeenCalledWith('Test Conf');
    // 53 approved + 2 rejected = 55 decided, NOT the 1500 undecided-queued noise.
    expect(result.sample.sampleSize).toBe(55);
    expect(result.eligible).toBe(true); // 53/55 ≈ 96.4%
  });
});

describe('checkAutoPublishKillSwitch (db-backed)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('passes enabledAt through to getRecentAutoPublishOutcomes as sinceIso (review finding, HIGH item 2)', async () => {
    const getRecentAutoPublishOutcomesMock = vi.fn(async () => []);
    vi.doMock('../ingest/db', () => ({
      getPrecisionRows: vi.fn(async () => []),
      getRecentAutoPublishOutcomes: getRecentAutoPublishOutcomesMock,
      updateProfilePatch: vi.fn(async () => ({})),
    }));
    const { checkAutoPublishKillSwitch } = await import('../ingest/gate');
    await checkAutoPublishKillSwitch('Test Conf', { enabledAt: '2027-05-01T00:00:00Z' });
    expect(getRecentAutoPublishOutcomesMock).toHaveBeenCalledWith(
      'Test Conf',
      expect.objectContaining({ sinceIso: '2027-05-01T00:00:00Z' })
    );
  });

  it('does nothing below the minimum sample size', async () => {
    const updateProfilePatchMock = vi.fn(async () => ({}));
    vi.doMock('../ingest/db', () => ({
      getPrecisionRows: vi.fn(async () => []),
      getRecentAutoPublishOutcomes: vi.fn(async () =>
        Array.from({ length: 10 }, () => ({ status: 'auto_published', event: { dateISO: '2027-06-01' }, updated_at: '2027-06-01T00:00:00Z' }))
      ),
      updateProfilePatch: updateProfilePatchMock,
    }));
    const { checkAutoPublishKillSwitch } = await import('../ingest/gate');
    const result = await checkAutoPublishKillSwitch('Test Conf');
    expect(result.killed).toBe(false);
    expect(updateProfilePatchMock).not.toHaveBeenCalled();
  });

  it('does nothing when precision is at/above threshold with enough sample', async () => {
    const updateProfilePatchMock = vi.fn(async () => ({}));
    const outcomes = [
      ...Array.from({ length: 48 }, () => ({ status: 'auto_published', event: { dateISO: '2027-06-01' }, updated_at: '2027-06-01T00:00:00Z' })),
      ...Array.from({ length: 2 }, () => ({ status: 'unpublished', event: { dateISO: '2027-06-01' }, updated_at: '2027-06-01T00:00:00Z' })),
    ]; // 48/50 = 96%
    vi.doMock('../ingest/db', () => ({
      getPrecisionRows: vi.fn(async () => []),
      getRecentAutoPublishOutcomes: vi.fn(async () => outcomes),
      updateProfilePatch: updateProfilePatchMock,
    }));
    const { checkAutoPublishKillSwitch } = await import('../ingest/gate');
    const result = await checkAutoPublishKillSwitch('Test Conf');
    expect(result.killed).toBe(false);
    expect(updateProfilePatchMock).not.toHaveBeenCalled();
  });

  it('flips auto_publish_enabled off and records why when rolling precision drops below threshold', async () => {
    const updateProfilePatchMock = vi.fn(async () => ({}));
    const outcomes = [
      ...Array.from({ length: 40 }, () => ({ status: 'auto_published', event: { dateISO: '2027-06-01' }, updated_at: '2027-06-01T00:00:00Z' })),
      ...Array.from({ length: 10 }, () => ({ status: 'unpublished', event: { dateISO: '2027-06-01' }, updated_at: '2027-06-01T00:00:00Z' })),
    ]; // 40/50 = 80%
    vi.doMock('../ingest/db', () => ({
      getPrecisionRows: vi.fn(async () => []),
      getRecentAutoPublishOutcomes: vi.fn(async () => outcomes),
      updateProfilePatch: updateProfilePatchMock,
    }));
    const { checkAutoPublishKillSwitch } = await import('../ingest/gate');
    const result = await checkAutoPublishKillSwitch('Test Conf');
    expect(result.killed).toBe(true);
    expect(updateProfilePatchMock).toHaveBeenCalledWith(
      'Test Conf',
      expect.objectContaining({
        auto_publish_enabled: false,
        auto_publish_kill_reason: expect.stringContaining('80.0%'),
      })
    );
  });

  it('does not throw when the profile row is gone by the time of the write (review finding, LOW item "gate.ts:241")', async () => {
    const outcomes = [
      ...Array.from({ length: 40 }, () => ({ status: 'auto_published', event: { dateISO: '2027-06-01' }, updated_at: '2027-06-01T00:00:00Z' })),
      ...Array.from({ length: 10 }, () => ({ status: 'unpublished', event: { dateISO: '2027-06-01' }, updated_at: '2027-06-01T00:00:00Z' })),
    ]; // 40/50 = 80%, below threshold -> would try to write
    vi.doMock('../ingest/db', () => ({
      getPrecisionRows: vi.fn(async () => []),
      getRecentAutoPublishOutcomes: vi.fn(async () => outcomes),
      // db.ts#updateProfilePatch resolves null (not a thrown error) when
      // zero rows matched the UPDATE — gate.ts must tolerate that.
      updateProfilePatch: vi.fn(async () => null),
    }));
    const { checkAutoPublishKillSwitch } = await import('../ingest/gate');
    await expect(checkAutoPublishKillSwitch('Gone Conf')).resolves.toEqual(expect.objectContaining({ killed: true }));
  });

  it('a re-enable is not killed by stale pre-enable history (review finding, HIGH item 2)', async () => {
    // All 50 "bad" outcomes are from BEFORE the most recent enable — a
    // real `getRecentAutoPublishOutcomes` would never return them once
    // `sinceIso` is passed, so the mock here returns nothing to simulate
    // that filtering already having happened server-side.
    const updateProfilePatchMock = vi.fn(async () => ({}));
    vi.doMock('../ingest/db', () => ({
      getPrecisionRows: vi.fn(async () => []),
      getRecentAutoPublishOutcomes: vi.fn(async (_conference: string, opts: { sinceIso?: string | null }) => {
        expect(opts.sinceIso).toBe('2027-06-01T00:00:00.000Z');
        return []; // nothing since the re-enable yet
      }),
      updateProfilePatch: updateProfilePatchMock,
    }));
    const { checkAutoPublishKillSwitch } = await import('../ingest/gate');
    const result = await checkAutoPublishKillSwitch('Test Conf', { enabledAt: '2027-06-01T00:00:00.000Z' });
    expect(result.killed).toBe(false);
    expect(updateProfilePatchMock).not.toHaveBeenCalled();
  });
});

describe('computePrecisionRowsFromCandidates (the SQL-view mirror used above)', () => {
  it('groups by conference, source_kind and score bucket, matching the migration SQL bands', () => {
    const candidates: PrecisionViewCandidateInput[] = [
      candidate({ final_score: 95, status: 'approved' }),
      candidate({ final_score: 85, status: 'approved' }),
      candidate({ final_score: 70, status: 'approved' }),
      candidate({ final_score: 50, status: 'approved' }),
      candidate({ final_score: 10, status: 'approved' }),
      candidate({ final_score: null, status: 'approved' }),
    ];
    const rows = computePrecisionRowsFromCandidates(candidates);
    const buckets = rows.map((r) => r.score_bucket).sort();
    expect(buckets).toEqual(['0-39', '40-59', '60-79', '80-89', '90-100', 'unscored']);
    expect(rows.every((r) => r.reviewed_on_theme === 1)).toBe(true);
  });

  it('counts swept duplicates (published then removed as duplicate) as successes, plain duplicates as nothing', () => {
    const rows = computePrecisionRowsFromCandidates([
      candidate({ status: 'duplicate', shadow_route: 'publish', published_at: '2026-10-01', auto_published_at: '2026-10-01' }),
      candidate({ status: 'duplicate', shadow_route: 'publish', published_at: '2026-10-01', auto_published_at: null }),
      candidate({ status: 'duplicate', shadow_route: 'publish' }),
    ]);
    const sum = (k: 'auto_published' | 'reviewed_on_theme' | 'shadow_publish_approved' | 'auto_unpublished') => rows.reduce((n, r) => n + r[k], 0);
    expect(sum('auto_published')).toBe(1);
    expect(sum('reviewed_on_theme')).toBe(1);
    expect(sum('shadow_publish_approved')).toBe(1);
    expect(sum('auto_unpublished')).toBe(0);
  });
});
