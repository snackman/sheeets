import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  parseMiraNextData,
  isValidMiraSeriesSlug,
  normalizeMiraSeriesSlug,
  MIRA_SERIES_SLUG_RE,
} from '../ingest/sources/mira';
import { isAllowlistedEventLink } from '../ingest/allowlist';

const seriesFixture = readFileSync(join(__dirname, 'fixtures', 'mira-series-page.html'), 'utf-8');
const homeFixture = readFileSync(join(__dirname, 'fixtures', 'mira-homepage.html'), 'utf-8');

describe('parseMiraNextData', () => {
  it('extracts props.pageProps from a series page', () => {
    const pageProps = parseMiraNextData(seriesFixture);
    expect(Array.isArray(pageProps.mainEvents)).toBe(true);
    expect(Array.isArray(pageProps.sideEvents)).toBe(true);
  });

  it('extracts props.pageProps from the homepage', () => {
    const pageProps = parseMiraNextData(homeFixture);
    expect(Array.isArray(pageProps.seriesMenuItems)).toBe(true);
  });

  it('throws MiraFetchError-ish on HTML with no __NEXT_DATA__', () => {
    expect(() => parseMiraNextData('<html><body>nope</body></html>')).toThrow();
  });

  it('throws on malformed JSON inside the script tag', () => {
    expect(() => parseMiraNextData('<script id="__NEXT_DATA__">{not json</script>')).toThrow();
  });
});

describe('MIRA_SERIES_SLUG_RE / isValidMiraSeriesSlug', () => {
  it('accepts real slugs seen live', () => {
    expect(isValidMiraSeriesSlug('Devcon8SideEvents2026')).toBe(true);
    expect(isValidMiraSeriesSlug('Breakpoint2026SideEvents2026')).toBe(true);
    expect(isValidMiraSeriesSlug('ArtBaselMiamiEvents2026')).toBe(true);
  });

  it('rejects anything that could smuggle a path or query string', () => {
    expect(isValidMiraSeriesSlug('../../etc/passwd')).toBe(false);
    expect(isValidMiraSeriesSlug('foo?bar=1')).toBe(false);
    expect(isValidMiraSeriesSlug('foo/bar')).toBe(false);
    expect(MIRA_SERIES_SLUG_RE.test('a'.repeat(200))).toBe(false);
  });
});

describe('normalizeMiraSeriesSlug', () => {
  it('accepts a bare slug', () => {
    expect(normalizeMiraSeriesSlug('Devcon8SideEvents2026')).toBe('Devcon8SideEvents2026');
  });

  it('strips a miragather.com URL', () => {
    expect(normalizeMiraSeriesSlug('https://miragather.com/Devcon8SideEvents2026')).toBe('Devcon8SideEvents2026');
    expect(normalizeMiraSeriesSlug('https://www.miragather.com/Devcon8SideEvents2026')).toBe('Devcon8SideEvents2026');
  });

  it('strips a legacy cryptonomads.org URL', () => {
    expect(normalizeMiraSeriesSlug('https://cryptonomads.org/Devcon8SideEvents2026')).toBe('Devcon8SideEvents2026');
  });

  it('returns null for empty/invalid input', () => {
    expect(normalizeMiraSeriesSlug('')).toBeNull();
    expect(normalizeMiraSeriesSlug('   ')).toBeNull();
    expect(normalizeMiraSeriesSlug('https://miragather.com/../etc')).toBeNull();
  });
});

describe('fetchMiraSeriesEvents (mocked safeFetch)', () => {
  beforeEach(() => vi.resetModules());

  it('sends a browser-shaped identifying User-Agent and parses both mainEvents and sideEvents', async () => {
    let capturedHeaders: Record<string, string> | undefined;
    vi.doMock('../safe-fetch', () => ({
      safeFetch: vi.fn(async (_url: string, opts: { headers?: Record<string, string> }) => {
        capturedHeaders = opts.headers;
        return { ok: true, status: 200, url: _url, headers: {}, text: seriesFixture };
      }),
      SafeFetchError: class SafeFetchError extends Error {},
    }));
    const { fetchMiraSeriesEvents } = await import('../ingest/sources/mira');
    const events = await fetchMiraSeriesEvents('Devcon8SideEvents2026');

    expect(capturedHeaders?.['User-Agent']).toMatch(/^Mozilla\/5\.0/);
    expect(capturedHeaders?.['User-Agent']).toContain('plan.wtf');
    // 1 mainEvent + 4 sideEvents from the fixture.
    expect(events).toHaveLength(5);
    const byId = new Map(events.map((e) => [e.id, e]));
    expect(byId.get('recMain1')?.website).toBe('https://luma.com/devcon8-opening');
    expect(byId.get('recSide1')?.website).toBe('https://lu.ma/builder-hh-mumbai');
    // city as a single-element array (seen live) is coerced to a plain string.
    expect(byId.get('recSide2')?.city).toBe('Mumbai');
    // an event with no website at all is still returned, just with website: null.
    expect(byId.get('recSide4')?.website).toBeNull();
  });

  it('throws when the site returns a non-200 (e.g. a 403 for a non-browser UA upstream)', async () => {
    vi.doMock('../safe-fetch', () => ({
      safeFetch: vi.fn(async () => ({ ok: false, status: 403, url: 'https://miragather.com/x', headers: {}, text: '' })),
      SafeFetchError: class SafeFetchError extends Error {},
    }));
    const { fetchMiraSeriesEvents } = await import('../ingest/sources/mira');
    await expect(fetchMiraSeriesEvents('Devcon8SideEvents2026')).rejects.toThrow(/403/);
  });

  it('rejects an invalid series slug before ever fetching', async () => {
    const { fetchMiraSeriesEvents } = await import('../ingest/sources/mira');
    await expect(fetchMiraSeriesEvents('../etc/passwd')).rejects.toThrow(/Invalid Mira series slug/);
  });
});

describe('fetchMiraSeriesMenu (mocked safeFetch)', () => {
  beforeEach(() => vi.resetModules());

  it('parses seriesMenuItems from the homepage, including the shared Breakpoint/DAS London entry', async () => {
    vi.doMock('../safe-fetch', () => ({
      safeFetch: vi.fn(async (url: string) => ({ ok: true, status: 200, url, headers: {}, text: homeFixture })),
      SafeFetchError: class SafeFetchError extends Error {},
    }));
    const { fetchMiraSeriesMenu } = await import('../ingest/sources/mira');
    const menu = await fetchMiraSeriesMenu();
    expect(menu.map((m) => m.slug)).toEqual(['Devcon8SideEvents2026', 'Breakpoint2026SideEvents2026', 'ArtBaselMiamiEvents2026']);
    const bp = menu.find((m) => m.slug === 'Breakpoint2026SideEvents2026');
    expect(bp?.title).toBe('Breakpoint & DAS Events');
    expect(bp?.location).toBe('London, England');
  });
});

describe('allowlist filtering applied to parsed Mira event links', () => {
  it('allows lu.ma / luma.com and Partiful, rejects a non-allowlisted site', () => {
    const pageProps = parseMiraNextData(seriesFixture);
    const all = [...(pageProps.mainEvents as { website?: string }[]), ...(pageProps.sideEvents as { website?: string }[])];
    const websites = all.map((e) => e.website).filter((w): w is string => !!w);
    expect(websites.filter(isAllowlistedEventLink)).toEqual([
      'https://luma.com/devcon8-opening',
      'https://lu.ma/builder-hh-mumbai',
      'https://partiful.com/e/mixer789',
    ]);
    expect(isAllowlistedEventLink('https://fintech.global/wealthtechsummit')).toBe(false);
  });
});
