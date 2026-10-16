import { describe, it, expect } from 'vitest';
import { normalizeDiscoveredLumaEvent, normalizeExtractedEvent } from '../ingest/normalize';
import type { LumaEventPayload } from '../luma';
import type { EventResult } from '../event-extractors';

describe('normalizeDiscoveredLumaEvent (Phase 3 §3.2 — discovered Luma links)', () => {
  const basePayload = {
    api_id: 'evt-ABC123',
    event: {
      api_id: 'evt-ABC123',
      name: 'ETHCC Builders Mixer',
      start_at: '2026-03-10T18:00:00.000Z',
      end_at: '2026-03-10T21:00:00.000Z',
      timezone: 'Europe/Paris',
      ticket_price_cents: 0,
    },
    hosts: [{ api_id: 'usr-1', name: 'Alice', username: 'alice', twitter_handle: '@alicextw' }],
    description_mirror: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Come hang out' }] }] },
  } as unknown as LumaEventPayload;

  it('builds a NormalizedEvent from a full Luma event payload', () => {
    const result = normalizeDiscoveredLumaEvent({ payload: basePayload, fallbackLink: 'https://lu.ma/ethcc-mixer' });
    expect(result).not.toBeNull();
    expect(result!.name).toBe('ETHCC Builders Mixer');
    expect(result!.link).toBe('https://luma.com/event/evt-ABC123');
    expect(result!.cost).toBe('Free');
    expect(result!.hosts).toEqual([{ apiId: 'usr-1', name: 'Alice', username: 'alice', twitter: 'alicextw' }]);
    expect(result!.organizer).toBe('Alice');
    expect(result!.descriptionText).toContain('Come hang out');
    expect(result!.platform).toBe('luma');
    // No iCal GEO is ever available for a discovered link.
    expect(result!.lat).toBeNull();
    expect(result!.lng).toBeNull();
    expect(result!.isOnline).toBe(false);
  });

  it('falls back to the discovered link when the payload has no stable api id', () => {
    const payload = { ...basePayload, api_id: undefined, event: { ...basePayload.event, api_id: undefined } } as unknown as LumaEventPayload;
    const result = normalizeDiscoveredLumaEvent({ payload, fallbackLink: 'https://lu.ma/ethcc-mixer' });
    expect(result!.link).toBe('https://lu.ma/ethcc-mixer');
  });

  it('returns null when the payload has no name', () => {
    const payload = { ...basePayload, event: { ...basePayload.event, name: '' } } as unknown as LumaEventPayload;
    expect(normalizeDiscoveredLumaEvent({ payload, fallbackLink: 'https://lu.ma/x' })).toBeNull();
  });

  it('returns null when the payload has no start_at', () => {
    const payload = { ...basePayload, event: { ...basePayload.event, start_at: undefined } } as unknown as LumaEventPayload;
    expect(normalizeDiscoveredLumaEvent({ payload, fallbackLink: 'https://lu.ma/x' })).toBeNull();
  });

  it('extracts an address from geo_address_info when present', () => {
    const payload = {
      ...basePayload,
      event: { ...basePayload.event, geo_address_info: { full_address: '123 Rue de Paris, Paris, France' } },
    } as unknown as LumaEventPayload;
    const result = normalizeDiscoveredLumaEvent({ payload, fallbackLink: 'https://lu.ma/x' });
    expect(result!.address).toBe('123 Rue de Paris, Paris, France');
  });
});

describe('normalizeExtractedEvent (Phase 3 §3.2 — Partiful/Eventbrite/Meetup/Posh discovered links)', () => {
  const result: EventResult = {
    name: 'Side Event Mixer',
    dateISO: '2026-03-11',
    startTime24: '19:00',
    endTime24: '21:00',
    address: '456 Side St',
    organizer: 'Side Collective',
    cost: '$10',
    link: 'https://partiful.com/e/abc123',
    tags: '',
  };

  it('builds a NormalizedEvent with 12h times from the extractor output', () => {
    const normalized = normalizeExtractedEvent({ platform: 'partiful', result });
    expect(normalized).not.toBeNull();
    expect(normalized!.name).toBe('Side Event Mixer');
    expect(normalized!.dateISO).toBe('2026-03-11');
    expect(normalized!.startTime).toBe('7:00p');
    expect(normalized!.endTime).toBe('9:00p');
    expect(normalized!.address).toBe('456 Side St');
    expect(normalized!.organizer).toBe('Side Collective');
    expect(normalized!.cost).toBe('$10');
    expect(normalized!.link).toBe('https://partiful.com/e/abc123');
    expect(normalized!.platform).toBe('partiful');
    expect(normalized!.hosts).toEqual([]);
  });

  it('returns null when the extractor found no name', () => {
    expect(normalizeExtractedEvent({ platform: 'eventbrite', result: { ...result, name: '' } })).toBeNull();
  });

  it('returns null when the extractor found no date', () => {
    expect(normalizeExtractedEvent({ platform: 'eventbrite', result: { ...result, dateISO: '' } })).toBeNull();
  });

  it('handles a missing end time gracefully', () => {
    const normalized = normalizeExtractedEvent({ platform: 'meetup', result: { ...result, endTime24: '' } });
    expect(normalized!.endTime).toBe('');
    expect(normalized!.endAt).toBeNull();
  });
});
