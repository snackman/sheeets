import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const pageHtml = readFileSync(join(__dirname, 'fixtures', 'sponsor-events-page.html'), 'utf-8');

describe('parseRobotsTxt / isPathAllowed', () => {
  it('disallows a path blocked for the wildcard user-agent', async () => {
    const { parseRobotsTxt, isPathAllowed } = await import('../ingest/sources/sponsor-pages');
    const rules = parseRobotsTxt('User-agent: *\nDisallow: /private\nDisallow: /events/internal\n');
    expect(isPathAllowed('/private/page', rules)).toBe(false);
    expect(isPathAllowed('/events/internal/x', rules)).toBe(false);
    expect(isPathAllowed('/events/public', rules)).toBe(true);
  });

  it('an Allow overrides a shorter or equal-length Disallow (longest-prefix-match)', async () => {
    const { parseRobotsTxt, isPathAllowed } = await import('../ingest/sources/sponsor-pages');
    const rules = parseRobotsTxt('User-agent: *\nDisallow: /events\nAllow: /events/public\n');
    expect(isPathAllowed('/events/private', rules)).toBe(false);
    expect(isPathAllowed('/events/public', rules)).toBe(true);
  });

  it('ignores a rule group for a specific named bot (not "*")', async () => {
    const { parseRobotsTxt, isPathAllowed } = await import('../ingest/sources/sponsor-pages');
    const rules = parseRobotsTxt('User-agent: Googlebot\nDisallow: /\n');
    expect(isPathAllowed('/anything', rules)).toBe(true);
  });

  it('a path with no matching rule defaults to allowed', async () => {
    const { parseRobotsTxt, isPathAllowed } = await import('../ingest/sources/sponsor-pages');
    const rules = parseRobotsTxt('User-agent: *\nDisallow: /admin\n');
    expect(isPathAllowed('/events', rules)).toBe(true);
  });

  it('an empty robots.txt allows everything', async () => {
    const { parseRobotsTxt, isPathAllowed } = await import('../ingest/sources/sponsor-pages');
    expect(isPathAllowed('/anything', parseRobotsTxt(''))).toBe(true);
  });
});

describe('isAllowedByRobots (fails open on no/unreachable robots.txt)', () => {
  beforeEach(() => vi.resetModules());

  it('fetches robots.txt once per origin and caches the result (rate-limit politeness)', async () => {
    let robotsFetches = 0;
    vi.doMock('../safe-fetch', () => ({
      safeFetch: vi.fn(async (url: string) => {
        if (url.endsWith('/robots.txt')) {
          robotsFetches++;
          return { ok: true, status: 200, url, headers: {}, text: 'User-agent: *\nDisallow: /blocked\n' };
        }
        throw new Error('unexpected fetch');
      }),
      SafeFetchError: class SafeFetchError extends Error {},
    }));
    const { isAllowedByRobots, createRobotsCache } = await import('../ingest/sources/sponsor-pages');
    const cache = createRobotsCache();
    expect(await isAllowedByRobots('https://sponsor.example.com/events', cache)).toBe(true);
    expect(await isAllowedByRobots('https://sponsor.example.com/blocked/page', cache)).toBe(false);
    expect(robotsFetches).toBe(1); // second call reused the cached rules for the same origin
  });

  it('fails open (allowed) when robots.txt 404s', async () => {
    vi.doMock('../safe-fetch', () => ({
      safeFetch: vi.fn(async (url: string) => ({ ok: false, status: 404, url, headers: {}, text: '' })),
      SafeFetchError: class SafeFetchError extends Error {},
    }));
    const { isAllowedByRobots, createRobotsCache } = await import('../ingest/sources/sponsor-pages');
    expect(await isAllowedByRobots('https://sponsor.example.com/events', createRobotsCache())).toBe(true);
  });

  it('fails open when the robots.txt fetch throws', async () => {
    vi.doMock('../safe-fetch', () => ({
      safeFetch: vi.fn(async () => {
        throw new Error('network error');
      }),
      SafeFetchError: class SafeFetchError extends Error {},
    }));
    const { isAllowedByRobots, createRobotsCache } = await import('../ingest/sources/sponsor-pages');
    expect(await isAllowedByRobots('https://sponsor.example.com/events', createRobotsCache())).toBe(true);
  });
});

describe('fetchSponsorPageLinks (fixture: sponsor-events-page.html)', () => {
  beforeEach(() => vi.resetModules());

  it('extracts only allowlisted outbound links, resolved to absolute URLs, deduped', async () => {
    vi.doMock('../safe-fetch', () => ({
      safeFetch: vi.fn(async (url: string) => {
        if (url.endsWith('/robots.txt')) return { ok: false, status: 404, url, headers: {}, text: '' };
        return { ok: true, status: 200, url, headers: {}, text: pageHtml };
      }),
      SafeFetchError: class SafeFetchError extends Error {},
    }));
    const { fetchSponsorPageLinks, createRobotsCache } = await import('../ingest/sources/sponsor-pages');
    const links = await fetchSponsorPageLinks('https://sponsor.example.com/events', createRobotsCache());
    expect(links.sort()).toEqual(['https://lu.ma/acme-demo-day', 'https://partiful.com/e/afterparty555'].sort());
  });

  it('respects robots.txt: returns no links when the page path is disallowed', async () => {
    vi.doMock('../safe-fetch', () => ({
      safeFetch: vi.fn(async (url: string) => {
        if (url.endsWith('/robots.txt')) return { ok: true, status: 200, url, headers: {}, text: 'User-agent: *\nDisallow: /events\n' };
        return { ok: true, status: 200, url, headers: {}, text: pageHtml };
      }),
      SafeFetchError: class SafeFetchError extends Error {},
    }));
    const { fetchSponsorPageLinks, createRobotsCache } = await import('../ingest/sources/sponsor-pages');
    const links = await fetchSponsorPageLinks('https://sponsor.example.com/events', createRobotsCache());
    expect(links).toEqual([]);
  });

  it('returns an empty array (never throws) when the page fetch fails', async () => {
    class FakeSafeFetchError extends Error {}
    vi.doMock('../safe-fetch', () => ({
      safeFetch: vi.fn(async (url: string) => {
        if (url.endsWith('/robots.txt')) return { ok: false, status: 404, url, headers: {}, text: '' };
        throw new FakeSafeFetchError('boom');
      }),
      SafeFetchError: FakeSafeFetchError,
    }));
    const { fetchSponsorPageLinks, createRobotsCache } = await import('../ingest/sources/sponsor-pages');
    const links = await fetchSponsorPageLinks('https://sponsor.example.com/events', createRobotsCache());
    expect(links).toEqual([]);
  });
});

describe('resolveSponsorPageUrls', () => {
  function fakeSupabase(sponsorUrls: { sponsor_url: string | null }[], error: unknown = null) {
    return {
      from: () => ({
        select: () => ({
          eq: () => ({
            not: () => Promise.resolve({ data: sponsorUrls, error }),
          }),
        }),
      }),
    } as never;
  }

  it('admin-entered known URLs win outright and are capped at MAX_PAGES_PER_RUN', async () => {
    const { resolveSponsorPageUrls, MAX_PAGES_PER_RUN } = await import('../ingest/sources/sponsor-pages');
    const many = Array.from({ length: MAX_PAGES_PER_RUN + 5 }, (_, i) => `https://sponsor${i}.example.com/events`);
    const urls = await resolveSponsorPageUrls(fakeSupabase([]), 'ETHDenver', many);
    expect(urls).toHaveLength(MAX_PAGES_PER_RUN);
    expect(urls[0]).toBe(many[0]);
  });

  it('discovers from event_sponsors.sponsor_url when no URLs are configured: homepage + /events per sponsor', async () => {
    const { resolveSponsorPageUrls } = await import('../ingest/sources/sponsor-pages');
    const urls = await resolveSponsorPageUrls(
      fakeSupabase([{ sponsor_url: 'https://acme.example.com' }, { sponsor_url: 'https://beta.example.com/' }]),
      'ETHDenver',
      []
    );
    expect(urls).toEqual([
      'https://acme.example.com/',
      'https://acme.example.com/events',
      'https://beta.example.com/',
      'https://beta.example.com/events',
    ]);
  });

  it('returns [] when event_sponsors does not exist yet (42P01), never throws', async () => {
    const { resolveSponsorPageUrls } = await import('../ingest/sources/sponsor-pages');
    const urls = await resolveSponsorPageUrls(fakeSupabase([], { code: '42P01', message: 'relation does not exist' }), 'ETHDenver', []);
    expect(urls).toEqual([]);
  });
});
