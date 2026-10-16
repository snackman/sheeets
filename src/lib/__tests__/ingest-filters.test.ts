import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { dateWindowFilter, geoFilter, isPastEvent, ReverseGeocodeLimiter, upsertGeocodedAddress } from '../ingest/filters';

describe('dateWindowFilter', () => {
  const conference = { startDate: '2026-04-11', endDate: '2026-04-17' };
  const profile = { window_pre_days: 3, window_post_days: 1 };

  it('passes a date inside the conference window', () => {
    expect(dateWindowFilter({ dateISO: '2026-04-14' }, conference, profile)).toEqual({ pass: true });
  });

  it('passes a date exactly at the pre-window edge', () => {
    expect(dateWindowFilter({ dateISO: '2026-04-08' }, conference, profile).pass).toBe(true);
  });

  it('fails a date one day before the pre-window edge', () => {
    expect(dateWindowFilter({ dateISO: '2026-04-07' }, conference, profile).pass).toBe(false);
  });

  it('passes a date exactly at the post-window edge', () => {
    expect(dateWindowFilter({ dateISO: '2026-04-18' }, conference, profile).pass).toBe(true);
  });

  it('fails a date one day after the post-window edge', () => {
    expect(dateWindowFilter({ dateISO: '2026-04-19' }, conference, profile).pass).toBe(false);
  });
});

describe('geoFilter', () => {
  const center = { lat: 43.5528, lng: 7.0174 }; // Cannes
  const profile = { radius_km: 40, allow_online: false };

  it('passes an event at the center', () => {
    expect(geoFilter({ lat: center.lat, lng: center.lng, isOnline: false }, center, profile)).toEqual({ pass: true });
  });

  it('fails an event far outside the radius', () => {
    const result = geoFilter({ lat: 48.8566, lng: 2.3522, isOnline: false }, center, profile); // Paris
    expect(result.pass).toBe(false);
  });

  it('returns no_geo when lat/lng are missing', () => {
    expect(geoFilter({ lat: null, lng: null, isOnline: false }, center, profile)).toEqual({ pass: 'no_geo' });
  });

  it('rejects an online event when allow_online is false', () => {
    const result = geoFilter({ lat: null, lng: null, isOnline: true }, center, profile);
    expect(result.pass).toBe(false);
  });

  it('passes an online event when allow_online is true', () => {
    const result = geoFilter({ lat: null, lng: null, isOnline: true }, center, { ...profile, allow_online: true });
    expect(result.pass).toBe(true);
  });
});

// Bug: "addresses are always empty" — priority 3 of the address resolution
// order (`pipeline.ts`): when a candidate has coordinates but no usable
// address text, reverse-geocode a short label instead of leaving it blank.
describe('ReverseGeocodeLimiter', () => {
  const mapboxFeatures = (features: { place_type: string[]; text: string }[]) =>
    Promise.resolve(new Response(JSON.stringify({ features }), { status: 200 }));

  beforeEach(() => {
    // `vi.stubEnv` (not direct `process.env` mutation) so `vi.unstubAllEnvs()`
    // below reliably restores whatever was there before — including a real
    // `MAPBOX_SECRET_TOKEN`/`NEXT_PUBLIC_MAPBOX_TOKEN` from `.env.local` —
    // rather than leaving `.env.local`'s value deleted for the rest of the
    // run (env-leak bug fix: the "no token configured" test below used to
    // fail whenever `.env.local` was loaded, because it only cleared
    // `MAPBOX_SECRET_TOKEN` and never touched `NEXT_PUBLIC_MAPBOX_TOKEN`,
    // which `filters.ts` falls back to).
    vi.stubEnv('MAPBOX_SECRET_TOKEN', 'test-token');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('builds "Neighborhood, City" from a Mapbox response with both', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        mapboxFeatures([
          { place_type: ['neighborhood'], text: 'Thonglor' },
          { place_type: ['place'], text: 'Bangkok' },
        ])
      )
    );
    const limiter = new ReverseGeocodeLimiter();
    const result = await limiter.resolve(13.7563, 100.5018);
    expect(result).toEqual({ label: 'Thonglor, Bangkok', city: 'Bangkok' });
  });

  it('falls back to just the city when there is no neighborhood', async () => {
    vi.stubGlobal('fetch', vi.fn(() => mapboxFeatures([{ place_type: ['place'], text: 'Bangkok' }])));
    const limiter = new ReverseGeocodeLimiter();
    const result = await limiter.resolve(13.7563, 100.5018);
    expect(result).toEqual({ label: 'Bangkok', city: 'Bangkok' });
  });

  it('returns null and never calls fetch again for the same rounded coordinates (per-run cache)', async () => {
    const fetchMock = vi.fn(() => mapboxFeatures([{ place_type: ['place'], text: 'Bangkok' }]));
    vi.stubGlobal('fetch', fetchMock);
    const limiter = new ReverseGeocodeLimiter();
    await limiter.resolve(13.7563, 100.5018);
    await limiter.resolve(13.7563001, 100.5018001); // rounds to the same key
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stops making real calls once the per-run cap is hit', async () => {
    const fetchMock = vi.fn(() => mapboxFeatures([{ place_type: ['place'], text: 'Bangkok' }]));
    vi.stubGlobal('fetch', fetchMock);
    const limiter = new ReverseGeocodeLimiter(1);
    await limiter.resolve(13.7563, 100.5018);
    const second = await limiter.resolve(1.3521, 103.8198); // different point, cache miss
    expect(second).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns null without calling fetch when no Mapbox token is configured', async () => {
    // Stub BOTH env vars `filters.ts` checks (`MAPBOX_SECRET_TOKEN ||
    // NEXT_PUBLIC_MAPBOX_TOKEN`) to hermetically simulate "no token", even
    // when `.env.local` is loaded and provides a real one.
    vi.stubEnv('MAPBOX_SECRET_TOKEN', '');
    vi.stubEnv('NEXT_PUBLIC_MAPBOX_TOKEN', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const limiter = new ReverseGeocodeLimiter();
    expect(await limiter.resolve(13.7563, 100.5018)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null (never throws) when Mapbox errors', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('', { status: 500 }))));
    const limiter = new ReverseGeocodeLimiter();
    expect(await limiter.resolve(13.7563, 100.5018)).toBeNull();
  });
});

describe('upsertGeocodedAddress', () => {
  it('upserts the normalized address with the given coordinates', async () => {
    const upsertMock = vi.fn(async () => ({ error: null }));
    const supabase = { from: () => ({ upsert: upsertMock }) } as unknown as Parameters<typeof upsertGeocodedAddress>[0];
    await upsertGeocodedAddress(supabase, '123 Main St, Bangkok', 13.75, 100.5, 'Devcon 8');
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ lat: 13.75, lng: 100.5, matched_address: '123 Main St, Bangkok', conference: 'Devcon 8' })
    );
  });

  it('is a no-op for an empty address', async () => {
    const upsertMock = vi.fn(async () => ({ error: null }));
    const supabase = { from: () => ({ upsert: upsertMock }) } as unknown as Parameters<typeof upsertGeocodedAddress>[0];
    await upsertGeocodedAddress(supabase, '   ', 13.75, 100.5, 'Devcon 8');
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('swallows a write failure rather than throwing (best-effort cache)', async () => {
    const supabase = {
      from: () => ({
        upsert: () => {
          throw new Error('boom');
        },
      }),
    } as unknown as Parameters<typeof upsertGeocodedAddress>[0];
    await expect(upsertGeocodedAddress(supabase, '123 Main St', 13.75, 100.5, 'Devcon 8')).resolves.toBeUndefined();
  });
});

describe('isPastEvent', () => {
  it('is true for a startAt before now', () => {
    expect(isPastEvent({ startAt: '2020-01-01T00:00:00.000Z' })).toBe(true);
  });

  it('is false for a startAt in the future', () => {
    expect(isPastEvent({ startAt: '2099-01-01T00:00:00.000Z' })).toBe(false);
  });

  it('respects an injected `now`', () => {
    expect(isPastEvent({ startAt: '2026-06-01T00:00:00.000Z' }, new Date('2026-01-01T00:00:00.000Z'))).toBe(false);
  });
});
