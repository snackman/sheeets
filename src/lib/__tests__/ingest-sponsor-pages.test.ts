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

  // Re-review item 7: wildcard support.
  it('supports the "*" wildcard mid-pattern', async () => {
    const { parseRobotsTxt, isPathAllowed } = await import('../ingest/sources/sponsor-pages');
    const rules = parseRobotsTxt('User-agent: *\nDisallow: /events/*/private\n');
    expect(isPathAllowed('/events/123/private', rules)).toBe(false);
    expect(isPathAllowed('/events/abc/private', rules)).toBe(false);
    expect(isPathAllowed('/events/123/public', rules)).toBe(true);
  });

  it('supports the "$" end-of-url anchor', async () => {
    const { parseRobotsTxt, isPathAllowed } = await import('../ingest/sources/sponsor-pages');
    const rules = parseRobotsTxt('User-agent: *\nDisallow: /events$\n');
    expect(isPathAllowed('/events', rules)).toBe(false);
    // Without the anchor this would also match - $ means it must NOT continue.
    expect(isPathAllowed('/events/public', rules)).toBe(true);
  });

  // Re-review item 7: group consecutive User-agent lines correctly.
  it('applies shared directives to every agent in a run of consecutive User-agent lines, incl. "*"', async () => {
    const { parseRobotsTxt, isPathAllowed } = await import('../ingest/sources/sponsor-pages');
    const rules = parseRobotsTxt('User-agent: Googlebot\nUser-agent: *\nDisallow: /private\n');
    expect(isPathAllowed('/private/page', rules)).toBe(false);
  });

  it('does not let a later, unrelated named-bot group leak into the "*" group', async () => {
    const { parseRobotsTxt, isPathAllowed } = await import('../ingest/sources/sponsor-pages');
    const rules = parseRobotsTxt('User-agent: *\nDisallow: /a\n\nUser-agent: Bingbot\nDisallow: /b\n');
    expect(isPathAllowed('/a/x', rules)).toBe(false);
    expect(isPathAllowed('/b/x', rules)).toBe(true); // /b only applies to Bingbot's own group
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

  // Re-review item 7: a 5xx means "the site can't currently tell us its
  // rules," which is NOT the same as "no robots.txt exists" - disallow
  // everything rather than failing open.
  it('treats a robots.txt 5xx as disallow-all, not fail-open', async () => {
    vi.doMock('../safe-fetch', () => ({
      safeFetch: vi.fn(async (url: string) => ({ ok: false, status: 503, url, headers: {}, text: '' })),
      SafeFetchError: class SafeFetchError extends Error {},
    }));
    const { isAllowedByRobots, createRobotsCache } = await import('../ingest/sources/sponsor-pages');
    expect(await isAllowedByRobots('https://sponsor.example.com/events', createRobotsCache())).toBe(false);
  });

  // Re-review (this round): allows exactly one redirect hop for
  // robots.txt, so the extremely common apex<->www redirect is now
  // followed and TRUSTED, instead of always failing open on any redirect.
  it('follows a same-site (apex -> www) robots.txt redirect and trusts the result', async () => {
    const requestedUrls: string[] = [];
    vi.doMock('../safe-fetch', () => ({
      safeFetch: vi.fn(async (url: string, opts: { maxRedirects?: number }) => {
        requestedUrls.push(url);
        expect(opts.maxRedirects).toBe(1);
        // safeFetch itself follows the redirect internally and returns
        // the FINAL url - simulate landing on www after requesting apex.
        return { ok: true, status: 200, url: 'https://www.sponsor.example.com/robots.txt', headers: {}, text: 'User-agent: *\nDisallow: /blocked\n' };
      }),
      SafeFetchError: class SafeFetchError extends Error {},
    }));
    const { isAllowedByRobots, createRobotsCache } = await import('../ingest/sources/sponsor-pages');
    const cache = createRobotsCache();
    expect(await isAllowedByRobots('https://sponsor.example.com/events', cache)).toBe(true);
    expect(await isAllowedByRobots('https://sponsor.example.com/blocked/page', cache)).toBe(false);
    expect(requestedUrls).toEqual(['https://sponsor.example.com/robots.txt']); // cached - only fetched once
  });

  // Re-review (this round): a redirect to a GENUINELY different domain
  // (not apex<->www of the same site) must still never be trusted as
  // that origin's own robots.txt.
  it('discards a robots.txt redirect to a different domain (fails open, does not trust it)', async () => {
    vi.doMock('../safe-fetch', () => ({
      safeFetch: vi.fn(async () => ({
        ok: true,
        status: 200,
        url: 'https://totally-different-host.example.net/robots.txt',
        headers: {},
        text: 'User-agent: *\nDisallow: /\n', // would disallow everything if (wrongly) trusted
      })),
      SafeFetchError: class SafeFetchError extends Error {},
    }));
    const { isAllowedByRobots, createRobotsCache } = await import('../ingest/sources/sponsor-pages');
    expect(await isAllowedByRobots('https://sponsor.example.com/events', createRobotsCache())).toBe(true);
  });

  // Re-review (this round): 429 ("rate limited") is unavailable, same
  // posture as a 5xx - disallow, not fail-open.
  it('treats a robots.txt 429 as disallow-all, not fail-open', async () => {
    vi.doMock('../safe-fetch', () => ({
      safeFetch: vi.fn(async (url: string) => ({ ok: false, status: 429, url, headers: {}, text: '' })),
      SafeFetchError: class SafeFetchError extends Error {},
    }));
    const { isAllowedByRobots, createRobotsCache } = await import('../ingest/sources/sponsor-pages');
    expect(await isAllowedByRobots('https://sponsor.example.com/events', createRobotsCache())).toBe(false);
  });

  it('fails open when the robots.txt fetch throws (e.g. too many/off-site redirect hops)', async () => {
    vi.doMock('../safe-fetch', () => ({
      safeFetch: vi.fn(async () => {
        throw new Error('simulated: safeFetch exhausted its single allowed redirect hop');
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
            not: () => ({
              // Re-review (this round): the real query now adds
              // `.order('sponsor_url')` for a stable rotation order.
              order: () => Promise.resolve({ data: sponsorUrls, error }),
            }),
          }),
        }),
      }),
    } as never;
  }

  it('admin-entered known URLs win outright, are capped at MAX_PAGES_PER_RUN, and never rotate (nextOffset null)', async () => {
    const { resolveSponsorPageUrls, MAX_PAGES_PER_RUN } = await import('../ingest/sources/sponsor-pages');
    const many = Array.from({ length: MAX_PAGES_PER_RUN + 5 }, (_, i) => `https://sponsor${i}.example.com/events`);
    const { urls, nextOffset } = await resolveSponsorPageUrls(fakeSupabase([]), 'ETHDenver', many);
    expect(urls).toHaveLength(MAX_PAGES_PER_RUN);
    expect(urls[0]).toBe(many[0]);
    expect(nextOffset).toBeNull();
  });

  it('discovers from event_sponsors.sponsor_url when no URLs are configured: homepage + /events per sponsor', async () => {
    const { resolveSponsorPageUrls } = await import('../ingest/sources/sponsor-pages');
    const { urls, nextOffset } = await resolveSponsorPageUrls(
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
    expect(nextOffset).toBe(0); // both sponsors visited, wraps back to the start (offset 0)
  });

  it('returns [] when event_sponsors does not exist yet (42P01), never throws', async () => {
    const { resolveSponsorPageUrls } = await import('../ingest/sources/sponsor-pages');
    const { urls, nextOffset } = await resolveSponsorPageUrls(fakeSupabase([], { code: '42P01', message: 'relation does not exist' }), 'ETHDenver', []);
    expect(urls).toEqual([]);
    expect(nextOffset).toBeNull();
  });

  // Re-review item 8: rotation.
  it('rotates which sponsor starts the list based on the offset cursor', async () => {
    const { resolveSponsorPageUrls } = await import('../ingest/sources/sponsor-pages');
    const sponsors = [
      { sponsor_url: 'https://a.example.com' },
      { sponsor_url: 'https://b.example.com' },
      { sponsor_url: 'https://c.example.com' },
    ];
    const { urls, nextOffset } = await resolveSponsorPageUrls(fakeSupabase(sponsors), 'ETHDenver', [], { offset: 1 });
    // Starts at sponsor index 1 ("b"), not index 0 ("a").
    expect(urls[0]).toBe('https://b.example.com/');
    expect(nextOffset).toBe(1); // 1 (offset) + 3 (all three visited) = 4 % 3 = 1
  });

  it('wraps an out-of-range offset back into bounds', async () => {
    const { resolveSponsorPageUrls } = await import('../ingest/sources/sponsor-pages');
    const sponsors = [{ sponsor_url: 'https://a.example.com' }, { sponsor_url: 'https://b.example.com' }];
    const { urls } = await resolveSponsorPageUrls(fakeSupabase(sponsors), 'ETHDenver', [], { offset: 5 });
    expect(urls[0]).toBe('https://b.example.com/'); // 5 % 2 == 1 -> starts at "b"
  });

  // Re-review item 8: normalize bare domains + skip bad ones instead of failing the run.
  it('normalizes a bare domain (no scheme) to https://, and skips an unparseable one', async () => {
    const { resolveSponsorPageUrls } = await import('../ingest/sources/sponsor-pages');
    const sponsors = [{ sponsor_url: 'acme.example.com' }, { sponsor_url: 'not a url at all :::' }, { sponsor_url: 'https://beta.example.com' }];
    const { urls } = await resolveSponsorPageUrls(fakeSupabase(sponsors), 'ETHDenver', []);
    expect(urls).toContain('https://acme.example.com/');
    expect(urls).toContain('https://acme.example.com/events');
    expect(urls).toContain('https://beta.example.com/');
    expect(urls).toContain('https://beta.example.com/events');
    // The unparseable one contributed nothing, but didn't throw or stop
    // the other two sponsors from being processed.
    expect(urls).toHaveLength(4);
  });

  // Re-review (this round): nextOffset must advance only by sponsors
  // ACTUALLY FETCHED (contributed >= 1 page), not every sponsor merely
  // selected/considered - a permanently-bad URL must not consume a
  // rotation slot, since skipping it costs nothing (no page budget used).
  it('does not advance the offset past a sponsor whose URL fails to parse', async () => {
    const { resolveSponsorPageUrls } = await import('../ingest/sources/sponsor-pages');
    const sponsors = [{ sponsor_url: 'not a url at all :::' }, { sponsor_url: 'https://beta.example.com' }];
    const { urls, nextOffset } = await resolveSponsorPageUrls(fakeSupabase(sponsors), 'ETHDenver', []);
    expect(urls).toEqual(['https://beta.example.com/', 'https://beta.example.com/events']);
    // Only "beta" was actually fetched (1 sponsor), not both "selected"
    // sponsors (2) - offset 0 + 1 fetched = 1.
    expect(nextOffset).toBe(1);
  });
});
