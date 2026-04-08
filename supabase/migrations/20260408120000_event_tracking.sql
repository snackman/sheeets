CREATE TABLE IF NOT EXISTS public.event_tracking (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id    text NOT NULL,
  event_name  text,
  event_type  text NOT NULL CHECK (event_type IN ('click', 'impression', 'pin-click')),
  conference  text,
  visitor_id  text,
  url         text,
  source      text,
  metadata    jsonb DEFAULT '{}'::jsonb,
  created_at  timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX idx_event_tracking_event_id ON public.event_tracking(event_id);
CREATE INDEX idx_event_tracking_created_at ON public.event_tracking(created_at);
CREATE INDEX idx_event_tracking_conference ON public.event_tracking(conference);
CREATE INDEX idx_event_tracking_type ON public.event_tracking(event_type);
CREATE INDEX idx_event_tracking_report ON public.event_tracking(created_at, conference, event_type);

ALTER TABLE public.event_tracking ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow anonymous inserts" ON public.event_tracking FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow service role reads" ON public.event_tracking FOR SELECT USING (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION get_event_tracking_report(
  p_start_date timestamptz,
  p_end_date timestamptz,
  p_conference text DEFAULT NULL
)
RETURNS TABLE (
  event_id text,
  event_name text,
  conference text,
  clicks bigint,
  unique_clicks bigint,
  impressions bigint,
  unique_impressions bigint,
  pin_clicks bigint,
  ctr numeric,
  first_seen timestamptz,
  last_seen timestamptz
)
LANGUAGE sql STABLE
AS $$
  SELECT
    e.event_id,
    MAX(e.event_name) AS event_name,
    MAX(e.conference) AS conference,
    COUNT(*) FILTER (WHERE e.event_type = 'click') AS clicks,
    COUNT(DISTINCT e.visitor_id) FILTER (WHERE e.event_type = 'click') AS unique_clicks,
    COUNT(*) FILTER (WHERE e.event_type = 'impression') AS impressions,
    COUNT(DISTINCT e.visitor_id) FILTER (WHERE e.event_type = 'impression') AS unique_impressions,
    COUNT(*) FILTER (WHERE e.event_type = 'pin-click') AS pin_clicks,
    CASE
      WHEN COUNT(*) FILTER (WHERE e.event_type = 'impression') > 0
      THEN ROUND(
        COUNT(*) FILTER (WHERE e.event_type = 'click')::numeric /
        COUNT(*) FILTER (WHERE e.event_type = 'impression')::numeric * 100, 2
      )
      ELSE 0
    END AS ctr,
    MIN(e.created_at) AS first_seen,
    MAX(e.created_at) AS last_seen
  FROM event_tracking e
  WHERE e.created_at >= p_start_date
    AND e.created_at <= p_end_date
    AND (p_conference IS NULL OR p_conference = '' OR e.conference = p_conference)
  GROUP BY e.event_id
  ORDER BY clicks DESC;
$$;
