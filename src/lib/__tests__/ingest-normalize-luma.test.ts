import { describe, it, expect } from 'vitest';
import { normalizeLumaEvent, looksLikeRealAddress, addressFromLumaGeoFields } from '../ingest/normalize';
import type { VEvent } from '../ingest/ical';
import type { LumaEventPayload } from '../luma';

// Bug: "addresses are always empty" — `normalizeLumaEvent` must apply the
// address resolution order's priorities 1/2 (priorities 3/4, the Mapbox
// reverse-geocode and conference-city fallbacks, happen one level up in
// `pipeline.ts`, which has the run's Mapbox client/cache/conference
// context this pure function doesn't).
describe('normalizeLumaEvent: address resolution (priorities 1/2)', () => {
  const baseVevent: VEvent = {
    uid: 'evt-ABC123@events.lu.ma',
    summary: 'Devcon Builders Mixer',
    description: 'Get up-to-date information at: https://luma.com/devcon-mixer\n\nHosted by Alice',
    dtstart: '2026-11-10T18:00:00.000Z',
    dtstartIsDateOnly: false,
    dtend: '2026-11-10T21:00:00.000Z',
    location: 'https://luma.com/event/evt-ABC123',
    geo: { lat: 13.7563, lng: 100.5018 },
    sequence: 0,
    status: 'CONFIRMED',
    dtstamp: '2026-11-01T00:00:00.000Z',
  };

  it('priority 1: uses the enriched Luma address when the enrichment payload has one', () => {
    const enrichment = {
      event: {
        api_id: 'evt-ABC123',
        name: 'Devcon Builders Mixer',
        geo_address_info: { full_address: '123 Sukhumvit Rd, Bangkok, Thailand' },
      },
      hosts: [],
    } as unknown as LumaEventPayload;

    const result = normalizeLumaEvent({ vevent: baseVevent, timezone: 'Asia/Bangkok', enrichment });
    expect(result.address).toBe('123 Sukhumvit Rd, Bangkok, Thailand');
  });

  it('priority 2: falls back to the iCal LOCATION field when it looks like a real address and there is no enrichment', () => {
    const vevent: VEvent = { ...baseVevent, location: 'True Icon Hall, Bangkok' };
    const result = normalizeLumaEvent({ vevent, timezone: 'Asia/Bangkok', enrichment: null });
    expect(result.address).toBe('True Icon Hall, Bangkok');
  });

  it('priority 2 is skipped when LOCATION is a bare URL (Luma often puts the event link there, not a venue)', () => {
    const vevent: VEvent = { ...baseVevent, location: 'https://luma.com/event/evt-ABC123' };
    const result = normalizeLumaEvent({ vevent, timezone: 'Asia/Bangkok', enrichment: null });
    expect(result.address).toBe('');
  });

  it('priority 2 is skipped when LOCATION is empty', () => {
    const vevent: VEvent = { ...baseVevent, location: null };
    const result = normalizeLumaEvent({ vevent, timezone: 'Asia/Bangkok', enrichment: null });
    expect(result.address).toBe('');
  });

  it('is empty (no address AND no usable LOCATION) when neither priority resolves — left for pipeline.ts to fill via geocoding/city fallback', () => {
    const enrichment = { event: { api_id: 'evt-ABC123', name: 'Devcon Builders Mixer' }, hosts: [] } as unknown as LumaEventPayload;
    const vevent: VEvent = { ...baseVevent, location: 'https://luma.com/event/evt-ABC123' };
    const result = normalizeLumaEvent({ vevent, timezone: 'Asia/Bangkok', enrichment });
    expect(result.address).toBe('');
    // Still carries the iCal GEO — that's what pipeline.ts's reverse-geocode
    // fallback (priority 3) keys off of.
    expect(result.lat).toBe(13.7563);
    expect(result.lng).toBe(100.5018);
  });

  it('prefers the enriched address over a usable iCal LOCATION (priority 1 beats priority 2)', () => {
    const enrichment = {
      event: { api_id: 'evt-ABC123', name: 'Devcon Builders Mixer', geo_address_info: { city: 'Bangkok' } },
      hosts: [],
    } as unknown as LumaEventPayload;
    const vevent: VEvent = { ...baseVevent, location: 'Some Other Venue Text' };
    const result = normalizeLumaEvent({ vevent, timezone: 'Asia/Bangkok', enrichment });
    expect(result.address).toBe('Bangkok');
  });
});

describe('looksLikeRealAddress', () => {
  it('rejects empty/null/undefined', () => {
    expect(looksLikeRealAddress('')).toBe(false);
    expect(looksLikeRealAddress('   ')).toBe(false);
    expect(looksLikeRealAddress(null)).toBe(false);
    expect(looksLikeRealAddress(undefined)).toBe(false);
  });

  it('rejects bare URLs', () => {
    expect(looksLikeRealAddress('https://luma.com/event/evt-ABC123')).toBe(false);
    expect(looksLikeRealAddress('http://example.com')).toBe(false);
  });

  it('accepts real-looking venue/address text', () => {
    expect(looksLikeRealAddress('123 Sukhumvit Rd, Bangkok, Thailand')).toBe(true);
    expect(looksLikeRealAddress('True Icon Hall')).toBe(true);
  });
});

describe('addressFromLumaGeoFields', () => {
  it('prefers geo_address_json.full_address', () => {
    expect(addressFromLumaGeoFields({ geo_address_json: { full_address: '1 Main St' } })).toBe('1 Main St');
  });

  it('falls back to geo_address_info.city_state/city when geo_address_json is absent', () => {
    expect(addressFromLumaGeoFields({ geo_address_info: { city_state: 'Bangkok, Thailand' } })).toBe('Bangkok, Thailand');
    expect(addressFromLumaGeoFields({ geo_address_info: { city: 'Bangkok' } })).toBe('Bangkok');
  });

  it('returns empty string when neither field is present', () => {
    expect(addressFromLumaGeoFields({})).toBe('');
  });
});
