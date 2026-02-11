export interface ETHDenverEvent {
  id: string;
  date: string;          // Raw: "Tue, Feb 10"
  dateISO: string;       // Parsed: "2026-02-10"
  startTime: string;     // Raw: "12:00p" or "6:00 PM"
  endTime: string;       // Raw
  isAllDay: boolean;
  organizer: string;
  name: string;
  address: string;
  cost: string;
  isFree: boolean;
  vibe: string;          // Primary tag (first tag)
  tags: string[];        // All tags from comma-separated Tags column
  conference: string;    // Which tab/conference this event belongs to
  link: string;
  hasFood: boolean;
  hasBar: boolean;
  note: string;
  lat?: number;
  lng?: number;
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night' | 'all-day';
  isDuplicate?: boolean;
}

export interface FilterState {
  conference: string;
  selectedDays: string[];
  timeStart: number;   // 0-24 hour
  timeEnd: number;     // 0-24 hour
  vibes: string[];
  freeOnly: boolean;
  hasFood: boolean;
  hasBar: boolean;
  itineraryOnly: boolean;
  searchQuery: string;
  nowMode: boolean;
}

export interface UserState {
  itinerary: string[];
}

export type ViewMode = 'map' | 'list' | 'table';
