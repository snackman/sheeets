import { describe, it, expect } from 'vitest';
import {
  EVENT_TABS,
  DEFAULT_TAB,
  getTabConfig,
  getTabBySlug,
  TIME_RANGES,
} from '../conferences';

describe('conferences', () => {
  describe('EVENT_TABS', () => {
    it('contains at least one conference', () => {
      expect(EVENT_TABS.length).toBeGreaterThan(0);
    });

    it('each tab has required fields', () => {
      for (const tab of EVENT_TABS) {
        expect(tab).toHaveProperty('gid');
        expect(tab).toHaveProperty('name');
        expect(tab).toHaveProperty('slug');
        expect(tab).toHaveProperty('timezone');
        expect(tab).toHaveProperty('dates');
        expect(tab).toHaveProperty('center');
        expect(tab.dates.length).toBeGreaterThan(0);
        expect(tab.center).toHaveProperty('lat');
        expect(tab.center).toHaveProperty('lng');
      }
    });

    it('has unique slugs', () => {
      const slugs = EVENT_TABS.map((t) => t.slug);
      expect(new Set(slugs).size).toBe(slugs.length);
    });

    it('has unique gids', () => {
      const gids = EVENT_TABS.map((t) => t.gid);
      expect(new Set(gids).size).toBe(gids.length);
    });

    it('dates are in ISO format', () => {
      for (const tab of EVENT_TABS) {
        for (const d of tab.dates) {
          expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
      }
    });
  });

  describe('DEFAULT_TAB', () => {
    it('is the first tab', () => {
      expect(DEFAULT_TAB).toBe(EVENT_TABS[0]);
    });
  });

  describe('getTabConfig', () => {
    it('returns correct tab for exact conference name', () => {
      const tab = getTabConfig('Paris Blockchain Week 2026');
      expect(tab?.name).toBe('Paris Blockchain Week 2026');
      expect(tab?.slug).toBe('pbw');
    });

    it('returns correct tab for Bitcoin Vegas', () => {
      const tab = getTabConfig('Bitcoin Vegas');
      expect(tab?.name).toBe('Bitcoin Vegas');
      expect(tab?.timezone).toBe('America/Los_Angeles');
    });

    it('returns correct tab for Consensus Miami', () => {
      const tab = getTabConfig('Consensus Miami');
      expect(tab?.slug).toBe('consensus');
      expect(tab?.timezone).toBe('America/New_York');
    });

    // Callers must handle a miss themselves (usually `?? DEFAULT_TAB`)
    // instead of getTabConfig silently guessing -- see the regression this
    // fixed: a conference not in the fallback list briefly inherited
    // whatever conference happened to be first in the list it was passed,
    // including that conference's dates, which filtered out every event.
    it('returns undefined for an unknown conference name instead of guessing', () => {
      const tab = getTabConfig('Nonexistent Conference');
      expect(tab).toBeUndefined();
    });

    it('returns undefined for an empty string instead of guessing', () => {
      const tab = getTabConfig('');
      expect(tab).toBeUndefined();
    });

    it('looks up against a provided tab list, not just EVENT_TABS', () => {
      const customTabs = [
        { gid: 999, name: 'DevCon 8', slug: 'devcon8', timezone: 'Asia/Kolkata', dates: ['2026-11-17'], center: { lat: 19.076, lng: 72.8777 } },
      ];
      expect(getTabConfig('DevCon 8', customTabs)?.slug).toBe('devcon8');
      expect(getTabConfig('Paris Blockchain Week 2026', customTabs)).toBeUndefined();
    });
  });

  describe('getTabBySlug', () => {
    it('finds tab by lowercase slug', () => {
      const tab = getTabBySlug('pbw');
      expect(tab).toBeDefined();
      expect(tab!.name).toBe('Paris Blockchain Week 2026');
    });

    it('finds tab by uppercase slug (case-insensitive)', () => {
      const tab = getTabBySlug('PBW');
      expect(tab).toBeDefined();
      expect(tab!.slug).toBe('pbw');
    });

    it('finds tab by mixed case slug', () => {
      const tab = getTabBySlug('Bitcoin');
      expect(tab).toBeDefined();
      expect(tab!.name).toBe('Bitcoin Vegas');
    });

    it('returns undefined for unknown slug', () => {
      const tab = getTabBySlug('nonexistent');
      expect(tab).toBeUndefined();
    });

    it('returns undefined for empty slug', () => {
      const tab = getTabBySlug('');
      expect(tab).toBeUndefined();
    });

    it('finds consensus tab', () => {
      const tab = getTabBySlug('consensus');
      expect(tab).toBeDefined();
      expect(tab!.name).toBe('Consensus Miami');
    });
  });

  describe('TIME_RANGES', () => {
    it('has all four time ranges', () => {
      expect(TIME_RANGES).toHaveProperty('morning');
      expect(TIME_RANGES).toHaveProperty('afternoon');
      expect(TIME_RANGES).toHaveProperty('evening');
      expect(TIME_RANGES).toHaveProperty('night');
    });

    it('morning is 6-12', () => {
      expect(TIME_RANGES.morning.start).toBe(6);
      expect(TIME_RANGES.morning.end).toBe(12);
    });

    it('afternoon is 12-17', () => {
      expect(TIME_RANGES.afternoon.start).toBe(12);
      expect(TIME_RANGES.afternoon.end).toBe(17);
    });

    it('evening is 17-21', () => {
      expect(TIME_RANGES.evening.start).toBe(17);
      expect(TIME_RANGES.evening.end).toBe(21);
    });

    it('night is 21-6', () => {
      expect(TIME_RANGES.night.start).toBe(21);
      expect(TIME_RANGES.night.end).toBe(6);
    });
  });
});
