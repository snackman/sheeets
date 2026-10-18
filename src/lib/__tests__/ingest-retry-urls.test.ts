import { describe, it, expect } from 'vitest';
import { nextRetryUrls, retryUrlsOf, RETRY_URLS_MAX, RETRY_URL_TTL_MS, type RetryUrlEntry } from '../ingest/retry-urls';

const NOW = Date.parse('2026-10-18T12:00:00.000Z');
const entry = (url: string, agoMs = 0): RetryUrlEntry => ({ url, ref: 'https://x.com/i/status/1', first_deferred_at: new Date(NOW - agoMs).toISOString(), reason: 'Luma returned 429.' });

describe('retry-urls', () => {
  it('adds newly deferred links, drops handled and expired ones, keeps untried ones', () => {
    const prev = [entry('https://lu.ma/handled'), entry('https://lu.ma/old', RETRY_URL_TTL_MS + 1), entry('https://lu.ma/untried')];
    const next = nextRetryUrls(prev, new Map([['https://lu.ma/new', { ref: null, reason: 'luma_budget_exhausted' }]]), new Set(['https://lu.ma/handled']), NOW);
    expect(next.map((e) => e.url)).toEqual(['https://lu.ma/untried', 'https://lu.ma/new']);
  });

  it('a re-deferred link keeps its first_deferred_at (so TTL still applies) and updates its reason', () => {
    const prev = [entry('https://lu.ma/a', 1000)];
    const [e] = nextRetryUrls(prev, new Map([['https://lu.ma/a', { ref: null, reason: 'Luma returned 503.' }]]), new Set(), NOW);
    expect(e.first_deferred_at).toBe(prev[0].first_deferred_at);
    expect(e.reason).toBe('Luma returned 503.');
  });

  it('caps the list, dropping the oldest first; tolerates junk in the cursor', () => {
    const deferred = new Map(Array.from({ length: RETRY_URLS_MAX + 5 }, (_, i) => [`https://lu.ma/l${i}`, { ref: null, reason: 'x' }] as const));
    const next = nextRetryUrls([], new Map(deferred), new Set(), NOW);
    expect(next).toHaveLength(RETRY_URLS_MAX);
    expect(next[0].url).toBe('https://lu.ma/l5');
    expect(retryUrlsOf({ retry_urls: [null, 3, { url: 'https://lu.ma/ok', first_deferred_at: 'x' }] })).toHaveLength(1);
    expect(retryUrlsOf(null)).toEqual([]);
  });
});
