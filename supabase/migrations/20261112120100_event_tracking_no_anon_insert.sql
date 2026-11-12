-- Every event_tracking write goes through POST /api/events/track, which uses
-- the service-role key (bypasses RLS). The anon direct-insert policy is no
-- longer needed and let anyone with the public anon key insert rows directly.
drop policy if exists "Allow anonymous inserts" on public.event_tracking;
