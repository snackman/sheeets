-- Security hardening: admin_config held an "anyone can read" policy, so the
-- public anon key could read every config row via PostgREST, including
-- manually hidden conferences. All app and script reads use the service-role
-- key (which bypasses RLS), and the public site gets its slice of config via
-- GET /api/admin/config (which now filters to public keys).
drop policy if exists "Allow anonymous reads" on public.admin_config;
