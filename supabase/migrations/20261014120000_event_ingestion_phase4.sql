-- ============================================================
-- Event ingestion Phase 4 (X account monitoring, sponsor event pages,
-- Meetup search). See plans/event-ingestion.md §Phase 4.
--
-- NOT APPLIED TO PROD BY THIS PR, same convention as 20261011120000,
-- 20261012120000 and 20261013120000. Apply by hand against the production
-- Supabase project before Phase 4 code paths are exercised there.
--
-- Additive only, same as every prior phase in this series:
--   - `ingest_sources.kind` already allows 'x_account', 'meetup_search' and
--     'sponsor_pages' — they were added to the check constraint back in
--     20261011120000, ahead of any phase actually using them, same as
--     'telegram_channel'/'host_submission' were in Phase 3. Nothing to
--     alter there.
--   - Two new columns on `ingest_runs`, both `not null default 0` so an
--     existing row (and every row `finishRun` writes for a NON-X source,
--     which never sets these) is unaffected.
--   - One new RPC (same SECURITY DEFINER / pinned search_path / service-
--     role-only pattern as `get_monthly_ingest_cost_usd`, 20261013120000),
--     kept STRICTLY SEPARATE from the LLM cost RPC: X "Posts: Read" spend
--     has its own cap (`INGEST_X_MONTHLY_USD_CAP`, plan §3.7) and must
--     never be silently folded into the LLM budget `checkMonthlyBudget()`
--     already enforces for the Phase 1b/2/3 pipeline that's live today.
--   - A widened `ingest_sources_unique` index so the new source kinds get
--     the same "don't let an admin silently create a duplicate" idempotency
--     Luma calendars/Telegram channels already have, keyed on the config
--     field each new kind actually varies by (calendar/handle already
--     covered, query text for a Meetup search, an md5 hash of the url list
--     for sponsor pages) — every EXISTING kind's discriminator columns are
--     untouched, so this changes nothing about which existing rows
--     collide. (Re-review cleanup: this originally also included a
--     `listId` column for an X "list" source kind that Phase 4 doesn't
--     implement — see the PR's "known scope trims" — so it's been dropped
--     before this migration ever shipped to prod; and the url-list column
--     is hashed with md5(), not stored as raw text, so an admin pasting a
--     very long list of sponsor-page URLs can never produce an index tuple
--     that trips Postgres's btree row-size limit.)
--   - `ingest_run_cost_by_source_kind` view: run count + LLM/X cost per
--     source_kind, for the admin Precision tab's volume/cost-per-source-type
--     breakdown (db.ts#getRunCostBySourceKind).
--
-- Degrading gracefully (plan constraint: "must not break the live cron if
-- it's deployed before the migration"): `db.ts#monthlyXCostUsd` and
-- `db.ts#recordRunXCost` both tolerate the RPC/columns not existing yet
-- (same missing-relation error codes as the Phase 3 LLM-cost fallback),
-- and NEITHER is on any code path the already-live Luma-iCal/Telegram
-- cron run takes today — `finishRun`'s signature/behavior is unchanged by
-- this PR; `recordRunXCost` is an extra, best-effort call made ONLY after
-- processing an `x_account` source, which itself cannot run until an admin
-- adds one (and adding one is itself gated on `X_BEARER_TOKEN` being set).
-- ============================================================

alter table public.ingest_runs add column if not exists x_posts_read int not null default 0;
alter table public.ingest_runs add column if not exists x_cost_usd numeric(10,4) not null default 0;

create or replace function public.get_monthly_ingest_x_cost_usd(p_month_start timestamptz)
returns numeric
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select sum(x_cost_usd) from public.ingest_runs where started_at >= p_month_start), 0);
$$;

revoke execute on function public.get_monthly_ingest_x_cost_usd(timestamptz) from public;
revoke execute on function public.get_monthly_ingest_x_cost_usd(timestamptz) from anon;
revoke execute on function public.get_monthly_ingest_x_cost_usd(timestamptz) from authenticated;
grant execute on function public.get_monthly_ingest_x_cost_usd(timestamptz) to service_role;

-- Widen the source-dedupe index (originally from 20261011120000) to cover
-- the two new source kinds that need a discriminator (`meetup_search`'s
-- query text, `sponsor_pages`'s url list). `coalesce(...,'')` on each, same
-- NULL-safety rationale as the original two columns — two sources of a new
-- kind that both happen to have no value in the relevant field must not
-- silently collide with each other either. `md5(config->>'urls')` (not the
-- raw url-list text) bounds that column to a fixed 32 characters
-- regardless of how many/how long an admin's sponsor-page URLs are, so a
-- large list can never make this index tuple trip Postgres's btree
-- row-size limit — two sources collide here iff their url lists are
-- byte-for-byte identical, which is exactly the idempotency this index is
-- for. (No `listId` column: Phase 4 doesn't implement X "list" sources —
-- see the PR's "known scope trims" — so there's nothing to key on yet.)
drop index if exists ingest_sources_unique;
create unique index if not exists ingest_sources_unique on public.ingest_sources (
  conference, kind,
  coalesce(config->>'calendar_api_id', ''),
  coalesce(config->>'handle', ''),
  coalesce(config->>'query', ''),
  coalesce(md5(config->>'urls'), '')
);

-- ------------------------------------------------------------
-- Precision tab (§9.1 item 4 / §11): "break out volume and cost per source
-- type." `ingest_precision` (20261011120000, extended 20261012120000)
-- already groups review/auto-publish/shadow counts by source_kind; this
-- view adds the COST side (LLM $, X $, run count), joined from
-- ingest_runs -> ingest_sources.kind. A run with no source_id (a manual
-- re-score or dry-run recorded via `recordAdhocCost`) rolls up under the
-- literal string 'manual' rather than being dropped from the sum.
-- ------------------------------------------------------------
create or replace view public.ingest_run_cost_by_source_kind as
select
  r.conference,
  coalesce(s.kind, 'manual') as source_kind,
  count(*) as run_count,
  coalesce(sum(r.est_cost_usd), 0) as llm_cost_usd,
  coalesce(sum(r.x_cost_usd), 0) as x_cost_usd,
  coalesce(sum(r.llm_input_tokens), 0) as llm_input_tokens,
  coalesce(sum(r.llm_output_tokens), 0) as llm_output_tokens
from public.ingest_runs r
left join public.ingest_sources s on s.id = r.source_id
group by 1, 2;

revoke all on public.ingest_run_cost_by_source_kind from anon, authenticated;
