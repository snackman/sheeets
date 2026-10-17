import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeAddress } from '../utils';

// Minimal fake standing in for the one query shape
// getRuntimeGeocodedAddresses() makes:
// `.from('geocoded_addresses').select('normalized_address, lat, lng, matched_address').range(from, to)`.
type Row = { normalized_address: string; lat: number; lng: number; matched_address: string | null };
let fakeRows: Row[] = [];
let fakeError: unknown = null;

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (_table: string) => ({
      select: (_cols: string) => ({
        range: async (from: number, to: number) => {
          if (fakeError) return { data: null, error: fakeError };
          return { data: fakeRows.slice(from, to + 1), error: null };
        },
      }),
    }),
  }),
}));

describe('getRuntimeGeocodedAddresses', () => {
  beforeEach(() => {
    fakeRows = [];
    fakeError = null;
    vi.resetModules();
  });

  it('builds a GeoAddressMap keyed by normalized_address, in the shape fetchEvents expects', async () => {
    fakeRows = [
      { normalized_address: '123 main st mumbai', lat: 19.076, lng: 72.8777, matched_address: '123 Main St, Mumbai, India' },
      { normalized_address: '456 side ave pune', lat: 18.5204, lng: 73.8567, matched_address: null },
    ];
    const { getRuntimeGeocodedAddresses } = await import('@/lib/geocoded-addresses');
    const map = await getRuntimeGeocodedAddresses();

    expect(map).toEqual({
      '123 main st mumbai': { lat: 19.076, lng: 72.8777, matchedAddress: '123 Main St, Mumbai, India' },
      '456 side ave pune': { lat: 18.5204, lng: 73.8567, matchedAddress: undefined },
    });
  });

  it('returns an empty map on a query error instead of throwing', async () => {
    fakeError = new Error('connection refused');
    const { getRuntimeGeocodedAddresses } = await import('@/lib/geocoded-addresses');
    const map = await getRuntimeGeocodedAddresses();
    expect(map).toEqual({});
  });

  it('returns an empty map when the table has no rows', async () => {
    fakeRows = [];
    const { getRuntimeGeocodedAddresses } = await import('@/lib/geocoded-addresses');
    const map = await getRuntimeGeocodedAddresses();
    expect(map).toEqual({});
  });

  it('paginates past PostgREST\'s 1000-row page size (review finding, LOW) instead of silently dropping rows', async () => {
    fakeRows = Array.from({ length: 1001 }, (_, i) => ({
      normalized_address: `address ${i}`,
      lat: i,
      lng: i,
      matched_address: null,
    }));
    const { getRuntimeGeocodedAddresses } = await import('@/lib/geocoded-addresses');
    const map = await getRuntimeGeocodedAddresses();

    expect(Object.keys(map)).toHaveLength(1001);
    expect(map['address 0']).toEqual({ lat: 0, lng: 0, matchedAddress: undefined });
    expect(map['address 1000']).toEqual({ lat: 1000, lng: 1000, matchedAddress: undefined });
  });
});

describe('writeGeocodedAddress', () => {
  function makeFakeSupabase(upsertResult: { error: unknown }) {
    const calls: unknown[] = [];
    const client = {
      from: (_table: string) => ({
        upsert: async (payload: unknown) => {
          calls.push(payload);
          return upsertResult;
        },
      }),
    } as unknown as SupabaseClient;
    return { client, calls };
  }

  it('upserts the normalized row and returns { ok: true } on success', async () => {
    const { client, calls } = makeFakeSupabase({ error: null });
    const { writeGeocodedAddress } = await import('@/lib/geocoded-addresses');

    const result = await writeGeocodedAddress(client, {
      address: '  123 Main St, Mumbai  ',
      lat: 19.076,
      lng: 72.8777,
      conference: 'Devcon 8',
      matchedAddress: '123 Main St, Mumbai, India',
    });

    expect(result).toEqual({ ok: true });
    expect(calls).toEqual([
      {
        normalized_address: normalizeAddress('123 Main St, Mumbai'),
        lat: 19.076,
        lng: 72.8777,
        matched_address: '123 Main St, Mumbai, India',
        conference: 'Devcon 8',
      },
    ]);
  });

  it('falls back to the trimmed address when no matchedAddress is given', async () => {
    const { client, calls } = makeFakeSupabase({ error: null });
    const { writeGeocodedAddress } = await import('@/lib/geocoded-addresses');

    await writeGeocodedAddress(client, { address: 'Some Venue', lat: 1, lng: 2, conference: 'Devcon 8' });

    expect((calls[0] as { matched_address: string }).matched_address).toBe('Some Venue');
  });

  it('returns { ok: false, error } and logs instead of swallowing a PostgREST error (review finding, HIGH)', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const pgError = { message: 'column "conference" of relation "geocoded_addresses" does not exist' };
    const { client } = makeFakeSupabase({ error: pgError });
    const { writeGeocodedAddress } = await import('@/lib/geocoded-addresses');

    const result = await writeGeocodedAddress(client, { address: 'Some Venue', lat: 1, lng: 2, conference: 'Devcon 8' });

    expect(result).toEqual({ ok: false, error: pgError.message });
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('returns { ok: false } for an empty/whitespace address without calling Supabase', async () => {
    const { client, calls } = makeFakeSupabase({ error: null });
    const { writeGeocodedAddress } = await import('@/lib/geocoded-addresses');

    const result = await writeGeocodedAddress(client, { address: '   ', lat: 1, lng: 2, conference: 'Devcon 8' });

    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
