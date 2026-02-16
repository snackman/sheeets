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
  // Green group — event formats
  'Conference': '#34D399',
  'Panel/Talk': '#34D399',
  'Hackathon': '#34D399',
  'Networking': '#34D399',
  'Workshop': '#34D399',
  'Party': '#34D399',
  'Brunch': '#34D399',
  'Bar/Pub': '#34D399',
  'Meetup': '#34D399',
  'Demo Day': '#34D399',
  'Dinner': '#34D399',
  'Wellness': '#34D399',
  'Performance': '#34D399',
  'Art': '#34D399',
  '$$': '#A855F7',
  '🍕 Food': '#34D399',
  '🍺 Bar': '#34D399',
  // Blue group — builders & business
  'Devs/Builders': '#3B82F6',
  'VCs/Angels': '#3B82F6',
  'Jobs/Hiring': '#3B82F6',
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
