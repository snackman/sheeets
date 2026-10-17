import { describe, it, expect, vi, beforeEach } from 'vitest';

// Minimal fake standing in for the one query shape
// getRuntimeGeocodedAddresses() makes:
// `.from('geocoded_addresses').select('normalized_address, lat, lng, matched_address')`.
let fakeRows: Array<{ normalized_address: string; lat: number; lng: number; matched_address: string | null }> = [];
let fakeError: unknown = null;

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (_table: string) => ({
      select: async (_cols: string) => ({ data: fakeRows, error: fakeError }),
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
});
