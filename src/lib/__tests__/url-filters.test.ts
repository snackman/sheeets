import { describe, it, expect } from 'vitest';
import { parseFilterParams, buildFilterSearch } from '../url-filters';

describe('parseFilterParams', () => {
  it('parses valid params', () => {
    expect(parseFilterParams('?start=2026-11-03T00:00&end=2026-11-05&time=today&tags=AI,DeFi&q=party&view=map')).toEqual({
      start: '2026-11-03T00:00', end: '2026-11-05T23:30', timeMode: 'today', tags: ['AI', 'DeFi'], query: 'party', view: 'map',
    });
  });
  it('ignores invalid/unknown values', () => {
    expect(parseFilterParams('?start=nope&end=2026-13-45&time=weekly&view=3d&foo=bar')).toEqual({});
  });
  it('rejects reversed ranges and half ranges', () => {
    expect(parseFilterParams('?start=2026-11-05&end=2026-11-03')).toEqual({});
    expect(parseFilterParams('?start=2026-11-05')).toEqual({});
  });
  it('dedupes and bounds tags', () => {
    expect(parseFilterParams(`?tags=a,a,,${'x'.repeat(50)}`).tags).toEqual(['a']);
  });
});

describe('buildFilterSearch', () => {
  const defaultRange = { startDateTime: '2026-11-03T00:00', endDateTime: '2026-11-08T23:30' };
  const base = { startDateTime: defaultRange.startDateTime, endDateTime: defaultRange.endDateTime, timeMode: 'off' as const, vibes: [], searchQuery: '' };
  it('omits defaults and an unchosen view', () => {
    expect(buildFilterSearch('', { filters: base, defaultRange, view: null })).toBe('');
    expect(buildFilterSearch('', { filters: base, defaultRange, view: 'list' })).toBe('?view=list');
  });
  it('round-trips and keeps unrelated params', () => {
    const s = buildFilterSearch('?fc=abc&q=old', {
      filters: { ...base, startDateTime: '2026-11-04T00:00', timeMode: 'now', vibes: ['AI'], searchQuery: ' hi ' },
      defaultRange, view: 'table',
    });
    const sp = new URLSearchParams(s);
    expect(sp.get('fc')).toBe('abc');
    expect(parseFilterParams(sp)).toEqual({ start: '2026-11-04T00:00', end: '2026-11-08T23:30', timeMode: 'now', tags: ['AI'], query: 'hi', view: 'table' });
  });
});
