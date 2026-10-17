import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConferenceConfig } from '@/lib/types';

// Minimal fake standing in for the one query shape get-conferences.ts makes:
// `.from('admin_config').select('value').eq('key', 'conferences').single()`.
let fakeConfigs: ConferenceConfig[] = [];

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _val: string) => ({
          single: async () => ({ data: { value: fakeConfigs }, error: null }),
        }),
      }),
    }),
  }),
}));

const TODAY = new Date();
function isoDaysFromNow(days: number): string {
  const d = new Date(TODAY);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function conf(partial: Partial<ConferenceConfig> & { name: string; slug: string }): ConferenceConfig {
  return {
    gid: 1,
    timezone: 'UTC',
    startDate: isoDaysFromNow(10),
    endDate: isoDaysFromNow(12),
    center: { lat: 0, lng: 0 },
    ...partial,
  };
}

describe('getUpcomingConferences', () => {
  beforeEach(() => {
    fakeConfigs = [];
    vi.resetModules();
  });

  it('excludes a hidden conference even when a visible, already-active one is also present', async () => {
    // A non-hidden, non-past conference is always "active" (shown in the
    // home page's "Browse Events" section regardless of how far away its
    // startDate is), so it must never show up in "Upcoming" either --
    // only a hidden conference could previously end up here, which was
    // exactly the bug (hidden conferences leaking into "Upcoming").
    fakeConfigs = [
      conf({ name: 'ETHDenver 2027', slug: 'ethdenver8', hidden: true, startDate: isoDaysFromNow(60), endDate: isoDaysFromNow(65) }),
      conf({ name: 'Visible Active Conf', slug: 'visible-active', hidden: false, startDate: isoDaysFromNow(30), endDate: isoDaysFromNow(35) }),
    ];
    const { getUpcomingConferences } = await import('@/lib/get-conferences');
    const upcoming = await getUpcomingConferences();

    expect(upcoming).toEqual([]);
    expect(upcoming.some((c) => c.name === 'ETHDenver 2027')).toBe(false);
  });

  it('returns an empty list when every not-yet-active conference is hidden', async () => {
    fakeConfigs = [
      conf({ name: 'EthCC[10]', slug: 'ethcc10', hidden: true, startDate: isoDaysFromNow(90), endDate: isoDaysFromNow(95) }),
      conf({ name: 'TOKEN2049 Dubai', slug: 'token2049-dubai', hidden: true, startDate: isoDaysFromNow(100), endDate: isoDaysFromNow(103) }),
    ];
    const { getUpcomingConferences } = await import('@/lib/get-conferences');
    const upcoming = await getUpcomingConferences();

    expect(upcoming).toEqual([]);
  });
});

describe('getAllConferenceTabs', () => {
  beforeEach(() => {
    fakeConfigs = [];
    vi.resetModules();
  });

  it('still includes hidden conferences, so admin and the ingestion cron can reach them', async () => {
    fakeConfigs = [
      conf({ name: 'ETHDenver 2027', slug: 'ethdenver8', hidden: true }),
    ];
    const { getAllConferenceTabs } = await import('@/lib/get-conferences');
    const tabs = await getAllConferenceTabs();

    expect(tabs.map((t) => t.name)).toContain('ETHDenver 2027');
  });
});

describe('getConferenceTabs', () => {
  beforeEach(() => {
    fakeConfigs = [];
    vi.resetModules();
  });

  it('excludes hidden conferences from the active/public tab list', async () => {
    fakeConfigs = [
      conf({ name: 'ETHDenver 2027', slug: 'ethdenver8', hidden: true, startDate: isoDaysFromNow(-1), endDate: isoDaysFromNow(2) }),
      conf({ name: 'Visible Conf', slug: 'visible', hidden: false, startDate: isoDaysFromNow(-1), endDate: isoDaysFromNow(2) }),
    ];
    const { getConferenceTabs } = await import('@/lib/get-conferences');
    const tabs = await getConferenceTabs();

    expect(tabs.map((t) => t.name)).toEqual(['Visible Conf']);
  });
});
