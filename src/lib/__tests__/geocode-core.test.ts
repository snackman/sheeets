import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  distanceKm,
  isNearCenter,
  isSaneForConference,
  cityBbox,
  cleanAddressForGeocoding,
  geocodeNearCenter,
} from '../geocode-core';

const MUMBAI = { lat: 19.076, lng: 72.8777 };
const PUNE = { lat: 18.5204, lng: 73.8567 };
const FORT_WORTH = { lat: 32.7555, lng: -97.3308 };

interface FeatureOpts {
  place_type?: string[];
  text?: string;
  context?: { id: string; text: string }[];
}

function feature(lat: number, lng: number, place_name: string, extra: FeatureOpts = {}) {
  return {
    features: [
      {
        center: [lng, lat],
        geometry: { coordinates: [lng, lat] },
        place_name,
        place_type: ['address'],
        ...extra,
      },
    ],
  };
}

function mockFetch(responses: (unknown | { notOk: true })[]) {
  return vi.fn(async (_url: string) => {
    const body = responses.shift() ?? { features: [] };
    if (body && typeof body === 'object' && 'notOk' in body) {
      return { ok: false, json: async () => ({}) };
    }
    return { ok: true, json: async () => body };
  });
}

describe('distance check', () => {
  it('computes haversine distance', () => {
    expect(distanceKm(MUMBAI, MUMBAI)).toBe(0);
    // Mumbai -> Fort Worth is ~13,500 km
    expect(distanceKm(MUMBAI, FORT_WORTH)).toBeGreaterThan(12000);
  });

  it('accepts points within 50 km and rejects farther ones at geocode time', () => {
    expect(isNearCenter({ lat: 19.1, lng: 72.9 }, MUMBAI)).toBe(true);
    expect(isNearCenter(PUNE, MUMBAI)).toBe(false); // ~120 km
    expect(isNearCenter(FORT_WORTH, MUMBAI)).toBe(false);
    expect(isNearCenter({ lat: NaN, lng: 0 }, MUMBAI)).toBe(false);
  });

  it('uses a looser 300 km radius at read time: keeps Pune, drops Fort Worth', () => {
    expect(isSaneForConference(PUNE, MUMBAI)).toBe(true);
    expect(isSaneForConference(FORT_WORTH, MUMBAI)).toBe(false);
  });
});

describe('cityBbox', () => {
  it('is a ~0.5 degree box around the center, widened in longitude by 1/cos(lat)', () => {
    const [minLng, minLat, maxLng, maxLat] = cityBbox(MUMBAI);
    expect(minLat).toBeCloseTo(18.576, 3);
    expect(maxLat).toBeCloseTo(19.576, 3);
    expect(minLng).toBeCloseTo(72.3487, 2);
    expect(maxLng).toBeCloseTo(73.4067, 2);
  });
});

describe('cleanAddressForGeocoding', () => {
  it('skips URLs', () => {
    expect(cleanAddressForGeocoding('https://game.tradingbattles.com/join/302')).toBeNull();
    expect(cleanAddressForGeocoding('http://example.com')).toBeNull();
    expect(cleanAddressForGeocoding('www.example.com/x')).toBeNull();
  });

  it('strips placeholder phrases, with or without parentheses', () => {
    expect(cleanAddressForGeocoding('Mumbai (venue on event page)')).toBe('Mumbai');
    expect(cleanAddressForGeocoding('Jio World Centre (TBA)')).toBe('Jio World Centre');
    expect(cleanAddressForGeocoding('Mumbai - venue on event page')).toBe('Mumbai');
  });

  it('treats whole-placeholder text as no address', () => {
    for (const p of [
      'TBA',
      'TBD',
      'RSVP to see exact location',
      'Exact location shared after RSVP',
      'Location revealed to guests',
      'Secret location',
      'Venue on event page',
      '   ',
    ]) {
      expect(cleanAddressForGeocoding(p)).toBeNull();
    }
  });

  it('keeps real addresses and bare cities', () => {
    expect(cleanAddressForGeocoding('Mumbai, India')).toBe('Mumbai, India');
    expect(cleanAddressForGeocoding('London, UK')).toBe('London, UK');
    expect(cleanAddressForGeocoding('Somerset House Strand, London WC2R 1LA, UK')).toBe(
      'Somerset House Strand, London WC2R 1LA, UK'
    );
  });
});

describe('geocodeNearCenter', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  const opts = (fetchImpl: ReturnType<typeof mockFetch>, center = MUMBAI, city = 'Mumbai') => ({
    token: 't',
    center,
    city,
    fetchImpl,
  });

  it('returns an in-range first result without retrying', async () => {
    const f = mockFetch([feature(19.06, 72.86, 'Jio World Centre, Mumbai')]);
    const hit = await geocodeNearCenter('Jio World Centre', opts(f));
    expect(hit).toMatchObject({ lat: 19.06, lng: 72.86 });
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][0]).toContain('proximity=72.8777,19.076');
    expect(f.mock.calls[0][0]).not.toContain('bbox=');
  });

  it('retries once with the city appended and the bbox when the first result is too far', async () => {
    const f = mockFetch([
      feature(32.75, -97.33, 'World Way, Fort Worth, Texas', {
        context: [{ id: 'place.1', text: 'Fort Worth' }],
      }),
      feature(19.06, 72.86, 'Jio World Centre, Mumbai'),
    ]);
    const hit = await geocodeNearCenter('Jio World Centre', opts(f));
    expect(hit?.matchedAddress).toBe('Jio World Centre, Mumbai');
    expect(f).toHaveBeenCalledTimes(2);
    const retryUrl = f.mock.calls[1][0];
    expect(decodeURIComponent(retryUrl)).toContain('/Jio World Centre, Mumbai.json');
    const bbox = /bbox=([^&]+)/.exec(retryUrl)![1].split(',').map(Number);
    expect(bbox[0]).toBeCloseTo(72.3487, 2);
    expect(bbox[1]).toBeCloseTo(18.576, 3);
    expect(bbox[2]).toBeCloseTo(73.4067, 2);
    expect(bbox[3]).toBeCloseTo(19.576, 3);
  });

  it('returns null (no pin) when the retry is still too far', async () => {
    const f = mockFetch([
      feature(32.75, -97.33, 'World Way, Fort Worth, Texas'),
      feature(32.76, -97.34, 'Another Fort Worth place'),
    ]);
    expect(await geocodeNearCenter('Jio World Centre', opts(f))).toBeNull();
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('still does a bbox retry when the address already contains the city, without appending it again', async () => {
    const f = mockFetch([
      feature(32.8, -96.8, 'Londonderry Lane, Dallas, Texas', {
        context: [{ id: 'place.2', text: 'Dallas' }],
      }),
      feature(51.5, -0.15, 'The Peninsula London, Belgravia'),
    ]);
    const hit = await geocodeNearCenter('The Peninsula London', opts(f, { lat: 51.5074, lng: -0.1278 }, 'London'));
    expect(hit?.matchedAddress).toBe('The Peninsula London, Belgravia');
    expect(f).toHaveBeenCalledTimes(2);
    const retryUrl = f.mock.calls[1][0];
    expect(retryUrl).toContain('bbox=');
    expect(decodeURIComponent(retryUrl)).toContain('/The Peninsula London.json');
  });

  it('accepts a far result when it names a city that the address itself names (Pune side event)', async () => {
    const f = mockFetch([
      feature(18.5314, 73.8446, 'Pavillion Mall, Shivajinagar, Pune, Maharashtra 411016, India', {
        context: [
          { id: 'locality.1', text: 'Shivajinagar' },
          { id: 'place.3', text: 'Pune' },
        ],
      }),
    ]);
    const hit = await geocodeNearCenter(
      'Redbrick Offices - Pavillion Mall, Shivajinagar, Pune, Maharashtra 411016, India',
      opts(f)
    );
    expect(hit).toMatchObject({ lat: 18.5314, lng: 73.8446 });
    expect(f).toHaveBeenCalledTimes(1); // no ", Mumbai" retry
  });

  it('rejects a retry that only finds an area-level (place) feature', async () => {
    const f = mockFetch([
      feature(32.75, -97.33, 'World Way, Fort Worth, Texas'),
      feature(19.076, 72.8777, 'Mumbai, Maharashtra, India', { place_type: ['place'], text: 'Mumbai' }),
    ]);
    expect(await geocodeNearCenter('Some Unknown Venue', opts(f))).toBeNull();
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('returns null when the provider responds non-ok', async () => {
    const f = mockFetch([{ notOk: true }, { notOk: true }]);
    expect(await geocodeNearCenter('Jio World Centre', opts(f))).toBeNull();
  });

  it('never calls the provider for URLs or placeholders', async () => {
    const f = mockFetch([]);
    expect(await geocodeNearCenter('https://game.tradingbattles.com/join/302', opts(f))).toBeNull();
    expect(await geocodeNearCenter('TBA', opts(f))).toBeNull();
    expect(await geocodeNearCenter('RSVP to see exact location', opts(f))).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it('gives no pin for a bare city left over after stripping a placeholder', async () => {
    const f = mockFetch([feature(19.0759, 72.8776, 'Mumbai, Maharashtra, India', { place_type: ['place'] })]);
    expect(await geocodeNearCenter('Mumbai (venue on event page)', opts(f))).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it('still resolves a row that is just a city to the city center', async () => {
    const f = mockFetch([feature(51.5074, -0.1278, 'London, England, United Kingdom', { place_type: ['place'] })]);
    const hit = await geocodeNearCenter('London, UK', opts(f, { lat: 51.5074, lng: -0.1278 }, 'London'));
    expect(hit).toMatchObject({ lat: 51.5074, lng: -0.1278 });
  });
});
