import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'meetup-event-search-response.json'), 'utf-8'));

const CREDENTIAL_KEYS = ['MEETUP_CLIENT_ID', 'MEETUP_CLIENT_SECRET', 'MEETUP_REFRESH_TOKEN'] as const;

function clearMeetupCredentials() {
  for (const k of CREDENTIAL_KEYS) delete process.env[k];
}

describe('isMeetupConfigured (disabled-when-unconfigured, plan Phase 4 item 3: "requires Meetup Pro")', () => {
  const originalValues: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of CREDENTIAL_KEYS) originalValues[k] = process.env[k];
  });
  afterEach(() => {
    for (const k of CREDENTIAL_KEYS) {
      if (originalValues[k] === undefined) delete process.env[k];
      else process.env[k] = originalValues[k];
    }
  });

  it('is false when no OAuth credentials are set', async () => {
    clearMeetupCredentials();
    vi.resetModules();
    const { isMeetupConfigured } = await import('../ingest/sources/meetup');
    expect(isMeetupConfigured()).toBe(false);
  });

  it('is false when only SOME credentials are set', async () => {
    clearMeetupCredentials();
    process.env.MEETUP_CLIENT_ID = 'id';
    process.env.MEETUP_CLIENT_SECRET = 'secret';
    vi.resetModules();
    const { isMeetupConfigured } = await import('../ingest/sources/meetup');
    expect(isMeetupConfigured()).toBe(false);
  });

  it('is true once client id, secret and refresh token are all set', async () => {
    process.env.MEETUP_CLIENT_ID = 'id';
    process.env.MEETUP_CLIENT_SECRET = 'secret';
    process.env.MEETUP_REFRESH_TOKEN = 'refresh';
    vi.resetModules();
    const { isMeetupConfigured } = await import('../ingest/sources/meetup');
    expect(isMeetupConfigured()).toBe(true);
  });
});

describe('parseMeetupEventSearchResponse (fixture: meetup-event-search-response.json)', () => {
  it('extracts a result for every edge with a usable id + eventUrl', async () => {
    const { parseMeetupEventSearchResponse } = await import('../ingest/sources/meetup');
    const results = parseMeetupEventSearchResponse(fixture);
    expect(results).toEqual([{ id: 'mu-evt-1', title: 'DeFi Builders Happy Hour', eventUrl: 'https://www.meetup.com/defi-builders/events/123456789/' }]);
  });

  it('skips a node missing eventUrl, and a null node, without throwing (schema-drift tolerance)', async () => {
    const { parseMeetupEventSearchResponse } = await import('../ingest/sources/meetup');
    expect(() => parseMeetupEventSearchResponse(fixture)).not.toThrow();
  });

  it('returns an empty array for a totally unexpected shape', async () => {
    const { parseMeetupEventSearchResponse } = await import('../ingest/sources/meetup');
    expect(parseMeetupEventSearchResponse({})).toEqual([]);
    expect(parseMeetupEventSearchResponse({ errors: [{ message: 'schema changed' }] })).toEqual([]);
  });
});

describe('the allowlist applied to a Meetup search result', () => {
  it('allows a meetup.com event URL', async () => {
    const { isAllowlistedEventLink } = await import('../ingest/allowlist');
    const { parseMeetupEventSearchResponse } = await import('../ingest/sources/meetup');
    const results = parseMeetupEventSearchResponse(fixture);
    expect(isAllowlistedEventLink(results[0].eventUrl)).toBe(true);
  });
});

describe('searchMeetupEvents: token refresh + GraphQL POST, via a mocked safeFetch', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.MEETUP_CLIENT_ID = 'id';
    process.env.MEETUP_CLIENT_SECRET = 'secret';
    process.env.MEETUP_REFRESH_TOKEN = 'refresh';
  });

  it('refreshes an access token, then POSTs the eventSearch query with a Bearer header', async () => {
    const calls: { url: string; options: Record<string, unknown> }[] = [];
    vi.doMock('../safe-fetch', () => ({
      safeFetch: vi.fn(async (url: string, options: Record<string, unknown>) => {
        calls.push({ url, options });
        if (url.includes('oauth2/access')) {
          return { ok: true, status: 200, url, headers: {}, text: JSON.stringify({ access_token: 'fresh-token', expires_in: 3600 }) };
        }
        return { ok: true, status: 200, url, headers: {}, text: JSON.stringify(fixture) };
      }),
      SafeFetchError: class SafeFetchError extends Error {},
    }));
    const { searchMeetupEvents, _resetMeetupTokenCacheForTests } = await import('../ingest/sources/meetup');
    _resetMeetupTokenCacheForTests();

    const results = await searchMeetupEvents({
      query: 'defi',
      lat: 40.7,
      lon: -74.0,
      radiusMi: 25,
      startDateISO: '2026-05-01',
      endDateISO: '2026-05-10',
    });

    expect(results).toHaveLength(1);
    expect(calls[0].url).toContain('oauth2/access');
    const graphqlCall = calls.find((c) => c.url.includes('gql-ext'));
    expect(graphqlCall).toBeTruthy();
    expect(graphqlCall!.options.method).toBe('POST');
    expect((graphqlCall!.options.headers as Record<string, string>).Authorization).toBe('Bearer fresh-token');
    const body = JSON.parse(graphqlCall!.options.body as string);
    expect(body.variables.filter.query).toBe('defi');
  });

  it('throws MeetupFetchError (not a raw fetch error) when credentials are missing', async () => {
    clearMeetupCredentials();
    vi.resetModules();
    const { searchMeetupEvents, MeetupFetchError, _resetMeetupTokenCacheForTests } = await import('../ingest/sources/meetup');
    _resetMeetupTokenCacheForTests();
    await expect(
      searchMeetupEvents({ query: 'ai', lat: 0, lon: 0, radiusMi: 10, startDateISO: '2026-01-01', endDateISO: '2026-01-02' })
    ).rejects.toThrow(MeetupFetchError);
  });
});
