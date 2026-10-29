// Typed Supabase access for the ingestion ledger (§7 `db.ts`). All five
// tables are service-role only (no RLS policies for anon/authenticated), so
// every function here must run server-side with SUPABASE_SERVICE_ROLE_KEY.
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getDefaultProfile } from './profiles';
import { FINAL_CANDIDATE_STATUSES, THEME_REJECT_REASONS } from './types';
import type {
  CandidateRoute,
  CandidateStatus,
  IngestCandidateRow,
  IngestLabelRow,
  IngestProfileRow,
  IngestRunRow,
  IngestSourceProposalRow,
  IngestSourceRow,
  LabelSource,
  NormalizedEvent,
  RunCounts,
  RunStatus,
  RunTrigger,
  SourceKind,
  SourceProposalEvidence,
  SourceProposalStatus,
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
 *
 * Uses `.maybeSingle()`, not `.single()` — if the row vanished between a
 * caller's earlier read and this write (e.g. the kill switch racing an
 * admin deleting/recreating the profile), zero rows matching is a real,
 * if rare, possibility and must not throw (review finding, LOW item
 * "gate.ts:241: handle a missing profile row without throwing" —
 * `checkAutoPublishKillSwitch` calls this and ignores the return value,
 * so this is the one place that needed to change). Returns null in that
 * case instead of an error.
 */
export async function updateProfilePatch(conference: string, patch: Partial<IngestProfileRow>): Promise<IngestProfileRow | null> {
  const supabase = getIngestSupabase();
  const { data, error } = await supabase
    .from('ingest_profiles')
    .update(patch)
    .eq('conference', conference)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`Failed to update ingest profile: ${error.message}`);
  return (data as IngestProfileRow) ?? null;
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

/** Enabled sources due to run, oldest `last_run_at` first (nulls first = never run).
 *  `kind` accepts one kind or several (Phase 3: the cron polls BOTH
 *  `luma_ical` and `telegram_channel`; `host_submission` sources are
 *  passive — fed by `POST /api/host/submissions`, never polled — so they're
 *  simply never passed here). */
export async function listDueSources(kind?: SourceKind | SourceKind[]): Promise<IngestSourceRow[]> {
  const supabase = getIngestSupabase();
  let query = supabase
    .from('ingest_sources')
    .select('*')
    .eq('enabled', true)
    .order('last_run_at', { ascending: true, nullsFirst: true });
  if (Array.isArray(kind)) query = query.in('kind', kind);
  else if (kind) query = query.eq('kind', kind);
  const { data, error } = await query;
  if (error) throw new Error(`Failed to list due ingest sources: ${error.message}`);
  return (data as IngestSourceRow[]) ?? [];
}

/**
 * Get (or lazily create) the single passive `host_submission` source for a
 * conference (Phase 3, §7: "Phase 3: ... /api/host/sources"). Unlike every
 * other source kind, this one isn't added through the admin Config UI — it
 * exists purely so host-submitted candidates have a real `ingest_sources`
 * row to point `source_id` at (so it shows up, and can be disabled, in the
 * admin Config/Queue UI like any other source). Always `trust: 'discovery'`
 * — host submissions are never auto-published (§10 item 4), and this is
 * never changed by anything else, unlike a Luma/Telegram source's trust,
 * which an admin can set.
 */
export async function getOrCreateHostSubmissionSource(conference: string): Promise<IngestSourceRow> {
  const supabase = getIngestSupabase();
  const { data: existing, error: findError } = await supabase
    .from('ingest_sources')
    .select('*')
    .eq('conference', conference)
    .eq('kind', 'host_submission')
    .maybeSingle();
  if (findError) throw new Error(`Failed to load host-submission source: ${findError.message}`);
  if (existing) return existing as IngestSourceRow;

  // Plain insert, not an upsert — `ingest_sources_unique` is a functional
  // index (keyed on `coalesce(config->>'calendar_api_id', '')`/`handle`,
  // not a plain column), and PostgREST's `onConflict` upsert param only
  // matches a target by its literal column list, not an arbitrary
  // expression. A concurrent double-create (two requests racing to be the
  // first submission for a brand-new conference) is handled the same way
  // the host-claims route handles its own unique-index race: insert, and on
  // a unique-violation re-select the row that won (review finding pattern
  // from #177's `event_claims` POST handler).
  const { data: created, error: insertError } = await supabase
    .from('ingest_sources')
    .insert({
      conference,
      kind: 'host_submission' as SourceKind,
      label: 'Host submissions',
      config: {},
      trust: 'discovery' as const,
      added_by: 'system',
    })
    .select('*')
    .single();
  if (insertError) {
    if ((insertError as { code?: string }).code === '23505') {
      const { data: winner, error: refetchError } = await supabase
        .from('ingest_sources')
        .select('*')
        .eq('conference', conference)
        .eq('kind', 'host_submission')
        .maybeSingle();
      if (!refetchError && winner) return winner as IngestSourceRow;
    }
    throw new Error(`Failed to create host-submission source: ${insertError.message}`);
  }
  return created as IngestSourceRow;
}

/* ------------------------------------------------------------------ */
/* Phase 3: public host-submission anti-abuse rate limiting (§10)      */
/* ------------------------------------------------------------------ */

/**
 * Record one submission attempt and return its row id — the row is
 * inserted BEFORE any count-based rate-limit check (review finding, HIGH
 * item 2: inserting first and then counting, rather than counting then
 * inserting, closes most of the TOCTOU race two concurrent requests from
 * the same IP would otherwise have — the second request's count query
 * will see the first request's just-inserted row, because it's already
 * committed by the time it runs). This also means a flood of deliberately-
 * invalid requests still counts against the limit, not just valid ones.
 * `ipHash` is a SHA-256 of the client IP (IPv6 bucketed to its /64 prefix
 * first — see `route.ts#bucketIp`); the raw IP is never stored.
 */
export async function recordSubmissionAttempt(ipHash: string, conference: string | null): Promise<string> {
  const supabase = getIngestSupabase();
  const { data, error } = await supabase
    .from('ingest_submission_attempts')
    .insert({ ip_hash: ipHash, conference })
    .select('id')
    .single();
  if (error) throw new Error(`Failed to record submission attempt: ${error.message}`);
  return (data as { id: string }).id;
}

/** Record this submission's LLM cost/token usage against its own attempt
 *  row (review finding, MEDIUM item 7 — aggregated here instead of a
 *  per-submission `ingest_runs` row) so `monthlyLlmCostUsd` below counts
 *  it toward the budget cap. Called even on a `ClassifierError` that still
 *  billed tokens (a schema-validation failure still gets a completion). */
export async function recordSubmissionAttemptCost(
  attemptId: string,
  usage: { costUsd: number; inputTokens: number; outputTokens: number }
): Promise<void> {
  const supabase = getIngestSupabase();
  const { error } = await supabase
    .from('ingest_submission_attempts')
    .update({ cost_usd: usage.costUsd, input_tokens: usage.inputTokens, output_tokens: usage.outputTokens })
    .eq('id', attemptId);
  if (error) throw new Error(`Failed to record submission attempt cost: ${error.message}`);
}

/** Count of attempts from `ipHash` in the last `windowMs` — the per-IP
 *  rate-limit check. Includes the just-inserted current attempt (see
 *  `recordSubmissionAttempt`'s doc comment), so callers compare with `>`,
 *  not `>=`. Deliberately NOT filtered on `rejected` — unlike the global/
 *  per-conference counts below, a per-IP-rejected attempt SHOULD keep
 *  counting against that same IP's future windows (that's the point: it
 *  stays rate-limited), it's only other IPs/conferences that must not be
 *  penalized by it (re-review finding A). */
export async function countRecentSubmissionAttempts(ipHash: string, windowMs: number): Promise<number> {
  const supabase = getIngestSupabase();
  const since = new Date(Date.now() - windowMs).toISOString();
  const { count, error } = await supabase
    .from('ingest_submission_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('ip_hash', ipHash)
    .gte('created_at', since);
  if (error) throw new Error(`Failed to count submission attempts: ${error.message}`);
  return count ?? 0;
}

/**
 * Global (every IP) attempt count in the last `windowMs` — the overall
 * ceiling (review finding, HIGH item 2) that stops a botnet spreading one
 * attempt per IP from ever adding up to an unbounded flood of LLM calls.
 *
 * Filters `rejected = false` (re-review finding A): a request already
 * rejected by its OWN per-IP limit (the only way a row can be `rejected`
 * today — a captcha failure is checked BEFORE any row is inserted at all)
 * must not ALSO count against this shared, cross-IP ceiling — otherwise
 * one IP that blows through its own per-IP limit keeps consuming global
 * budget and starts 429-ing every OTHER IP too, which is a DoS a single
 * bad actor could trigger instead of only hurting themselves.
 */
export async function countGlobalRecentSubmissionAttempts(windowMs: number): Promise<number> {
  const supabase = getIngestSupabase();
  const since = new Date(Date.now() - windowMs).toISOString();
  const { count, error } = await supabase
    .from('ingest_submission_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('rejected', false)
    // Rows written by other public endpoints that reuse this ledger
    // (conference prefixed `sec:`, see src/lib/ledger-rate-limit.ts) must not
    // count against the host-submission global ceiling.
    .or('conference.is.null,conference.not.like.sec:%')
    .gte('created_at', since);
  if (error) throw new Error(`Failed to count global submission attempts: ${error.message}`);
  return count ?? 0;
}

/** Per-conference attempt count in the last `windowMs` — stops one
 *  conference's submission form being hammered from many different IPs
 *  (review finding, HIGH item 2). Filters `rejected = false`, same
 *  rationale as `countGlobalRecentSubmissionAttempts` above (re-review
 *  finding A) — a flood against ONE conference that's already being
 *  turned away by the per-IP limit must not also use up this
 *  conference's shared daily budget for every other submitter. */
export async function countConferenceRecentSubmissionAttempts(conference: string, windowMs: number): Promise<number> {
  const supabase = getIngestSupabase();
  const since = new Date(Date.now() - windowMs).toISOString();
  const { count, error } = await supabase
    .from('ingest_submission_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('conference', conference)
    .eq('rejected', false)
    .gte('created_at', since);
  if (error) throw new Error(`Failed to count conference submission attempts: ${error.message}`);
  return count ?? 0;
}

/** Mark an attempt as `rejected` — called when ITS OWN per-IP (or, after
 *  that, global/per-conference) check fails, so the global/per-conference
 *  counts above exclude it from here on (re-review finding A). */
export async function markSubmissionAttemptRejected(attemptId: string): Promise<void> {
  const supabase = getIngestSupabase();
  const { error } = await supabase.from('ingest_submission_attempts').update({ rejected: true }).eq('id', attemptId);
  if (error) throw new Error(`Failed to mark submission attempt rejected: ${error.message}`);
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

/**
 * Create a curated `luma_ical` source for a calendar, or — if one already
 * exists for this exact (conference, calendar_api_id) pair (collided on
 * `ingest_sources_unique`, e.g. an admin manually added it between a
 * proposal's creation and its Accept, or a previous Accept attempt
 * partially succeeded) — return the EXISTING row instead of throwing.
 * Same "insert, tolerate 23505, re-select" idiom as
 * `getOrCreateHostSubmissionSource`. Used by the "Accept a calendar
 * proposal" flow (review finding, LOW item 5), so accepting an
 * already-configured calendar is a no-op success, not a 500.
 */
export async function createLumaIcalSourceIdempotent(row: {
  conference: string;
  label: string;
  calendar_api_id: string;
  calendar_name: string | null;
  trust: 'curated' | 'host' | 'discovery';
  added_by?: string;
}): Promise<IngestSourceRow> {
  const supabase = getIngestSupabase();
  const { data, error } = await supabase
    .from('ingest_sources')
    .insert({
      conference: row.conference,
      kind: 'luma_ical',
      label: row.label,
      config: { calendar_api_id: row.calendar_api_id, calendar_name: row.calendar_name },
      trust: row.trust,
      added_by: row.added_by ?? 'admin',
    })
    .select('*')
    .single();
  if (!error) return data as IngestSourceRow;

  if ((error as { code?: string }).code === '23505') {
    const existingSources = await listSources(row.conference);
    const existing = existingSources.find(
      (s) => s.kind === 'luma_ical' && (s.config as { calendar_api_id?: string }).calendar_api_id === row.calendar_api_id
    );
    if (existing) return existing;
  }
  throw new Error(`Failed to create ingest source: ${error.message}`);
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

/**
 * Same as `getCandidateByKey`, but also matches a candidate whose
 * `alt_keys` (gin-indexed) contains `canonicalKey` — not just its
 * `canonical_key` column. Needed because a Luma event can be discovered
 * under more than one link shape (a curated calendar's `luma:evt-…` vs. a
 * short `lu.ma/<slug>` link resolved to the SAME api id elsewhere): once a
 * short-link key is resolved to its evt- canonical key (`discover.ts`), the
 * row that key was stored under may only have the slug recorded in
 * `alt_keys`, not `canonical_key` itself. Checking only `canonical_key`
 * (as every lookup used to) meant a short link for an already-rejected/
 * approved event could never find that candidate and would be ingested as
 * a brand-new one instead (Bug: "short Luma links bypass dedupe").
 *
 * Two separate queries rather than one `.or(...)` filter, to avoid having
 * to escape `canonicalKey` (which can contain `.`, `/`, `:`) into a
 * PostgREST filter-string.
 */
export async function getCandidateByKeyOrAltKey(conference: string, canonicalKey: string): Promise<IngestCandidateRow | null> {
  const direct = await getCandidateByKey(conference, canonicalKey);
  if (direct) return direct;

  const supabase = getIngestSupabase();
  const { data, error } = await supabase
    .from('ingest_candidates')
    .select('*')
    .eq('conference', conference)
    .contains('alt_keys', [canonicalKey])
    .limit(1);
  if (error) throw new Error(`Failed to load candidate by alt key: ${error.message}`);
  const rows = (data as IngestCandidateRow[] | null) ?? [];
  return rows[0] ?? null;
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
    .or(`status.in.${FINAL_STATUS_LIST},and(status.eq.duplicate,published_at.not.is.null)`)
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
    .or('status.neq.duplicate,published_at.is.null') // not a swept duplicate (dedupe-sweep.ts)
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

/** Columns the admin queue UI (`IngestCandidateClient`) and the operator
 *  scripts (`fetch-queues.sh`: id, event.*, final_score, llm_flags,
 *  possible_duplicate_of) read. Omits the heavy/internal ones (sources,
 *  alt_keys, hashes, edits, review fields, ...). */
export const QUEUE_LIST_COLUMNS = [
  'id', 'conference', 'canonical_key', 'source_kind', 'event', 'status', 'filter_reason',
  'duplicate_of', 'possible_duplicate_of', 'llm_score', 'llm_reason', 'llm_tags', 'llm_flags',
  'data_quality', 'signal_breakdown', 'final_score', 'route', 'shadow_route',
  'published_event_id', 'first_seen_at',
].join(',');

export async function listCandidates(opts: {
  conference?: string;
  status?: CandidateStatus | CandidateStatus[];
  sourceId?: string;
  minScore?: number;
  limit?: number;
  offset?: number;
  /** PostgREST column list; defaults to every column. */
  columns?: string;
}): Promise<IngestCandidateRow[]> {
  const supabase = getIngestSupabase();
  let query = supabase.from('ingest_candidates').select(opts.columns ?? '*');
  if (opts.conference) query = query.eq('conference', opts.conference);
  if (opts.status) {
    query = Array.isArray(opts.status) ? query.in('status', opts.status) : query.eq('status', opts.status);
  }
  if (opts.sourceId) query = query.eq('source_id', opts.sourceId);
  if (opts.minScore !== undefined) query = query.gte('final_score', opts.minScore);
  // `id` as a tiebreaker keeps offset pagination stable across pages.
  query = query.order('final_score', { ascending: false }).order('id', { ascending: true });
  const limit = opts.limit ?? 200;
  const offset = opts.offset ?? 0;
  query = offset > 0 ? query.range(offset, offset + limit - 1) : query.limit(limit);
  const { data, error } = await query;
  if (error) throw new Error(`Failed to list candidates: ${error.message}`);
  return (data as unknown as IngestCandidateRow[]) ?? [];
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

/** Candidates in OTHER conferences sharing any of `keys` as their
 *  canonical_key or in their alt_keys — the cross-conference duplicate
 *  lookup (cross-conference.ts). The unique index is per-conference
 *  (conference, canonical_key), so the same Luma event can legitimately
 *  exist once per conference; this is what finds the twins. */
export async function listOtherConferenceCandidatesByKeys(
  conference: string,
  keys: string[]
): Promise<Pick<IngestCandidateRow, 'id' | 'conference' | 'canonical_key' | 'alt_keys' | 'status' | 'published_at' | 'event' | 'first_seen_at' | 'review_note' | 'llm_score' | 'edits'>[]> {
  const uniq = Array.from(new Set(keys.filter(Boolean)));
  if (uniq.length === 0) return [];
  const supabase = getIngestSupabase();
  const cols = 'id,conference,canonical_key,alt_keys,status,published_at,event,first_seen_at,review_note,llm_score,edits';
  const [byKey, byAlt] = await Promise.all([
    supabase.from('ingest_candidates').select(cols).neq('conference', conference).in('canonical_key', uniq).limit(50),
    supabase.from('ingest_candidates').select(cols).neq('conference', conference).overlaps('alt_keys', uniq).limit(50),
  ]);
  if (byKey.error) throw new Error(`Failed to look up cross-conference candidates: ${byKey.error.message}`);
  if (byAlt.error) throw new Error(`Failed to look up cross-conference candidates: ${byAlt.error.message}`);
  const out = new Map<string, Pick<IngestCandidateRow, 'id' | 'conference' | 'canonical_key' | 'alt_keys' | 'status' | 'published_at' | 'event' | 'first_seen_at' | 'review_note' | 'llm_score' | 'edits'>>();
  for (const row of [...(byKey.data ?? []), ...(byAlt.data ?? [])] as IngestCandidateRow[]) out.set(row.id, row);
  return Array.from(out.values());
}

/**
 * Postgres/PostgREST error codes meaning "the thing I queried doesn't
 * exist (yet)" — a missing table/view (42P01), a missing column (42703),
 * or PostgREST's own "not in the schema cache" code for either (PGRST205),
 * plus the two ways PostgREST reports a MISSING RPC FUNCTION (PGRST202 is
 * its own code for that; some gateway/pooler configurations instead let
 * the underlying `42883 undefined_function` through). All five mean the
 * same thing here: this migration (or this specific statement within it)
 * hasn't been applied yet (re-review finding C). Defined ahead of
 * `finishRun` (Phase 4 needs it there too, for `x_cost_usd` — see that
 * function's doc comment) rather than only near `monthlyLlmCostUsd` below.
 */
const MISSING_RELATION_ERROR_CODES = new Set(['42P01', '42703', 'PGRST205', 'PGRST202', '42883']);

export function isMissingRelationError(error: { code?: string } | null | undefined): boolean {
  return !!error?.code && MISSING_RELATION_ERROR_CODES.has(error.code);
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

/**
 * Sum `ingest_runs.est_cost_usd` + `ingest_submission_attempts.cost_usd`
 * for the current calendar month (UTC) — the monthly LLM budget cap
 * (`budget.ts#checkMonthlyBudget`), checked by EVERY candidate source
 * including the Phase 1b/2 Luma-iCal pipeline that's already live in
 * production today.
 *
 * Re-review finding B: sums in SQL via `get_monthly_ingest_cost_usd` (one
 * row back, correct no matter how many underlying rows exist), not by
 * pulling rows client-side and reducing — the old version silently
 * truncated at PostgREST's default 1000-row page once either table passed
 * that many rows in a month.
 *
 * Re-review finding C: if that RPC isn't available yet (this exact
 * migration hasn't been applied — a real possibility right after this PR
 * deploys, since the Luma-iCal pipeline's budget check must not depend on
 * a Phase 3 migration it has nothing else to do with), falls back to the
 * previous per-table queries. Within that fallback, a missing-relation
 * error from the `ingest_runs` half is a REAL problem and still throws
 * (that table has existed since Phase 1b); the SAME error from the
 * `ingest_submission_attempts` half is treated as $0 instead, since that
 * table is brand new in this PR and its absence must never break the
 * already-live cron's budget check.
 */
export async function monthlyLlmCostUsd(): Promise<number> {
  const supabase = getIngestSupabase();
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

  const { data: rpcTotal, error: rpcError } = await supabase.rpc('get_monthly_ingest_cost_usd', { p_month_start: monthStart });
  if (!rpcError) return Number(rpcTotal ?? 0);
  if (!isMissingRelationError(rpcError)) throw new Error(`Failed to sum monthly ingest cost: ${rpcError.message}`);

  const [{ data: runs, error: runsError }, { data: submissions, error: submissionsError }] = await Promise.all([
    supabase.from('ingest_runs').select('est_cost_usd').gte('started_at', monthStart),
    supabase.from('ingest_submission_attempts').select('cost_usd').gte('created_at', monthStart),
  ]);
  if (runsError) throw new Error(`Failed to sum monthly ingest cost: ${runsError.message}`);
  const runsCost = (runs ?? []).reduce((sum, r) => sum + Number((r as { est_cost_usd: number }).est_cost_usd || 0), 0);

  if (submissionsError) {
    if (!isMissingRelationError(submissionsError)) throw new Error(`Failed to sum monthly submission cost: ${submissionsError.message}`);
    return runsCost; // ingest_submission_attempts doesn't exist yet — treat as $0, never break the cron.
  }
  const submissionsCost = (submissions ?? []).reduce((sum, r) => sum + Number((r as { cost_usd: number }).cost_usd || 0), 0);
  return runsCost + submissionsCost;
}

/**
 * Sum `ingest_runs.x_cost_usd` for the current calendar month (UTC) — the
 * Phase 4 X-spend budget cap (`budget.ts#checkMonthlyXBudget`), kept
 * strictly separate from `monthlyLlmCostUsd` above (different cap, not
 * the LLM one). Same RPC-first / client-fallback / degrade-on-missing-
 * relation shape as `monthlyLlmCostUsd` (re-review finding B/C there),
 * so a preview/prod deploy of this PR ahead of its migration still works:
 * both the RPC and the `x_cost_usd` column itself are new in
 * 20261014120000, and their absence (42P01/42703/PGRST205/PGRST202/42883)
 * is treated as "$0 spent so far", never a thrown error — nothing about
 * the ALREADY-LIVE Luma-iCal/Telegram cron run calls this function, so
 * there is no live path this could regress even if it always returned 0.
 */
export async function monthlyXCostUsd(): Promise<number> {
  const supabase = getIngestSupabase();
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

  const { data: rpcTotal, error: rpcError } = await supabase.rpc('get_monthly_ingest_x_cost_usd', { p_month_start: monthStart });
  if (!rpcError) return Number(rpcTotal ?? 0);
  if (!isMissingRelationError(rpcError)) throw new Error(`Failed to sum monthly X cost: ${rpcError.message}`);

  const { data: runs, error: runsError } = await supabase.from('ingest_runs').select('x_cost_usd').gte('started_at', monthStart);
  if (runsError) {
    if (isMissingRelationError(runsError)) return 0; // x_cost_usd column doesn't exist yet.
    throw new Error(`Failed to sum monthly X cost: ${runsError.message}`);
  }
  return (runs ?? []).reduce((sum, r) => sum + Number((r as { x_cost_usd?: number }).x_cost_usd || 0), 0);
}

/**
 * Best-effort record of an `x_account` run's X API spend onto its own
 * `ingest_runs` row, as a SEPARATE update (not folded into `finishRun`'s
 * own patch) — `finishRun`'s signature/behavior must stay exactly as it is
 * for every other source kind (Luma iCal, Telegram, sponsor pages, Meetup
 * — none of which set `x_posts_read`/`x_cost_usd`), so a run whose caller
 * never calls this function is byte-for-byte what it was before this PR.
 * Re-review item 2: called by `pipeline.ts#processXSource` itself, in a
 * `finally` right after the paid read(s), which may run BEFORE (not
 * necessarily after) `finishRun` — the row already exists (created by
 * `createRun` before any of this), so the ORDER relative to `finishRun`
 * doesn't matter, only that this fires even if everything after the read
 * throws. Swallows a missing-column/table error (the 20261014120000
 * migration not applied yet) instead of throwing — same "degrade
 * gracefully" posture as `monthlyXCostUsd` above. Also used by
 * `recordAdhocXCost` below for the one-time handle-resolution lookup.
 */
export async function recordRunXCost(runId: string, usage: { xPostsRead: number; xCostUsd: number }): Promise<void> {
  if (usage.xPostsRead <= 0 && usage.xCostUsd <= 0) return;
  const supabase = getIngestSupabase();
  const { error } = await supabase
    .from('ingest_runs')
    .update({ x_posts_read: usage.xPostsRead, x_cost_usd: usage.xCostUsd })
    .eq('id', runId);
  if (error) {
    if (isMissingRelationError(error)) return;
    throw new Error(`Failed to record X run cost: ${error.message}`);
  }
}

/**
 * Re-review item 9: the admin config route's one-time `resolveXUser` call
 * (a "User: Read", $0.01) spends real X API budget too, outside any
 * `x_account` source run — this records it as its own tiny `ingest_runs`
 * row (trigger `'manual'`, no `source_id`) so it counts toward
 * `monthlyXCostUsd`/`checkMonthlyXBudget` exactly like a real run's reads
 * do, via the same `recordRunXCost` path above.
 */
export async function recordAdhocXCost(conference: string, costUsd: number): Promise<void> {
  if (costUsd <= 0) return;
  const run = await createRun({ source_id: null, conference, trigger: 'manual' });
  await finishRun(run.id, { status: 'ok', counts: {} });
  await recordRunXCost(run.id, { xPostsRead: 0, xCostUsd: costUsd });
}

/** Per-`source_kind` run volume + cost (LLM $ and X $ separately) for the
 *  Precision tab's "volume and cost per source type" breakdown (§9.1 item
 *  4 / §11) — the `ingest_run_cost_by_source_kind` view (Phase 4 migration).
 *  Returns [] if the view doesn't exist yet, same tolerance as every other
 *  Phase 4 read. */
export interface RunCostBySourceKind {
  source_kind: string;
  run_count: number;
  llm_cost_usd: number;
  x_cost_usd: number;
  llm_input_tokens: number;
  llm_output_tokens: number;
}

export async function getRunCostBySourceKind(conference: string): Promise<RunCostBySourceKind[]> {
  const supabase = getIngestSupabase();
  const { data, error } = await supabase
    .from('ingest_run_cost_by_source_kind')
    .select('*')
    .eq('conference', conference);
  if (error) {
    if (isMissingRelationError(error)) return [];
    throw new Error(`Failed to load run cost by source kind: ${error.message}`);
  }
  return (data as RunCostBySourceKind[]) ?? [];
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

/** A cache row's api id AND when it was resolved — `getCachedLumaApiId`
 *  collapses away `resolved_at`, which is fine for the "already resolved,
 *  found an id" case but not for a cached MISS: a stale negative is
 *  indistinguishable from a trustworthy one once the timestamp is gone.
 *  Used by `dedupe.ts#buildSheetLinkIndex` to decide whether a cached miss
 *  is still worth trusting (2026-10-16 incident: a buggy script wrote 63
 *  false "no api id" rows, which hid real duplicates from the sheet-link
 *  index for as long as those rows existed). */
export interface LumaApiIdCacheEntry {
  apiId: string | null;
  resolvedAt: string;
}

export async function getCachedLumaApiIdEntry(linkKey: string): Promise<LumaApiIdCacheEntry | undefined> {
  const supabase = getIngestSupabase();
  const { data, error } = await supabase
    .from('ingest_link_cache')
    .select('luma_api_id, resolved_at')
    .eq('link_key', linkKey)
    .maybeSingle();
  if (error) throw new Error(`Failed to read link cache: ${error.message}`);
  if (!data) return undefined;
  return { apiId: (data.luma_api_id as string | null) ?? null, resolvedAt: data.resolved_at as string };
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
 *  extended by 20261012120000 with `shadow_publish_rejected_theme`, which
 *  since 20261029140000 counts EVERY non-duplicate rejection of a
 *  shadow_route='publish' item, not just off_theme/spam). */
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
 * back down (`unpublished`/`unpublished_external`), or swept as a duplicate
 * of a hand-added row (`duplicate` + `auto_published_at`, counted as a
 * SUCCESS by the kill switch, since the publish was correct — see
 * dedupe-sweep.ts). `opts.sinceIso`
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
    .in('status', ['auto_published', 'unpublished', 'unpublished_external', 'duplicate']);
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

/* ------------------------------------------------------------------ */
/* Calendar auto-discovery (daily job, plan item 3)                    */
/* ------------------------------------------------------------------ */

/** Luma candidates for a conference (any status, any source kind) — the
 *  pool `discover-calendars.ts` walks to find each event's true hosting
 *  calendar. Capped generously; the caller (the daily job) applies its own
 *  rate-limited-call and deadline caps on top of this.
 *
 *  Review finding, MEDIUM item 2: excludes a candidate an admin already
 *  rejected as `off_theme` or `spam` (`THEME_REJECT_REASONS`) — that's a
 *  bad signal that its calendar is "worth proposing" as a new source, so
 *  it's dropped from the pool entirely rather than letting its calendar
 *  get resolved/evaluated at all. Filtered client-side (not in the
 *  query) since this list is already capped to `limit` rows. */
export async function listLumaCandidatesForConference(conference: string, limit = 500): Promise<IngestCandidateRow[]> {
  const supabase = getIngestSupabase();
  const { data, error } = await supabase
    .from('ingest_candidates')
    .select('*')
    .eq('conference', conference)
    .like('canonical_key', 'luma:%')
    .order('last_seen_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Failed to list Luma candidates: ${error.message}`);
  return ((data as IngestCandidateRow[]) ?? []).filter(
    (c) => !(c.status === 'rejected' && c.reject_reason && (THEME_REJECT_REASONS as readonly string[]).includes(c.reject_reason))
  );
}

/** Rows per page for the paginated candidate-key queries below (review
 *  finding, LOW item 4 — PostgREST's own default row cap is 1000, so a
 *  conference with more candidates than that silently lost everything
 *  past the first page). */
const CANDIDATE_KEYS_PAGE_SIZE = 1000;
/** Hard ceiling on total pages fetched, so a pathological conference can't
 *  turn this into an unbounded loop. 50 * 1000 rows is far more than any
 *  real conference's candidate pool. */
const CANDIDATE_KEYS_MAX_PAGES = 50;

/**
 * Shared pagination core: every `canonical_key` + `alt_keys` pair for a
 * conference, regardless of status, optionally filtered to a
 * `canonical_key` prefix (e.g. `'luma:%'`). Pages past PostgREST's
 * 1000-row default limit (review finding, LOW item 4) via `.range()`,
 * with an explicit `.order('id')` (Minor review finding) — `.range()`
 * pagination over an UNORDERED select has no guarantee that two pages
 * don't overlap or skip rows, since Postgres is free to return rows in
 * any order absent an explicit sort; `id` is used (not `canonical_key`,
 * which only `listKnownLumaCandidateKeys` even filters on) so every
 * caller of this shared core gets the same stable order regardless of
 * which prefix it passes.
 */
async function listCandidateKeysPaginated(conference: string, canonicalKeyPrefix?: string): Promise<Set<string>> {
  const supabase = getIngestSupabase();
  const keys = new Set<string>();
  for (let page = 0; page < CANDIDATE_KEYS_MAX_PAGES; page++) {
    const from = page * CANDIDATE_KEYS_PAGE_SIZE;
    const to = from + CANDIDATE_KEYS_PAGE_SIZE - 1;
    let query = supabase
      .from('ingest_candidates')
      .select('canonical_key, alt_keys')
      .eq('conference', conference)
      .order('id', { ascending: true })
      .range(from, to);
    if (canonicalKeyPrefix) query = query.like('canonical_key', canonicalKeyPrefix);
    const { data, error } = await query;
    if (error) throw new Error(`Failed to list candidate keys: ${error.message}`);
    const rows = (data ?? []) as { canonical_key: string; alt_keys: string[] | null }[];
    for (const row of rows) {
      keys.add(row.canonical_key);
      for (const alt of row.alt_keys ?? []) keys.add(alt);
    }
    if (rows.length < CANDIDATE_KEYS_PAGE_SIZE) break; // last page.
  }
  return keys;
}

/** Every `luma:…` canonical/alt key already known for a conference,
 *  regardless of status — used to tell "genuinely new" calendar events
 *  apart from ones we've already discovered (possibly already rejected)
 *  through some other source. Deliberately unfiltered by status (unlike
 *  `listRecentCandidatesForDedupe`): an already-`rejected` candidate is
 *  still "already discovered", not new. */
export async function listKnownLumaCandidateKeys(conference: string): Promise<Set<string>> {
  return listCandidateKeysPaginated(conference, 'luma:%');
}

/**
 * Every canonical/alt key already known for a conference, across EVERY
 * platform and EVERY status (including final/rejected/unpublished/stale
 * ones) — review finding, HIGH item A ("links can be starved"):
 * `runDiscoveredLinksBatch`'s unseen-first ordering previously derived its
 * "known" set from the in-run dedupe pool (`listRecentCandidatesForDedupe`),
 * which (a) drops `alt_keys` entirely, mapping only `canonical_key`, and
 * (b) excludes rejected/unpublished/stale candidates outright. In
 * production, a short Luma link (`luma:short-slug`) almost always
 * resolves to a candidate keyed by its stable `luma:evt-…` id, with the
 * short slug recorded ONLY in `alt_keys` — so that pool could never
 * recognize a short link as "already known," meaning nearly every short
 * link counted as "unseen" on every run, and the ordering/cap logic that
 * depends on telling unseen apart from seen was effectively a no-op.
 */
export async function listAllCandidateKeysForConference(conference: string): Promise<Set<string>> {
  return listCandidateKeysPaginated(conference);
}

/** A conference's already-configured `luma_ical` calendar ids — a
 *  candidate calendar that's already one of these is never proposed again
 *  (it's already a real source). Tolerant of the odd malformed config row
 *  (missing `calendar_api_id`) rather than throwing. */
export async function listConfiguredLumaCalendarIds(conference: string): Promise<Set<string>> {
  const sources = await listSources(conference);
  const ids = new Set<string>();
  for (const s of sources) {
    if (s.kind !== 'luma_ical') continue;
    const apiId = (s.config as { calendar_api_id?: string }).calendar_api_id;
    if (apiId) ids.add(apiId);
  }
  return ids;
}

/** Load one proposal row, or `null` if none exists yet (or the
 *  `ingest_source_proposals` table/migration isn't applied yet). */
export async function getSourceProposal(conference: string, calendarApiId: string): Promise<IngestSourceProposalRow | null> {
  const supabase = getIngestSupabase();
  const { data, error } = await supabase
    .from('ingest_source_proposals')
    .select('*')
    .eq('conference', conference)
    .eq('calendar_api_id', calendarApiId)
    .maybeSingle();
  if (error) {
    if (isMissingRelationError(error)) return null;
    throw new Error(`Failed to load source proposal: ${error.message}`);
  }
  return (data as IngestSourceProposalRow) ?? null;
}

/**
 * Insert a fresh 'proposed' row, or refresh an EXISTING 'proposed' row's
 * evidence — and otherwise (the row is already 'accepted' or 'dismissed')
 * leave it completely untouched. This is the ONE write path a daily
 * discovery run uses, and it's exactly what makes "never re-propose a
 * dismissed calendar" true: a dismissed row's `status` simply never
 * changes back, no matter how many later runs find the same calendar
 * eligible again. Swallows a missing-table error (migration not applied
 * yet) rather than failing the whole discovery run.
 */
export async function upsertSourceProposal(row: {
  conference: string;
  calendar_api_id: string;
  calendar_name: string | null;
  evidence: SourceProposalEvidence;
}): Promise<void> {
  const supabase = getIngestSupabase();
  const existing = await getSourceProposal(row.conference, row.calendar_api_id);
  if (existing) {
    if (existing.status !== 'proposed') return; // already decided — never touch it again.
    const { error } = await supabase
      .from('ingest_source_proposals')
      .update({ calendar_name: row.calendar_name, evidence: row.evidence, updated_at: new Date().toISOString() })
      .eq('id', existing.id);
    if (error) {
      if (isMissingRelationError(error)) return;
      throw new Error(`Failed to update source proposal: ${error.message}`);
    }
    return;
  }

  const { error } = await supabase.from('ingest_source_proposals').insert({
    conference: row.conference,
    calendar_api_id: row.calendar_api_id,
    calendar_name: row.calendar_name,
    status: 'proposed',
    evidence: row.evidence,
  });
  if (error) {
    // A concurrent insert winning the unique-index race is fine — the row
    // exists either way, same "insert, tolerate 23505" pattern as
    // `getOrCreateHostSubmissionSource`.
    if (isMissingRelationError(error) || (error as { code?: string }).code === '23505') return;
    throw new Error(`Failed to create source proposal: ${error.message}`);
  }
}

export async function listSourceProposals(conference: string, status?: SourceProposalStatus): Promise<IngestSourceProposalRow[]> {
  const supabase = getIngestSupabase();
  let query = supabase.from('ingest_source_proposals').select('*').eq('conference', conference);
  if (status) query = query.eq('status', status);
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) {
    if (isMissingRelationError(error)) return [];
    throw new Error(`Failed to list source proposals: ${error.message}`);
  }
  return (data as IngestSourceProposalRow[]) ?? [];
}

export async function getSourceProposalById(id: string): Promise<IngestSourceProposalRow | null> {
  const supabase = getIngestSupabase();
  const { data, error } = await supabase.from('ingest_source_proposals').select('*').eq('id', id).maybeSingle();
  if (error) {
    if (isMissingRelationError(error)) return null;
    throw new Error(`Failed to load source proposal: ${error.message}`);
  }
  return (data as IngestSourceProposalRow) ?? null;
}

/** Admin decision on a proposal — 'accepted' (the config route also
 *  creates the real `luma_ical` source) or 'dismissed' (never re-proposed
 *  — see `upsertSourceProposal`'s doc comment). */
export async function decideSourceProposal(id: string, status: 'accepted' | 'dismissed', decidedBy: string): Promise<void> {
  const supabase = getIngestSupabase();
  const { error } = await supabase
    .from('ingest_source_proposals')
    .update({ status, decided_at: new Date().toISOString(), decided_by: decidedBy })
    .eq('id', id);
  if (error) throw new Error(`Failed to update source proposal: ${error.message}`);
}
