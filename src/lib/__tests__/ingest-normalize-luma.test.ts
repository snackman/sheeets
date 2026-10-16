import { describe, it, expect } from 'vitest';
import { normalizeLumaEvent, looksLikeRealAddress, addressFromLumaGeoFields, resolveLumaOrganizer, isGenericAggregatorCalendarName } from '../ingest/normalize';
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
    organizerName: null,
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

// Bug: "Organizer column shows the source calendar name" — a published
// row's Organizer used to fall back unconditionally to the calendar's
// `name` (which, before the pipeline.ts fix, was actually the internal
// `ingest_sources.label`, e.g. "Luma: Devcon 8 Side Events (official)"),
// whenever a Luma event had no hosts. Priority order: hosts (joined) ->
// iCal ORGANIZER CN -> calendar public name (if not generic) -> ''.
describe('isGenericAggregatorCalendarName', () => {
  it('flags community/side "Events" aggregator calendar names', () => {
    expect(isGenericAggregatorCalendarName('Breakpoint 2026 Community Events')).toBe(true);
    expect(isGenericAggregatorCalendarName('Devcon 8 Side Events (official)')).toBe(true);
  });

  it('does not flag a specific organizer-looking calendar name', () => {
    expect(isGenericAggregatorCalendarName('ETHDenver Official Afterparty')).toBe(false);
    expect(isGenericAggregatorCalendarName('Superteam')).toBe(false);
  });

  it('treats empty/missing as generic (nothing useful to show)', () => {
    expect(isGenericAggregatorCalendarName('')).toBe(true);
    expect(isGenericAggregatorCalendarName(null)).toBe(true);
    expect(isGenericAggregatorCalendarName(undefined)).toBe(true);
  });
});

describe('resolveLumaOrganizer (priority: hosts -> ORGANIZER CN -> calendar name -> empty)', () => {
  it('prefers hosts, joined, over everything else', () => {
    expect(
      resolveLumaOrganizer({
        hosts: [{ name: 'Alice' }, { name: 'Bob' }],
        organizerCN: 'Devcon Core Team',
        calendarName: 'ETHDenver',
      })
    ).toBe('Alice, Bob');
  });

  it('falls back to the iCal ORGANIZER CN when there are no hosts', () => {
    expect(resolveLumaOrganizer({ hosts: [], organizerCN: 'Devcon Core Team', calendarName: 'ETHDenver' })).toBe('Devcon Core Team');
  });

  it('falls back to the calendar\'s public name when there are no hosts/CN and the name is not a generic aggregator', () => {
    expect(resolveLumaOrganizer({ hosts: [], organizerCN: null, calendarName: 'ETHDenver' })).toBe('ETHDenver');
  });

  it('never uses a generic aggregator calendar name — falls through to empty', () => {
    expect(resolveLumaOrganizer({ hosts: [], organizerCN: null, calendarName: 'Breakpoint 2026 Community Events' })).toBe('');
    expect(resolveLumaOrganizer({ hosts: [], organizerCN: null, calendarName: 'Devcon 8 Side Events (official)' })).toBe('');
  });

  it('is empty when nothing is available', () => {
    expect(resolveLumaOrganizer({ hosts: [] })).toBe('');
  });
});

describe('normalizeLumaEvent: organizer priority (Bug: "Organizer column shows the source calendar name")', () => {
  const noHostsVevent: VEvent = {
    uid: 'evt-NOHOST0001@events.lu.ma',
    summary: 'Side Mixer',
    description: '',
    dtstart: '2026-11-10T18:00:00.000Z',
    dtstartIsDateOnly: false,
    dtend: null,
    location: null,
    geo: null,
    sequence: 0,
    status: 'CONFIRMED',
    dtstamp: '2026-11-01T00:00:00.000Z',
    organizerName: null,
  };

  it('uses the Luma hosts, joined, when the enrichment payload has any', () => {
    const enrichment = { hosts: [{ api_id: 'usr-1', name: 'Alice' }, { api_id: 'usr-2', name: 'Bob' }] } as unknown as LumaEventPayload;
    const result = normalizeLumaEvent({
      vevent: noHostsVevent,
      timezone: 'UTC',
      enrichment,
      calendar: { apiId: 'cal-1', name: 'Luma: Devcon 8 Side Events (official)' },
    });
    expect(result.organizer).toBe('Alice, Bob');
  });

  it('falls back to the iCal ORGANIZER CN when the event has no hosts (no enrichment)', () => {
    const vevent: VEvent = { ...noHostsVevent, organizerName: 'Devcon Core Team' };
    const result = normalizeLumaEvent({
      vevent,
      timezone: 'UTC',
      enrichment: null,
      calendar: { apiId: 'cal-1', name: 'Luma: Devcon 8 Side Events (official)' },
    });
    expect(result.organizer).toBe('Devcon Core Team');
  });

  it('never falls back to the ingest_sources-style internal label — a generic aggregator calendar name produces an empty organizer', () => {
    const result = normalizeLumaEvent({
      vevent: noHostsVevent,
      timezone: 'UTC',
      enrichment: null,
      calendar: { apiId: 'cal-1', name: 'Luma: Devcon 8 Side Events (official)' },
    });
    expect(result.organizer).toBe('');
  });

  it('uses the calendar public name when it is NOT a generic aggregator', () => {
    const result = normalizeLumaEvent({
      vevent: noHostsVevent,
      timezone: 'UTC',
      enrichment: null,
      calendar: { apiId: 'cal-1', name: 'ETHDenver' },
    });
    expect(result.organizer).toBe('ETHDenver');
  });
});
