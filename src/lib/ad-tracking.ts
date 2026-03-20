/**
 * Per-ad impression and click tracking to Supabase ad_events table.
 *
 * - Reuses the visitor ID from A/B testing (localStorage `sheeets-ab-visitor`)
 * - Deduplicates impressions per ad_id per page session (in-memory Set)
 * - Fire-and-forget: never blocks UI, never surfaces errors
 */

import { getVisitorId } from './ab-testing';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface AdTrackParams {
  ad_id: string;
  ad_name?: string;
  placement: 'native-ad' | 'sponsor-ticker' | 'featured-event' | 'profile';
  event_type: 'impression' | 'click';
  conference?: string;
  url?: string;
  metadata?: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/* Session deduplication                                                */
/* ------------------------------------------------------------------ */

const trackedImpressions = new Set<string>();

/* ------------------------------------------------------------------ */
/* Main tracking function                                              */
/* ------------------------------------------------------------------ */

/**
 * Track an ad event (impression or click) to the Supabase ad_events table.
 *
 * - Impressions are deduplicated per ad_id per page session.
 * - Clicks are always tracked.
 * - Fire-and-forget: errors are silently caught.
 */
export function trackAdEvent(params: AdTrackParams): void {
  // Deduplicate impressions per ad_id per session
  if (params.event_type === 'impression') {
    const key = `${params.ad_id}:${params.placement}`;
    if (trackedImpressions.has(key)) return;
    trackedImpressions.add(key);
  }

  const visitor_id = getVisitorId();
  if (!visitor_id) return;

  // Fire-and-forget POST
  fetch('/api/ads/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ad_id: params.ad_id,
      ad_name: params.ad_name,
      placement: params.placement,
      event_type: params.event_type,
      conference: params.conference,
      visitor_id,
      url: params.url,
      metadata: params.metadata,
    }),
  }).catch(() => {
    // Silently fail -- tracking should never break the app
  });
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Slugify a sponsor name for use as an ad_id.
 * "Stand With Crypto" -> "sponsor-stand-with-crypto"
 */
export function slugifySponsor(linkText: string): string {
  return (
    'sponsor-' +
    linkText
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  );
}
