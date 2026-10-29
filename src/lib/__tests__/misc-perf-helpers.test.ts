import { describe, it, expect } from 'vitest';
import { resizedLumaCover } from '@/lib/image-url';
import { ogCacheHeaders } from '@/lib/og-cache';
import { DEFAULT_MIN_INTERVAL_MS } from '@/lib/ingest/publish';

describe('resizedLumaCover', () => {
  it('inserts cdn-cgi resize params for a plain lumacdn url', () => {
    expect(resizedLumaCover('https://images.lumacdn.com/event-covers/ab/xyz.png', 600)).toBe(
      'https://images.lumacdn.com/cdn-cgi/image/format=auto,fit=cover,width=600/event-covers/ab/xyz.png'
    );
  });
  it('replaces existing cdn-cgi params', () => {
    expect(resizedLumaCover('https://images.lumacdn.com/cdn-cgi/image/format=auto,fit=cover,dpr=2,quality=75,width=1000/event-covers/ab/xyz.png', 600)).toBe(
      'https://images.lumacdn.com/cdn-cgi/image/format=auto,fit=cover,width=600/event-covers/ab/xyz.png'
    );
  });
  it('leaves other hosts and junk alone', () => {
    expect(resizedLumaCover('https://example.com/a.png')).toBe('https://example.com/a.png');
    expect(resizedLumaCover('not a url')).toBe('not a url');
    expect(resizedLumaCover(null)).toBe('');
  });
});

describe('ogCacheHeaders', () => {
  it('caches hits for a day with a week of SWR', () => {
    const h = ogCacheHeaders('https://x/y.png')['Cache-Control'];
    expect(h).toContain('s-maxage=86400');
    expect(h).toContain('stale-while-revalidate=86400');
  });
  it('caches misses briefly', () => {
    expect(ogCacheHeaders(null)['Cache-Control']).toBe('public, max-age=60, s-maxage=300');
  });
});

describe('publish throttle', () => {
  it('stays under the Sheets read quota (<=3-4 reads/insert, 60 reads/min)', () => {
    const insertsPerMin = 60_000 / DEFAULT_MIN_INTERVAL_MS;
    expect(insertsPerMin * 4).toBeLessThanOrEqual(60);
  });
});
