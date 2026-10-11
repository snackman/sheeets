// Rate-limited Luma enrichment (§3.1 policy: 1 req/s, capped per run,
// identifying User-Agent, only for new/changed curated-feed events or single
// links discovered elsewhere). Wraps the existing `fetchLumaEvent`.
import { fetchLumaEvent, LumaFetchError } from '../luma-server';
import type { LumaEventPayload } from '../luma';

export interface EnrichRef {
  slug?: string;
  apiId?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class LumaEnrichmentLimiter {
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
