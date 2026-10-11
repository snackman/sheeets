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

export const REJECT_REASON_OPTIONS: { value: string; label: string }[] = [
  { value: 'off_theme', label: 'Off-theme' },
  { value: 'wrong_city', label: 'Wrong city' },
  { value: 'wrong_dates', label: 'Wrong dates' },
  { value: 'duplicate', label: 'Duplicate' },
  { value: 'private_or_invite_only', label: 'Private/invite-only' },
  { value: 'spam', label: 'Spam' },
  { value: 'other', label: 'Other' },
];
