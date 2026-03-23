-- Gmail-based Luma event importer tables
-- Stores Gmail OAuth connections, imported events, and source email references

-- ============================================================
-- gmail_connections: stores OAuth tokens per user
-- ============================================================
CREATE TABLE IF NOT EXISTS gmail_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL,
  google_account_email text NOT NULL,
  access_token_encrypted text NOT NULL,
  refresh_token_encrypted text NOT NULL,
  scope text,
  connected_at timestamptz DEFAULT now(),
  last_sync_at timestamptz,
  status text DEFAULT 'active' CHECK (status IN ('active', 'disconnected'))
);

-- One active connection per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_gmail_connections_user
  ON gmail_connections (user_id) WHERE status = 'active';

ALTER TABLE gmail_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own gmail connections"
  ON gmail_connections FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own gmail connections"
  ON gmail_connections FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own gmail connections"
  ON gmail_connections FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own gmail connections"
  ON gmail_connections FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================
-- imported_events: canonical deduplicated event records
-- ============================================================
CREATE TABLE IF NOT EXISTS imported_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL,
  source text DEFAULT 'gmail_luma',
  external_event_key text,
  event_name text,
  event_start_at timestamptz,
  event_end_at timestamptz,
  location_raw text,
  location_normalized text,
  event_url text,
  status text CHECK (status IN ('approved', 'rsvp', 'waitlist', 'unknown')),
  parse_confidence float,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (user_id, external_event_key)
);

CREATE INDEX IF NOT EXISTS idx_imported_events_user
  ON imported_events (user_id);

ALTER TABLE imported_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own imported events"
  ON imported_events FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own imported events"
  ON imported_events FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own imported events"
  ON imported_events FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own imported events"
  ON imported_events FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================
-- imported_event_sources: email provenance per event
-- ============================================================
CREATE TABLE IF NOT EXISTS imported_event_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  imported_event_id uuid REFERENCES imported_events ON DELETE CASCADE,
  gmail_message_id text,
  gmail_thread_id text,
  message_type text CHECK (message_type IN (
    'rsvp_confirmation', 'approval', 'reminder',
    'calendar_invite', 'waitlist', 'cancellation', 'unknown'
  )),
  sender text,
  subject text,
  received_at timestamptz,
  had_ics boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_imported_event_sources_event
  ON imported_event_sources (imported_event_id);

ALTER TABLE imported_event_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own imported event sources"
  ON imported_event_sources FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM imported_events
      WHERE imported_events.id = imported_event_sources.imported_event_id
        AND imported_events.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own imported event sources"
  ON imported_event_sources FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM imported_events
      WHERE imported_events.id = imported_event_sources.imported_event_id
        AND imported_events.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own imported event sources"
  ON imported_event_sources FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM imported_events
      WHERE imported_events.id = imported_event_sources.imported_event_id
        AND imported_events.user_id = auth.uid()
    )
  );
