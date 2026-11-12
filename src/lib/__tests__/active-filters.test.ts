import { describe, it, expect } from 'vitest';
import { describeActiveFilters } from '../active-filters';
import type { FilterState } from '../types';

const defaults = { startDateTime: '2026-03-01T00:00', endDateTime: '2026-03-05T23:30' };
const base: FilterState = {
  conference: 'Test Conf',
  ...defaults,
  vibes: [],
  tagMatchAll: false,
  selectedFriends: [],
  itineraryOnly: false,
  searchQuery: '',
  timeMode: 'off',
  selectedOrgs: [],
};

describe('describeActiveFilters', () => {
  it('is empty when nothing narrows the list (conference is not a filter)', () => {
    expect(describeActiveFilters(base, defaults)).toEqual([]);
  });

  it('lists search, tags, friends, orgs and my-plan', () => {
    const out = describeActiveFilters(
      { ...base, searchQuery: ' yoga ', vibes: ['AI', 'Party'], selectedFriends: ['a'], selectedOrgs: ['x', 'y'], itineraryOnly: true },
      defaults,
    );
    expect(out).toEqual(['Search: "yoga"', 'AI', 'Party', '1 friend', '2 organizers', 'My plan only']);
  });

  it('describes a changed date range, and a single day', () => {
    expect(describeActiveFilters({ ...base, startDateTime: '2026-03-02T00:00' }, defaults)).toEqual(['Dates: Mar 2 - Mar 5']);
    expect(describeActiveFilters({ ...base, startDateTime: '2026-03-02T00:00', endDateTime: '2026-03-02T23:30' }, defaults)).toEqual(['Date: Mar 2']);
  });

  it('time mode replaces the date range', () => {
    expect(describeActiveFilters({ ...base, timeMode: 'tomorrow', startDateTime: '2026-03-02T00:00' }, defaults)).toEqual(['Tomorrow']);
    expect(describeActiveFilters({ ...base, timeMode: 'now' }, defaults)).toEqual(['Happening now']);
  });
});
