-- ============================================================
-- Mira series + Sheet tracker source kinds, and calendar auto-discovery
-- proposals. See the task brief for this PR (three new ingestion
-- capabilities): `mira_series`, `sheet_tracker`, and
-- `ingest_source_proposals` (daily calendar auto-discovery job).
--
-- NOT APPLIED TO PROD BY THIS PR, same convention as every prior
-- event-ingestion migration (20261011120000 .. 20261016120000). Apply by
-- hand against the production Supabase project before this PR's code is
-- exercised there.
--
-- Additive only:
--   - Widens `ingest_sources.kind`'s check constraint to also allow
--     'mira_series' and 'sheet_tracker'. Every existing value stays valid.
--   - Widens `ingest_sources_unique` to add each new kind's own
--     discriminator column (`series_slug` for Mira, `sheet_id`+`gid` for a
--     sheet tracker) so two sources of the SAME new kind with the same
--     config still collide (same idempotency every other kind already
--     has), while every EXISTING kind's discriminator columns, and
--     therefore which existing rows collide, are completely unchanged.
--     Note: the SAME `series_slug` is expected to be added as a source for
--     TWO DIFFERENT conferences (Breakpoint 2026 and DAS London 2026, which
--     currently share one Mira series) — `conference` is itself part of
--     this index, so that is NOT a collision.
--   - New table `ingest_source_proposals` (calendar auto-discovery, plan
--     item 3) — 'proposed'/'accepted'/'dismissed', same service-role-only
--     RLS posture (RLS enabled, no policies, anon/authenticated revoked)
--     as every other ingestion table.
--
-- Degrading gracefully (plan constraint: "must not break the live cron if
-- it's deployed before the migration"): every `ingest_source_proposals`
-- read/write in `db.ts` (`getSourceProposal`, `upsertSourceProposal`,
-- `listSourceProposals`, `getSourceProposalById`) tolerates the table not
-- existing yet (the same missing-relation error codes as every other
-- Phase 3/4 tolerant read), and NOTHING on the already-live cron's
-- `luma_ical`/`telegram_channel`/`x_account`/`meetup_search`/
-- `sponsor_pages` code paths touches this table at all — only the NEW
-- `mira_series`/`sheet_tracker` processors and the NEW, separate
-- `/api/cron/ingest-discover-sources` cron entry do.
-- ============================================================

alter table public.ingest_sources drop constraint if exists ingest_sources_kind_check;
alter table public.ingest_sources add constraint ingest_sources_kind_check check (kind in (
  'luma_ical','telegram_channel','telegram_bot','x_account','meetup_search',
  'sponsor_pages','host_submission','manual_links','mira_series','sheet_tracker'));

drop index if exists ingest_sources_unique;
create unique index if not exists ingest_sources_unique on public.ingest_sources (
  conference, kind,
  coalesce(config->>'calendar_api_id', ''),
  coalesce(config->>'handle', ''),
  coalesce(config->>'query', ''),
  coalesce(md5(config->>'urls'), ''),
  coalesce(config->>'series_slug', ''),
  coalesce(config->>'sheet_id', ''),
  coalesce(config->>'gid', '')
);

create table if not exists public.ingest_source_proposals (
  id uuid primary key default gen_random_uuid(),
  conference text not null,
  calendar_api_id text not null,
  calendar_name text,
  status text not null default 'proposed' check (status in ('proposed','accepted','dismissed')),
  evidence jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by text
);
-- One row per (conference, calendar) ever — `db.ts#upsertSourceProposal`
-- only ever inserts when no row exists yet, or updates an existing
-- 'proposed' row's evidence; a 'dismissed'/'accepted' row is never
-- recreated or re-touched (the "never re-propose a dismissed calendar"
-- guarantee lives in that function, not here, but this index is what makes
-- "one row per calendar" true in the first place).
create unique index if not exists ingest_source_proposals_unique on public.ingest_source_proposals (conference, calendar_api_id);
create index if not exists ingest_source_proposals_conference on public.ingest_source_proposals (conference, status);

alter table public.ingest_source_proposals enable row level security;
revoke all on public.ingest_source_proposals from anon, authenticated;
