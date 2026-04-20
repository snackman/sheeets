-- Migration: event_sponsors + sponsor_crawl_log tables
-- Stores extracted sponsor data from event page crawling

-- ============================================================
-- Table: event_sponsors
-- ============================================================

CREATE TABLE IF NOT EXISTS public.event_sponsors (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id          text NOT NULL,
  event_name        text,
  event_url         text NOT NULL,
  conference        text NOT NULL,
  sponsor_name      text NOT NULL,
  sponsor_url       text,
  sponsor_logo_url  text,
  sponsor_type      text DEFAULT 'sponsor',    -- sponsor | partner | presenter | host
  confidence        text DEFAULT 'medium',     -- high | medium | low
  extraction_method text,                      -- api | json-ld | html-section | description
  crawled_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE(event_id, sponsor_name)
);

CREATE INDEX idx_event_sponsors_event_id ON public.event_sponsors(event_id);
CREATE INDEX idx_event_sponsors_conference ON public.event_sponsors(conference);
CREATE INDEX idx_event_sponsors_sponsor_name ON public.event_sponsors(sponsor_name);

-- RLS: public read, service-role write
ALTER TABLE public.event_sponsors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read on event_sponsors"
  ON public.event_sponsors FOR SELECT
  USING (true);

CREATE POLICY "Allow service role insert on event_sponsors"
  ON public.event_sponsors FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Allow service role update on event_sponsors"
  ON public.event_sponsors FOR UPDATE
  USING (true);

CREATE POLICY "Allow service role delete on event_sponsors"
  ON public.event_sponsors FOR DELETE
  USING (true);

-- ============================================================
-- Table: sponsor_crawl_log
-- ============================================================

CREATE TABLE IF NOT EXISTS public.sponsor_crawl_log (
  event_url      text PRIMARY KEY,
  event_id       text NOT NULL,
  conference     text NOT NULL,
  status         text NOT NULL CHECK (status IN ('success', 'no_sponsors', 'error', 'skipped')),
  sponsors_found integer DEFAULT 0,
  error_message  text,
  crawled_at     timestamptz NOT NULL DEFAULT now()
);

-- RLS: public read, service-role write
ALTER TABLE public.sponsor_crawl_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read on sponsor_crawl_log"
  ON public.sponsor_crawl_log FOR SELECT
  USING (true);

CREATE POLICY "Allow service role insert on sponsor_crawl_log"
  ON public.sponsor_crawl_log FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Allow service role update on sponsor_crawl_log"
  ON public.sponsor_crawl_log FOR UPDATE
  USING (true);

CREATE POLICY "Allow service role delete on sponsor_crawl_log"
  ON public.sponsor_crawl_log FOR DELETE
  USING (true);
