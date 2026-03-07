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

export const VIBE_COLORS: Record<string, string> = {
  // Green group — event formats
  'Conference': '#34D399',
  'Panel/Talk': '#34D399',
  'Hackathon': '#34D399',
  'Networking': '#34D399',
  'Workshop': '#34D399',
  'Party': '#34D399',
  'Brunch': '#34D399',
  'Bar': '#34D399',
  'Meetup': '#34D399',
  'Demo Day': '#34D399',
  'Dinner': '#34D399',
  'Wellness': '#34D399',
  'Performance': '#34D399',
  'Art': '#34D399',
  'Session': '#34D399',
  'Showcase': '#34D399',
  'Special Event': '#34D399',
  'Activation': '#34D399',
  'Lounge': '#34D399',
  'Exhibition': '#34D399',
  'Screening': '#34D399',
  'Vibe': '#34D399',
  '$$': '#A855F7',
  '🍕 Food': '#34D399',
  '🍺 Bar': '#34D399',
  // Blue group — builders & business
  'Devs': '#3B82F6',
  'VCs': '#3B82F6',
  'Jobs': '#3B82F6',
  // Yellow group — crypto & topics
  'DePIN': '#FBBF24',
  'AI': '#FBBF24',
  'DeFi': '#FBBF24',
  'NFTs': '#FBBF24',
  'Memecoins': '#FBBF24',
  'Ordinals': '#FBBF24',
  'BTC': '#FBBF24',
  'ETH': '#FBBF24',
  'SOL': '#FBBF24',
  'DAOs': '#FBBF24',
  'RWA': '#FBBF24',
  'Gaming': '#FBBF24',
  'Tech': '#FBBF24',
  // Pink group — entertainment & culture
  'Culture': '#F472B6',
  'Music': '#F472B6',
  'Film/TV': '#F472B6',
  'Comedy': '#F472B6',
  // Teal — education
  'Education': '#2DD4BF',
  'default': '#6B7280',
};

/** Tags that describe event format/type (vs topic/interest tags) */
export const TYPE_TAGS = [
  '$$',
  '🍕 Food',
  '🍺 Bar',
  'Conference',
  'Panel/Talk',
  'Hackathon',
  'Networking',
  'Workshop',
  'Party',
  'Brunch',
  'Bar',
  'Meetup',
  'Demo Day',
  'Dinner',
  'Wellness',
  'Performance',
  'Session',
  'Showcase',
  'Special Event',
  'Activation',
  'Lounge',
  'Exhibition',
  'Screening',
  'Vibe',
];

export const STORAGE_KEYS = {
  ITINERARY: 'sheeets-itinerary',
  ITINERARY_UPDATED: 'sheeets-itinerary-updated',
  VIEW_MODE: 'sheeets-view',
  ONBOARDING_COMPLETED: 'sheeets-onboarding-done',
};

export const TIME_RANGES = {
  morning: { start: 6, end: 12, label: 'Morning' },
  afternoon: { start: 12, end: 17, label: 'Afternoon' },
  evening: { start: 17, end: 21, label: 'Evening' },
  night: { start: 21, end: 6, label: 'Night' },
};

export const POI_CATEGORIES = [
  { value: 'pin', label: 'Pin', icon: 'MapPin', color: '#94A3B8' },
  { value: 'hotel', label: 'Hotel', icon: 'BedDouble', color: '#60A5FA' },
  { value: 'food', label: 'Food', icon: 'Utensils', color: '#F97316' },
  { value: 'drink', label: 'Drink', icon: 'Wine', color: '#A855F7' },
  { value: 'work', label: 'Work', icon: 'Laptop', color: '#34D399' },
  { value: 'meeting', label: 'Meeting', icon: 'Users', color: '#FBBF24' },
] as const;

export const MAX_POIS = 20;

export const REACTION_EMOJIS = ['🔥', '❤️', '💯', '👍', '🎉', '👀'] as const;
