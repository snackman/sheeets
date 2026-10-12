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
