import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { LumaFetchErrorMock } = vi.hoisted(() => ({
  LumaFetchErrorMock: class LumaFetchError extends Error {
    constructor(
      message: string,
      public readonly code: 'not_found' | 'invalid' | 'upstream' = 'upstream'
    ) {
      super(message);
      this.name = 'LumaFetchError';
    }
  },
}));

vi.mock('../luma-server', () => ({
  fetchLumaEvent: vi.fn(async ({ slug }: { slug?: string; apiId?: string }) => ({ event: { api_id: `evt-${slug ?? 'x'}` } })),
  LumaFetchError: LumaFetchErrorMock,
}));

import { LumaEnrichmentLimiter, HourlyWindowLumaLimiter } from '../ingest/enrich';
import { fetchLumaEvent } from '../luma-server';

beforeEach(() => {
  vi.clearAllMocks();
});

// Review finding, HIGH ("exhausting the Luma limiter poisons
// ingest_link_cache"): `enrichResult` must let a caller tell a CONFIRMED
// Luma "not found" apart from "we genuinely don't know" (exhausted budget
// or a transient error) — only the former is safe to cache as a negative.
describe('LumaEnrichmentLimiter#enrichResult', () => {
  it('returns {status: "ok", payload} on a successful lookup', async () => {
    const limiter = new LumaEnrichmentLimiter(5, 0);
    const result = await limiter.enrichResult({ slug: 'a' });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.payload).toEqual({ event: { api_id: 'evt-a' } });
  });

  it('returns {status: "not_found"} ONLY for a confirmed Luma 404 (LumaFetchError code "not_found")', async () => {
    (fetchLumaEvent as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new LumaFetchErrorMock('gone', 'not_found'));
    const limiter = new LumaEnrichmentLimiter(5, 0);
    expect(await limiter.enrichResult({ slug: 'a' })).toEqual({ status: 'not_found' });
  });

  it('returns {status: "unavailable"} (never "not_found") for a transient/invalid LumaFetchError', async () => {
    (fetchLumaEvent as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new LumaFetchErrorMock('network blip', 'upstream'));
    const limiter = new LumaEnrichmentLimiter(5, 0);
    expect(await limiter.enrichResult({ slug: 'a' })).toEqual({ status: 'unavailable' });
  });

  it('returns {status: "unavailable"} once the limiter is exhausted, WITHOUT calling fetchLumaEvent at all', async () => {
    const limiter = new LumaEnrichmentLimiter(0, 0);
    expect(limiter.exhausted).toBe(true);
    expect(await limiter.enrichResult({ slug: 'a' })).toEqual({ status: 'unavailable' });
    expect(fetchLumaEvent).not.toHaveBeenCalled();
  });

  it('enrich() collapses both "not_found" and "unavailable" to null, same as before', async () => {
    (fetchLumaEvent as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new LumaFetchErrorMock('gone', 'not_found'));
    const limiter = new LumaEnrichmentLimiter(5, 0);
    expect(await limiter.enrich({ slug: 'a' })).toBeNull();
  });
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
