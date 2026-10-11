-- ============================================================
-- Event ingestion (Phase 1b). See plans/event-ingestion.md.
--
-- NOT APPLIED TO PROD BY THIS PR. Migrations after 20260929120000 are
-- applied by hand (see repo convention) — run this file against the
-- production Supabase project yourself before the ingestion code paths
-- are exercised there (the admin Ingest tab and /api/cron/ingest will
-- error without it; nothing else in the app is affected).
--
-- ingest_profiles    : per-conference theme profile + routing config.
-- ingest_sources      : configured feeds (Luma iCal in 1b; other kinds
--                       are reserved for later phases).
-- ingest_candidates   : the ledger — one row per unique candidate event
--                       per conference, with score, route and decision.
-- ingest_runs         : one row per pipeline run (cron/manual/webhook/script).
-- ingest_labels       : admin decisions, fed back as few-shot examples (Phase 2).
-- ingest_link_cache   : Luma slug -> api id cache for sheet-link dedupe.
-- ingest_precision    : view over ingest_candidates + ingest_labels for the
--                       Phase 2 precision dashboard; harmless to create now.
--
-- All five tables are service-role only: RLS enabled, no policies for
-- anon/authenticated, explicit revokes. Every write goes through an admin
-- or cron API route using the service role, same pattern as event_claims
-- (supabase/migrations/20261002120000_event_claims.sql).
-- ============================================================

create table if not exists public.ingest_profiles (
  conference text primary key,
  theme_key text not null default 'crypto'
    check (theme_key in ('crypto','ai','gaming','art','music','tech','custom')),
  theme_description text not null default '',
  include_keywords text[] not null default '{}',
  exclude_keywords text[] not null default '{}',
  trusted_hosts jsonb not null default '[]',
  blocked_hosts jsonb not null default '[]',
  publish_threshold int not null default 85 check (publish_threshold between 0 and 100),
  review_threshold  int not null default 40 check (review_threshold between 0 and 100),
  auto_publish_enabled boolean not null default false,
  radius_km numeric not null default 40,
  window_pre_days int not null default 3,
  window_post_days int not null default 1,
  allow_online boolean not null default false,
  max_llm_calls_per_run int not null default 150,
  max_publish_per_run int not null default 25,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  check (review_threshold <= publish_threshold)
);

create table if not exists public.ingest_sources (
  id uuid primary key default gen_random_uuid(),
  conference text not null,
  kind text not null check (kind in (
    'luma_ical','telegram_channel','telegram_bot','x_account','meetup_search',
    'sponsor_pages','host_submission','manual_links')),
  label text not null default '',
  config jsonb not null default '{}',
  trust text not null default 'curated' check (trust in ('curated','host','discovery')),
  enabled boolean not null default true,
  added_by text,
  cursor jsonb not null default '{}',
  last_run_at timestamptz,
  last_status text,
  last_error text,
  created_at timestamptz not null default now()
);
create unique index if not exists ingest_sources_unique on public.ingest_sources (
  conference, kind, (config->>'calendar_api_id'), (config->>'handle')
);
create index if not exists ingest_sources_conference on public.ingest_sources (conference, enabled);

create table if not exists public.ingest_candidates (
  id uuid primary key default gen_random_uuid(),
  conference text not null,
  canonical_key text not null,
  alt_keys text[] not null default '{}',
  source_id uuid references public.ingest_sources(id) on delete set null,
  source_kind text not null,
  sources jsonb not null default '[]',
  source_ref text,
  event jsonb not null,
  content_hash text not null,
  status text not null default 'new' check (status in (
    'new','pending_classify','filtered_out','duplicate','queued','auto_published','approved',
    'auto_rejected','rejected','unpublished','unpublished_external','error','stale')),
  filter_reason text,
  duplicate_of text,
  possible_duplicate_of text,
  llm_score int,
  llm_reason text,
  llm_tags text[],
  llm_flags text[],
  is_event boolean,
  data_quality text check (data_quality in ('sufficient','thin')),
  signal_breakdown jsonb not null default '{}',
  final_score int,
  route text check (route in ('publish','review','reject')),
  shadow_route text,
  model text,
  prompt_version text,
  classified_at timestamptz,
  classify_attempts int not null default 0,
  published_event_id text,
  sheet_row int,
  published_at timestamptz,
  review_note text,
  reject_reason text,
  edits jsonb,
  reviewed_at timestamptz,
  reviewed_by text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists ingest_candidates_key on public.ingest_candidates (conference, canonical_key);
create index if not exists ingest_candidates_alt_keys on public.ingest_candidates using gin (alt_keys);
create index if not exists ingest_candidates_queue on public.ingest_candidates (conference, status, final_score desc);
create index if not exists ingest_candidates_published on public.ingest_candidates (published_event_id) where published_event_id is not null;
create index if not exists ingest_candidates_source on public.ingest_candidates (source_id);

create table if not exists public.ingest_runs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references public.ingest_sources(id) on delete set null,
  conference text not null,
  trigger text not null check (trigger in ('cron','manual','webhook','script')),
  status text not null default 'running' check (status in ('running','ok','partial','error','skipped')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  counts jsonb not null default '{}',
  llm_input_tokens int not null default 0,
  llm_output_tokens int not null default 0,
  est_cost_usd numeric(10,4) not null default 0,
  error text
);
create index if not exists ingest_runs_recent on public.ingest_runs (conference, started_at desc);
create index if not exists ingest_runs_running on public.ingest_runs (source_id) where status = 'running';
create index if not exists ingest_runs_cost_month on public.ingest_runs (started_at);

create table if not exists public.ingest_labels (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid references public.ingest_candidates(id) on delete cascade,
  conference text not null,
  theme_key text not null,
  label text not null check (label in ('on_theme','off_theme')),
  label_kind text not null default 'theme' check (label_kind in ('theme','non_theme')),
  source text not null check (source in ('admin_review','admin_unpublish','sheet_removed','eval_seed')),
  reason text,
  example jsonb not null default '{}',
  model_score int,
  model_route text,
  created_at timestamptz not null default now()
);
create unique index if not exists ingest_labels_one_per_candidate on public.ingest_labels (candidate_id, source) where candidate_id is not null;
create index if not exists ingest_labels_theme on public.ingest_labels (theme_key, label, created_at desc);

-- Luma slug -> api id cache (dedupe against sheet links that are still slug-form).
create table if not exists public.ingest_link_cache (
  link_key text primary key,
  luma_api_id text,
  resolved_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- updated_at maintenance (reuses the event_claims trigger function's pattern)
-- ------------------------------------------------------------
create or replace function public.ingest_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists ingest_candidates_touch_updated_at on public.ingest_candidates;
create trigger ingest_candidates_touch_updated_at
  before update on public.ingest_candidates
  for each row execute function public.ingest_touch_updated_at();

drop trigger if exists ingest_profiles_touch_updated_at on public.ingest_profiles;
create trigger ingest_profiles_touch_updated_at
  before update on public.ingest_profiles
  for each row execute function public.ingest_touch_updated_at();

-- ------------------------------------------------------------
-- RLS: service-role only, everywhere.
-- ------------------------------------------------------------
alter table public.ingest_profiles enable row level security;
alter table public.ingest_sources enable row level security;
alter table public.ingest_candidates enable row level security;
alter table public.ingest_runs enable row level security;
alter table public.ingest_labels enable row level security;
alter table public.ingest_link_cache enable row level security;

revoke all on table public.ingest_profiles from anon, authenticated;
revoke all on table public.ingest_sources from anon, authenticated;
revoke all on table public.ingest_candidates from anon, authenticated;
revoke all on table public.ingest_runs from anon, authenticated;
revoke all on table public.ingest_labels from anon, authenticated;
revoke all on table public.ingest_link_cache from anon, authenticated;

-- ------------------------------------------------------------
-- Precision dashboard view (Phase 2 UI reads this; harmless to ship now).
-- Buckets final_score into the plan's five bands and aggregates admin
-- decisions recorded in ingest_labels / ingest_candidates.status.
-- ------------------------------------------------------------
create or replace view public.ingest_precision as
select
  c.conference,
  c.source_kind,
  case
    when c.final_score is null then 'unscored'
    when c.final_score >= 90 then '90-100'
    when c.final_score >= 80 then '80-89'
    when c.final_score >= 60 then '60-79'
    when c.final_score >= 40 then '40-59'
    else '0-39'
  end as score_bucket,
  count(*) filter (where c.status = 'approved') as reviewed_on_theme,
  count(*) filter (where c.status = 'rejected' and c.reject_reason in ('off_theme', 'spam')) as reviewed_off_theme,
  count(*) filter (where c.status = 'auto_published') as auto_published,
  count(*) filter (where c.status in ('unpublished', 'unpublished_external')) as auto_unpublished,
  count(*) filter (where c.status = 'queued' and c.shadow_route = 'publish') as shadow_publish_candidates,
  count(*) filter (where c.status = 'approved' and c.shadow_route = 'publish') as shadow_publish_approved
from public.ingest_candidates c
group by 1, 2, 3;

revoke all on public.ingest_precision from anon, authenticated;
