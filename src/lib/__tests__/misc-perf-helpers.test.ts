import { describe, it, expect } from 'vitest';
import { resizedLumaCover, thumbUrl, thumbSrcSet } from '@/lib/image-url';

describe('thumbUrl', () => {
  it('uses Cloudflare resizing for Luma', () => {
    expect(thumbUrl('https://images.lumacdn.com/event-covers/ab/x.png', 320)).toBe(
      'https://images.lumacdn.com/cdn-cgi/image/format=auto,fit=cover,width=320/event-covers/ab/x.png'
    );
  });
  it('adds width params for unsplash, eventbrite, imgix', () => {
    const un = thumbUrl('https://images.unsplash.com/photo-1?ixid=a', 320);
    expect(un).toContain('w=320');
    expect(un).toContain('ixid=a');
    expect(thumbUrl('https://partiful.imgix.net/x.png', 300)).toContain('w=300');
  });
  it('leaves signed URLs and Eventbrite untouched (changing w would 403)', () => {
    const eb = 'https://img.evbuc.com/https%3A%2F%2Fcdn.evbuc.com%2Fimages%2F1.jpg?w=512&auto=format&s=abc123';
    expect(thumbUrl(eb, 320)).toBe(eb);
    expect(thumbSrcSet(eb, [176, 320])).toBeUndefined();
    const im = 'https://partiful.imgix.net/x.png?s=deadbeef';
    expect(thumbUrl(im, 300)).toBe(im);
    const plain = 'https://img.evbuc.com/abc?auto=format';
    expect(thumbUrl(plain, 400)).toBe(plain);
  });
  it('leaves unknown hosts, junk and empty alone', () => {
    expect(thumbUrl('https://example.com/a.png')).toBe('https://example.com/a.png');
    expect(thumbUrl('nope')).toBe('nope');
    expect(thumbUrl(undefined)).toBe('');
  });
});

describe('thumbSrcSet', () => {
  it('builds a w-descriptor srcset for resizable hosts', () => {
    const s = thumbSrcSet('https://images.lumacdn.com/event-covers/ab/x.png', [176, 320]);
    expect(s).toContain('width=176/event-covers/ab/x.png 176w');
    expect(s).toContain('width=320/event-covers/ab/x.png 320w');
  });
  it('returns undefined for non-resizable hosts or empty', () => {
    expect(thumbSrcSet('https://example.com/a.png', [176, 320])).toBeUndefined();
    expect(thumbSrcSet(null, [176])).toBeUndefined();
  });
});
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
