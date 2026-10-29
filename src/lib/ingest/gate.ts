// Phase 2 auto-publish gate + kill switch (plans/event-ingestion.md §13.2,
// §11, §5.7): "Snax flips auto-publish on per conference once the
// dashboard shows >= 95% precision on >= 50 high-score decisions."
//
// Pure math (`computePrecision`, `evaluateGate`, the `summarize*`
// functions, `isAutoPublishFailure`) is separated from the Supabase
// reads/writes (`evaluateAutoPublishEnableGate`, `checkAutoPublishKillSwitch`)
// so the gate/kill-switch LOGIC — the thing that must never have an
// off-by-one at the 50-item or 95% boundary, or count the wrong rows — is
// unit-testable with plain arrays, no Supabase mocking required.
import {
  getPrecisionRows,
  getRecentAutoPublishOutcomes,
  updateProfilePatch,
  type IngestPrecisionRow,
} from './db';
import type { CandidateRoute, CandidateStatus } from './types';

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
  // Guard the invariant the review flagged (CRITICAL item 1): precision
  // must never exceed 100%. If `positive` ever came in larger than
  // `sampleSize` (a bug upstream, or two columns from different,
  // non-comparable sets getting summed together), clamp rather than
  // silently report e.g. 340%.
  return Math.min(1, positive / sampleSize);
}

/**
 * Roll up the `ingest_precision` view's per-(score_bucket, source_kind)
 * shadow-mode columns into one precision sample for a conference (§11
 * "shadow precision": "among queued items whose shadow_route='publish',
 * the share approved"). This is the gate for turning auto-publish on.
 *
 * CRITICAL item 1 fix: the numerator is `shadow_publish_approved`
 * (decided, approved, shadow_route='publish'). The denominator is that
 * SAME decided set — approved PLUS theme-rejected
 * (`shadow_publish_rejected_theme`) — never `shadow_publish_candidates`
 * (still `status='queued'`, i.e. UNDECIDED). The old code divided by
 * `shadow_publish_candidates`, which is disjoint from the numerator by
 * definition (a row can't be both 'queued' and 'approved'), so the ratio
 * wasn't a precision figure at all and could exceed 100%.
 */
export function summarizeShadowSample(
  rows: Pick<IngestPrecisionRow, 'shadow_publish_approved' | 'shadow_publish_rejected_theme'>[]
): PrecisionSample {
  const approved = rows.reduce((sum, r) => sum + Number(r.shadow_publish_approved || 0), 0);
  const rejectedTheme = rows.reduce((sum, r) => sum + Number(r.shadow_publish_rejected_theme || 0), 0);
  const sampleSize = approved + rejectedTheme;
  return { sampleSize, positive: approved, precision: computePrecision(sampleSize, approved) };
}

/**
 * What counts as an auto-publish FAILURE (review finding, HIGH item 2,
 * "decide what counts as a failure explicitly"):
 * - `auto_published` (still live): success.
 * - `unpublished` (an admin explicitly pulled it from the queue's
 *   "Unpublish" action): always a failure — a direct, deliberate signal
 *   that this auto-publish was wrong.
 * - `unpublished_external` (the reconcile step found the sheet row gone —
 *   a curator deleted it some other way): a failure ONLY if the event
 *   hadn't happened yet when it disappeared. A curator tidying up a row
 *   for an event that's already over isn't reporting a quality problem;
 *   `eventDateISO` unknown is treated conservatively as a failure (we
 *   can't rule out it was pulled before the event).
 */
export function isAutoPublishFailure(outcome: {
  status: string;
  eventDateISO?: string | null;
  /** When the removal was detected — `ingest_candidates.updated_at`, bumped
   *  by the table's `updated_at` trigger on the same write that flips
   *  status to `unpublished_external`. Used only to compare against
   *  `eventDateISO`'s calendar day. */
  detectedAtIso?: string | null;
}): boolean {
  if (outcome.status === 'auto_published') return false;
  if (outcome.status === 'unpublished') return true;
  if (outcome.status === 'unpublished_external') {
    if (!outcome.eventDateISO) return true; // unknown date: conservative
    if (!outcome.detectedAtIso) return true; // unknown detection time: conservative
    const detectedDateISO = outcome.detectedAtIso.slice(0, 10);
    return outcome.eventDateISO >= detectedDateISO; // event hadn't happened yet -> real failure
  }
  return false;
}

/**
 * A row is simply excluded from the rolling sample (neither a success nor
 * a failure) when it's a post-event `unpublished_external` removal — it's
 * not informative either way, so it shouldn't dilute or distort the
 * precision figure.
 */
function isExcludedFromRollingSample(outcome: { status: string; eventDateISO?: string | null; detectedAtIso?: string | null }): boolean {
  if (outcome.status !== 'unpublished_external') return false;
  if (!outcome.eventDateISO || !outcome.detectedAtIso) return false; // unknown -> keep (conservative, counted as failure above)
  const detectedDateISO = outcome.detectedAtIso.slice(0, 10);
  return outcome.eventDateISO < detectedDateISO; // event had ALREADY happened when removed -> noise, drop it
}

/** Precision among the most recent real auto-published outcomes (§11
 *  "auto-publish precision = 1 - unpublished/auto_published") — what's
 *  ACTUALLY happening once auto-publish is live, used by the kill switch.
 *  Applies `isAutoPublishFailure`'s rule and drops post-event
 *  `unpublished_external` noise entirely (review finding, HIGH item 2). */
export function summarizeRealOutcomeSample(
  rows: { status: string; event?: { dateISO?: string | null } | null; updated_at?: string | null }[]
): PrecisionSample {
  let sampleSize = 0;
  let positive = 0;
  for (const r of rows) {
    const outcome = { status: r.status, eventDateISO: r.event?.dateISO ?? null, detectedAtIso: r.updated_at ?? null };
    if (isExcludedFromRollingSample(outcome)) continue;
    sampleSize++;
    if (!isAutoPublishFailure(outcome)) positive++;
  }
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
 * The kill switch: once auto-publish is live, check the most recent real
 * outcomes SINCE THE MOST RECENT ENABLE (`enabledAt` — a re-enable must
 * never be killed immediately by a prior bad window's history, review
 * finding, HIGH item 2) and turn it back off, recording why, if rolling
 * precision has dropped below the gate threshold. Deliberately uses the
 * SAME threshold/sample-size constants as the enable gate — same bar, both
 * directions.
 *
 * Called just before each actual auto-publish attempt in
 * `pipeline.ts#processSource` (review finding, LOW item 10) rather than
 * only once at the top of a run, so a conference that goes bad mid-run
 * stops publishing partway through, not only on the NEXT run.
 */
export async function checkAutoPublishKillSwitch(
  conference: string,
  opts: { enabledAt?: string | null } = {}
): Promise<KillSwitchResult> {
  const rows = await getRecentAutoPublishOutcomes(conference, {
    sinceIso: opts.enabledAt,
    limit: AUTO_PUBLISH_MIN_SAMPLE_SIZE,
  });
  const sample = summarizeRealOutcomeSample(rows);

  if (sample.sampleSize < AUTO_PUBLISH_MIN_SAMPLE_SIZE) {
    return { killed: false, sample };
  }
  if (sample.precision === null || sample.precision >= AUTO_PUBLISH_PRECISION_THRESHOLD) {
    return { killed: false, sample };
  }

  const pct = (sample.precision * 100).toFixed(1);
  await updateProfilePatch(conference, {
    auto_publish_enabled: false,
    auto_publish_killed_at: new Date().toISOString(),
    auto_publish_kill_reason:
      `Rolling precision dropped to ${pct}% over ${sample.sampleSize} recent auto-published items ` +
      `(kill-switch threshold ${(AUTO_PUBLISH_PRECISION_THRESHOLD * 100).toFixed(0)}%).`,
  });
  return { killed: true, sample };
}

/* ------------------------------------------------------------------ */
/* Test support: a pure-TS mirror of the `ingest_precision` SQL view    */
/* ------------------------------------------------------------------ */

/** The slice of an `ingest_candidates` row the view's `group by`/`filter`
 *  clauses read. Deliberately mirrors the SQL column list exactly. */
export interface PrecisionViewCandidateInput {
  conference: string;
  source_kind: string;
  final_score: number | null;
  status: CandidateStatus;
  reject_reason: string | null;
  shadow_route: CandidateRoute | null;
  /** Optional: only needed to classify swept duplicates (dedupe-sweep.ts). */
  published_at?: string | null;
  auto_published_at?: string | null;
}

function scoreBucket(finalScore: number | null): string {
  if (finalScore === null) return 'unscored';
  if (finalScore >= 90) return '90-100';
  if (finalScore >= 80) return '80-89';
  if (finalScore >= 60) return '60-79';
  if (finalScore >= 40) return '40-59';
  return '0-39';
}

const THEME_REJECT_REASONS_FOR_VIEW = new Set(['off_theme', 'spam']);

/** Shadow-precision negatives (migration 20261029140000): ANY human
 *  rejection of an item the router would have auto-published counts
 *  against precision — online, lodging, wrong_city, private, pre_event...
 *  would all have been bad publishes — except `duplicate` (the event was
 *  right, it just already existed). A rejection with no reason counts too
 *  (conservative). */
export function isShadowPublishNegative(c: Pick<PrecisionViewCandidateInput, 'status' | 'reject_reason' | 'shadow_route'>): boolean {
  return c.status === 'rejected' && c.shadow_route === 'publish' && (c.reject_reason ?? '') !== 'duplicate';
}

/**
 * A pure-TypeScript mirror of the `ingest_precision` view's exact SQL
 * (`supabase/migrations/20261011120000_event_ingestion.sql`, extended by
 * `20261012120000_event_ingestion_phase2.sql`, `20261028120000` and
 * `20261029140000_precision_all_rejects.sql`) — group by
 * (conference, source_kind, score_bucket), same `count(*) filter (...)`
 * conditions. Exists ONLY so tests can build realistic, raw candidate rows
 * (review finding, CRITICAL item 1: "write the tests against realistic
 * candidate and label rows, not hand-built view rows") and verify the
 * actual aggregation semantics end-to-end, instead of hand-asserting
 * `{shadow_publish_approved: 29, shadow_publish_rejected_theme: 1}`
 * numbers that could just as easily encode the same bug the fix corrects.
 * If the SQL view's logic ever changes, this must change with it.
 */
export function computePrecisionRowsFromCandidates(candidates: PrecisionViewCandidateInput[]): IngestPrecisionRow[] {
  const groups = new Map<string, IngestPrecisionRow>();
  for (const c of candidates) {
    const bucket = scoreBucket(c.final_score);
    const key = `${c.conference}\u0000${c.source_kind}\u0000${bucket}`;
    const row =
      groups.get(key) ??
      ({
        conference: c.conference,
        source_kind: c.source_kind,
        score_bucket: bucket,
        reviewed_on_theme: 0,
        reviewed_off_theme: 0,
        auto_published: 0,
        auto_unpublished: 0,
        shadow_publish_candidates: 0,
        shadow_publish_approved: 0,
        shadow_publish_rejected_theme: 0,
      } satisfies IngestPrecisionRow);
    groups.set(key, row);

    const isThemeRejected = c.status === 'rejected' && !!c.reject_reason && THEME_REJECT_REASONS_FOR_VIEW.has(c.reject_reason);
    // Swept duplicates (status 'duplicate' but published) keep counting as
    // the correct publishes they were — mirrors migration 20261028120000.
    const sweptAuto = c.status === 'duplicate' && !!c.auto_published_at;
    const sweptApproved = c.status === 'duplicate' && !!c.published_at && !c.auto_published_at;
    const isApproved = c.status === 'approved' || sweptApproved;
    if (isApproved) row.reviewed_on_theme++;
    if (isThemeRejected) row.reviewed_off_theme++;
    if (c.status === 'auto_published' || sweptAuto) row.auto_published++;
    if (c.status === 'unpublished' || c.status === 'unpublished_external') row.auto_unpublished++;
    if (c.status === 'queued' && c.shadow_route === 'publish') row.shadow_publish_candidates++;
    if (isApproved && c.shadow_route === 'publish') row.shadow_publish_approved++;
    // Despite the legacy column name, every non-duplicate rejection counts
    // (migration 20261029140000) — see `isShadowPublishNegative`.
    if (isShadowPublishNegative(c)) row.shadow_publish_rejected_theme++;
  }
  return Array.from(groups.values());
}
