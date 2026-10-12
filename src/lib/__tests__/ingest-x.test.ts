import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'x-tweets-response.json'), 'utf-8'));

describe('isValidXHandle / normalizeXHandle', () => {
  it('accepts well-formed handles (1-15 chars, letters/digits/underscore)', async () => {
    const { isValidXHandle } = await import('../ingest/sources/x');
    expect(isValidXHandle('ethsideevents')).toBe(true);
    expect(isValidXHandle('eth_cc_2026')).toBe(true);
    expect(isValidXHandle('a'.repeat(15))).toBe(true);
  });

  it('rejects too-long or invalid-character handles', async () => {
    const { isValidXHandle, X_HANDLE_RE } = await import('../ingest/sources/x');
    expect(isValidXHandle('a'.repeat(16))).toBe(false);
    expect(isValidXHandle('eth-cc')).toBe(false);
    expect(isValidXHandle('eth cc')).toBe(false);
    expect(X_HANDLE_RE.test('../../etc/passwd')).toBe(false);
  });

  it('normalizes a bare handle, @handle, and an x.com/twitter.com URL', async () => {
    const { normalizeXHandle } = await import('../ingest/sources/x');
    expect(normalizeXHandle('ethsideevents')).toBe('ethsideevents');
    expect(normalizeXHandle('@ethsideevents')).toBe('ethsideevents');
    expect(normalizeXHandle('https://x.com/ethsideevents')).toBe('ethsideevents');
    expect(normalizeXHandle('https://twitter.com/ethsideevents')).toBe('ethsideevents');
  });

  it('returns null for an invalid handle', async () => {
    const { normalizeXHandle } = await import('../ingest/sources/x');
    expect(normalizeXHandle('')).toBeNull();
    expect(normalizeXHandle('   ')).toBeNull();
    expect(normalizeXHandle('a'.repeat(16))).toBeNull();
  });
});

describe('isXConfigured (disabled-when-unconfigured, plan Phase 4 item 1)', () => {
  const originalToken = process.env.X_BEARER_TOKEN;
  afterEach(() => {
    if (originalToken === undefined) delete process.env.X_BEARER_TOKEN;
    else process.env.X_BEARER_TOKEN = originalToken;
  });

  it('is false when X_BEARER_TOKEN is not set', async () => {
    delete process.env.X_BEARER_TOKEN;
    vi.resetModules();
    const { isXConfigured } = await import('../ingest/sources/x');
    expect(isXConfigured()).toBe(false);
  });

  it('is true once X_BEARER_TOKEN is set', async () => {
    process.env.X_BEARER_TOKEN = 'test-bearer-token';
    vi.resetModules();
    const { isXConfigured } = await import('../ingest/sources/x');
    expect(isXConfigured()).toBe(true);
  });
});

describe('parseXTweetsResponse (fixture: x-tweets-response.json)', () => {
  it('parses every tweet, newest first in the fixture, with its expanded link', async () => {
    const { parseXTweetsResponse } = await import('../ingest/sources/x');
    const page = parseXTweetsResponse(fixture);
    expect(page.posts).toHaveLength(3);
    expect(page.posts[0].links).toEqual(['https://lu.ma/eth-rooftop-mixer']);
    expect(page.posts[1].links).toEqual(['https://partiful.com/e/sidequest987']);
    expect(page.posts[2].links).toEqual(['https://example-blog.com/post/42']);
  });

  it('uses meta.newest_id as the next since_id cursor (plan Phase 4 item 1: "read only once")', async () => {
    const { parseXTweetsResponse } = await import('../ingest/sources/x');
    const page = parseXTweetsResponse(fixture);
    expect(page.newestId).toBe('1800000000000000003');
  });

  it('bills the billable "Posts: Read" count from meta.result_count, not just links found', async () => {
    const { parseXTweetsResponse } = await import('../ingest/sources/x');
    const page = parseXTweetsResponse(fixture);
    expect(page.resultCount).toBe(3);
  });

  it('falls back to a bare-URL text scan when entities.urls is missing', async () => {
    const { parseXTweetsResponse } = await import('../ingest/sources/x');
    const page = parseXTweetsResponse({
      data: [{ id: '1', text: 'RSVP at https://lu.ma/no-entities please!' }],
      meta: {},
    });
    expect(page.posts[0].links).toEqual(['https://lu.ma/no-entities']);
    expect(page.newestId).toBe('1'); // no meta.newest_id -> falls back to the first post's id
  });

  it('returns an empty page for a response with no data', async () => {
    const { parseXTweetsResponse } = await import('../ingest/sources/x');
    const page = parseXTweetsResponse({});
    expect(page.posts).toEqual([]);
    expect(page.newestId).toBeNull();
    expect(page.resultCount).toBe(0);
  });
});

describe('the allowlist applied to X-extracted links', () => {
  it('allows Luma and Partiful, rejects a blog and a non-allowlisted host', async () => {
    const { isAllowlistedEventLink } = await import('../ingest/allowlist');
    const { parseXTweetsResponse } = await import('../ingest/sources/x');
    const page = parseXTweetsResponse(fixture);
    expect(isAllowlistedEventLink(page.posts[0].links[0])).toBe(true);
    expect(isAllowlistedEventLink(page.posts[1].links[0])).toBe(true);
    expect(isAllowlistedEventLink(page.posts[2].links[0])).toBe(false);
  });
});

describe('fetchXUserPosts / resolveXUser: since_id cursor + cost, via a mocked safeFetch', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.X_BEARER_TOKEN = 'test-bearer-token';
  });

  it('passes since_id through as a query param when a cursor is supplied', async () => {
    const requestedUrls: string[] = [];
    vi.doMock('../safe-fetch', () => ({
      safeFetch: vi.fn(async (url: string) => {
        requestedUrls.push(url);
        return { ok: true, status: 200, url, headers: {}, text: JSON.stringify(fixture) };
      }),
      SafeFetchError: class SafeFetchError extends Error {},
    }));
    const { fetchXUserPosts } = await import('../ingest/sources/x');
    await fetchXUserPosts('999', { sinceId: '1799999999999999999' });
    expect(requestedUrls[0]).toContain('since_id=1799999999999999999');
    expect(requestedUrls[0]).toContain('/2/users/999/tweets');
    expect(requestedUrls[0]).toContain('exclude=retweets%2Creplies');
  });

  it('omits since_id on a first run (no cursor yet)', async () => {
    const requestedUrls: string[] = [];
    vi.doMock('../safe-fetch', () => ({
      safeFetch: vi.fn(async (url: string) => {
        requestedUrls.push(url);
        return { ok: true, status: 200, url, headers: {}, text: JSON.stringify(fixture) };
      }),
      SafeFetchError: class SafeFetchError extends Error {},
    }));
    const { fetchXUserPosts } = await import('../ingest/sources/x');
    await fetchXUserPosts('999', {});
    expect(requestedUrls[0]).not.toContain('since_id');
  });

  it('computes cost as resultCount * X_POST_READ_COST_USD ($0.005/post, plan §12)', async () => {
    const { X_POST_READ_COST_USD } = await import('../ingest/sources/x');
    expect(X_POST_READ_COST_USD).toBeCloseTo(0.005, 6);
    // 3 posts in the fixture -> $0.015, matching how pipeline.ts#processXSource computes xCostUsd.
    expect(3 * X_POST_READ_COST_USD).toBeCloseTo(0.015, 6);
  });

  it('resolveXUser throws a clear error when the account is not found', async () => {
    vi.doMock('../safe-fetch', () => ({
      safeFetch: vi.fn(async () => ({ ok: true, status: 200, url: '', headers: {}, text: JSON.stringify({ errors: [{ title: 'Not Found Error' }] }) })),
      SafeFetchError: class SafeFetchError extends Error {},
    }));
    const { resolveXUser, XFetchError } = await import('../ingest/sources/x');
    await expect(resolveXUser('ethsideevents')).rejects.toThrow(XFetchError);
  });
});
