-- Queue-list indexes for the admin review queue
-- (GET /api/admin/ingest/queue: status filter, optional conference, ordered
-- by final_score desc). The existing ingest_candidates_queue index leads with
-- `conference`, so the all-conference view (`?status=queued` without a
-- conference, or `status=all`) can't use it for the sort.
--
-- Manual apply. Idempotent. The code does NOT depend on these indexes --
-- they only make the queue list cheaper as the table grows.
create index if not exists ingest_candidates_status_score
  on public.ingest_candidates (status, final_score desc);

create index if not exists ingest_candidates_queued_conference_score
  on public.ingest_candidates (conference, final_score desc)
  where status = 'queued';
