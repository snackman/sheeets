// Rate-limited Luma enrichment (§3.1 policy: 1 req/s, capped per run,
// identifying User-Agent, only for new/changed curated-feed events or single
// links discovered elsewhere). Wraps the existing `fetchLumaEvent`.
import { fetchLumaEvent, LumaFetchError } from '../luma-server';
import type { LumaEventPayload } from '../luma';

export interface EnrichRef {
  slug?: string;
  apiId?: string;
}

/**
 * A richer outcome than `enrich()`'s plain `LumaEventPayload | null`,
 * distinguishing a CONFIRMED "Luma says this doesn't exist" (`'not_found'`
 * — safe to cache as a permanent negative) from `'unavailable'` (the
 * limiter's budget is exhausted, or a transient network/upstream error —
 * we genuinely don't know, and must NEVER be cached as a negative).
 *
 * Bug: "exhausting the Luma limiter poisons `ingest_link_cache`" —
 * `enrich()` alone collapses an exhausted limiter, a transient fetch
 * error, AND a genuine 404 into the same `null`, which is fine for every
 * caller that just wants best-effort data (falls back to iCal-only info
 * either way), but was silently wrong for `discover.ts#resolveLumaShortLinkKey`,
 * which used a `null` result to write a FALSE permanent miss into the
 * cache — hiding a real event from dedupe for as long as that cache row
 * existed, exactly the same class of incident as #193's stale-negative
 * fix, just from a different write path.
 */
export type EnrichOutcome =
  | { status: 'ok'; payload: LumaEventPayload }
  | { status: 'not_found'; reason?: string }
  | { status: 'unavailable'; reason?: string };

/** Structural interface both `LumaEnrichmentLimiter` and
 *  `HourlyWindowLumaLimiter` satisfy — lets a caller (e.g. `discover.ts`'s
 *  `DiscoveredLinkContext`) accept either without depending on a concrete
 *  class. */
export interface EnrichLimiter {
  enrich(ref: EnrichRef): Promise<LumaEventPayload | null>;
  /** Same lookup as `enrich`, but see `EnrichOutcome`'s doc comment — a
   *  caller that might cache a negative result must call this instead of
   *  `enrich` and check `status === 'not_found'` before doing so. */
  enrichResult(ref: EnrichRef): Promise<EnrichOutcome>;
  /** True once this limiter's budget for the current window is used up.
   *  Exposed on the interface (not just the concrete classes) so a shared
   *  caller like `discover.ts`/`pipeline.ts` can stop feeding it more work
   *  — see `runDiscoveredLinksBatch`'s doc comment. */
  readonly exhausted: boolean;
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

  /** The real lookup, with the full outcome — see `EnrichOutcome`. Checks
   *  `exhausted` BEFORE any pacing/count increment (same as the old
   *  `enrich()` did), so a call made once the budget is used up costs
   *  nothing and never touches `lastCallAt`. */
  async enrichResult(ref: EnrichRef): Promise<EnrichOutcome> {
    if (this.exhausted) return { status: 'unavailable', reason: 'luma_budget_exhausted' };

    const now = Date.now();
    const wait = this.lastCallAt ? Math.max(0, this.lastCallAt + this.minIntervalMs - now) : 0;
    if (wait > 0) await sleep(wait);
    this.lastCallAt = Date.now();
    this.count++;

    try {
      let payload: LumaEventPayload;
      if (ref.apiId) payload = await fetchLumaEvent({ apiId: ref.apiId });
      else if (ref.slug) payload = await fetchLumaEvent({ slug: ref.slug });
      else return { status: 'unavailable', reason: 'no_ref' };
      return { status: 'ok', payload };
    } catch (err) {
      // Only a CONFIRMED "Luma says this doesn't exist" (404, `not_found`)
      // is a genuine miss. Every other `LumaFetchError` ('invalid' — a
      // malformed ref that should never have reached here, or 'upstream' —
      // a network/5xx/parse failure) is transient-or-our-own-bug, not proof
      // the event doesn't exist, so it must never be cached as a negative.
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof LumaFetchError && err.code === 'not_found') return { status: 'not_found', reason: message };
      return { status: 'unavailable', reason: message };
    }
  }

  /** Fetch one event's full payload, or `null` if the cap is hit, the ref is
   *  invalid, or Luma errors (callers fall back to iCal-only data). A thin
   *  wrapper over `enrichResult` for the common "I just want the payload,
   *  I'm not deciding whether to cache a negative" case. */
  async enrich(ref: EnrichRef): Promise<LumaEventPayload | null> {
    const result = await this.enrichResult(ref);
    return result.status === 'ok' ? result.payload : null;
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

  private maybeResetWindow(): void {
    if (Date.now() - this.windowStartedAt > HourlyWindowLumaLimiter.WINDOW_MS) {
      this.inner = new LumaEnrichmentLimiter(this.maxPerHour, this.minIntervalMs);
      this.windowStartedAt = Date.now();
    }
  }

  /** True once this (rolling) hour's shared budget is used up. Re-review
   *  finding E: callers (the host-submissions route) check this BEFORE
   *  attempting to process a Luma link, so they can return an honest
   *  "try again later" instead of silently falling through to
   *  `processDiscoveredLink`'s generic enrichment-failure handling, which
   *  would otherwise surface as a cheerful "thanks, we'll review this" —
   *  true for most failures, but not for "we didn't even look." */
  get exhausted(): boolean {
    this.maybeResetWindow();
    return this.inner.exhausted;
  }

  async enrich(ref: EnrichRef): Promise<LumaEventPayload | null> {
    this.maybeResetWindow();
    return this.inner.enrich(ref);
  }

  async enrichResult(ref: EnrichRef): Promise<EnrichOutcome> {
    this.maybeResetWindow();
    return this.inner.enrichResult(ref);
  }
}

/** A `dedupe.ts#SlugResolver` backed by `limiter` (so slug resolution and
 *  enrichment share one clock/budget). Tri-state, see `SlugResolver`: only
 *  a confirmed `not_found` yields `null` (cacheable miss); `unavailable`
 *  (429/5xx/budget exhausted) yields `undefined` so the caller never
 *  caches a false negative. Returns the api id in Luma's original case —
 *  event api ids are CASE-SENSITIVE on `event/get`. */
export function makeSlugResolver(limiter: EnrichLimiter): (slug: string) => Promise<string | null | undefined> {
  return async (slug: string) => {
    const result = await limiter.enrichResult({ slug });
    if (result.status === 'ok') return result.payload.event?.api_id ?? result.payload.api_id ?? null;
    if (result.status === 'not_found') return null;
    return undefined;
  };
}
