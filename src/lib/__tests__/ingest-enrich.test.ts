import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../luma-server', () => ({
  fetchLumaEvent: vi.fn(async ({ slug }: { slug?: string; apiId?: string }) => ({ event: { api_id: `evt-${slug ?? 'x'}` } })),
  LumaFetchError: class LumaFetchError extends Error {},
}));

import { LumaEnrichmentLimiter, HourlyWindowLumaLimiter } from '../ingest/enrich';
import { fetchLumaEvent } from '../luma-server';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('LumaEnrichmentLimiter', () => {
  it('stops enriching once maxPerRun is reached', async () => {
    const limiter = new LumaEnrichmentLimiter(2, 0);
    expect(await limiter.enrich({ slug: 'a' })).not.toBeNull();
    expect(await limiter.enrich({ slug: 'b' })).not.toBeNull();
    expect(limiter.exhausted).toBe(true);
    expect(await limiter.enrich({ slug: 'c' })).toBeNull();
    expect(fetchLumaEvent).toHaveBeenCalledTimes(2);
  });
});

describe('HourlyWindowLumaLimiter (review finding, HIGH item 2 — shared across requests, resets hourly)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shares ONE budget across every .enrich() call, the way a module-level singleton would be reused across requests', async () => {
    const limiter = new HourlyWindowLumaLimiter(2, 0);
    expect(await limiter.enrich({ slug: 'a' })).not.toBeNull();
    expect(await limiter.enrich({ slug: 'b' })).not.toBeNull();
    // A third call within the SAME hour, simulating a third concurrent/
    // sequential request sharing this one instance, is refused — unlike
    // the old per-request `new LumaEnrichmentLimiter(...)`, where every
    // request got its own fresh budget of 2.
    expect(await limiter.enrich({ slug: 'c' })).toBeNull();
    expect(fetchLumaEvent).toHaveBeenCalledTimes(2);
  });

  it('resets its budget once a full hour has rolled over', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const limiter = new HourlyWindowLumaLimiter(1, 0);
    expect(await limiter.enrich({ slug: 'a' })).not.toBeNull();
    expect(await limiter.enrich({ slug: 'b' })).toBeNull(); // exhausted for this hour

    vi.setSystemTime(new Date('2026-01-01T01:00:01.000Z')); // just past the hour
    expect(await limiter.enrich({ slug: 'c' })).not.toBeNull(); // fresh budget
    expect(fetchLumaEvent).toHaveBeenCalledTimes(2);
  });

  it('does NOT reset before a full hour has passed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const limiter = new HourlyWindowLumaLimiter(1, 0);
    expect(await limiter.enrich({ slug: 'a' })).not.toBeNull();

    vi.setSystemTime(new Date('2026-01-01T00:59:00.000Z')); // still within the hour
    expect(await limiter.enrich({ slug: 'b' })).toBeNull();
  });
});
