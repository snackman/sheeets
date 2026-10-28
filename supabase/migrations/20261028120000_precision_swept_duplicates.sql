-- Dedupe sweep (src/lib/ingest/dedupe-sweep.ts): when a hand-added sheet row
-- duplicates a row the pipeline published, the pipeline's row is deleted and
-- its candidate is marked status='duplicate' (published_at stays set; plain
-- duplicates are never published). Those candidates were correct, on-theme
-- publishes, so keep counting them as the success they were instead of
-- letting them silently drop out of the precision sample.
--   * auto-published then swept (auto_published_at set)  -> auto_published
--   * approved then swept (published_at set, no auto_published_at) -> approved
-- They are never counted as unpublished / off-theme.
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
    where c.status = 'rejected' and c.reject_reason in ('off_theme', 'spam') and c.shadow_route = 'publish'
  ) as shadow_publish_rejected_theme
from public.ingest_candidates c
group by 1, 2, 3;

revoke all on public.ingest_precision from anon, authenticated;
