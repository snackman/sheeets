// Shared types for the event-ingestion theme classifier (Phase 1a).
// DB-backed types (ingest_candidates, ingest_sources, ...) arrive in Phase 1b;
// this file only covers what the classifier and eval harness need today.
import { z } from 'zod';
import { TAG_GROUPS, TYPE_TAGS } from '../tags';

/** Groups conferences for few-shot sharing and default theme presets (§6, §9.1). */
export type ThemeKey = 'crypto' | 'ai' | 'gaming' | 'art' | 'music' | 'tech' | 'custom';

/**
 * Per-conference theme profile. In Phase 1a this lives in code (DEFAULT_THEME_PROFILES
 * in `profiles.ts`); Phase 1b moves it into the `ingest_profiles` table (§6) with the
 * same shape plus routing/runtime fields (thresholds, radius, caps, enabled flags).
 */
export interface ThemeProfile {
  themeKey: ThemeKey;
  /** Short display name, e.g. "Crypto / Web3". Shown in the admin config UI (§9.1). */
  themeName: string;
  /** Free-text rubric description injected into the classifier system prompt. */
  themeDescription: string;
  includeKeywords: string[];
  excludeKeywords: string[];
  /** score >= publish - 15 required to ever auto-publish (§5.4). */
  publishThreshold: number;
  reviewThreshold: number;
}

/** Tags the classifier is allowed to suggest — the fixed list from `tags.ts` (§5.5). */
export const ALLOWED_TAGS = Array.from(
  new Set<string>([...TAG_GROUPS.flatMap((g) => g.tags), ...TYPE_TAGS])
) as [string, ...string[]];

export const CLASSIFIER_FLAGS = [
  'private_or_invite_only',
  'sold_out',
  'online_only',
  'spam_or_promo',
  'instructions_in_content',
] as const;

export type ClassifierFlag = (typeof CLASSIFIER_FLAGS)[number];

/**
 * 'sufficient': enough detail (description, venue, or other confirming
 * signal) to be confident this is a real, correctly specified event.
 * 'thin': only sparse fields are known (e.g. just a name/host/date) and
 * real-event-ness can't be confirmed from the data alone, but nothing
 * suggests it's spam or a non-event either. Thin data must never drive
 * `theme_score` down — it's a separate axis, handled by `routeCandidate`
 * (signals.ts), which sends thin-but-plausible events to review instead of
 * auto-publishing or auto-rejecting them (tuning round, 2026-10-11).
 */
export const DATA_QUALITY = ['sufficient', 'thin'] as const;
export type DataQuality = (typeof DATA_QUALITY)[number];

/** Structured-output schema the classifier model fills in (§5.5). */
export const ClassifierOutputSchema = z.object({
  is_event: z.boolean(),
  /** Topical fit ONLY (0-100) — never lowered just because detail is sparse. */
  theme_score: z.number().int().min(0).max(100),
  data_quality: z.enum(DATA_QUALITY),
  reason: z.string().max(160),
  suggested_tags: z.array(z.enum(ALLOWED_TAGS)).max(4),
  flags: z.array(z.enum(CLASSIFIER_FLAGS)).max(5),
});

export type ClassifierOutput = z.infer<typeof ClassifierOutputSchema>;

/** The subset of a normalized event the classifier (and the eval harness) need. */
export interface ClassifierEventInput {
  name: string;
  hosts?: string[];
  calendarName?: string | null;
  organizer?: string | null;
  venue?: string | null;
  city?: string | null;
  dateISO?: string | null;
  startTime?: string | null;
  cost?: string | null;
  platform?: string | null;
  /** Plain-text description excerpt. Untrusted — never treated as instructions. */
  descriptionText?: string | null;
}

export interface ClassifierConferenceContext {
  name: string;
  city?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}

/** One few-shot example for the system prompt (learning loop lands in Phase 2, §5.6). */
export interface FewShotExample {
  summary: string; // "name | hosts | 1-line summary"
  label: 'on_theme' | 'off_theme';
  reason: string;
}

/* ------------------------------------------------------------------ */
/* Phase 1b: DB-backed types (ingest_profiles/_sources/_candidates/_runs/_labels) */
/* ------------------------------------------------------------------ */

/** A host or calendar entry in a profile's trusted/blocked lists (§6 jsonb shape). */
export interface TrustedHostEntry {
  kind: 'luma_host' | 'luma_calendar' | 'organizer';
  id?: string;
  name: string;
}

/** `ingest_profiles` row — the DB-backed superset of `ThemeProfile` (§9.1). */
export interface IngestProfileRow {
  conference: string;
  theme_key: ThemeKey;
  theme_description: string;
  include_keywords: string[];
  exclude_keywords: string[];
  trusted_hosts: TrustedHostEntry[];
  blocked_hosts: TrustedHostEntry[];
  publish_threshold: number;
  review_threshold: number;
  auto_publish_enabled: boolean;
  radius_km: number;
  window_pre_days: number;
  window_post_days: number;
  allow_online: boolean;
  max_llm_calls_per_run: number;
  max_publish_per_run: number;
  enabled: boolean;
  /** Set by the Phase 2 kill switch (`gate.ts#checkAutoPublishKillSwitch`)
   *  when it automatically flips `auto_publish_enabled` back to false
   *  because rolling precision dropped below the gate threshold. Cleared
   *  (set back to null) the next time an admin successfully re-enables
   *  auto-publish through the config API. */
  auto_publish_killed_at: string | null;
  auto_publish_kill_reason: string | null;
  /** Set whenever an admin successfully turns `auto_publish_enabled` on
   *  (cleared back to null is NOT done — it's simply overwritten on every
   *  fresh enable). The kill switch's rolling sample only considers
   *  outcomes at or after this timestamp, so a re-enable is never killed
   *  immediately by a bad run from a PRIOR enable window (review finding,
   *  HIGH item 2). */
  auto_publish_enabled_at: string | null;
  updated_at: string;
}

export type SourceKind =
  | 'luma_ical'
  | 'telegram_channel'
  | 'telegram_bot'
  | 'x_account'
  | 'meetup_search'
  | 'sponsor_pages'
  | 'host_submission'
  | 'manual_links';

export type SourceTrust = 'curated' | 'host' | 'discovery';

export interface LumaIcalSourceConfig {
  calendar_api_id: string;
  calendar_slug?: string;
  calendar_name?: string;
}

/** `ingest_sources` row. */
export interface IngestSourceRow {
  id: string;
  conference: string;
  kind: SourceKind;
  label: string;
  config: Record<string, unknown>;
  trust: SourceTrust;
  enabled: boolean;
  added_by: string | null;
  cursor: Record<string, unknown>;
  last_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
  created_at: string;
}

export type CandidateStatus =
  | 'new'
  | 'pending_classify'
  | 'filtered_out'
  | 'duplicate'
  | 'queued'
  | 'auto_published'
  | 'approved'
  | 'auto_rejected'
  | 'rejected'
  | 'unpublished'
  | 'unpublished_external'
  | 'error'
  | 'stale';

export type CandidateRoute = 'publish' | 'review' | 'reject';

/**
 * Statuses that represent a final, admin- or publish-owned decision. A
 * re-ingest of the same feed (or a stray pipeline write) must never change
 * the `status` of a candidate in one of these — only its `event` snapshot
 * may be refreshed (review finding, CRITICAL item 2). Enforced in
 * `db.ts`'s `upsertCandidate` and short-circuited early in the pipeline.
 */
export const FINAL_CANDIDATE_STATUSES: readonly CandidateStatus[] = [
  'approved',
  'auto_published',
  'rejected',
  'unpublished',
  'unpublished_external',
];

/** Statuses a candidate must be in for approve/rescore/unpublish to act on
 *  it. Anything not in here is either already decided (final) or mid-flight
 *  in a way that shouldn't be approved/rescored (review findings, HIGH
 *  items 3 and 4). */
export const APPROVABLE_CANDIDATE_STATUSES: readonly CandidateStatus[] = [
  'queued',
  'auto_rejected',
  'error',
  'pending_classify',
];

/** Statuses excluded from the pre-enrichment "unchanged, skip" shortcut even
 *  when the iCal-stub hash matches — they need to be retried, not treated
 *  as settled (review finding, MEDIUM item 6). */
export const RETRY_ON_UNCHANGED_STATUSES: readonly CandidateStatus[] = ['error', 'pending_classify'];

/** One source that surfaced a candidate (§6 `sources` jsonb array). */
export interface CandidateSourceRef {
  source_id: string | null;
  kind: SourceKind;
  ref: string | null;
  seen_at: string;
}

/** The normalized event payload stored in `ingest_candidates.event` (§5.1). */
export interface NormalizedEvent {
  name: string;
  /** ISO UTC instant. */
  startAt: string;
  endAt?: string | null;
  timezone: string;
  /** "YYYY-MM-DD" in the conference timezone. */
  dateISO: string;
  /** "Oct 14" — same style as the client's formatDateShort, no weekday/year. */
  sheetDate: string;
  /** "6:00 PM" — same style as format12Hour. */
  startTime: string;
  endTime: string;
  address: string;
  lat?: number | null;
  lng?: number | null;
  isOnline: boolean;
  organizer: string;
  hosts: { apiId?: string; name: string; username?: string | null; twitter?: string | null }[];
  calendar?: { apiId: string; name: string } | null;
  cost: string;
  /** Canonical public URL. */
  link: string;
  descriptionText: string;
  imageUrl?: string | null;
  platform: string;
}

/** `ingest_candidates` row. */
export interface IngestCandidateRow {
  id: string;
  conference: string;
  canonical_key: string;
  alt_keys: string[];
  source_id: string | null;
  source_kind: SourceKind;
  sources: CandidateSourceRef[];
  source_ref: string | null;
  event: NormalizedEvent;
  content_hash: string;
  /** Hash of the iCal-only fields, checked BEFORE enrichment (CRITICAL item 1). */
  ical_hash: string | null;
  status: CandidateStatus;
  filter_reason: string | null;
  duplicate_of: string | null;
  possible_duplicate_of: string | null;
  llm_score: number | null;
  llm_reason: string | null;
  llm_tags: string[] | null;
  llm_flags: string[] | null;
  is_event: boolean | null;
  data_quality: DataQuality | null;
  signal_breakdown: Record<string, number>;
  final_score: number | null;
  route: CandidateRoute | null;
  shadow_route: CandidateRoute | null;
  model: string | null;
  prompt_version: string | null;
  classified_at: string | null;
  classify_attempts: number;
  published_event_id: string | null;
  sheet_row: number | null;
  published_at: string | null;
  /** Set ONLY when the PIPELINE auto-published this row (never on a manual
   *  admin approval, which shares `published_at` but not this). The kill
   *  switch's rolling sample filters on this being non-null — mixing in a
   *  manual approval would measure the wrong thing (review finding, HIGH
   *  item 2). */
  auto_published_at: string | null;
  review_note: string | null;
  reject_reason: string | null;
  edits: Record<string, unknown> | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  first_seen_at: string;
  last_seen_at: string;
  updated_at: string;
}

export type RunTrigger = 'cron' | 'manual' | 'webhook' | 'script';
export type RunStatus = 'running' | 'ok' | 'partial' | 'error' | 'skipped';

export interface RunCounts {
  fetched?: number;
  past?: number;
  new?: number;
  unchanged?: number;
  /** Already final (approved/auto_published/rejected/unpublished…) —
   *  snapshot refreshed, but dedupe/filter/classify/publish all skipped. */
  skipped_final?: number;
  enriched?: number;
  duplicates?: number;
  filtered?: number;
  classified?: number;
  published?: number;
  queued?: number;
  rejected?: number;
  errors?: number;
  /** Marker (1) so the Log tab/`ingest_runs` can tell a dry run apart from
   *  a real run without a dedicated column. */
  dry_run?: number;
}

/** `ingest_runs` row. */
export interface IngestRunRow {
  id: string;
  source_id: string | null;
  conference: string;
  trigger: RunTrigger;
  status: RunStatus;
  started_at: string;
  finished_at: string | null;
  counts: RunCounts;
  llm_input_tokens: number;
  llm_output_tokens: number;
  est_cost_usd: number;
  error: string | null;
}

export type LabelSource = 'admin_review' | 'admin_unpublish' | 'sheet_removed' | 'eval_seed';

/** `ingest_labels` row. */
export interface IngestLabelRow {
  id: string;
  candidate_id: string | null;
  conference: string;
  theme_key: ThemeKey;
  label: 'on_theme' | 'off_theme';
  label_kind: 'theme' | 'non_theme';
  source: LabelSource;
  reason: string | null;
  example: Record<string, unknown>;
  model_score: number | null;
  model_route: CandidateRoute | string | null;
  /** True for weak/noisy signals (e.g. a curator deleting a published row —
   *  could mean off-theme, duplicate, or just "not needed anymore") that
   *  are kept for audit but must not feed the Phase 2 few-shot selector
   *  (review finding, MEDIUM item 8). */
  excluded_from_fewshot: boolean;
  created_at: string;
}

/** Reject reasons shown as chips in the review queue (§9.2). Only
 *  'off_theme' and 'spam' create theme labels; the rest are non_theme. */
export const REJECT_REASONS = [
  'off_theme',
  'wrong_city',
  'wrong_dates',
  'duplicate',
  'private_or_invite_only',
  'spam',
  'other',
] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];
export const THEME_REJECT_REASONS: readonly RejectReason[] = ['off_theme', 'spam'];
