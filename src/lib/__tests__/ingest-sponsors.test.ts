import { describe, it, expect, vi, beforeEach } from 'vitest';
import { matchSponsorName } from '../ingest/sponsors';

describe('matchSponsorName', () => {
  it('matches case-insensitively on a word boundary', () => {
    expect(matchSponsorName('Builders brunch hosted by Coinbase', ['Coinbase'])).toBe('Coinbase');
    expect(matchSponsorName('builders brunch hosted by coinbase', ['Coinbase'])).toBe('Coinbase');
  });

  it('does not match a sponsor name glued to other alphanumerics', () => {
    expect(matchSponsorName('CoinbaseMAX afterparty', ['Coinbase'])).toBeNull();
  });

  it('returns the first matching name in list order', () => {
    expect(matchSponsorName('A party with Coinbase and Binance', ['Binance', 'Coinbase'])).toBe('Binance');
  });

  it('returns null when nothing matches', () => {
    expect(matchSponsorName('Totally unrelated meetup', ['Coinbase', 'Binance'])).toBeNull();
  });

  it('skips blank entries without throwing', () => {
    expect(matchSponsorName('Coinbase party', ['', '  ', 'Coinbase'])).toBe('Coinbase');
  });

  describe('stoplisted / short sponsor names require an exact-case match (review finding, MEDIUM item 8)', () => {
    it('does NOT match a stoplisted name in the wrong case', () => {
      expect(matchSponsorName('come grab a base camp meetup spot', ['Base'])).toBeNull();
      expect(matchSponsorName('an open bar all night', ['Open'])).toBeNull();
      expect(matchSponsorName('ai agent party', ['AI'])).toBeNull();
    });

    it('DOES match a stoplisted name in its own exact case', () => {
      expect(matchSponsorName('hosted by Base', ['Base'])).toBe('Base');
      expect(matchSponsorName('an AI meetup', ['AI'])).toBe('AI');
    });

    it('a short (<4 char) name not on the explicit stoplist is still exact-case only', () => {
      expect(matchSponsorName('ref protocol meetup', ['Ref'])).toBeNull(); // wrong case
      expect(matchSponsorName('Ref protocol meetup', ['Ref'])).toBe('Ref'); // exact case
    });

    it('an ordinary, unambiguous (>=4 char, non-stoplisted) sponsor name stays case-insensitive', () => {
      expect(matchSponsorName('hosted by coinbase', ['Coinbase'])).toBe('Coinbase');
      expect(matchSponsorName('hosted by COINBASE', ['Coinbase'])).toBe('Coinbase');
    });

    it('still respects the word-boundary guard for a stoplisted/short name (not glued to other alnum chars)', () => {
      expect(matchSponsorName('an AIrplane enthusiast meetup', ['AI'])).toBeNull();
    });
  });
});

describe('getSponsorNamesForConference', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns deduplicated, non-empty sponsor names for the conference', async () => {
    vi.doMock('../ingest/db', () => ({
      getIngestSupabase: () => ({
        from: () => ({
          select: () => ({
            eq: () =>
              Promise.resolve({
                data: [{ sponsor_name: 'Coinbase' }, { sponsor_name: 'Coinbase' }, { sponsor_name: '' }, { sponsor_name: null }],
                error: null,
              }),
          }),
        }),
      }),
    }));
    const { getSponsorNamesForConference } = await import('../ingest/sponsors');
    const names = await getSponsorNamesForConference('Test Conf');
    expect(names).toEqual(['Coinbase']);
  });

  it('returns an empty list (not an error) when the table does not exist yet (42P01)', async () => {
    vi.doMock('../ingest/db', () => ({
      getIngestSupabase: () => ({
        from: () => ({
          select: () => ({
            eq: () => Promise.resolve({ data: null, error: { code: '42P01', message: 'relation does not exist' } }),
          }),
        }),
      }),
    }));
    const { getSponsorNamesForConference } = await import('../ingest/sponsors');
    expect(await getSponsorNamesForConference('Test Conf')).toEqual([]);
  });

  it('throws on any other error', async () => {
    vi.doMock('../ingest/db', () => ({
      getIngestSupabase: () => ({
        from: () => ({
          select: () => ({
            eq: () => Promise.resolve({ data: null, error: { code: '500', message: 'boom' } }),
          }),
        }),
      }),
    }));
    const { getSponsorNamesForConference } = await import('../ingest/sponsors');
    await expect(getSponsorNamesForConference('Test Conf')).rejects.toThrow('boom');
  });
});
