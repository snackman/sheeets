-- ================================================================
-- Luma form fields cache
-- Stores the registration questions for each Luma event so we
-- don't have to re-scan every time.
-- ================================================================

CREATE TABLE IF NOT EXISTS luma_form_fields (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  luma_slug text NOT NULL,
  event_api_id text NOT NULL,
  event_name text,
  name_requirement text,           -- 'full-name' | 'first-last'
  questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  scanned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (luma_slug)
);

ALTER TABLE luma_form_fields ENABLE ROW LEVEL SECURITY;

-- Anyone can read cached form fields
CREATE POLICY "luma_form_fields_select" ON luma_form_fields
  FOR SELECT USING (true);

-- Only service role can insert/update (via API route or CLI script)
CREATE POLICY "luma_form_fields_insert" ON luma_form_fields
  FOR INSERT WITH CHECK (false);
CREATE POLICY "luma_form_fields_update" ON luma_form_fields
  FOR UPDATE USING (false);

-- ================================================================
-- Custom field answers cache
-- Remembers user answers to custom Luma questions so they can
-- be pre-filled across events.
-- ================================================================

CREATE TABLE IF NOT EXISTS custom_field_answers (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question_label text NOT NULL,
  question_type text NOT NULL,     -- 'text' | 'dropdown' | 'multi-select' | 'terms'
  answer text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, question_label)
);

ALTER TABLE custom_field_answers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "custom_field_answers_select" ON custom_field_answers
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "custom_field_answers_insert" ON custom_field_answers
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "custom_field_answers_update" ON custom_field_answers
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "custom_field_answers_delete" ON custom_field_answers
  FOR DELETE USING (auth.uid() = user_id);

-- ================================================================
-- Batch RSVP jobs
-- Tracks each individual registration submission within a batch.
-- ================================================================

CREATE TABLE IF NOT EXISTS batch_rsvp_jobs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id text NOT NULL,
  luma_slug text NOT NULL,
  event_name text,
  event_api_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'submitting', 'success', 'failed')),
  error_message text,
  profile_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  custom_answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE batch_rsvp_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "batch_rsvp_jobs_select" ON batch_rsvp_jobs
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "batch_rsvp_jobs_insert" ON batch_rsvp_jobs
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "batch_rsvp_jobs_update" ON batch_rsvp_jobs
  FOR UPDATE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_batch_rsvp_jobs_user ON batch_rsvp_jobs (user_id);
CREATE INDEX IF NOT EXISTS idx_batch_rsvp_jobs_status ON batch_rsvp_jobs (status);
