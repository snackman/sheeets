-- ============================================================
-- Event ingestion Phase 2 (learning loop, precision dashboard, auto-publish
-- gate). See plans/event-ingestion.md §Phase 2.
--
-- NOT APPLIED TO PROD BY THIS PR, same convention as 20261011120000. Apply
-- by hand against the production Supabase project before Phase 2 code
-- paths are exercised there.
--
-- Additive only: new nullable columns (`add column if not exists`, never
-- destructive) plus a `create or replace view` that keeps every existing
-- `ingest_precision` column and adds one.
-- ============================================================

-- Kill-switch bookkeeping on `ingest_profiles` (`src/lib/ingest/
-- gate.ts#checkAutoPublishKillSwitch`): WHY/WHEN it last flipped
-- `auto_publish_enabled` back off, shown in the admin Config sub-tab
-- instead of a silent flip.
alter table public.ingest_profiles add column if not exists auto_publish_killed_at timestamptz;
alter table public.ingest_profiles add column if not exists auto_publish_kill_reason text;

-- WHEN auto-publish was most recently turned on. The kill switch only
-- looks at outcomes from AFTER this timestamp (`getRecentAutoPublishOutcomes`'s
-- `sinceIso`) — otherwise a re-enable could be killed immediately by a
-- bad run from a PRIOR enable window, which says nothing about whether the
-- newly re-enabled run is actually still bad (review finding, HIGH item 2).
alter table public.ingest_profiles add column if not exists auto_publish_enabled_at timestamptz;

-- WHEN a candidate was actually auto-published by the pipeline, distinct
-- from `published_at` (shared with a manual admin approval). The kill
-- switch's rolling sample must only ever look at rows the PIPELINE
-- auto-published, never a manual approval that happens to share the same
-- `status` value in spirit — `auto_published_at is not null` is the
-- precise filter for that (review finding, HIGH item 2).
alter table public.ingest_candidates add column if not exists auto_published_at timestamptz;
create index if not exists ingest_candidates_auto_published_at
  on public.ingest_candidates (conference, auto_published_at desc)
  where auto_published_at is not null;

-- ------------------------------------------------------------
-- Precision view fix (review finding, CRITICAL item 1): the ORIGINAL
-- `shadow_publish_candidates` column (status='queued' AND
-- shadow_route='publish') counts items STILL AWAITING a decision — by
-- definition disjoint from `shadow_publish_approved` (status='approved'),
-- since a row can't be 'queued' and 'approved' at once. So the old ratio
-- `shadow_publish_approved / shadow_publish_candidates` compared "decided
-- yes" against "not yet decided" — not a precision figure at all, and
-- easily exceeded 100%.
--
-- The correct shadow precision (plan §11: "among queued items whose
-- shadow_route='publish', the share approved") needs a DECIDED
-- denominator: approved, plus theme-rejected (off_theme/spam), among items
-- whose shadow_route was 'publish'. Pending ('queued', still undecided)
-- items must never enter either side.
--
-- `shadow_publish_candidates` is kept as-is (still useful on its own, e.g.
-- "how many would-publish items are still sitting in the queue right
-- now") — this ADDS the missing denominator half instead of repurposing
-- an existing column, so nothing that already reads this view breaks.
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
  count(*) filter (where c.status = 'approved') as reviewed_on_theme,
  count(*) filter (where c.status = 'rejected' and c.reject_reason in ('off_theme', 'spam')) as reviewed_off_theme,
  count(*) filter (where c.status = 'auto_published') as auto_published,
  count(*) filter (where c.status in ('unpublished', 'unpublished_external')) as auto_unpublished,
  count(*) filter (where c.status = 'queued' and c.shadow_route = 'publish') as shadow_publish_candidates,
  count(*) filter (where c.status = 'approved' and c.shadow_route = 'publish') as shadow_publish_approved,
  -- NEW: the other half of a real precision denominator — decided,
  -- theme-rejected items whose shadow route was 'publish'.
  count(*) filter (
    where c.status = 'rejected' and c.reject_reason in ('off_theme', 'spam') and c.shadow_route = 'publish'
  ) as shadow_publish_rejected_theme
from public.ingest_candidates c
group by 1, 2, 3;

revoke all on public.ingest_precision from anon, authenticated;
