# Check-In Enhancements & Friend Map Pins

## Current State

### What Already Works
- **Manual check-in**: Two entry points — UserMenu button (150m proximity check) and AddressLink button (no proximity check)
- **Database**: `check_ins` table with `user_id`, `event_id`, `lat`, `lng`, `checked_out_at`, `created_at`
- **Friends checked-in display**: `useCheckIns` hook fetches friend check-ins, EventCard/EventPopup show green "friends checked in" rows
- **Friend locations**: `user_locations` table + `get_friends_locations()` RPC, `FriendMarker` component renders friend avatars on map
- **Geolocation**: `distanceMeters()` Haversine function in `src/lib/geo.ts`

### What's Missing
1. **Auto check-in**: No background geolocation watching, always user-initiated
2. **Friend pins from check-ins**: Friend markers show raw GPS, not snapped to event locations
3. **Periodic refresh**: `useCheckIns` fetches once on mount, no refresh interval

---

## Phase 1: Auto Check-In via Proximity

**New file**: `src/hooks/useAutoCheckIn.ts`

- `watchPosition()` with `enableHighAccuracy: false` (battery-friendly)
- Throttle checks to every 2 minutes
- Filter itinerary events within 150m that pass `passesNowFilter()`
- Upsert matching events to `check_ins` (skip already checked-in)
- Return `recentAutoCheckIns` for toast display
- Track session-local set of auto-checked events to avoid repeat notifications

**New file**: `src/components/CheckInToast.tsx`
- Auto-dismissing toast: "You're at [Event Name] — Checked in!"

**Modified**: `src/components/EventApp.tsx`
- Wire `useAutoCheckIn` hook
- Render `CheckInToast`

## Phase 2: Friend Check-In Map Pins

**Goal**: When a friend checks in at an event, show them at the event's lat/lng (not raw GPS).

**Type change** (`src/lib/types.ts`):
```typescript
export interface FriendLocation {
  // existing fields...
  checkedInEventName?: string; // NEW
}
```

**Modified**: `src/components/EventApp.tsx`
- Compute `friendCheckInLocations` from `checkedInFriendsByEvent` + events data
- For each event with checked-in friends, map to `FriendLocation[]` with event's lat/lng
- Merge with raw GPS locations, preferring check-in location

**Modified**: `src/components/FriendMarker.tsx`
- Accept optional `eventName` prop
- Render event name badge when present (green border variant)

**Modified**: `src/components/MapView.tsx`
- Render check-in-derived friend markers at event coordinates

## Phase 3: Periodic Check-In Refresh

**Modified**: `src/hooks/useCheckIns.ts`
- Add `setInterval` to re-fetch every 2 minutes
- Friend auto-check-ins appear promptly

---

## Privacy
All features are friends-only by design:
- `useCheckIns` scopes to friend user IDs
- `get_friends_locations()` RPC joins on `friendships`
- RLS policies on all tables
- Auto-check-in requires itinerary + geolocation permission (user opt-in)

## No Database Changes Needed
Existing `check_ins` and `user_locations` tables are sufficient.

## Files Summary

| Action | File |
|--------|------|
| Create | `src/hooks/useAutoCheckIn.ts` |
| Create | `src/components/CheckInToast.tsx` |
| Modify | `src/components/EventApp.tsx` |
| Modify | `src/lib/types.ts` |
| Modify | `src/components/FriendMarker.tsx` |
| Modify | `src/components/MapView.tsx` |
| Modify | `src/hooks/useCheckIns.ts` |
