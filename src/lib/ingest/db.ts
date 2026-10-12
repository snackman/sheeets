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
