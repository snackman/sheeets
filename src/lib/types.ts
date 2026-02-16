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
  timeStart: number;   // 0-24 in 0.5 increments (e.g. 6, 6.5, 7, ...)
  timeEnd: number;     // 0-24 in 0.5 increments
  vibes: string[];
  selectedFriends: string[];
  itineraryOnly: boolean;
  searchQuery: string;
  nowMode: boolean;
}

export interface UserState {
  itinerary: string[];
}

export type ViewMode = 'map' | 'list' | 'table';

export interface UserProfile {
  user_id: string;
  email: string | null;
  display_name: string | null;
  x_handle: string | null;
  rsvp_name: string | null;
}

export interface Friend {
  user_id: string;
  email: string | null;
  display_name: string | null;
  x_handle: string | null;
  rsvp_name: string | null;
}

export interface FriendRequest {
  id: string;
  sender_id: string;
  receiver_id: string;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
  sender_profile?: { display_name: string | null; email: string | null; x_handle: string | null };
  receiver_profile?: { display_name: string | null; email: string | null; x_handle: string | null };
}

export interface UserSearchResult {
  user_id: string;
  display_name: string | null;
  x_handle: string | null;
  email: string | null;
  rsvp_name: string | null;
  request_status: 'pending_outgoing' | 'pending_incoming' | null;
}

export type POICategory = 'pin' | 'hotel' | 'food' | 'drink' | 'work' | 'meeting';

export interface POI {
  id: string;
  user_id: string;
  name: string;
  lat: number;
  lng: number;
  address: string | null;
  category: POICategory;
  note: string | null;
  conference: string | null;
  created_at: string;
}
