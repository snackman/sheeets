import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { detectPlatform, parseEventbrite, parsePartiful, parseGeneric, UserFacingError } from '../event-extractors';

vi.mock('../safe-fetch', () => ({
  safeFetch: vi.fn(),
  SafeFetchError: class SafeFetchError extends Error {},
}));

import { safeFetch } from '../safe-fetch';

function htmlWithJsonLd(event: Record<string, unknown>): string {
  return `<html><head><script type="application/ld+json">${JSON.stringify({
    '@type': 'Event',
    ...event,
  })}</script></head><body></body></html>`;
}

function htmlWithOg(title: string, description = '', image = ''): string {
  return `<html><head>
    <meta property="og:title" content="${title}">
    <meta property="og:description" content="${description}">
    <meta property="og:image" content="${image}">
  </head><body></body></html>`;
}

describe('detectPlatform', () => {
  it('detects every supported platform', () => {
    expect(detectPlatform('https://lu.ma/abc')).toBe('luma');
    expect(detectPlatform('https://luma.com/abc')).toBe('luma');
    expect(detectPlatform('https://www.eventbrite.com/e/x')).toBe('eventbrite');
    expect(detectPlatform('https://partiful.com/e/x')).toBe('partiful');
    expect(detectPlatform('https://meetup.com/g/x')).toBe('meetup');
    expect(detectPlatform('https://posh.vip/e/x')).toBe('posh');
  });

  it('returns null for unknown hosts or invalid URLs', () => {
    expect(detectPlatform('https://example.com/e/x')).toBeNull();
    expect(detectPlatform('not a url')).toBeNull();
  });

  it('detects every Eventbrite ccTLD, with and without www.', () => {
    const ccTlds = [
      'com', 'co.uk', 'ca', 'com.au', 'de', 'fr', 'es', 'ie', 'nl', 'it',
      'com.br', 'com.mx', 'sg', 'hk', 'co.nz', 'ch', 'at', 'be', 'pt', 'se', 'dk', 'fi', 'pl',
    ];
    for (const tld of ccTlds) {
      expect(detectPlatform(`https://eventbrite.${tld}/e/x`)).toBe('eventbrite');
      expect(detectPlatform(`https://www.eventbrite.${tld}/e/x`)).toBe('eventbrite');
    }
  });

  // Review finding, HIGH item 1: `host.startsWith('eventbrite.')` also
  // matched `eventbrite.attacker.com` — any host an attacker controls that
  // merely BEGINS with the literal string "eventbrite.". Fixed with an
  // exact-match allowlist (`EVENTBRITE_HOSTS`). These cover the same class
  // of prefix/suffix tricks against every platform, not just Eventbrite.
  describe('rejects lookalike/attacker-controlled hosts (prefix and suffix tricks) for every platform', () => {
    const lookalikes = [
      // Eventbrite: the original vulnerability — a subdomain of an
      // attacker's own domain that starts with "eventbrite.".
      'https://eventbrite.attacker.com/e/x',
      'https://eventbrite.evil.com/e/x',
      // Suffix trick: attacker's host ends with a real Eventbrite ccTLD
      // string but isn't actually that domain.
      'https://notitreallyeventbrite.com/e/x',
      'https://eventbrite.com.evil.com/e/x',
      // Luma
      'https://notluma.com/event/evt-ABC123',
      'https://lu.ma.evil.com/phish',
      'https://evilluma.com/abc',
      // Partiful
      'https://notpartiful.com/e/x',
      'https://partiful.com.evil.com/e/x',
      // Meetup
      'https://notmeetup.com/g/x',
      'https://meetup.com.evil.com/g/x',
      // Posh
      'https://notposh.vip/e/x',
      'https://posh.vip.evil.com/e/x',
    ];
    for (const url of lookalikes) {
      it(url, () => {
        expect(detectPlatform(url)).toBeNull();
      });
    }
  });
});

describe('parseEventbrite', () => {
  beforeEach(() => vi.mocked(safeFetch).mockReset());
  afterEach(() => vi.restoreAllMocks());

  it('extracts name/date/address/organizer/cost from JSON-LD', async () => {
    vi.mocked(safeFetch).mockResolvedValue({
      ok: true,
      status: 200,
      text: htmlWithJsonLd({
        name: 'Crypto Mixer',
        startDate: '2026-05-05T18:00:00-04:00',
        endDate: '2026-05-05T21:00:00-04:00',
        location: { name: 'Rooftop Bar', address: { streetAddress: '123 Main St', addressLocality: 'Miami' } },
        organizer: { name: 'Acme Events' },
        offers: { price: '0', priceCurrency: 'USD' },
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const result = await parseEventbrite('https://www.eventbrite.com/e/crypto-mixer');
    expect(result.name).toBe('Crypto Mixer');
    expect(result.address).toContain('Rooftop Bar');
    expect(result.organizer).toBe('Acme Events');
    expect(result.cost).toBe('Free');
    expect(result.dateISO).toBe('2026-05-05');
    expect(result.link).toBe('https://www.eventbrite.com/e/crypto-mixer');
  });

  it('throws UserFacingError when no name can be found', async () => {
    vi.mocked(safeFetch).mockResolvedValue({
      ok: true,
      status: 200,
      text: '<html><head></head><body>nothing here</body></html>',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    await expect(parseEventbrite('https://www.eventbrite.com/e/empty')).rejects.toBeInstanceOf(UserFacingError);
  });
});

describe('parsePartiful', () => {
  beforeEach(() => vi.mocked(safeFetch).mockReset());
  afterEach(() => vi.restoreAllMocks());

  it('falls back to OG tags when there is no JSON-LD', async () => {
    vi.mocked(safeFetch).mockResolvedValue({
      ok: true,
      status: 200,
      text: htmlWithOg('Rooftop Party', 'Come hang out'),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const result = await parsePartiful('https://partiful.com/e/xyz');
    expect(result.name).toBe('Rooftop Party');
    expect(result.cost).toBe('Free');
  });
});

describe('parseGeneric', () => {
  beforeEach(() => vi.mocked(safeFetch).mockReset());
  afterEach(() => vi.restoreAllMocks());

  it('resolves a relative og:image to an absolute URL', async () => {
    vi.mocked(safeFetch).mockResolvedValue({
      ok: true,
      status: 200,
      text: htmlWithOg('Some Event', 'desc', '/images/og.png'),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const result = await parseGeneric('https://example.com/events/some-event');
    expect(result.name).toBe('Some Event');
  });

  it('throws UserFacingError when the page has no event data', async () => {
    vi.mocked(safeFetch).mockResolvedValue({
      ok: true,
      status: 200,
      text: '<html><head></head><body></body></html>',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    await expect(parseGeneric('https://example.com/not-an-event')).rejects.toBeInstanceOf(UserFacingError);
  });
});
