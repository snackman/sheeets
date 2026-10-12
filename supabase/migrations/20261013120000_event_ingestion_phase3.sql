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
-- needs altering either.
--
-- Corrected per PR #181 review (LOW item 6): `POST /api/host/submissions`
-- is REACHABLE the moment this PR deploys — anyone who finds the URL can
-- call it directly, whether or not `/submit-source` is linked anywhere, and
-- regardless of whether this migration has been applied yet. What's
-- actually true is narrower: every DB call this route makes against
-- `ingest_submission_attempts` throws if the table doesn't exist yet (a
-- plain Postgres "relation does not exist" error surfaces as a normal
-- Supabase query error, which the route doesn't swallow), and an uncaught
-- throw in a Next.js route handler becomes a 500 response — so a request
-- against an un-migrated deploy fails closed (an error, nothing written,
-- nothing published) rather than silently doing the wrong thing. The
-- Telegram source kind is similarly reachable (an admin could, in
-- principle, try to add one) but equally fails closed the same way. Apply
-- this migration before actually exercising either path.
--
-- ingest_submission_attempts : per-IP (and global, and per-conference)
--                               rate limiting for the public host
--                               submission endpoint. IPs are hashed
--                               (SHA-256) before being stored — never the
--                               raw address; an IPv6 address is bucketed to
--                               its /64 prefix before hashing. Also carries
--                               each submission's LLM cost/token usage
--                               (review finding, MEDIUM item 7: a per-
--                               submission `ingest_runs` row would pollute
--                               the admin Log tab's run history with one
--                               row per public request, so submission cost
--                               is aggregated here instead and folded into
--                               `monthlyLlmCostUsd()` — see db.ts).
-- ============================================================

create table if not exists public.ingest_submission_attempts (
  id uuid primary key default gen_random_uuid(),
  ip_hash text not null,
  conference text,
  created_at timestamptz not null default now()
);

create index if not exists ingest_submission_attempts_ip_recent
  on public.ingest_submission_attempts (ip_hash, created_at desc);

-- Global (all-IP) hourly ceiling and per-conference daily ceiling (review
-- finding, HIGH item 2) both scan by `created_at` alone/with `conference`,
-- not `ip_hash` — separate indexes so those scans don't have to walk the
-- ip_hash-keyed index.
create index if not exists ingest_submission_attempts_created_at
  on public.ingest_submission_attempts (created_at);
create index if not exists ingest_submission_attempts_conference_recent
  on public.ingest_submission_attempts (conference, created_at desc)
  where conference is not null;

-- LLM cost/token usage for this submission's classification call (0 if the
-- link was never classified — e.g. filtered out, a duplicate, or rate-
-- limited before it got that far). `alter table add column if not exists`
-- (not inline in the create table above) so this is picked up even if the
-- table already exists from an earlier apply of this same file.
alter table public.ingest_submission_attempts add column if not exists cost_usd numeric(10,4) not null default 0;
alter table public.ingest_submission_attempts add column if not exists input_tokens int not null default 0;
alter table public.ingest_submission_attempts add column if not exists output_tokens int not null default 0;

alter table public.ingest_submission_attempts enable row level security;
revoke all on table public.ingest_submission_attempts from anon, authenticated;
