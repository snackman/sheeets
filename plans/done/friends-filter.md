# Friends Filter

## Summary

Add a "Friends" filter row to the FilterBar — between Days and Type — that lets users filter events to only show events on selected friends' itineraries. Only appears when the user has friends with itinerary events for the current conference.

## Implementation Steps

### 1. Database Migration — `get_friends_itineraries` RPC

Create a Postgres function that securely returns friends' itineraries (bypasses RLS via `SECURITY DEFINER`):

```sql
CREATE OR REPLACE FUNCTION get_friends_itineraries()
RETURNS TABLE(user_id uuid, event_ids text[])
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT i.user_id, i.event_ids
  FROM itineraries i
  WHERE i.user_id IN (
    SELECT f.user_b FROM friendships f WHERE f.user_a = auth.uid()
    UNION
    SELECT f.user_a FROM friendships f WHERE f.user_b = auth.uid()
  )
  AND array_length(i.event_ids, 1) > 0;
$$;
```

### 2. Types — `src/lib/types.ts`

Add `selectedFriends: string[]` to `FilterState`.

### 3. useFilters — `src/hooks/useFilters.ts`

- Add `selectedFriends: []` to defaults
- Add `toggleFriend` callback
- Update `activeFilterCount` to count friends filter

### 4. New Hook — `src/hooks/useFriendsItineraries.ts`

- Takes `friends` array from `useFriends`
- Calls `get_friends_itineraries` RPC
- Returns per-friend itinerary data with display names
- Only fetches when user is authenticated and has friends

### 5. Filter Logic — `src/lib/filters.ts`

Add `friendEventIds?: Set<string>` parameter to `applyFilters`. If `selectedFriends.length > 0` and event isn't in the set, filter it out.

### 6. Analytics — `src/lib/analytics.ts`

Add `trackFriendFilter` event.

### 7. FilterBar UI — `src/components/FilterBar.tsx`

- New props: `friendsForFilter`, `selectedFriends`, `onToggleFriend`
- Add Friends chip row between Days/Time and Type sections
- Blue pills with `Users` icon, horizontally scrollable
- Only renders when `friendsForFilter.length > 0`

### 8. EventApp Orchestration — `src/components/EventApp.tsx`

- Import and call `useFriendsItineraries` hook
- Compute `friendsForFilter` (friends with events in current conference)
- Compute `selectedFriendEventIds` (union of selected friends' event IDs)
- Pass to `applyFilters` and `FilterBar`
- Cleanup effect for removed friends

## Edge Cases

- No friends → filter hidden
- Friends with no events for this conference → excluded from chip list
- Friend removed while filter active → auto-cleared via useEffect
- RPC only returns itineraries for verified friends (security)
