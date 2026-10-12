// Typed Supabase access for the ingestion ledger (§7 `db.ts`). All five
// tables are service-role only (no RLS policies for anon/authenticated), so
// every function here must run server-side with SUPABASE_SERVICE_ROLE_KEY.
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getDefaultProfile } from './profiles';
import { FINAL_CANDIDATE_STATUSES } from './types';
import type {
  CandidateRoute,
  CandidateStatus,
  IngestCandidateRow,
  IngestLabelRow,
  IngestProfileRow,
  IngestRunRow,
  IngestSourceRow,
  LabelSource,
  NormalizedEvent,
  RunCounts,
  RunStatus,
  RunTrigger,
  SourceKind,
  ThemeKey,
  ThemeProfile,
} from './types';

let cached: SupabaseClient | null = null;

export function getIngestSupabase(): SupabaseClient {
  if (cached) return cached;
  cached = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  return cached;
}

/** Only used by tests to reset the memoized client between suites. */
export function _resetIngestSupabaseForTests() {
  cached = null;
}

/** Map a DB profile row to the plain `ThemeProfile` the classifier/signals take. */
export function profileRowToThemeProfile(row: IngestProfileRow): ThemeProfile {
  const preset = row.theme_key === 'custom' ? null : getDefaultProfile(row.theme_key);
  return {
    themeKey: row.theme_key,
    themeName: preset?.themeName ?? 'Custom',
    themeDescription: row.theme_description,
    includeKeywords: row.include_keywords,
    excludeKeywords: row.exclude_keywords,
    publishThreshold: row.publish_threshold,
    reviewThreshold: row.review_threshold,
  };
}

/** Build a new `ingest_profiles` row seeded from a theme preset (§9.1 "Enable ingestion"). */
export function seedProfileRow(conference: string, themeKey: ThemeKey): Omit<IngestProfileRow, 'updated_at'> {
  const preset = getDefaultProfile(themeKey);
  return {
    conference,
    theme_key: themeKey,
    theme_description: preset.themeDescription,
    include_keywords: preset.includeKeywords,
    exclude_keywords: preset.excludeKeywords,
    trusted_hosts: [],
    blocked_hosts: [],
    publish_threshold: preset.publishThreshold,
    review_threshold: preset.reviewThreshold,
    auto_publish_enabled: false, // shadow mode default (§5.7, §17.3)
    radius_km: 40,
    window_pre_days: 3,
    window_post_days: 1,
    allow_online: false,
    max_llm_calls_per_run: 150,
    max_publish_per_run: 25,
    enabled: true,
    auto_publish_killed_at: null,
    auto_publish_kill_reason: null,
    auto_publish_enabled_at: null,
  };
}

export async function getProfile(conference: string): Promise<IngestProfileRow | null> {
  const supabase = getIngestSupabase();
  const { data, error } = await supabase
    .from('ingest_profiles')
    .select('*')
    .eq('conference', conference)
    .maybeSingle();
  if (error) throw new Error(`Failed to load ingest profile: ${error.message}`);
  return (data as IngestProfileRow) ?? null;
}

export async function listProfiles(): Promise<IngestProfileRow[]> {
  const supabase = getIngestSupabase();
  const { data, error } = await supabase.from('ingest_profiles').select('*').order('conference');
  if (error) throw new Error(`Failed to list ingest profiles: ${error.message}`);
  return (data as IngestProfileRow[]) ?? [];
}

export async function upsertProfile(row: Partial<IngestProfileRow> & { conference: string }): Promise<IngestProfileRow> {
  const supabase = getIngestSupabase();
  const { data, error } = await supabase
    .from('ingest_profiles')
    .upsert(row, { onConflict: 'conference' })
    .select('*')
    .single();
  if (error) throw new Error(`Failed to save ingest profile: ${error.message}`);
  return data as IngestProfileRow;
}

/**
 * A true partial UPDATE — sends ONLY the given fields, unlike
 * `upsertProfile`, which resends every field of whatever caller-built
 * object it's given (fine for a brand-new row, since there's no prior
 * state to lose, but dangerous for an EXISTING row: a request that read
 * the profile, then wrote back a merge of `{...fullRowItReadEarlier,
 * ...patch}`, can silently clobber a field someone else changed in
 * between — e.g. the kill switch flipping `auto_publish_enabled` off
 * while an admin's unrelated config save is in flight (review finding,
 * MEDIUM item 7)). The config API's PUT handler uses this for every
 * EXISTING profile and only falls back to `upsertProfile` for a brand-new
 * one (where seeding full defaults is the point).
 */
export async function updateProfilePatch(conference: string, patch: Partial<IngestProfileRow>): Promise<IngestProfileRow> {
  const supabase = getIngestSupabase();
  const { data, error } = await supabase
    .from('ingest_profiles')
    .update(patch)
    .eq('conference', conference)
    .select('*')
    .single();
  if (error) throw new Error(`Failed to update ingest profile: ${error.message}`);
  return data as IngestProfileRow;
}

export async function listSources(conference?: string): Promise<IngestSourceRow[]> {
  const supabase = getIngestSupabase();
  let query = supabase.from('ingest_sources').select('*').order('created_at', { ascending: false });
  if (conference) query = query.eq('conference', conference);
  const { data, error } = await query;
  if (error) throw new Error(`Failed to list ingest sources: ${error.message}`);
  return (data as IngestSourceRow[]) ?? [];
}

export async function getSource(id: string): Promise<IngestSourceRow | null> {
  const supabase = getIngestSupabase();
  const { data, error } = await supabase.from('ingest_sources').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`Failed to load ingest source: ${error.message}`);
  return (data as IngestSourceRow) ?? null;
}

/** Enabled sources due to run, oldest `last_run_at` first (nulls first = never run). */
export async function listDueSources(kind?: SourceKind): Promise<IngestSourceRow[]> {
  const supabase = getIngestSupabase();
  let query = supabase
    .from('ingest_sources')
    .select('*')
    .eq('enabled', true)
    .order('last_run_at', { ascending: true, nullsFirst: true });
  if (kind) query = query.eq('kind', kind);
  const { data, error } = await query;
  if (error) throw new Error(`Failed to list due ingest sources: ${error.message}`);
  return (data as IngestSourceRow[]) ?? [];
}

export async function createSource(row: {
  conference: string;
  kind: SourceKind;
  label: string;
  config: Record<string, unknown>;
  trust: 'curated' | 'host' | 'discovery';
  added_by?: string;
}): Promise<IngestSourceRow> {
  const supabase = getIngestSupabase();
  const { data, error } = await supabase.from('ingest_sources').insert(row).select('*').single();
  if (error) throw new Error(`Failed to create ingest source: ${error.message}`);
  return data as IngestSourceRow;
}

export async function updateSource(id: string, patch: Partial<IngestSourceRow>): Promise<void> {
  const supabase = getIngestSupabase();
  const { error } = await supabase.from('ingest_sources').update(patch).eq('id', id);
  if (error) throw new Error(`Failed to update ingest source: ${error.message}`);
}

export async function deleteSource(id: string): Promise<void> {
  const supabase = getIngestSupabase();
  const { error } = await supabase.from('ingest_sources').delete().eq('id', id);
  if (error) throw new Error(`Failed to delete ingest source: ${error.message}`);
}

/* ------------------------------------------------------------------ */
/* Candidates                                                          */
/* ------------------------------------------------------------------ */

export async function getCandidateByKey(conference: string, canonicalKey: string): Promise<IngestCandidateRow | null> {
  const supabase = getIngestSupabase();
  const { data, error } = await supabase
    .from('ingest_candidates')
    .select('*')
    .eq('conference', conference)
    .eq('canonical_key', canonicalKey)
    .maybeSingle();
  if (error) throw new Error(`Failed to load candidate: ${error.message}`);
  return (data as IngestCandidateRow) ?? null;
}

export async function getCandidate(id: string): Promise<IngestCandidateRow | null> {
  const supabase = getIngestSupabase();
  const { data, error } = await supabase.from('ingest_candidates').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`Failed to load candidate: ${error.message}`);
  return (data as IngestCandidateRow) ?? null;
}

export async function insertCandidate(row: {
  conference: string;
  canonical_key: string;
  alt_keys: string[];
  source_id: string | null;
  source_kind: SourceKind;
  sources: unknown[];
  source_ref: string | null;
  event: NormalizedEvent;
  content_hash: string;
  ical_hash?: string | null;
  status: CandidateStatus;
}): Promise<IngestCandidateRow> {
  const supabase = getIngestSupabase();
  const { data, error } = await supabase.from('ingest_candidates').insert(row).select('*').single();
  if (error) throw new Error(`Failed to insert candidate: ${error.message}`);
  return data as IngestCandidateRow;
}

export async function updateCandidate(id: string, patch: Record<string, unknown>): Promise<void> {
  const supabase = getIngestSupabase();
  const { error } = await supabase.from('ingest_candidates').update(patch).eq('id', id);
  if (error) throw new Error(`Failed to update candidate: ${error.message}`);
}

/** The ONLY fields a re-ingest may touch once a candidate has a
 *  final/admin-owned status — notably NOT `event`/`content_hash`, which
 *  would otherwise silently replace an enriched (or admin-edited) snapshot
 *  with the bare, un-enriched iCal stub (review finding, MEDIUM item 1).
 *  `conference`/`canonical_key` are the upsert's conflict-target columns,
 *  not really "refreshed", but must stay in the written payload for the
 *  ON CONFLICT match itself. */
const FINAL_REFRESH_FIELDS = ['conference', 'canonical_key', 'ical_hash', 'last_seen_at', 'sources'] as const;

/** PostgREST `not(...,'in',...)` list literal for FINAL_CANDIDATE_STATUSES. */
const FINAL_STATUS_LIST = `(${FINAL_CANDIDATE_STATUSES.map((s) => `"${s}"`).join(',')})`;

/**
 * Idempotent upsert keyed on (conference, canonical_key) — the pipeline's
 * main write path (§5 "upsert candidate (idempotent)").
 *
 * Guards against a re-ingest overwriting an admin decision or a publish
 * outcome (CRITICAL item 2): if the existing row's status is final
 * (`FINAL_CANDIDATE_STATUSES` — approved/auto_published/rejected/
 * unpublished/unpublished_external), only `FINAL_REFRESH_FIELDS` are
 * written; `status` and every decision/publish field are left exactly as
 * they are. This also means a previously-published candidate can never be
 * re-marked `duplicate` of its own now-live sheet row, and an unpublished
 * candidate can never be silently re-queued or re-published by a later run.
 *
 * Closes the read-then-write race a separate "SELECT status, then decide,
 * then write" would have (review finding, LOW item 4): both attempts below
 * are conditional UPDATEs whose WHERE clause is evaluated atomically
 * against the row as it exists at the moment the UPDATE actually runs, not
 * against an earlier, possibly-stale read. Whichever one's WHERE matches
 * wins; if neither matches, no row exists yet and we insert one.
 */
export async function upsertCandidate(row: Record<string, unknown> & { conference: string; canonical_key: string }): Promise<IngestCandidateRow> {
  const supabase = getIngestSupabase();
  const nowIso = new Date().toISOString();

  // 1. If a FINAL row already exists, refresh only the allowed fields.
  //    Gated entirely by `.in('status', FINAL_CANDIDATE_STATUSES)` in the
  //    WHERE clause — if the row is concurrently un-finalized between a
  //    caller deciding to call this and this statement running, this
  //    simply won't match, and step 2 below will.
  const finalRefreshPatch: Record<string, unknown> = { last_seen_at: nowIso };
  for (const key of FINAL_REFRESH_FIELDS) {
    if (key === 'conference' || key === 'canonical_key' || key === 'last_seen_at') continue;
    if (key in row) finalRefreshPatch[key] = row[key];
  }
  const { data: finalMatch, error: finalError } = await supabase
    .from('ingest_candidates')
    .update(finalRefreshPatch)
    .eq('conference', row.conference)
    .eq('canonical_key', row.canonical_key)
    .in('status', FINAL_CANDIDATE_STATUSES as CandidateStatus[])
    .select('*')
    .maybeSingle();
  if (finalError) throw new Error(`Failed to refresh a final candidate: ${finalError.message}`);
  if (finalMatch) return finalMatch as IngestCandidateRow;

  // 2. Not final (or no row yet) — try a full conditional update against a
  //    NON-final row.
  const fullPatch = { ...row, last_seen_at: nowIso };
  const { data: nonFinalMatch, error: nonFinalError } = await supabase
    .from('ingest_candidates')
    .update(fullPatch)
    .eq('conference', row.conference)
    .eq('canonical_key', row.canonical_key)
    .not('status', 'in', FINAL_STATUS_LIST)
    .select('*')
    .maybeSingle();
  if (nonFinalError) throw new Error(`Failed to update candidate: ${nonFinalError.message}`);
  if (nonFinalMatch) return nonFinalMatch as IngestCandidateRow;

  // 3. Neither UPDATE matched a row — it doesn't exist yet. Insert (or, on
  //    the rare chance a concurrent insert won the race in the meantime,
  //    fall back to upserting it).
  const { data: inserted, error: insertError } = await supabase
    .from('ingest_candidates')
    .upsert(fullPatch, { onConflict: 'conference,canonical_key' })
    .select('*')
    .single();
  if (insertError) throw new Error(`Failed to insert candidate: ${insertError.message}`);
  return inserted as IngestCandidateRow;
}

/**
 * Atomically transition a candidate's status, but ONLY if its current
 * status is one of `fromStatuses` — acts as a lock so two concurrent
 * requests for the same id (a double-click, a retried request) can't both
 * "win" (review finding, HIGH item 3). Returns the updated row, or `null`
 * if the candidate wasn't in an eligible status (already handled, or never
 * eligible) — callers must treat `null` as "do nothing further", never
 * retry the side effect (e.g. a sheet insert).
 */
export async function claimCandidateStatus(
  id: string,
  fromStatuses: readonly CandidateStatus[],
  toStatus: CandidateStatus,
  extra: Record<string, unknown> = {}
): Promise<IngestCandidateRow | null> {
  const supabase = getIngestSupabase();
  const { data, error } = await supabase
    .from('ingest_candidates')
    .update({ status: toStatus, ...extra })
    .eq('id', id)
    .in('status', fromStatuses as CandidateStatus[])
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`Failed to claim candidate status: ${error.message}`);
  return (data as IngestCandidateRow) ?? null;
}

export async function listCandidates(opts: {
  conference?: string;
  status?: CandidateStatus | CandidateStatus[];
  sourceId?: string;
  minScore?: number;
  limit?: number;
}): Promise<IngestCandidateRow[]> {
  const supabase = getIngestSupabase();
  let query = supabase.from('ingest_candidates').select('*');
  if (opts.conference) query = query.eq('conference', opts.conference);
  if (opts.status) {
    query = Array.isArray(opts.status) ? query.in('status', opts.status) : query.eq('status', opts.status);
  }
  if (opts.sourceId) query = query.eq('source_id', opts.sourceId);
  if (opts.minScore !== undefined) query = query.gte('final_score', opts.minScore);
  query = query.order('final_score', { ascending: false }).limit(opts.limit ?? 200);
  const { data, error } = await query;
  if (error) throw new Error(`Failed to list candidates: ${error.message}`);
  return (data as IngestCandidateRow[]) ?? [];
}

/** Recent candidates for a conference, used by fuzzy dedupe within/across runs. */
export async function listRecentCandidatesForDedupe(conference: string): Promise<IngestCandidateRow[]> {
  const supabase = getIngestSupabase();
  const { data, error } = await supabase
    .from('ingest_candidates')
    .select('*')
    .eq('conference', conference)
    .not('status', 'in', '("rejected","unpublished","unpublished_external","stale")')
    .order('last_seen_at', { ascending: false })
    .limit(2000);
  if (error) throw new Error(`Failed to list candidates for dedupe: ${error.message}`);
  return (data as IngestCandidateRow[]) ?? [];
}

/* ------------------------------------------------------------------ */
/* Runs                                                                 */
/* ------------------------------------------------------------------ */

export async function createRun(row: {
  source_id: string | null;
  conference: string;
  trigger: RunTrigger;
}): Promise<IngestRunRow> {
  const supabase = getIngestSupabase();
  const { data, error } = await supabase
    .from('ingest_runs')
    .insert({ ...row, status: 'running' as RunStatus })
    .select('*')
    .single();
  if (error) throw new Error(`Failed to create ingest run: ${error.message}`);
  return data as IngestRunRow;
}

export async function finishRun(
  id: string,
  patch: {
    status: RunStatus;
    counts: RunCounts;
    llm_input_tokens?: number;
    llm_output_tokens?: number;
    est_cost_usd?: number;
    error?: string | null;
  }
): Promise<void> {
  const supabase = getIngestSupabase();
  const { error } = await supabase
    .from('ingest_runs')
    .update({ ...patch, finished_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(`Failed to finish ingest run: ${error.message}`);
}

/** A source has a `running` row started less than `withinMs` ago (overlap guard, §8). */
export async function hasRecentRunningRun(sourceId: string, withinMs = 10 * 60 * 1000): Promise<boolean> {
  const supabase = getIngestSupabase();
  const since = new Date(Date.now() - withinMs).toISOString();
  const { data, error } = await supabase
    .from('ingest_runs')
    .select('id')
    .eq('source_id', sourceId)
    .eq('status', 'running')
    .gte('started_at', since)
    .limit(1);
  if (error) throw new Error(`Failed to check running runs: ${error.message}`);
  return (data ?? []).length > 0;
}

/** Mark stale `running` rows (older than `olderThanMs`) as `error` (§8). */
export async function reapStaleRunningRuns(olderThanMs = 10 * 60 * 1000): Promise<number> {
  const supabase = getIngestSupabase();
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  const { data, error } = await supabase
    .from('ingest_runs')
    .update({ status: 'error', error: 'Stale run reaped (exceeded 10 min with no update).', finished_at: new Date().toISOString() })
    .eq('status', 'running')
    .lt('started_at', cutoff)
    .select('id');
  if (error) throw new Error(`Failed to reap stale runs: ${error.message}`);
  return (data ?? []).length;
}

/**
 * Record a one-off LLM cost (a manual "Re-score" from the queue, or a dry
 * run) as its own `ingest_runs` row so it counts toward the monthly budget
 * cap, which just sums `est_cost_usd` across the month (review findings,
 * MEDIUM items 4 and 5 — rescore/dry-run cost wasn't counted before).
 * `counts` can carry a marker like `{ dry_run: 1 }` for the Log tab.
 */
export async function recordAdhocCost(row: {
  conference: string;
  trigger: RunTrigger;
  sourceId?: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  counts?: RunCounts;
  status?: RunStatus;
  error?: string | null;
}): Promise<void> {
  const run = await createRun({ source_id: row.sourceId ?? null, conference: row.conference, trigger: row.trigger });
  await finishRun(run.id, {
    status: row.status ?? 'ok',
    counts: row.counts ?? {},
    llm_input_tokens: row.inputTokens,
    llm_output_tokens: row.outputTokens,
    est_cost_usd: row.costUsd,
    error: row.error ?? null,
  });
}

export async function listRuns(opts: { conference?: string; limit?: number } = {}): Promise<IngestRunRow[]> {
  const supabase = getIngestSupabase();
  let query = supabase.from('ingest_runs').select('*').order('started_at', { ascending: false }).limit(opts.limit ?? 100);
  if (opts.conference) query = query.eq('conference', opts.conference);
  const { data, error } = await query;
  if (error) throw new Error(`Failed to list ingest runs: ${error.message}`);
  return (data as IngestRunRow[]) ?? [];
}

/** Sum of `est_cost_usd` across runs started this calendar month (UTC), for the budget cap. */
export async function monthlyLlmCostUsd(): Promise<number> {
  const supabase = getIngestSupabase();
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const { data, error } = await supabase.from('ingest_runs').select('est_cost_usd').gte('started_at', monthStart);
  if (error) throw new Error(`Failed to sum monthly ingest cost: ${error.message}`);
  return (data ?? []).reduce((sum, r) => sum + Number((r as { est_cost_usd: number }).est_cost_usd || 0), 0);
}

/* ------------------------------------------------------------------ */
/* Labels                                                               */
/* ------------------------------------------------------------------ */

export async function insertLabel(row: {
  candidate_id: string | null;
  conference: string;
  theme_key: ThemeKey;
  label: 'on_theme' | 'off_theme';
  label_kind: 'theme' | 'non_theme';
  source: LabelSource;
  reason?: string | null;
  example: Record<string, unknown>;
  model_score?: number | null;
  model_route?: CandidateRoute | null;
  /** See `IngestLabelRow.excluded_from_fewshot`. Defaults false. */
  excluded_from_fewshot?: boolean;
}): Promise<IngestLabelRow | null> {
  const supabase = getIngestSupabase();
  // Upsert on (candidate_id, source): re-approving/re-rejecting the same
  // candidate from the same source replaces the earlier label instead of
  // erroring on the unique index.
  const { data, error } = await supabase
    .from('ingest_labels')
    .upsert(row, { onConflict: 'candidate_id,source' })
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`Failed to write ingest label: ${error.message}`);
  return (data as IngestLabelRow) ?? null;
}

/* ------------------------------------------------------------------ */
/* Luma slug -> api id cache (§5.2)                                    */
/* ------------------------------------------------------------------ */

/**
 * Tri-state: `undefined` means no cache row exists at all (never looked
 * up — go resolve it); `null` means a row exists and the lookup confirmed
 * no api id (a cached miss — don't burn another rate-limited request on
 * it); a string is the resolved api id. Collapsing "never looked up" and
 * "looked up, found nothing" into the same `null` (as the original version
 * did) meant a confirmed miss was retried on every single run forever
 * (review finding, MEDIUM item 7).
 */
export async function getCachedLumaApiId(linkKey: string): Promise<string | null | undefined> {
  const supabase = getIngestSupabase();
  const { data, error } = await supabase.from('ingest_link_cache').select('luma_api_id').eq('link_key', linkKey).maybeSingle();
  if (error) throw new Error(`Failed to read link cache: ${error.message}`);
  if (!data) return undefined;
  return (data.luma_api_id as string | null) ?? null;
}

export async function setCachedLumaApiId(linkKey: string, apiId: string | null): Promise<void> {
  const supabase = getIngestSupabase();
  const { error } = await supabase
    .from('ingest_link_cache')
    .upsert({ link_key: linkKey, luma_api_id: apiId, resolved_at: new Date().toISOString() }, { onConflict: 'link_key' });
  if (error) throw new Error(`Failed to write link cache: ${error.message}`);
}

/* ------------------------------------------------------------------ */
/* Phase 2: learning loop + precision dashboard + auto-publish gate    */
/* ------------------------------------------------------------------ */

/** Theme labels eligible for few-shot (`learning.ts#selectFewShotExamples`):
 *  `label_kind='theme'` only (non-theme reasons like "duplicate"/"wrong
 *  city" don't teach theme fit) and never `excluded_from_fewshot`. Spans
 *  every conference sharing `themeKey` — `learning.ts` ranks same-conference
 *  examples first but the pool itself is theme-wide (§5.6). */
export async function listLabelsForFewShot(themeKey: ThemeKey, limit = 400): Promise<IngestLabelRow[]> {
  const supabase = getIngestSupabase();
  const { data, error } = await supabase
    .from('ingest_labels')
    .select('*')
    .eq('theme_key', themeKey)
    .eq('label_kind', 'theme')
    .eq('excluded_from_fewshot', false)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Failed to list labels for few-shot: ${error.message}`);
  return (data as IngestLabelRow[]) ?? [];
}

/**
 * Theme labels for ONE conference, for the learned trusted/blocked host
 * signal (`learning.ts#deriveLearnedHostSignals`) — deliberately a
 * SEPARATE query from `listLabelsForFewShot`, not filtered on
 * `excluded_from_fewshot` (review finding, MEDIUM item 6): that flag is
 * specifically about whether a label is a good FEW-SHOT PROMPT example
 * (readable, representative text for the model to imitate), which is a
 * different question from whether it's valid evidence that "this
 * organizer's events tend to get approved/rejected" for the host-signal
 * statistic. A label excluded from few-shot for being verbose or an odd
 * phrasing is still a real admin decision about a real organizer.
 */
export async function listLabelsForHostSignals(
  conference: string,
  limit = 500
): Promise<Pick<IngestLabelRow, 'label' | 'label_kind' | 'example'>[]> {
  const supabase = getIngestSupabase();
  const { data, error } = await supabase
    .from('ingest_labels')
    .select('label, label_kind, example')
    .eq('conference', conference)
    .eq('label_kind', 'theme')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Failed to list labels for host signals: ${error.message}`);
  return (data ?? []) as Pick<IngestLabelRow, 'label' | 'label_kind' | 'example'>[];
}

/** One row of the `ingest_precision` view (migration 20261011120000,
 *  extended by 20261012120000 with `shadow_publish_rejected_theme`). */
export interface IngestPrecisionRow {
  conference: string;
  source_kind: string;
  score_bucket: string;
  reviewed_on_theme: number;
  reviewed_off_theme: number;
  auto_published: number;
  auto_unpublished: number;
  shadow_publish_candidates: number;
  shadow_publish_approved: number;
  /** Decided (rejected, theme reasons), shadow_route='publish' rows — the
   *  other half of the shadow-precision denominator (review finding,
   *  CRITICAL item 1). Together with `shadow_publish_approved`, this is
   *  "decided" shadow-publish items; `shadow_publish_candidates` (still
   *  'queued', i.e. UNDECIDED) must never be used as a precision
   *  denominator — see `gate.ts#summarizeShadowSample`. */
  shadow_publish_rejected_theme: number;
}

/** All `ingest_precision` rows (one per source_kind x score_bucket) for a
 *  conference — the raw input the Precision dashboard and the auto-publish
 *  enable gate both roll up (`gate.ts`'s `summarize*` functions). */
export async function getPrecisionRows(conference: string): Promise<IngestPrecisionRow[]> {
  const supabase = getIngestSupabase();
  const { data, error } = await supabase.from('ingest_precision').select('*').eq('conference', conference);
  if (error) throw new Error(`Failed to load precision rows: ${error.message}`);
  return (data as IngestPrecisionRow[]) ?? [];
}

/** The subset of an `ingest_candidates` row the kill switch's rolling
 *  sample needs — just enough to apply `gate.ts`'s "what counts as a
 *  failure" rule (a manual unpublish always counts; a curator deleting the
 *  sheet row AFTER the event already happened does not — review finding,
 *  HIGH item 2). */
export type AutoPublishOutcomeRow = Pick<IngestCandidateRow, 'status' | 'auto_published_at' | 'updated_at'> & {
  event: Pick<NormalizedEvent, 'dateISO'>;
};

/**
 * The most recent `opts.limit` REAL auto-publish outcomes for a
 * conference — rows the PIPELINE itself auto-published
 * (`auto_published_at is not null`; a manual admin approval shares
 * `published_at` but never sets `auto_published_at`, so it's excluded —
 * review finding, HIGH item 2), still live (`auto_published`) or taken
 * back down (`unpublished`/`unpublished_external`). `opts.sinceIso`
 * (typically the profile's `auto_publish_enabled_at`) excludes outcomes
 * from before the most recent enable, so a re-enable is never immediately
 * killed by a prior bad window's history. Ordered by `auto_published_at`
 * so "recent" means recently auto-published, not recently decided. Feeds
 * the kill switch (`gate.ts#checkAutoPublishKillSwitch`).
 */
export async function getRecentAutoPublishOutcomes(
  conference: string,
  opts: { limit?: number; sinceIso?: string | null } = {}
): Promise<AutoPublishOutcomeRow[]> {
  const supabase = getIngestSupabase();
  let query = supabase
    .from('ingest_candidates')
    .select('status, event, auto_published_at, updated_at')
    .eq('conference', conference)
    .not('auto_published_at', 'is', null)
    .in('status', ['auto_published', 'unpublished', 'unpublished_external']);
  if (opts.sinceIso) query = query.gte('auto_published_at', opts.sinceIso);
  query = query.order('auto_published_at', { ascending: false }).limit(opts.limit ?? 50);
  const { data, error } = await query;
  if (error) throw new Error(`Failed to load recent auto-publish outcomes: ${error.message}`);
  return (data as AutoPublishOutcomeRow[]) ?? [];
}

export interface CandidateVolumeBySource {
  source_id: string;
  label: string;
  kind: SourceKind;
  total: number;
  published: number;
  queued: number;
  rejected: number;
}

/** Per-source candidate volume for the Precision dashboard's "volume per
 *  source" table. Supabase's JS client has no `group by`, and at our
 *  volumes (plan §12: tens-hundreds per conference) a raw select + in-
 *  memory aggregation is simpler and cheaper than a dedicated view. */
export async function getCandidateVolumeBySource(conference: string): Promise<CandidateVolumeBySource[]> {
  const supabase = getIngestSupabase();
  const [{ data: candidates, error: candErr }, sources] = await Promise.all([
    supabase.from('ingest_candidates').select('source_id, status').eq('conference', conference).limit(5000),
    listSources(conference),
  ]);
  if (candErr) throw new Error(`Failed to load candidate volume: ${candErr.message}`);

  const bySource = new Map<string, { total: number; published: number; queued: number; rejected: number }>();
  for (const row of (candidates ?? []) as { source_id: string | null; status: CandidateStatus }[]) {
    if (!row.source_id) continue;
    const agg = bySource.get(row.source_id) ?? { total: 0, published: 0, queued: 0, rejected: 0 };
    agg.total++;
    if (row.status === 'auto_published' || row.status === 'approved') agg.published++;
    else if (row.status === 'queued') agg.queued++;
    else if (row.status === 'auto_rejected' || row.status === 'rejected') agg.rejected++;
    bySource.set(row.source_id, agg);
  }

  return sources.map((s) => ({
    source_id: s.id,
    label: s.label || s.kind,
    kind: s.kind,
    ...(bySource.get(s.id) ?? { total: 0, published: 0, queued: 0, rejected: 0 }),
  }));
}

/** Recent false positives (an auto-published/approved event an admin later
 *  took back down — `source='admin_unpublish'`) and false negatives (an
 *  event the model would have rejected, `model_route='reject'`, that an
 *  admin approved anyway) for the Precision dashboard's audit lists (§11). */
export async function listRecentLabelMismatches(
  conference: string,
  limit = 10
): Promise<{ falsePositives: IngestLabelRow[]; falseNegatives: IngestLabelRow[] }> {
  const supabase = getIngestSupabase();
  const [{ data: fp, error: fpError }, { data: fn, error: fnError }] = await Promise.all([
    supabase
      .from('ingest_labels')
      .select('*')
      .eq('conference', conference)
      .eq('source', 'admin_unpublish')
      .order('created_at', { ascending: false })
      .limit(limit),
    supabase
      .from('ingest_labels')
      .select('*')
      .eq('conference', conference)
      .eq('label', 'on_theme')
      .eq('model_route', 'reject')
      .order('created_at', { ascending: false })
      .limit(limit),
  ]);
  if (fpError) throw new Error(`Failed to load false positives: ${fpError.message}`);
  if (fnError) throw new Error(`Failed to load false negatives: ${fnError.message}`);
  return { falsePositives: (fp as IngestLabelRow[]) ?? [], falseNegatives: (fn as IngestLabelRow[]) ?? [] };
}
