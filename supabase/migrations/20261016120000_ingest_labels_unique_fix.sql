-- ============================================================
-- Fix `ingest_labels` upsert: ON CONFLICT (candidate_id, source) cannot
-- target a PARTIAL unique index. `20261011120000_event_ingestion.sql`
-- created `ingest_labels_one_per_candidate` as a partial index (`where
-- candidate_id is not null`), but `db.ts#insertLabel` upserts with
-- `{ onConflict: 'candidate_id,source' }` — Postgres can't infer a partial
-- index as the arbiter for a plain column-list ON CONFLICT, so every
-- approve/reject/unpublish (anything that writes an ingest_labels row)
-- failed with "no unique or exclusion constraint matching the ON CONFLICT
-- specification".
--
-- Hotfixed directly on prod on 2026-10-16; this migration makes the repo
-- match prod. Idempotent (IF NOT EXISTS / IF EXISTS), safe to re-run.
--
-- APPLIED BY HAND TO PROD ALREADY on 2026-10-16, same convention as every
-- migration after 20260929120000 — this file just keeps the repo in sync.
-- ============================================================

create unique index if not exists ingest_labels_candidate_source
  on public.ingest_labels (candidate_id, source);

drop index if exists public.ingest_labels_one_per_candidate;
