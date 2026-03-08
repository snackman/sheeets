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
  matchedAddress?: string;
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night' | 'all-day';
  isDuplicate?: boolean;
  isFeatured?: boolean;
}

export interface FilterState {
  conference: string;
  startDateTime: string;  // ISO local: "2026-02-16T14:00"
  endDateTime: string;    // ISO local: "2026-02-21T23:59"
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

export type ReactionEmoji = '🔥' | '❤️' | '💯' | '👍' | '🎉' | '👀';

export interface EventReaction {
  id: string;
  event_id: string;
  user_id: string;
  emoji: ReactionEmoji;
  visibility: 'public' | 'friends';
  created_at: string;
}

export interface EventComment {
  id: string;
  event_id: string;
  user_id: string;
  text: string;
  visibility: 'public' | 'friends';
  created_at: string;
  display_name?: string;
  x_handle?: string;
}

export interface FriendLocation {
  user_id: string;
  lat: number;
  lng: number;
  updated_at: string;
  display_name?: string;
  x_handle?: string;
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
  is_public: boolean;
  created_at: string;
}

export interface SponsorEntry {
  beforeText: string;
  linkText: string;
  afterText: string;
  url: string;
}

export interface NativeAd {
  id: string;
  title: string;
  description: string;
  link: string;
  imageUrl: string;
  conference: string;
  badge: string;
  active: boolean;
}

export interface UpsellCopy {
  heading: string;
  body: string;
  cta_text: string;
  cta_url: string;
}

export interface AdInventoryItem {
  id: string;
  title: string;
  slug: string;
  description: string;
  price: string;
  priceNote?: string;
  stats?: string;
  features: string[];
  imageUrl?: string;
  badge?: string;
  available: boolean;
  sortOrder: number;
}

export interface SponsorshipTier {
  name: string;
  price: string;
  features: string[];
  highlighted: boolean;
}

export interface AdvertisePageConfig {
  heroHeading: string;
  heroSubheading: string;
  statsLine: string;
  ctaText: string;
  ctaUrl: string;
  ctaSecondaryText: string;
  ctaSecondaryUrl: string;
  footerText: string;
  tiersEnabled: boolean;
  tiers: SponsorshipTier[];
}

export interface AdminConfig {
  sponsors: SponsorEntry[];
  sponsors_cta: { text: string };
  native_ads: NativeAd[];
  upsell_copy: UpsellCopy;
  ad_inventory?: AdInventoryItem[];
  advertise_page?: AdvertisePageConfig;
  [key: string]: unknown;
}
