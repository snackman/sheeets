-- Drop existing function first (return type changed)
DROP FUNCTION IF EXISTS get_event_tracking_report(timestamptz, timestamptz, text);

-- Recreate with per-source click breakdown columns
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
  list_clicks bigint,
  table_clicks bigint,
  map_popup_clicks bigint,
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
    COUNT(*) FILTER (WHERE e.event_type = 'click' AND e.source = 'list') AS list_clicks,
    COUNT(*) FILTER (WHERE e.event_type = 'click' AND e.source = 'table') AS table_clicks,
    COUNT(*) FILTER (WHERE e.event_type = 'click' AND e.source = 'map-popup') AS map_popup_clicks,
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
