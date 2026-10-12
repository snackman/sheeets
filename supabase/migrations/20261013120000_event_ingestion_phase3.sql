-- ============================================================
-- Event ingestion Phase 3 (Telegram source, discovered Luma/platform links,
-- host submission page). See plans/event-ingestion.md §Phase 3.
--
-- NOT APPLIED TO PROD BY THIS PR, same convention as 20261011120000 and
-- 20261012120000. Apply by hand against the production Supabase project
-- before Phase 3 code paths are exercised there.
--
-- Additive only: one new table. No changes to existing tables —
-- `ingest_sources.kind` already allows 'telegram_channel' and
-- 'host_submission' (added in the original 20261011120000 migration, ahead
-- of this phase actually using them), and `ingest_candidates.source_kind`
-- is a plain `text` column with no enum/check constraint, so nothing there
-- needs altering either. The app code (`src/lib/ingest/db.ts`,
-- `pipeline.ts`) already tolerates this migration not having been applied
-- yet to the exact same degree Phase 1b/2 did: every new code path that
-- touches `ingest_submission_attempts` is reached only from the new
-- `POST /api/host/submissions` route and the Telegram source kind, neither
-- of which exists before this PR, so nothing in production starts calling
-- them until this migration has been applied AND an admin has configured a
-- Telegram source / the submission page is linked somewhere.
--
-- ingest_submission_attempts : per-IP rate limiting for the public host
--                               submission endpoint. IPs are hashed
--                               (SHA-256) before being stored — never the
--                               raw address.
-- ============================================================

create table if not exists public.ingest_submission_attempts (
  id uuid primary key default gen_random_uuid(),
  ip_hash text not null,
  conference text,
  created_at timestamptz not null default now()
);

create index if not exists ingest_submission_attempts_ip_recent
  on public.ingest_submission_attempts (ip_hash, created_at desc);

-- Supports a future retention job (e.g. "delete rows older than 7 days") —
-- not added here since no cron currently prunes any ingest table; `data_
-- retention.sql`'s existing function is a natural place to extend later.
create index if not exists ingest_submission_attempts_created_at
  on public.ingest_submission_attempts (created_at);

alter table public.ingest_submission_attempts enable row level security;
revoke all on table public.ingest_submission_attempts from anon, authenticated;
