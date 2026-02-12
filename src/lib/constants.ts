export const SHEET_ID = '1xWmIHyEyOmPHfkYuZkucPRlLGWbb9CF6Oqvfl8FUV6k';

export const EVENT_TABS = [
  { gid: 356217373, name: 'ETH Denver 2026' },
  { gid: 377806756, name: 'Consensus Hong Kong 2026' },
];

export const EVENT_DATES = [
  '2026-02-10', '2026-02-11', '2026-02-12', '2026-02-13',
  '2026-02-14', '2026-02-15', '2026-02-16', '2026-02-17',
  '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-21',
];

export const DENVER_CENTER = { lat: 39.7392, lng: -104.9903 };

export const VIBE_COLORS: Record<string, string> = {
  'FREE': '#10B981',
  '$$': '#F59E0B',
  '🍕 Food': '#F97316',
  '🍺 Bar': '#FBBF24',
  'Conference': '#F97316',
  'Panel/Talk': '#6366F1',
  'Hackathon': '#3B82F6',
  'Networking': '#F59E0B',
  'Devs/Builders': '#10B981',
  'VCs/Angels': '#8B5CF6',
  'AI': '#EC4899',
  'DeFi': '#14B8A6',
  'DAOs': '#EF4444',
  'NFTs': '#A855F7',
  'DePIN': '#06B6D4',
  'RWA': '#84CC16',
  'ETH': '#818CF8',
  'BTC': '#F59E0B',
  'SOL': '#9333EA',
  'Gaming': '#22D3EE',
  'Art': '#F472B6',
  'Wellness': '#34D399',
  'Brunch': '#FB923C',
  'Bar/Pub': '#FBBF24',
  'Jobs/Hiring': '#2DD4BF',
  'Memecoins': '#E879F9',
  'Party': '#EC4899',
  'Workshop': '#10B981',
  'Meetup': '#14B8A6',
  'Demo Day': '#EF4444',
  'Dinner': '#F97316',
  'Performance': '#A855F7',
  'default': '#6B7280',
};

/** Tags that describe event format/type (vs topic/interest tags) */
export const TYPE_TAGS = [
  'FREE',
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
  'Bar/Pub',
  'Meetup',
  'Demo Day',
  'Dinner',
  'Wellness',
  'Performance',
];

export const STORAGE_KEYS = {
  ITINERARY: 'sheeets-itinerary',
  ITINERARY_UPDATED: 'sheeets-itinerary-updated',
  VIEW_MODE: 'sheeets-view',
  THEME: 'sheeets-theme',
};

export const TIME_RANGES = {
  morning: { start: 6, end: 12, label: 'Morning' },
  afternoon: { start: 12, end: 17, label: 'Afternoon' },
  evening: { start: 17, end: 21, label: 'Evening' },
  night: { start: 21, end: 6, label: 'Night' },
};
