export const SHEET_ID = '1xWmIHyEyOmPHfkYuZkucPRlLGWbb9CF6Oqvfl8FUV6k';

export const EVENT_TABS = [
  {
    gid: 666597336,
    name: 'DAS 2026',
    slug: 'das',
    timezone: 'America/New_York',
    dates: [
      '2026-03-21', '2026-03-22', '2026-03-23', '2026-03-24',
      '2026-03-25', '2026-03-26', '2026-03-27',
    ],
    center: { lat: 40.7128, lng: -74.0060 },
  },
  {
    gid: 437576609,
    name: 'ETHCC 2026',
    slug: 'ethcc',
    timezone: 'Europe/Paris',
    dates: [
      '2026-03-27', '2026-03-28', '2026-03-29', '2026-03-30',
      '2026-03-31', '2026-04-01', '2026-04-02',
    ],
    center: { lat: 43.5528, lng: 7.0174 },
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

export const DEFAULT_TAB = EVENT_TABS[0];

/** Get tab config by conference name */
export function getTabConfig(conference: string) {
  return EVENT_TABS.find((t) => t.name === conference) ?? DEFAULT_TAB;
}

/** Get tab config by URL slug */
export function getTabBySlug(slug: string) {
  return EVENT_TABS.find((t) => t.slug === slug.toLowerCase());
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
