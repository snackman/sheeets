import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchEvents } from '../fetch-events';
import { gvizTypedColumnsResponseString } from './fixtures/gviz-response';
import type { TabConfig } from '../conferences';

// Bug (audit finding): `fetchEventsCached()` always called
// `fetchEvents(undefined, tabs)`, so the `runtimeAddresses` map --
// coordinates written to the shared `geocoded_addresses` Supabase table by
// ingestion/approve/the geocode cron -- was never actually passed in. Any
// address geocoded since the last `npm run build` (which bakes the static
// `geocoded-addresses.json`) had real coordinates sitting in Supabase that
// never reached a map pin. These tests cover the merge itself: that
// `fetchEvents` uses `runtimeAddresses` when present, keyed by the same
// `normalizeAddress()` the rest of the app uses, and leaves an address with
// no match (static or runtime) un-geocoded rather than guessing.
const tab: TabConfig = {
  gid: 698718887,
  name: 'Devcon 8 2026',
  slug: 'devcon',
  timezone: 'UTC',
  dates: [],
  center: { lat: 19.076, lng: 72.8777 },
};

describe('fetchEvents: merging the runtime geocoded_addresses cache', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        text: async () => gvizTypedColumnsResponseString,
      }))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('leaves lat/lng undefined for an address with no runtime or static match', async () => {
    const events = await fetchEvents(undefined, [tab]);
    const event = events.find((e) => e.address === 'Mumbai, India');
    expect(event).toBeDefined();
    expect(event!.lat).toBeUndefined();
    expect(event!.lng).toBeUndefined();
  });

  it('uses the runtime (Supabase) coordinates when provided, keyed by normalizeAddress()', async () => {
    const events = await fetchEvents(
      { 'mumbai, india': { lat: 19.076, lng: 72.8777, matchedAddress: 'Mumbai, Maharashtra, India' } },
      [tab]
    );
    const event = events.find((e) => e.address === 'Mumbai, India');
    expect(event).toBeDefined();
    expect(event!.lat).toBe(19.076);
    expect(event!.lng).toBe(72.8777);
    expect(event!.matchedAddress).toBe('Mumbai, Maharashtra, India');
  });

  it('only applies the runtime match to the address it matches, not every event', async () => {
    const events = await fetchEvents(
      { 'mumbai, india': { lat: 19.076, lng: 72.8777 } },
      [tab]
    );
    const other = events.find((e) => e.address === 'Bandra West, Mumbai');
    expect(other).toBeDefined();
    expect(other!.lat).toBeUndefined();
    expect(other!.lng).toBeUndefined();
  });

  it('keeps regional side-event pins (Pune is ~120 km from Mumbai, inside the 300 km sanity radius)', async () => {
    const events = await fetchEvents(
      { 'mumbai, india': { lat: 18.5204, lng: 73.8567, matchedAddress: 'Pune, Maharashtra, India' } },
      [tab]
    );
    const event = events.find((e) => e.address === 'Mumbai, India');
    expect(event!.lat).toBe(18.5204);
  });

  it('drops cached coordinates far from the conference center (bad geocode, e.g. Fort Worth for Mumbai)', async () => {
    const events = await fetchEvents(
      { 'mumbai, india': { lat: 32.7555, lng: -97.3308, matchedAddress: 'World Way, Fort Worth, Texas' } },
      [tab]
    );
    const event = events.find((e) => e.address === 'Mumbai, India');
    expect(event).toBeDefined();
    expect(event!.lat).toBeUndefined();
    expect(event!.lng).toBeUndefined();
    expect(event!.matchedAddress).toBeUndefined();
  });
});
