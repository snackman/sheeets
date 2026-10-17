-- Fix every writer of geocoded_addresses silently failing (review finding,
-- HIGH, on PR #194): the table was created by
-- 20260309_add_geocoded_addresses.sql with `create table if not exists`,
-- but that original migration never actually ran with a `conference`
-- column in prod (verified via `supabase db query --linked` against
-- information_schema.columns: prod's columns are exactly
-- normalized_address, lat, lng, matched_address, created_at -- no
-- `conference`). Every writer
-- (src/app/api/cron/geocode/route.ts, src/lib/ingest/filters.ts,
-- src/app/api/admin/submissions/route.ts) upserts a `conference` field.
-- PostgREST rejects the unknown column (PGRST204) and, since none of
-- those call sites checked `{ error }` on the upsert, every write has been
-- silently failing for months -- confirmed by prod having 0 rows newer
-- than 2026-02-16 (119 total).
--
-- RLS/grants are unaffected by this migration and don't need to change:
-- RLS is enabled with a public SELECT policy only; every writer uses the
-- service-role client, which bypasses RLS regardless of policies present,
-- so the missing column -- not RLS -- was the actual bug.
--
-- Idempotent: safe to run more than once.
alter table public.geocoded_addresses add column if not exists conference text;

-- Negative-result cache for /api/cron/geocode (review finding, HIGH): an
-- address Mapbox genuinely can't resolve (a "TBA" placeholder, a Luma URL
-- accidentally left in the address field, ...) was retried every single
-- cron run (every 30 minutes, forever) with no backoff. This table lets
-- the cron skip an address that failed recently instead of re-calling
-- Mapbox for it every run -- see GEOCODE_FAILURE_RETRY_AFTER_MS in
-- src/app/api/cron/geocode/route.ts. Service-role only: nothing public
-- needs to read this, it's internal cron bookkeeping.
create table if not exists public.geocode_failures (
  normalized_address text primary key,
  conference text,
  last_attempt_at timestamptz not null default now()
);

alter table public.geocode_failures enable row level security;

drop policy if exists "Service role can manage geocode failures" on public.geocode_failures;
create policy "Service role can manage geocode failures"
  on public.geocode_failures for all using (auth.role() = 'service_role');
