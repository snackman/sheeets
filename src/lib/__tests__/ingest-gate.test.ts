import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  computePrecision,
  summarizeShadowSample,
  summarizeRealOutcomeSample,
  summarizeReviewApproval,
  evaluateGate,
  AUTO_PUBLISH_PRECISION_THRESHOLD,
  AUTO_PUBLISH_MIN_SAMPLE_SIZE,
} from '../ingest/gate';

describe('computePrecision', () => {
  it('returns null for a zero sample (never divide by zero)', () => {
    expect(computePrecision(0, 0)).toBeNull();
  });

  it('computes positive/sampleSize otherwise', () => {
    expect(computePrecision(50, 48)).toBeCloseTo(0.96);
    expect(computePrecision(10, 5)).toBe(0.5);
  });
});

describe('summarize* helpers', () => {
  it('summarizeShadowSample sums shadow_publish_candidates/approved across rows', () => {
    const rows = [
      { shadow_publish_candidates: 30, shadow_publish_approved: 29 },
      { shadow_publish_candidates: 20, shadow_publish_approved: 19 },
    ];
    const sample = summarizeShadowSample(rows);
    expect(sample.sampleSize).toBe(50);
    expect(sample.positive).toBe(48);
    expect(sample.precision).toBeCloseTo(0.96);
  });

  it('summarizeRealOutcomeSample counts auto_published as positive, unpublished as negative', () => {
    const rows = [{ status: 'auto_published' }, { status: 'auto_published' }, { status: 'unpublished' }, { status: 'unpublished_external' }];
    const sample = summarizeRealOutcomeSample(rows);
    expect(sample.sampleSize).toBe(4);
    expect(sample.positive).toBe(2);
    expect(sample.precision).toBe(0.5);
  });

  it('summarizeReviewApproval computes approved / (approved + off-theme rejected)', () => {
    const rows = [
      { reviewed_on_theme: 8, reviewed_off_theme: 2 },
      { reviewed_on_theme: 2, reviewed_off_theme: 0 },
    ];
    const sample = summarizeReviewApproval(rows);
    expect(sample.sampleSize).toBe(12);
    expect(sample.positive).toBe(10);
    expect(sample.precision).toBeCloseTo(10 / 12);
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
});

describe('evaluateAutoPublishEnableGate (db-backed)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('rolls up ingest_precision rows for the conference into the shadow gate', async () => {
    const getPrecisionRowsMock = vi.fn(async () => [
      { shadow_publish_candidates: 30, shadow_publish_approved: 29 },
      { shadow_publish_candidates: 25, shadow_publish_approved: 24 },
    ]);
    vi.doMock('../ingest/db', () => ({
      getPrecisionRows: getPrecisionRowsMock,
      getRecentAutoPublishOutcomes: vi.fn(async () => []),
      upsertProfile: vi.fn(async () => ({})),
    }));
    const { evaluateAutoPublishEnableGate } = await import('../ingest/gate');
    const result = await evaluateAutoPublishEnableGate('Test Conf');
    expect(getPrecisionRowsMock).toHaveBeenCalledWith('Test Conf');
    expect(result.sample.sampleSize).toBe(55);
    expect(result.eligible).toBe(true); // 53/55 ≈ 96.4%
  });
});

describe('checkAutoPublishKillSwitch (db-backed)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('does nothing below the minimum sample size', async () => {
    const upsertProfileMock = vi.fn(async () => ({}));
    vi.doMock('../ingest/db', () => ({
      getPrecisionRows: vi.fn(async () => []),
      getRecentAutoPublishOutcomes: vi.fn(async () => Array.from({ length: 10 }, () => ({ status: 'auto_published' }))),
      upsertProfile: upsertProfileMock,
    }));
    const { checkAutoPublishKillSwitch } = await import('../ingest/gate');
    const result = await checkAutoPublishKillSwitch('Test Conf');
    expect(result.killed).toBe(false);
    expect(upsertProfileMock).not.toHaveBeenCalled();
  });

  it('does nothing when precision is at/above threshold with enough sample', async () => {
    const upsertProfileMock = vi.fn(async () => ({}));
    const outcomes = [
      ...Array.from({ length: 48 }, () => ({ status: 'auto_published' })),
      ...Array.from({ length: 2 }, () => ({ status: 'unpublished' })),
    ]; // 48/50 = 96%
    vi.doMock('../ingest/db', () => ({
      getPrecisionRows: vi.fn(async () => []),
      getRecentAutoPublishOutcomes: vi.fn(async () => outcomes),
      upsertProfile: upsertProfileMock,
    }));
    const { checkAutoPublishKillSwitch } = await import('../ingest/gate');
    const result = await checkAutoPublishKillSwitch('Test Conf');
    expect(result.killed).toBe(false);
    expect(upsertProfileMock).not.toHaveBeenCalled();
  });

  it('flips auto_publish_enabled off and records why when rolling precision drops below threshold', async () => {
    const upsertProfileMock = vi.fn(async () => ({}));
    const outcomes = [
      ...Array.from({ length: 40 }, () => ({ status: 'auto_published' })),
      ...Array.from({ length: 10 }, () => ({ status: 'unpublished' })),
    ]; // 40/50 = 80%
    vi.doMock('../ingest/db', () => ({
      getPrecisionRows: vi.fn(async () => []),
      getRecentAutoPublishOutcomes: vi.fn(async () => outcomes),
      upsertProfile: upsertProfileMock,
    }));
    const { checkAutoPublishKillSwitch } = await import('../ingest/gate');
    const result = await checkAutoPublishKillSwitch('Test Conf');
    expect(result.killed).toBe(true);
    expect(upsertProfileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conference: 'Test Conf',
        auto_publish_enabled: false,
        auto_publish_kill_reason: expect.stringContaining('80.0%'),
      })
    );
  });
});
