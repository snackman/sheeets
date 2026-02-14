/** Lightweight wrapper around gtag for custom event tracking */

type GtagFn = (...args: unknown[]) => void;

declare global {
  interface Window {
    gtag?: GtagFn;
  }
}

function track(eventName: string, params?: Record<string, string | number | boolean>) {
  if (typeof window !== 'undefined' && window.gtag) {
    window.gtag('event', eventName, params);
  }
}

// View mode
export const trackViewChange = (mode: string) =>
  track('view_change', { view_mode: mode });

// Conference selection
export const trackConferenceSelect = (conference: string) =>
  track('conference_select', { conference });

// Tag/vibe toggle
export const trackTagToggle = (tag: string, active: boolean) =>
  track('tag_toggle', { tag, active });

// Day range change
export const trackDayRange = (startDay: string, endDay: string) =>
  track('day_range', { start_day: startDay, end_day: endDay });

// Time range change
export const trackTimeRange = (startHour: number, endHour: number) =>
  track('time_range', { start_hour: startHour, end_hour: endHour });

// Now mode toggle
export const trackNowMode = (active: boolean) =>
  track('now_mode', { active });

// Search
export const trackSearch = (query: string) =>
  track('search', { search_term: query });

// Itinerary
export const trackItinerary = (eventId: string, action: 'add' | 'remove') =>
  track('itinerary', { event_id: eventId, action });

// Event link click
export const trackEventClick = (eventName: string, url: string) =>
  track('event_click', { event_name: eventName, url });

// Auth
export const trackAuthPrompt = (trigger: string) =>
  track('auth_prompt', { trigger });

export const trackAuthSuccess = () =>
  track('auth_success');

export const trackSignOut = () =>
  track('sign_out');

// Map
export const trackLocateMe = () =>
  track('locate_me');

// Clear filters
export const trackClearFilters = () =>
  track('clear_filters');

// Social / Friends
export const trackProfileUpdate = () => track('profile_update');
export const trackFriendCodeGenerate = () => track('friend_code_generate');
export const trackFriendCodeCopy = () => track('friend_code_copy');
export const trackFriendAdded = () => track('friend_added');
export const trackFriendFilter = (friendName: string, active: boolean) =>
  track('friend_filter', { friend_name: friendName, active });
