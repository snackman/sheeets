import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  isValidSheetTrackerId,
  parseSheetTrackerInput,
  unwrapGoogleRedirect,
  extractSheetTrackerLinks,
  SHEET_TRACKER_ID_RE,
} from '../ingest/sources/sheet-tracker';

const fixture = readFileSync(join(__dirname, 'fixtures', 'sheet-tracker-htmlview.html'), 'utf-8');
const BUILD3_SHEET_ID = '1MDHdcFf69FEk_Zm48mJmYjzgrePxxpptMyY7MlzMBgg';

describe('SHEET_TRACKER_ID_RE / isValidSheetTrackerId', () => {
  it('accepts a real-looking sheet id', () => {
    expect(isValidSheetTrackerId(BUILD3_SHEET_ID)).toBe(true);
  });

  it('rejects too-short ids and anything that could smuggle a path', () => {
    expect(isValidSheetTrackerId('short')).toBe(false);
    expect(isValidSheetTrackerId('../../etc/passwd')).toBe(false);
    expect(SHEET_TRACKER_ID_RE.test('abc?gid=0')).toBe(false);
  });
});

describe('parseSheetTrackerInput', () => {
  it('accepts a bare sheet id', () => {
    expect(parseSheetTrackerInput(BUILD3_SHEET_ID)).toEqual({ sheetId: BUILD3_SHEET_ID, gid: null });
  });

  it('extracts the id (and gid, if present) from a full spreadsheet URL', () => {
    expect(parseSheetTrackerInput(`https://docs.google.com/spreadsheets/d/${BUILD3_SHEET_ID}/edit#gid=101`)).toEqual({
      sheetId: BUILD3_SHEET_ID,
      gid: 101,
    });
    expect(parseSheetTrackerInput(`https://docs.google.com/spreadsheets/d/${BUILD3_SHEET_ID}/htmlview?gid=0`)).toEqual({
      sheetId: BUILD3_SHEET_ID,
      gid: 0,
    });
  });

  it('returns null for empty or unparseable input', () => {
    expect(parseSheetTrackerInput('')).toBeNull();
    expect(parseSheetTrackerInput('not a sheet')).toBeNull();
  });
});

describe('unwrapGoogleRedirect', () => {
  it('unwraps a google.com/url?q= click-tracking redirect', () => {
    expect(unwrapGoogleRedirect('https://www.google.com/url?q=https://luma.com/bittensor-hh&sa=D&source=editors')).toBe(
      'https://luma.com/bittensor-hh'
    );
  });

  it('leaves a non-redirect href unchanged', () => {
    expect(unwrapGoogleRedirect('https://luma.com/direct-link')).toBe('https://luma.com/direct-link');
  });

  it('leaves an unparseable (e.g. in-sheet anchor) href unchanged', () => {
    expect(unwrapGoogleRedirect('#range=A1')).toBe('#range=A1');
  });
});

describe('extractSheetTrackerLinks', () => {
  it('unwraps every redirect, filters to allowlisted platforms, and dedupes', () => {
    const links = extractSheetTrackerLinks(fixture);
    // Telegram, devfolio.co and the in-sheet anchor are all excluded;
    // the two luma.com links collapse to one after de-duping.
    expect(links).toEqual(['https://luma.com/bittensor-hh', 'https://luma.com/ijy8hzbj']);
  });

  it('returns an empty array for HTML with no anchors', () => {
    expect(extractSheetTrackerLinks('<html><body>nothing here</body></html>')).toEqual([]);
  });
});

describe('fetchSheetTrackerHtml / fetchSheetTrackerLinks (mocked safeFetch)', () => {
  beforeEach(() => vi.resetModules());

  it('fetches /htmlview/sheet?gid=<gid>, defaulting gid to 0', async () => {
    let capturedUrl: string | undefined;
    vi.doMock('../safe-fetch', () => ({
      safeFetch: vi.fn(async (url: string) => {
        capturedUrl = url;
        return { ok: true, status: 200, url, headers: {}, text: fixture };
      }),
      SafeFetchError: class SafeFetchError extends Error {},
    }));
    const { fetchSheetTrackerLinks } = await import('../ingest/sources/sheet-tracker');
    const links = await fetchSheetTrackerLinks(BUILD3_SHEET_ID);
    expect(capturedUrl).toBe(`https://docs.google.com/spreadsheets/d/${BUILD3_SHEET_ID}/htmlview/sheet?gid=0`);
    expect(links).toEqual(['https://luma.com/bittensor-hh', 'https://luma.com/ijy8hzbj']);
  });

  it('fetches a specific gid when given one', async () => {
    let capturedUrl: string | undefined;
    vi.doMock('../safe-fetch', () => ({
      safeFetch: vi.fn(async (url: string) => {
        capturedUrl = url;
        return { ok: true, status: 200, url, headers: {}, text: fixture };
      }),
      SafeFetchError: class SafeFetchError extends Error {},
    }));
    const { fetchSheetTrackerLinks } = await import('../ingest/sources/sheet-tracker');
    await fetchSheetTrackerLinks(BUILD3_SHEET_ID, 101);
    expect(capturedUrl).toBe(`https://docs.google.com/spreadsheets/d/${BUILD3_SHEET_ID}/htmlview/sheet?gid=101`);
  });

  it('throws when Google returns a non-200 (e.g. the real CSV-export 401 this path avoids)', async () => {
    vi.doMock('../safe-fetch', () => ({
      safeFetch: vi.fn(async (url: string) => ({ ok: false, status: 401, url, headers: {}, text: '' })),
      SafeFetchError: class SafeFetchError extends Error {},
    }));
    const { fetchSheetTrackerLinks } = await import('../ingest/sources/sheet-tracker');
    await expect(fetchSheetTrackerLinks(BUILD3_SHEET_ID)).rejects.toThrow(/401/);
  });

  it('rejects an invalid sheet id before ever fetching', async () => {
    const { fetchSheetTrackerLinks } = await import('../ingest/sources/sheet-tracker');
    await expect(fetchSheetTrackerLinks('../../etc/passwd')).rejects.toThrow(/Invalid sheet id/);
  });
});
