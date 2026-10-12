// Phase 2 learning loop (plans/event-ingestion.md §5.6): admin approve/
// reject decisions in `ingest_labels` are fed back to the classifier as
// few-shot examples, per conference/theme, and (optionally) nudge the
// trusted/blocked host signals. Pure selection/derivation logic lives here
// so it's unit-testable without mocking Supabase; the two queries this
// needs (`listLabelsForFewShot`, `listLabelsForHostSignals`) live in
// `db.ts` with the rest of the typed Supabase access.
import { normalizeHostName } from './hosts';
import { listLabelsForFewShot, listLabelsForHostSignals } from './db';
import type { FewShotExample, IngestLabelRow, ThemeKey } from './types';

/** Rough token estimate (chars/4) — good enough to keep the few-shot block
 *  small; exact tokenization isn't needed for a soft budget like this. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Up to 4 positives + 4 negatives (§5.6). */
export const MAX_FEWSHOT_EXAMPLES_PER_LABEL = 4;
/** ~8 examples * ~90 tokens (plan estimates ~60/example; some headroom for
 *  longer summaries) — small enough that §5.6's prompt-caching note still
 *  holds (our prompt stays well under the 4,096-token cacheable minimum
 *  either way). */
export const DEFAULT_FEWSHOT_TOKEN_BUDGET = 800;
/** Per-field truncation (review finding, LOW item 9) — keeps any one
 *  example's `summary`/`reason` from eating the whole token budget by
 *  itself, independent of the stricter 160-char cap `prompt.ts` applies
 *  again right before the examples go into a request (defense in depth:
 *  that one also drops examples that fail the injection scan). */
const MAX_FEWSHOT_FIELD_CHARS = 200;

function truncateField(text: string, maxChars: number = MAX_FEWSHOT_FIELD_CHARS): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 1)}…`;
}

/** Every host/co-host name on the label's example snapshot — used ONLY
 *  for the human-readable few-shot `summary` (plan §5.6: "name | hosts").
 *  NOT used for learned-signal attribution; see `examplePrimaryOrganizer`
 *  for that (review finding, MEDIUM item 6). */
function exampleHostNames(example: Record<string, unknown> | null | undefined): string[] {
  if (!example) return [];
  const names: string[] = [];
  const hosts = example.hosts;
  if (Array.isArray(hosts)) {
    for (const h of hosts) {
      if (typeof h === 'string' && h.trim()) names.push(h.trim());
    }
  }
  return names;
}

/** The PRIMARY organizer only (never a co-host) from a label's example
 *  snapshot — the unit of attribution for learned trusted/blocked host
 *  signals (review finding, MEDIUM item 6: "Only count the primary
 *  organizer, not every co-host"). A popular event's co-host list can
 *  include someone who appears once and is otherwise unrelated; crediting
 *  or blaming them for that one event's outcome is the wrong attribution.
 *  The organizer is the account that actually owns/runs the event. */
function examplePrimaryOrganizer(example: Record<string, unknown> | null | undefined): string | null {
  if (!example) return null;
  const organizer = example.organizer;
  return typeof organizer === 'string' && organizer.trim() ? organizer.trim() : null;
}

/** "name | hosts" (plan §5.6's "name | hosts | 1-line summary", minus the
 *  summary — the admin/model reason already carries that, via
 *  `buildFewShotReason`, so we don't need a third redundant clause). Falls
 *  back to the calendar name when there are no hosts on record. Truncated
 *  (review finding, LOW item 9). */
export function buildFewShotSummary(label: Pick<IngestLabelRow, 'example'>): string {
  const example = label.example ?? {};
  const name = typeof example.name === 'string' && example.name.trim() ? example.name.trim() : '(untitled)';
  const hosts = exampleHostNames(example);
  const calendar = typeof example.calendar === 'string' && example.calendar.trim() ? example.calendar.trim() : null;
  const summary = hosts.length > 0 ? `${name} | ${hosts.slice(0, 3).join(', ')}` : calendar ? `${name} | ${calendar}` : name;
  return truncateField(summary);
}

/** The one-line "why" shown after the label (plan §5.6). Prefers the
 *  admin's own reject/approve-note reason; falls back to the model's
 *  `llm_reason` captured in the label snapshot at decision time, then a
 *  generic fallback so the prompt line is never empty. Truncated (review
 *  finding, LOW item 9). */
export function buildFewShotReason(label: Pick<IngestLabelRow, 'reason' | 'example'>): string {
  if (label.reason && label.reason.trim()) return truncateField(label.reason.trim());
  const example = label.example ?? {};
  if (typeof example.llmReason === 'string' && example.llmReason.trim()) return truncateField(example.llmReason.trim());
  return 'admin decision';
}

export function toFewShotExample(label: Pick<IngestLabelRow, 'example' | 'reason' | 'label'>): FewShotExample {
  return {
    summary: buildFewShotSummary(label),
    label: label.label,
    reason: buildFewShotReason(label),
  };
}

/** "Hard" examples (§5.6: "label disagreed with the model's route") — the
 *  classifier's own mistakes are the most useful correction to show it. An
 *  approval (`on_theme`) is hard if the model DIDN'T route it to publish; a
 *  rejection (`off_theme`) is hard if the model didn't route it to reject
 *  (i.e. it was queued or published and an admin disagreed). A label with
 *  no recorded `model_route` (e.g. an `eval_seed` import) is never "hard" —
 *  there's nothing to have disagreed with. */
export function isHardExample(label: Pick<IngestLabelRow, 'label' | 'model_route'>): boolean {
  if (!label.model_route) return false;
  return label.label === 'on_theme' ? label.model_route !== 'publish' : label.model_route !== 'reject';
}

/**
 * Rank a pool of theme labels for few-shot selection (§5.6): same
 * conference first, then other conferences sharing the theme; within each
 * group, hard examples first, then most recent. Stable w.r.t. the input
 * order for ties (array sort is stable in V8/Node).
 */
export function rankLabelsForFewShot(labels: IngestLabelRow[], conference: string): IngestLabelRow[] {
  return [...labels].sort((a, b) => {
    const confA = a.conference === conference ? 0 : 1;
    const confB = b.conference === conference ? 0 : 1;
    if (confA !== confB) return confA - confB;
    const hardA = isHardExample(a) ? 0 : 1;
    const hardB = isHardExample(b) ? 0 : 1;
    if (hardA !== hardB) return hardA - hardB;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

export interface SelectFewShotOptions {
  conference: string;
  /** Exclude a label tied to this candidate (a rescore shouldn't see its
   *  own prior decision, if it somehow has one, as an example of itself). */
  excludeCandidateId?: string | null;
  maxPerLabel?: number;
  maxTokenBudget?: number;
}

/**
 * Deterministic few-shot selection (§5.6) over an already-fetched pool of
 * theme labels for one `theme_key` (`db.ts#listLabelsForFewShot`, which
 * already filters `label_kind='theme'` and `excluded_from_fewshot=false` —
 * this function assumes that's done and only ranks/budgets). Up to
 * `maxPerLabel` (4) positives and `maxPerLabel` negatives, trimmed to fit
 * `maxTokenBudget`.
 *
 * Review finding, LOW item 9:
 * - positives and negatives are INTERLEAVED (pos, neg, pos, neg, ...)
 *   before budgeting, so a tight budget still gets a balanced mix instead
 *   of mostly-positives (the original order was all positives then all
 *   negatives);
 * - an example that doesn't fit the remaining budget is SKIPPED, not a
 *   stop signal — a later, shorter example may still fit, so one verbose
 *   example no longer silently cuts off everything after it.
 */
export function selectFewShotExamples(pool: IngestLabelRow[], opts: SelectFewShotOptions): FewShotExample[] {
  const maxPerLabel = opts.maxPerLabel ?? MAX_FEWSHOT_EXAMPLES_PER_LABEL;
  const maxTokenBudget = opts.maxTokenBudget ?? DEFAULT_FEWSHOT_TOKEN_BUDGET;
  const filtered = opts.excludeCandidateId
    ? pool.filter((l) => l.candidate_id !== opts.excludeCandidateId)
    : pool;
  const ranked = rankLabelsForFewShot(filtered, opts.conference);

  const positives = ranked.filter((l) => l.label === 'on_theme').slice(0, maxPerLabel);
  const negatives = ranked.filter((l) => l.label === 'off_theme').slice(0, maxPerLabel);

  const interleaved: IngestLabelRow[] = [];
  const maxLen = Math.max(positives.length, negatives.length);
  for (let i = 0; i < maxLen; i++) {
    if (positives[i]) interleaved.push(positives[i]);
    if (negatives[i]) interleaved.push(negatives[i]);
  }

  const examples: FewShotExample[] = [];
  let tokens = 0;
  for (const label of interleaved) {
    const ex = toFewShotExample(label);
    const cost = estimateTokens(`${ex.summary} -> ${ex.label} (${ex.reason})`);
    if (tokens + cost > maxTokenBudget) continue; // skip, don't stop — a smaller later example may still fit
    examples.push(ex);
    tokens += cost;
  }
  return examples;
}

/* ------------------------------------------------------------------ */
/* Optional: nudge trusted/blocked host signals from label history     */
/* (plan Phase 2 item 1: "Optionally adjust the trusted and blocked      */
/* host signals from the label history.")                               */
/* ------------------------------------------------------------------ */

export interface LearnedHostSignals {
  /** Normalized (`normalizeHostName`) host/organizer name keys. */
  trusted: Set<string>;
  blocked: Set<string>;
}

/** A host needs this many one-sided theme decisions before it's trusted
 *  (or blocked) purely from label history — low enough to matter at our
 *  volumes (plan §12: tens to hundreds of candidates per conference), high
 *  enough that one odd approval/rejection can't flip it on its own. */
export const LEARNED_HOST_MIN_DECISIONS = 3;

/**
 * Derive a learned trusted/blocked host set from a conference's theme
 * labels. Scoped to ONE conference's own label history (unlike few-shot,
 * which deliberately shares across the theme) — host trust is a property
 * of this conference's community, not the theme in general.
 *
 * Attribution is to the PRIMARY ORGANIZER only, never a co-host (review
 * finding, MEDIUM item 6) — see `examplePrimaryOrganizer`. Callers should
 * pass the pool from `db.ts#listLabelsForHostSignals` (conference-scoped,
 * NOT filtered on `excluded_from_fewshot` — review finding, MEDIUM item 6:
 * that flag is about few-shot PROMPT suitability, a different question
 * from whether a label is valid evidence for this statistic), not
 * `listLabelsForFewShot`'s theme-wide, few-shot-filtered pool.
 */
export function deriveLearnedHostSignals(
  labels: Pick<IngestLabelRow, 'label' | 'label_kind' | 'example'>[]
): LearnedHostSignals {
  const approvals = new Map<string, number>();
  const rejections = new Map<string, number>();
  for (const label of labels) {
    if (label.label_kind !== 'theme') continue;
    const organizer = examplePrimaryOrganizer(label.example);
    if (!organizer) continue;
    const key = normalizeHostName(organizer);
    if (!key) continue;
    const bucket = label.label === 'on_theme' ? approvals : rejections;
    bucket.set(key, (bucket.get(key) ?? 0) + 1);
  }
  const trusted = new Set<string>();
  const blocked = new Set<string>();
  for (const [key, count] of approvals) {
    if (count >= LEARNED_HOST_MIN_DECISIONS && (rejections.get(key) ?? 0) === 0) trusted.add(key);
  }
  for (const [key, count] of rejections) {
    if (count >= LEARNED_HOST_MIN_DECISIONS && (approvals.get(key) ?? 0) === 0) blocked.add(key);
  }
  return { trusted, blocked };
}

export function learnedHostSignalMatches(
  signals: LearnedHostSignals,
  kind: 'trusted' | 'blocked',
  names: (string | null | undefined)[]
): boolean {
  const set = kind === 'trusted' ? signals.trusted : signals.blocked;
  if (set.size === 0) return false;
  return names.some((n) => !!n && set.has(normalizeHostName(n)));
}

/* ------------------------------------------------------------------ */
/* Supabase-backed entry point used by pipeline.ts / the queue route    */
/* ------------------------------------------------------------------ */

export interface LearningContext {
  fewShot: FewShotExample[];
  learnedHosts: LearnedHostSignals;
}

/**
 * Two SEPARATE label-history fetches (review finding, MEDIUM item 6):
 * few-shot selection reads the theme-wide, few-shot-eligible pool
 * (`listLabelsForFewShot` — excludes `excluded_from_fewshot`); learned
 * host signals read a conference-scoped pool with NO such filter
 * (`listLabelsForHostSignals`) — a label can be unsuitable as a PROMPT
 * EXAMPLE (verbose, oddly phrased) while still being perfectly valid
 * evidence that "this organizer's events tend to get approved/rejected".
 * Reusing the few-shot pool for both, as the original Phase 2 version
 * did, silently under-counted host-signal evidence.
 */
export async function loadLearningContext(opts: {
  conference: string;
  themeKey: ThemeKey;
  excludeCandidateId?: string | null;
}): Promise<LearningContext> {
  const [fewShotPool, hostSignalPool] = await Promise.all([
    listLabelsForFewShot(opts.themeKey),
    listLabelsForHostSignals(opts.conference),
  ]);
  const fewShot = selectFewShotExamples(fewShotPool, {
    conference: opts.conference,
    excludeCandidateId: opts.excludeCandidateId,
  });
  const learnedHosts = deriveLearnedHostSignals(hostSignalPool);
  return { fewShot, learnedHosts };
}
