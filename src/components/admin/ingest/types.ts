// Client-side mirrors of the server ingest types (kept separate from
// `src/lib/ingest/types.ts` so these components don't pull in server-only
// modules through a shared import).
export interface IngestNormalizedEventClient {
  name: string;
  startAt: string;
  endAt?: string | null;
  dateISO: string;
  sheetDate: string;
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
  link: string;
  descriptionText: string;
  platform: string;
}

export interface IngestCandidateClient {
  id: string;
  conference: string;
  canonical_key: string;
  source_kind: string;
  event: IngestNormalizedEventClient;
  status: string;
  filter_reason: string | null;
  duplicate_of: string | null;
  possible_duplicate_of: string | null;
  llm_score: number | null;
  llm_reason: string | null;
  llm_tags: string[] | null;
  llm_flags: string[] | null;
  data_quality: string | null;
  signal_breakdown: Record<string, number>;
  final_score: number | null;
  route: string | null;
  shadow_route: string | null;
  published_event_id: string | null;
  first_seen_at: string;
}

export interface IngestProfileClient {
  conference: string;
  theme_key: string;
  theme_description: string;
  include_keywords: string[];
  exclude_keywords: string[];
  trusted_hosts: { kind: string; id?: string; name: string }[];
  blocked_hosts: { kind: string; id?: string; name: string }[];
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
  auto_publish_killed_at: string | null;
  auto_publish_kill_reason: string | null;
}

/** Phase 2 auto-publish gate result (`src/lib/ingest/gate.ts#GateResult`),
 *  as returned by `GET /api/admin/ingest/config?conference=...`. */
export interface IngestGateClient {
  eligible: boolean;
  sample: { sampleSize: number; positive: number; precision: number | null };
  minSampleSize: number;
  threshold: number;
  reason: string;
}

export interface IngestSourceClient {
  id: string;
  conference: string;
  kind: string;
  label: string;
  config: Record<string, unknown>;
  trust: string;
  enabled: boolean;
  last_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
}

export interface IngestRunClient {
  id: string;
  conference: string;
  trigger: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  counts: Record<string, number>;
  llm_input_tokens: number;
  llm_output_tokens: number;
  est_cost_usd: number;
  error: string | null;
}

/** `GET /api/admin/ingest/precision?conference=...` response (Phase 2). */
export interface IngestPrecisionSampleClient {
  sampleSize: number;
  positive: number;
  precision: number | null;
}

export interface IngestVolumeBySourceClient {
  source_id: string;
  label: string;
  kind: string;
  total: number;
  published: number;
  queued: number;
  rejected: number;
}

export interface IngestLabelMismatchClient {
  id: string;
  conference: string;
  label: string;
  reason: string | null;
  example: { name?: string; hosts?: string[] };
  model_score: number | null;
  model_route: string | null;
  created_at: string;
}

export interface IngestPrecisionResponseClient {
  conference: string;
  gate: IngestGateClient;
  shadow: IngestPrecisionSampleClient;
  live: IngestPrecisionSampleClient;
  review: IngestPrecisionSampleClient;
  volumeBySource: IngestVolumeBySourceClient[];
  budget: { spentUsd: number; capUsd: number };
  falsePositives: IngestLabelMismatchClient[];
  falseNegatives: IngestLabelMismatchClient[];
  profile: IngestProfileClient | null;
}

export const REJECT_REASON_OPTIONS: { value: string; label: string }[] = [
  { value: 'off_theme', label: 'Off-theme' },
  { value: 'wrong_city', label: 'Wrong city' },
  { value: 'wrong_dates', label: 'Wrong dates' },
  { value: 'duplicate', label: 'Duplicate' },
  { value: 'private_or_invite_only', label: 'Private/invite-only' },
  { value: 'spam', label: 'Spam' },
  { value: 'other', label: 'Other' },
];
