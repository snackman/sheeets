export const SHEET_ID = '1xWmIHyEyOmPHfkYuZkucPRlLGWbb9CF6Oqvfl8FUV6k';
export const GVIZ_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&gid=0`;

export const EVENT_DATES = [
  '2025-02-20', '2025-02-21', '2025-02-22', '2025-02-23',
  '2025-02-24', '2025-02-25', '2025-02-26', '2025-02-27',
  '2025-02-28', '2025-03-01', '2025-03-02', '2025-03-03', '2025-03-04',
];

export const DENVER_CENTER = { lat: 39.7392, lng: -104.9903 };

export const VIBE_COLORS: Record<string, string> = {
  'Hack': '#3B82F6',
  'Contest': '#8B5CF6',
  'Party': '#EC4899',
  'Workshop': '#10B981',
  'Networking': '#F59E0B',
  'Panel': '#6366F1',
  'Demo Day': '#EF4444',
  'Meetup': '#14B8A6',
  'Conference': '#F97316',
  'default': '#6B7280',
};

export const STORAGE_KEYS = {
  STARRED: 'ethdenver-2025-starred',
  ITINERARY: 'ethdenver-2025-itinerary',
  VIEW_MODE: 'ethdenver-2025-view',
};

export const TIME_RANGES = {
  morning: { start: 6, end: 12, label: 'Morning' },
  afternoon: { start: 12, end: 17, label: 'Afternoon' },
  evening: { start: 17, end: 21, label: 'Evening' },
  night: { start: 21, end: 6, label: 'Night' },
};
