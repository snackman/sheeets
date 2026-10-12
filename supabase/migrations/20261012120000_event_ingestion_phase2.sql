-- ============================================================
-- Event ingestion Phase 2 (learning loop, precision dashboard, auto-publish
-- gate). See plans/event-ingestion.md §Phase 2.
--
-- NOT APPLIED TO PROD BY THIS PR, same convention as 20261011120000. Apply
-- by hand against the production Supabase project before Phase 2 code
-- paths are exercised there.
--
-- This is a tiny, additive change: two new nullable columns on the
-- existing `ingest_profiles` table (via `add column if not exists`, never
-- destructive) so the auto-publish kill switch
-- (`src/lib/ingest/gate.ts#checkAutoPublishKillSwitch`) has somewhere to
-- record WHY it flipped `auto_publish_enabled` back off, and the admin
-- Config sub-tab can show that to Snax instead of a silent flip.
--
-- The Precision dashboard (`src/lib/ingest/gate.ts`, `/api/admin/ingest/
-- precision`) and the few-shot learning loop (`src/lib/ingest/learning.ts`)
-- are built entirely on tables/views the Phase 1b migration already
-- created (`ingest_precision`, `ingest_labels`, `ingest_candidates`) — no
-- further schema change was needed for either.
-- ============================================================

alter table public.ingest_profiles add column if not exists auto_publish_killed_at timestamptz;
alter table public.ingest_profiles add column if not exists auto_publish_kill_reason text;
