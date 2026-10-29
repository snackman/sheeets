-- Shadow precision (src/lib/ingest/gate.ts#summarizeShadowSample) used to
-- count only off_theme/spam rejections of shadow_route='publish' items as
-- negatives. But a shadow-publish item a human rejects for ANY reason
-- (online-only, lodging, sales 1:1s, residency, wrong city/dates, pre-event,
-- invite-only, other) would have been a bad auto-publish. Count every
-- rejection as a negative EXCEPT `duplicate` (the event was right, it just
-- already existed on the sheet). A rejection with no reason counts too.
--
-- The column keeps its legacy name `shadow_publish_rejected_theme` so the
-- TS reader (db.ts#IngestPrecisionRow) needs no change. `reviewed_off_theme`
-- (the queue approval-rate figure) keeps its theme-only definition.
--
-- Mirrored exactly by gate.ts#computePrecisionRowsFromCandidates /
-- isShadowPublishNegative (tested in ingest-gate.test.ts). Everything else
-- is unchanged from 20261028120000_precision_swept_duplicates.sql.
--
-- Manual apply. Idempotent (create or replace).
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
  count(*) filter (where c.status = 'approved' or (c.status = 'duplicate' and c.published_at is not null and c.auto_published_at is null)) as reviewed_on_theme,
  count(*) filter (where c.status = 'rejected' and c.reject_reason in ('off_theme', 'spam')) as reviewed_off_theme,
  count(*) filter (where c.status = 'auto_published' or (c.status = 'duplicate' and c.auto_published_at is not null)) as auto_published,
  count(*) filter (where c.status in ('unpublished', 'unpublished_external')) as auto_unpublished,
  count(*) filter (where c.status = 'queued' and c.shadow_route = 'publish') as shadow_publish_candidates,
  count(*) filter (where (c.status = 'approved' or (c.status = 'duplicate' and c.published_at is not null and c.auto_published_at is null)) and c.shadow_route = 'publish') as shadow_publish_approved,
  count(*) filter (
    where c.status = 'rejected' and coalesce(c.reject_reason, '') <> 'duplicate' and c.shadow_route = 'publish'
  ) as shadow_publish_rejected_theme
from public.ingest_candidates c
group by 1, 2, 3;

revoke all on public.ingest_precision from anon, authenticated;
