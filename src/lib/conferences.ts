export const SHEET_ID = '1xWmIHyEyOmPHfkYuZkucPRlLGWbb9CF6Oqvfl8FUV6k';

export const EVENT_TABS = [
  {
    gid: 1543768695,
    name: 'SXSW 2026',
    slug: 'sxsw',
    timezone: 'America/Chicago',
    dates: [
      '2026-03-05', '2026-03-06', '2026-03-07', '2026-03-08',
      '2026-03-09', '2026-03-10', '2026-03-11', '2026-03-12',
      '2026-03-13', '2026-03-14', '2026-03-15', '2026-03-16',
      '2026-03-17', '2026-03-18',
    ],
    center: { lat: 30.2672, lng: -97.7431 },
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
    gid: 1672479012,
    name: 'GDC 2026',
    slug: 'gdc',
    timezone: 'America/Los_Angeles',
    dates: [
      '2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10',
      '2026-03-11', '2026-03-12', '2026-03-13', '2026-03-14',
    ],
    center: { lat: 37.7749, lng: -122.4194 },
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
