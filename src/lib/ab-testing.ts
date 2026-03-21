/**
 * A/B Testing utilities
 *
 * Cookie-less visitor identification using localStorage + deterministic
 * variant assignment via a simple hash function.
 */

import { STORAGE_KEYS } from './storage-keys';
import { trackABImpression, trackABClick, trackABConversion } from './analytics';
import type { ABTest, ABTestVariant } from './types';

/* ------------------------------------------------------------------ */
/* Visitor ID                                                          */
/* ------------------------------------------------------------------ */

/** Generate a random visitor ID (UUID v4-like) */
function generateVisitorId(): string {
  // crypto.randomUUID is available in all modern browsers
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Get or create a persistent visitor ID from localStorage */
export function getVisitorId(): string {
  if (typeof window === 'undefined') return '';

  let id = localStorage.getItem(STORAGE_KEYS.AB_VISITOR_ID);
  if (!id) {
    id = generateVisitorId();
    localStorage.setItem(STORAGE_KEYS.AB_VISITOR_ID, id);
  }
  return id;
}

/* ------------------------------------------------------------------ */
/* Hash & Variant Assignment                                           */
/* ------------------------------------------------------------------ */

/**
 * Simple string hash (DJB2) that produces a number 0-9999.
 * Deterministic: same input always gives same output.
 */
export function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0xffffffff;
  }
  return Math.abs(hash) % 10000;
}

/**
 * Deterministically assign a visitor to a variant based on weighted allocation.
 *
 * @param testId  - The test identifier
 * @param visitorId - The visitor identifier
 * @param variants  - Array of variants with weights (should sum to 100)
 * @returns The assigned variant, or null if variants are empty
 */
export function assignVariant(
  testId: string,
  visitorId: string,
  variants: ABTestVariant[],
): ABTestVariant | null {
  if (variants.length === 0) return null;
  if (variants.length === 1) return variants[0];

  const bucket = hashString(`${testId}:${visitorId}`); // 0-9999
  const totalWeight = variants.reduce((sum, v) => sum + v.weight, 0);

  // Normalize bucket to total weight range
  const normalizedBucket = (bucket / 10000) * totalWeight;

  let cumulative = 0;
  for (const variant of variants) {
    cumulative += variant.weight;
    if (normalizedBucket < cumulative) {
      return variant;
    }
  }

  // Fallback to last variant (rounding edge case)
  return variants[variants.length - 1];
}

/**
 * Get the assigned variant for a running test.
 * Returns null if the test is not running or has no variants.
 */
export function getTestVariant(test: ABTest): ABTestVariant | null {
  if (test.status !== 'running') return null;

  const visitorId = getVisitorId();
  if (!visitorId) return null;

  return assignVariant(test.id, visitorId, test.variants);
}

/* ------------------------------------------------------------------ */
/* Event Tracking                                                      */
/* ------------------------------------------------------------------ */

/**
 * Track an A/B test event (impression, click, conversion).
 * Fires asynchronously and does not block.
 */
export function trackABEvent(
  testId: string,
  variantId: string,
  eventType: 'impression' | 'click' | 'conversion',
  metadata?: Record<string, unknown>,
): void {
  const visitorId = getVisitorId();
  if (!visitorId) return;

  // GA4 dual-tracking
  if (eventType === 'impression') trackABImpression(testId, variantId);
  else if (eventType === 'click') trackABClick(testId, variantId, metadata ? JSON.stringify(metadata) : undefined);
  else if (eventType === 'conversion') trackABConversion(testId, variantId, metadata ? JSON.stringify(metadata) : undefined);

  // Supabase tracking (fire-and-forget)
  fetch('/api/ab/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      test_id: testId,
      variant_id: variantId,
      visitor_id: visitorId,
      event_type: eventType,
      metadata,
    }),
  }).catch(() => {
    // Silently fail -- tracking should never break the app
  });
}

/* ------------------------------------------------------------------ */
/* Debounced Impression Tracking                                       */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Per-Item Variant Resolution                                         */
/* ------------------------------------------------------------------ */

/**
 * Resolve per-item A/B variants for a list of items.
 * Each item with ab.enabled gets variant selected based on visitor's hash.
 * Uses DJB2 hash of visitorId + item index for deterministic per-item assignment.
 */
export function resolveItemVariants<T extends { ab?: { b: Partial<T>; weightA: number; weightB: number; enabled: boolean } }>(
  items: T[],
  visitorId: string
): (T & { _variant?: 'a' | 'b' })[] {
  if (!visitorId) return items;
  return items.map((item, i) => {
    if (!item.ab || !item.ab.enabled) return item;
    const bucket = hashString(`${visitorId}:item:${i}`);
    const threshold = (item.ab.weightA / (item.ab.weightA + item.ab.weightB)) * 10000;
    if (bucket < threshold) {
      return { ...item, _variant: 'a' as const };
    }
    // Merge B variant fields over base
    const { b } = item.ab;
    return { ...item, ...b, _variant: 'b' as const };
  });
}

/* ------------------------------------------------------------------ */
/* Debounced Impression Tracking                                       */
/* ------------------------------------------------------------------ */

const trackedImpressions = new Set<string>();

/**
 * Track an impression only once per test+variant per page session.
 * Prevents duplicate impression events when components re-render.
 */
export function trackImpressionOnce(testId: string, variantId: string): void {
  const key = `${testId}:${variantId}`;
  if (trackedImpressions.has(key)) return;
  trackedImpressions.add(key);
  trackABEvent(testId, variantId, 'impression');
}
