// Rate-limited Luma enrichment (§3.1 policy: 1 req/s, capped per run,
// identifying User-Agent, only for new/changed curated-feed events or single
// links discovered elsewhere). Wraps the existing `fetchLumaEvent`.
import { fetchLumaEvent, LumaFetchError } from '../luma-server';
import type { LumaEventPayload } from '../luma';

export interface EnrichRef {
  slug?: string;
  apiId?: string;
}

/** Structural interface both `LumaEnrichmentLimiter` and
 *  `HourlyWindowLumaLimiter` satisfy — lets a caller (e.g. `discover.ts`'s
 *  `DiscoveredLinkContext`) accept either without depending on a concrete
 *  class. */
export interface EnrichLimiter {
  enrich(ref: EnrichRef): Promise<LumaEventPayload | null>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class LumaEnrichmentLimiter implements EnrichLimiter {
  private count = 0;
  private lastCallAt = 0;

  constructor(
    private readonly maxPerRun: number = 100,
    private readonly minIntervalMs: number = 1000
  ) {}

  get used(): number {
    return this.count;
  }

  get remaining(): number {
    return Math.max(0, this.maxPerRun - this.count);
  }

  get exhausted(): boolean {
    return this.count >= this.maxPerRun;
  }

  /** Fetch one event's full payload, or `null` if the cap is hit, the ref is
   *  invalid, or Luma errors (callers fall back to iCal-only data). */
  async enrich(ref: EnrichRef): Promise<LumaEventPayload | null> {
    if (this.exhausted) return null;

    const now = Date.now();
    const wait = this.lastCallAt ? Math.max(0, this.lastCallAt + this.minIntervalMs - now) : 0;
    if (wait > 0) await sleep(wait);
    this.lastCallAt = Date.now();
    this.count++;

    try {
      if (ref.apiId) return await fetchLumaEvent({ apiId: ref.apiId });
      if (ref.slug) return await fetchLumaEvent({ slug: ref.slug });
      return null;
    } catch (err) {
      if (err instanceof LumaFetchError) return null;
      return null;
    }
  }
}

/**
 * A `LumaEnrichmentLimiter`-alike meant to be instantiated ONCE and shared
 * across every invocation of a long-lived caller (review finding, HIGH
 * item 2 "share a module-level Luma limiter" — the public host-submissions
 * route used to construct a brand-new `LumaEnrichmentLimiter` PER REQUEST,
 * so N concurrent requests each got their own fresh budget, collectively
 * blowing well past the intended rate limit).
 *
 * `LumaEnrichmentLimiter.maxPerRun` is a MONOTONIC cap that never resets —
 * fine for one pipeline run, wrong for a limiter meant to live for an
 * entire server instance's lifetime (it would permanently stop enriching
 * after `maxPerRun` calls EVER, until a cold start). This wraps an inner
 * `LumaEnrichmentLimiter` and transparently swaps in a fresh one once per
 * rolling hour, so the cap is really "at most N per hour, shared across
 * every request this instance handles" — still only an in-process
 * mitigation (a Vercel deployment can run multiple instances), not a true
 * cross-instance global limiter, but a real improvement over one fresh
 * budget per request.
 */
export class HourlyWindowLumaLimiter implements EnrichLimiter {
  private inner: LumaEnrichmentLimiter;
  private windowStartedAt = Date.now();
  private static readonly WINDOW_MS = 60 * 60 * 1000;

  constructor(
    private readonly maxPerHour: number,
    private readonly minIntervalMs: number = 1000
  ) {
    this.inner = new LumaEnrichmentLimiter(maxPerHour, minIntervalMs);
  }

  async enrich(ref: EnrichRef): Promise<LumaEventPayload | null> {
    if (Date.now() - this.windowStartedAt > HourlyWindowLumaLimiter.WINDOW_MS) {
      this.inner = new LumaEnrichmentLimiter(this.maxPerHour, this.minIntervalMs);
      this.windowStartedAt = Date.now();
    }
    return this.inner.enrich(ref);
  }
}
