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
-- Corrected per PR #181 review (LOW item 6, re-corrected per the re-review,
-- item C): `POST /api/host/submissions` is REACHABLE the moment this PR
-- deploys — anyone who finds the URL can call it directly, whether or not
-- `/submit-source` is linked anywhere, and regardless of whether this
-- migration has been applied yet. Most DB calls the route makes against
-- `ingest_submission_attempts` (recording an attempt, the per-IP/global/
-- conference rate-limit counts, recording classification cost) throw if
-- the table doesn't exist — a plain Postgres "relation does not exist"
-- surfaces as a normal Supabase query error the route doesn't swallow, and
-- an uncaught throw in a Next.js route handler becomes a 500 — so a
-- request against this route on an un-migrated deploy fails closed (an
-- error, nothing written, nothing published), not "unreachable."
--
-- ONE exception, and it's deliberate: `monthlyLlmCostUsd()` (`db.ts`) is
-- also called from the Phase 1b/2 Luma-iCal pipeline's budget check
-- (`checkMonthlyBudget`), which is ALREADY LIVE in production today and
-- must keep working whether or not THIS migration (which it has no other
-- dependency on) has been applied yet. So that one function is written to
-- treat the submissions-table half of its sum as $0 (via
-- `get_monthly_ingest_cost_usd` below, with a client-side fallback if even
-- that RPC doesn't exist yet) rather than throwing, while still throwing
-- normally if the PRE-EXISTING `ingest_runs` half fails for a real reason.
-- See db.ts for the exact error-code handling. The Telegram source kind is
-- similarly reachable but fails closed the same way as the rest of the
-- submissions route. Apply this migration before actually exercising any
-- Phase 3 path for real.
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

-- Re-review finding A: a request rejected by the PER-IP limit (or, before
-- this re-review, a captcha failure — now moved to run before any insert
-- at all, so a failed-captcha flood never creates a row here) must not
-- count toward the GLOBAL/per-conference ceilings, or a single IP that
-- floods past its OWN per-IP limit would keep consuming shared budget and
-- 429 every OTHER IP/conference too. `route.ts` marks a row `rejected`
-- when ITS OWN per-IP (or global/conference) check fails; the global/
-- per-conference count queries filter `rejected = false` (see
-- `countGlobalRecentSubmissionAttempts`/`countConferenceRecentSubmissionAttempts`
-- in db.ts) — the per-IP count query deliberately does NOT filter on it
-- (a flood should keep counting against ITS OWN future per-IP windows).
alter table public.ingest_submission_attempts add column if not exists rejected boolean not null default false;
create index if not exists ingest_submission_attempts_global_recent
  on public.ingest_submission_attempts (created_at)
  where rejected = false;

alter table public.ingest_submission_attempts enable row level security;
revoke all on table public.ingest_submission_attempts from anon, authenticated;

-- ------------------------------------------------------------
-- Re-review finding B: sum both cost columns in SQL (one row back,
-- regardless of how many underlying rows), not by pulling up to
-- PostgREST's default 1000-row page client-side and summing in JS, which
-- silently truncated the total once either table passed 1000 rows in a
-- month. Same security pattern as the existing aggregation RPCs
-- (`20260929120000_harden_aggregation_rpcs.sql`): SECURITY DEFINER (so it
-- can read `ingest_runs`/`ingest_submission_attempts`, which have no
-- policies for anon/authenticated), a pinned `search_path`, and execute
-- granted to service_role only — this repo's ingestion code always runs
-- server-side with the service role key, never as anon/authenticated.
--
-- `create or replace function` makes re-running this file idempotent, same
-- as every other statement here.
create or replace function public.get_monthly_ingest_cost_usd(p_month_start timestamptz)
returns numeric
language sql
security definer
set search_path = public
stable
as $$
  select
    coalesce((select sum(est_cost_usd) from public.ingest_runs where started_at >= p_month_start), 0)
    + coalesce((select sum(cost_usd) from public.ingest_submission_attempts where created_at >= p_month_start), 0);
$$;

revoke execute on function public.get_monthly_ingest_cost_usd(timestamptz) from public;
revoke execute on function public.get_monthly_ingest_cost_usd(timestamptz) from anon;
revoke execute on function public.get_monthly_ingest_cost_usd(timestamptz) from authenticated;
grant execute on function public.get_monthly_ingest_cost_usd(timestamptz) to service_role;
