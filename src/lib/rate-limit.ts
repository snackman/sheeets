import type { NextRequest } from 'next/server';

/**
 * Best-effort client IP, same priority order as
 * `src/app/api/host/submissions/route.ts`'s `getClientIp`: Vercel's
 * `x-real-ip` (not client-suppliable), then `x-vercel-forwarded-for`, then
 * the first entry of the generic `x-forwarded-for` chain as a last resort
 * for non-Vercel environments.
 */
export function getClientIp(req: NextRequest): string {
  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  const vercelFwd = req.headers.get('x-vercel-forwarded-for');
  if (vercelFwd) {
    const first = vercelFwd.split(',')[0]?.trim();
    if (first) return first;
  }
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) {
    const first = fwd.split(',')[0]?.trim();
    if (first) return first;
  }
  return 'unknown';
}

interface Bucket {
  count: number;
  windowStart: number;
}

/**
 * A basic, in-process fixed-window rate limiter: at most `max` calls to
 * `check(key)` per `windowMs`, per key. No external store -- this resets on
 * cold start and is not shared across serverless instances/regions, so it
 * is a speed bump against casual brute-forcing (e.g. of
 * `/api/admin/verify`'s password), not a hard guarantee. Good enough for
 * "basic"; a real guarantee would need a shared store (Supabase/Redis),
 * which isn't warranted for this endpoint's actual risk.
 */
export function createRateLimiter(max: number, windowMs: number) {
  const buckets = new Map<string, Bucket>();

  return {
    /** Returns true if `key` is still within its limit for this window (and records the attempt); false if it should be rejected. */
    check(key: string): boolean {
      const now = Date.now();
      const bucket = buckets.get(key);

      if (!bucket || now - bucket.windowStart >= windowMs) {
        buckets.set(key, { count: 1, windowStart: now });
        return true;
      }

      if (bucket.count >= max) return false;
      bucket.count += 1;
      return true;
    },
  };
}
