-- Conference notification signups (Notify Me for upcoming conferences)
CREATE TABLE IF NOT EXISTS conference_notifications (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  email text NOT NULL,
  conference_slug text NOT NULL,
  conference_name text NOT NULL,
  created_at timestamptz DEFAULT now(),
  notified_at timestamptz,
  UNIQUE(email, conference_slug)
);

-- Allow inserts from anon (public signups)
ALTER TABLE conference_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can sign up for notifications"
  ON conference_notifications FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Only service role can read/update (for sending notifications)
CREATE POLICY "Service role can manage notifications"
  ON conference_notifications FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Index for querying by conference
CREATE INDEX idx_conference_notifications_slug ON conference_notifications(conference_slug);
-- Index for finding unsent notifications
CREATE INDEX idx_conference_notifications_pending ON conference_notifications(notified_at) WHERE notified_at IS NULL;
