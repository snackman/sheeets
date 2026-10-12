// Phase 2 auto-publish gate + kill switch (plans/event-ingestion.md §13.2,
// §11, §5.7): "Snax flips auto-publish on per conference once the
// dashboard shows >= 95% precision on >= 50 high-score decisions."
//
// Pure math (`computePrecision`, `evaluateGate`, the `summarize*`
// functions) is separated from the Supabase reads/writes
// (`evaluateAutoPublishEnableGate`, `checkAutoPublishKillSwitch`) so the
// gate/kill-switch LOGIC — the thing that must never have an off-by-one at
// the 50-item or 95% boundary — is unit-testable with plain arrays, no
// Supabase mocking required.
import { getPrecisionRows, getRecentAutoPublishOutcomes, upsertProfile } from './db';

/** §13.2: "auto_publish_enabled can only be turned on once its measured
 *  precision at publish is >= 95% over 50+ labeled items." Also the kill
 *  switch's threshold for turning it back off (same bar, both directions). */
export const AUTO_PUBLISH_PRECISION_THRESHOLD = 0.95;
export const AUTO_PUBLISH_MIN_SAMPLE_SIZE = 50;

export interface PrecisionSample {
  sampleSize: number;
  positive: number;
  /** null when sampleSize is 0 — never divide by zero, never report 0% as
   *  if it were a real measurement. */
  precision: number | null;
}

export function computePrecision(sampleSize: number, positive: number): number | null {
  if (sampleSize <= 0) return null;
  return positive / sampleSize;
}

/** Roll up the `ingest_precision` view's per-(score_bucket, source_kind)
 *  shadow-mode columns into one sample for a conference: among queued
 *  items whose `shadow_route='publish'`, the share that got approved —
 *  i.e. "precision at the publish threshold" BEFORE auto-publish is live
 *  (§11 "shadow precision"). This is the gate for turning auto-publish on. */
export function summarizeShadowSample(
  rows: { shadow_publish_candidates: number; shadow_publish_approved: number }[]
): PrecisionSample {
  const sampleSize = rows.reduce((sum, r) => sum + Number(r.shadow_publish_candidates || 0), 0);
  const positive = rows.reduce((sum, r) => sum + Number(r.shadow_publish_approved || 0), 0);
  return { sampleSize, positive, precision: computePrecision(sampleSize, positive) };
}

/** Precision among the most recent N real auto-published outcomes (§11
 *  "auto-publish precision = 1 - unpublished/auto_published") — what's
 *  ACTUALLY happening once auto-publish is live, used by the kill switch. */
export function summarizeRealOutcomeSample(rows: { status: string }[]): PrecisionSample {
  const sampleSize = rows.length;
  const positive = rows.filter((r) => r.status === 'auto_published').length;
  return { sampleSize, positive, precision: computePrecision(sampleSize, positive) };
}

/** Review-queue approval rate (§11 "queue precision = approved / (approved
 *  + off-theme rejected)") — every reviewed item, not just the
 *  would-have-published band. Shown on the dashboard alongside the gate's
 *  shadow-precision number, not used by the gate itself. */
export function summarizeReviewApproval(
  rows: { reviewed_on_theme: number; reviewed_off_theme: number }[]
): PrecisionSample {
  const onTheme = rows.reduce((sum, r) => sum + Number(r.reviewed_on_theme || 0), 0);
  const offTheme = rows.reduce((sum, r) => sum + Number(r.reviewed_off_theme || 0), 0);
  return { sampleSize: onTheme + offTheme, positive: onTheme, precision: computePrecision(onTheme + offTheme, onTheme) };
}

export interface GateResult {
  eligible: boolean;
  sample: PrecisionSample;
  minSampleSize: number;
  threshold: number;
  /** Human-readable explanation, shown in the UI tooltip and the 400 error
   *  when the server-side enforcement in the config API refuses a toggle. */
  reason: string;
}

/** The actual gate rule (§13.2), isolated from where the sample comes
 *  from: refuse under `minSampleSize` labeled items OR under `threshold`
 *  precision. Both conditions are checked independently so the reason
 *  message is specific (never just "no") — this is also the exact
 *  boundary the "must refuse to enable under 50 labels or under 95%" test
 *  requirement targets. */
export function evaluateGate(
  sample: PrecisionSample,
  opts: { minSampleSize?: number; threshold?: number } = {}
): GateResult {
  const minSampleSize = opts.minSampleSize ?? AUTO_PUBLISH_MIN_SAMPLE_SIZE;
  const threshold = opts.threshold ?? AUTO_PUBLISH_PRECISION_THRESHOLD;

  if (sample.sampleSize < minSampleSize) {
    return {
      eligible: false,
      sample,
      minSampleSize,
      threshold,
      reason: `Needs ${minSampleSize}+ labeled items at the publish threshold (have ${sample.sampleSize}).`,
    };
  }
  if (sample.precision === null || sample.precision < threshold) {
    const pct = sample.precision != null ? (sample.precision * 100).toFixed(1) : '0.0';
    return {
      eligible: false,
      sample,
      minSampleSize,
      threshold,
      reason: `Precision is ${pct}% over ${sample.sampleSize} items; needs ${(threshold * 100).toFixed(0)}%+.`,
    };
  }
  return {
    eligible: true,
    sample,
    minSampleSize,
    threshold,
    reason: `Meets the gate: ${(sample.precision * 100).toFixed(1)}% over ${sample.sampleSize} items.`,
  };
}

/** The "turn auto-publish ON" gate (§13.2), backed by shadow-mode data.
 *  Called from the config API's PUT handler before it allows
 *  `auto_publish_enabled: false -> true`. */
export async function evaluateAutoPublishEnableGate(conference: string): Promise<GateResult> {
  const rows = await getPrecisionRows(conference);
  return evaluateGate(summarizeShadowSample(rows));
}

export interface KillSwitchResult {
  killed: boolean;
  sample: PrecisionSample;
}

/**
 * The kill switch: once auto-publish is live, check the most recent
 * `AUTO_PUBLISH_MIN_SAMPLE_SIZE` real outcomes and turn it back off,
 * recording why, if rolling precision has dropped below the gate
 * threshold. Called once per pipeline run (`pipeline.ts#runSource`) for
 * any conference whose profile currently has `auto_publish_enabled=true`.
 * Deliberately uses the SAME threshold/sample-size constants as the enable
 * gate — same bar, both directions.
 */
export async function checkAutoPublishKillSwitch(conference: string): Promise<KillSwitchResult> {
  const rows = await getRecentAutoPublishOutcomes(conference, AUTO_PUBLISH_MIN_SAMPLE_SIZE);
  const sample = summarizeRealOutcomeSample(rows);

  if (sample.sampleSize < AUTO_PUBLISH_MIN_SAMPLE_SIZE) {
    return { killed: false, sample };
  }
  if (sample.precision === null || sample.precision >= AUTO_PUBLISH_PRECISION_THRESHOLD) {
    return { killed: false, sample };
  }

  const pct = (sample.precision * 100).toFixed(1);
  await upsertProfile({
    conference,
    auto_publish_enabled: false,
    auto_publish_killed_at: new Date().toISOString(),
    auto_publish_kill_reason:
      `Rolling precision dropped to ${pct}% over ${sample.sampleSize} recent auto-published items ` +
      `(kill-switch threshold ${(AUTO_PUBLISH_PRECISION_THRESHOLD * 100).toFixed(0)}%).`,
  });
  return { killed: true, sample };
}
