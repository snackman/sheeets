-- Lock down ab_events, ad_events, event_sponsors, sponsor_crawl_log.
--
-- Audit findings (2026-10-17), verified against prod with
-- `supabase db query --linked` against pg_class.relrowsecurity / pg_policies:
--   - ab_events, ad_events: RLS disabled entirely. Anyone holding the
--     public anon key could read and write these tables directly.
--   - event_sponsors, sponsor_crawl_log: RLS enabled, but INSERT/UPDATE/
--     DELETE policies were granted to role `public` with `USING (true)` /
--     `WITH CHECK (true)` -- i.e. open writes for anyone with the anon key.
--
-- Every actual application writer/reader of these 4 tables already uses
-- the service-role Supabase client:
--   - ab_events:        src/app/api/ab/track/route.ts, src/app/api/ab/results/route.ts
--   - ad_events:        src/app/api/ads/track/route.ts, src/app/api/ads/report/route.ts
--   - event_sponsors:   src/app/api/admin/sponsor-data/route.ts,
--                        scripts/crawl-sponsors.ts, src/lib/ingest/db.ts (getIngestSupabase)
--   - sponsor_crawl_log: src/app/api/admin/sponsor-data/route.ts,
--                        src/app/api/admin/sponsor-data/crawl-log/route.ts,
--                        scripts/crawl-sponsors.ts
-- The Supabase `service_role` Postgres role has `bypassrls` by default, so
-- none of those call sites need an explicit policy added here. Enabling
-- RLS with no (or SELECT-only) policy is enough to lock out anon/
-- authenticated while leaving every service-role call site untouched --
-- no code changes are required alongside this migration.
--
-- The one exception is `event_sponsors`, which IS read directly with the
-- public anon key, server-side, by src/app/orgs/page.tsx and
-- src/app/api/orgs/mapping/route.ts (both power the public /orgs page).
-- That public SELECT policy is kept as-is.
--
-- No legitimate anon/public reader of `sponsor_crawl_log` exists anywhere
-- in the app, so every public policy on it (including SELECT) is dropped.
--
-- Idempotent: safe to run more than once.

-- ab_events: enable RLS. No anon/authenticated policy is added -- every
-- reader/writer (src/app/api/ab/track, src/app/api/ab/results) uses the
-- service-role client, which bypasses RLS.
ALTER TABLE public.ab_events ENABLE ROW LEVEL SECURITY;

-- ad_events: same reasoning (src/app/api/ads/track, src/app/api/ads/report).
ALTER TABLE public.ad_events ENABLE ROW LEVEL SECURITY;

-- event_sponsors: drop the open public write policies. Every real writer
-- (src/app/api/admin/sponsor-data, scripts/crawl-sponsors.ts,
-- src/lib/ingest/db.ts) uses the service-role client. Keep the existing
-- public SELECT policy ("Allow public read on event_sponsors"):
-- src/app/orgs/page.tsx and src/app/api/orgs/mapping/route.ts read this
-- table with the anon key and must keep working.
DROP POLICY IF EXISTS "Allow service role insert on event_sponsors" ON public.event_sponsors;
DROP POLICY IF EXISTS "Allow service role update on event_sponsors" ON public.event_sponsors;
DROP POLICY IF EXISTS "Allow service role delete on event_sponsors" ON public.event_sponsors;

-- sponsor_crawl_log: nothing in the app reads or writes this table with
-- the anon key -- only src/app/api/admin/sponsor-data/route.ts,
-- src/app/api/admin/sponsor-data/crawl-log/route.ts and
-- scripts/crawl-sponsors.ts touch it, all service-role. Drop every public
-- policy, including SELECT: there is no legitimate anon reader of crawl
-- logs (which can include scrape errors/raw HTML snippets).
DROP POLICY IF EXISTS "Allow public read on sponsor_crawl_log" ON public.sponsor_crawl_log;
DROP POLICY IF EXISTS "Allow service role insert on sponsor_crawl_log" ON public.sponsor_crawl_log;
DROP POLICY IF EXISTS "Allow service role update on sponsor_crawl_log" ON public.sponsor_crawl_log;
DROP POLICY IF EXISTS "Allow service role delete on sponsor_crawl_log" ON public.sponsor_crawl_log;
