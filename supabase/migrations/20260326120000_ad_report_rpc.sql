-- RPC function to aggregate ad events server-side (avoids PostgREST row limit)
CREATE OR REPLACE FUNCTION get_ad_report(
  p_start_date timestamptz,
  p_end_date timestamptz,
  p_conference text DEFAULT NULL
)
RETURNS TABLE (
  ad_id text,
  ad_name text,
  placement text,
  impressions bigint,
  unique_impressions bigint,
  clicks bigint,
  unique_clicks bigint,
  ctr numeric,
  first_seen timestamptz,
  last_seen timestamptz
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    e.ad_id,
    MAX(e.ad_name) AS ad_name,
    MAX(e.placement) AS placement,
    COUNT(*) FILTER (WHERE e.event_type = 'impression') AS impressions,
    COUNT(DISTINCT e.visitor_id) FILTER (WHERE e.event_type = 'impression') AS unique_impressions,
    COUNT(*) FILTER (WHERE e.event_type = 'click') AS clicks,
    COUNT(DISTINCT e.visitor_id) FILTER (WHERE e.event_type = 'click') AS unique_clicks,
    CASE
      WHEN COUNT(*) FILTER (WHERE e.event_type = 'impression') > 0
      THEN ROUND(
        COUNT(*) FILTER (WHERE e.event_type = 'click')::numeric /
        COUNT(*) FILTER (WHERE e.event_type = 'impression')::numeric * 100,
        2
      )
      ELSE 0
    END AS ctr,
    MIN(e.created_at) AS first_seen,
    MAX(e.created_at) AS last_seen
  FROM ad_events e
  WHERE e.created_at >= p_start_date
    AND e.created_at <= p_end_date
    AND (p_conference IS NULL OR p_conference = '' OR e.conference = p_conference)
  GROUP BY e.ad_id
  ORDER BY impressions DESC;
$$;
