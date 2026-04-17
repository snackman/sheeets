import type { ConferenceConfig } from './types';

export const SHEET_ID = '1xWmIHyEyOmPHfkYuZkucPRlLGWbb9CF6Oqvfl8FUV6k';

/**
 * Generate an array of ISO date strings between startDate and endDate (inclusive).
 */
export function datesToArray(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

/**
 * Check if a conference's endDate is in the past (timezone-aware).
 */
export function isConferencePast(conf: ConferenceConfig): boolean {
  // Get "today" in the conference's timezone
  const nowInTz = new Date().toLocaleDateString('en-CA', { timeZone: conf.timezone });
  return conf.endDate < nowInTz;
}

/**
 * Filter active conferences: not past AND not hidden. Sorted by startDate ascending.
 */
export function getActiveConferences(allConfs: ConferenceConfig[]): ConferenceConfig[] {
  return allConfs
    .filter((c) => !c.hidden && !isConferencePast(c))
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}

/** Tab format used by fetchEvents and other consumers */
export interface TabConfig {
  gid: number;
  name: string;
  slug: string;
  timezone: string;
  dates: string[];
  center: { lat: number; lng: number };
}

/**
 * Convert a ConferenceConfig to the legacy TabConfig format.
 */
export function conferenceToTab(conf: ConferenceConfig): TabConfig {
  return {
    gid: conf.gid,
    name: conf.name,
    slug: conf.slug,
    timezone: conf.timezone,
    dates: datesToArray(conf.startDate, conf.endDate),
    center: conf.center,
  };
}

/**
 * Fallback tabs — hardcoded for when Supabase is unreachable.
 * These mirror the current active conferences.
 */
export const FALLBACK_TABS: TabConfig[] = [
  {
    gid: 1604258025,
    name: 'Paris Blockchain Week 2026',
    slug: 'pbw',
    timezone: 'Europe/Paris',
    dates: [
      '2026-04-11', '2026-04-12', '2026-04-13', '2026-04-14',
      '2026-04-15', '2026-04-16', '2026-04-17',
    ],
    center: { lat: 48.8566, lng: 2.3522 },
  },
  {
    gid: 1002070994,
    name: 'Bitcoin Vegas 2026',
    slug: 'bitcoin',
    timezone: 'America/Los_Angeles',
    dates: [
      '2026-04-26', '2026-04-27', '2026-04-28', '2026-04-29',
      '2026-04-30', '2026-05-01',
    ],
    center: { lat: 36.1699, lng: -115.1398 },
  },
  {
    gid: 2092019144,
    name: 'Consensus Miami 2026',
    slug: 'consensus',
    timezone: 'America/New_York',
    dates: [
      '2026-05-03', '2026-05-04', '2026-05-05', '2026-05-06',
      '2026-05-07',
    ],
    center: { lat: 25.7617, lng: -80.1918 },
  },
];

/** Backward-compatible export */
export const EVENT_TABS = FALLBACK_TABS;

export const DEFAULT_TAB = EVENT_TABS[0];

/** Get tab config by conference name */
export function getTabConfig(conference: string, tabs?: TabConfig[]) {
  const list = tabs || EVENT_TABS;
  return list.find((t) => t.name === conference) ?? list[0] ?? DEFAULT_TAB;
}

/** Get tab config by URL slug */
export function getTabBySlug(slug: string, tabs?: TabConfig[]) {
  const list = tabs || EVENT_TABS;
  return list.find((t) => t.slug === slug.toLowerCase());
}

/** @deprecated Use getTabConfig(conference).timezone */
export const CONFERENCE_TIMEZONE = DEFAULT_TAB.timezone;

/** @deprecated Use getTabConfig(conference).dates */
export const EVENT_DATES = DEFAULT_TAB.dates;

/** @deprecated Use getTabConfig(conference).center */
export const DENVER_CENTER = DEFAULT_TAB.center;

export const TIME_RANGES = {
  morning: { start: 6, end: 12, label: 'Morning' },
  afternoon: { start: 12, end: 17, label: 'Afternoon' },
  evening: { start: 17, end: 21, label: 'Evening' },
  night: { start: 21, end: 6, label: 'Night' },
};
