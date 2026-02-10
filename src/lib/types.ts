export interface ETHDenverEvent {
  id: string;
  date: string;          // Raw: "Sat, Feb 22"
  dateISO: string;       // Parsed: "2025-02-22"
  startTime: string;     // Raw: "12:00p" or "6:00 PM"
  endTime: string;       // Raw
  isAllDay: boolean;
  organizer: string;
  name: string;
  address: string;
  cost: string;
  isFree: boolean;
  vibe: string;
  link: string;
  hasFood: boolean;
  hasBar: boolean;
  note: string;
  lat?: number;
  lng?: number;
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night' | 'all-day';
}

export interface FilterState {
  selectedDays: string[];
  timeOfDay: string[];
  vibes: string[];
  freeOnly: boolean;
  hasFood: boolean;
  hasBar: boolean;
  starredOnly: boolean;
  itineraryOnly: boolean;
  searchQuery: string;
}

export interface UserState {
  starred: string[];
  itinerary: string[];
}

export type ViewMode = 'map' | 'list';
