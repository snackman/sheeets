# Submit Event Form Improvements

## 4 Changes

### 1. Date/time fields → use DateTimePicker dropdowns
**Current**: Plain text inputs (`"Feb 16"`, `"7:00 PM"`)
**Target**: Reuse the `DateTimePicker` component from FilterBar (date dropdown + 30-min time dropdown)

The submit form needs a slightly different setup than the filter:
- **Date**: Single date dropdown (not a datetime range), scoped to selected conference dates
- **Start Time**: Standalone time dropdown (30-min intervals)
- **End Time**: Standalone time dropdown (30-min intervals)

We need to extract the `Dropdown` sub-component and `TIME_OPTIONS`/format helpers from `DateTimePicker.tsx` so the submit form can use date-only and time-only dropdowns independently.

**Changes**:
- `src/components/DateTimePicker.tsx` — Export `Dropdown`, `TIME_OPTIONS`, `formatDateShort`, `format12Hour`
- `src/components/SubmitEventModal.tsx` — Replace text inputs with Dropdown components. Store date as ISO `"2026-03-10"` and times as 24h `"19:00"`. Convert to display format `"Mar 10"` / `"7:00 PM"` for the sheet on submit.

### 2. Address → Google Places autocomplete (from rsvpizza)
**Current**: Plain text input
**Target**: Google Places autocomplete dropdown

Create `src/components/AddressAutocomplete.tsx` adapted from rsvpizza's `LocationAutocomplete.tsx`:
- Simplified for sheeets (no timezone, no city data, no venue name)
- Uses `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (Next.js convention)
- Falls back to plain text input if no API key
- Styled to match sheeets dark theme (slate-900 bg, slate-600 border, orange focus)
- Types: `['geocode', 'establishment']`

**Also need**: `npm install -D @types/google.maps` for TypeScript support

**Env var**: Add `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` to Vercel (can reuse same GCP project as rsvpizza). Component works as plain input until key is added.

### 3. Auto-fetch on Luma URL paste
**Current**: User pastes URL, clicks "Fetch Event" button
**Target**: Auto-fetch when a valid Luma URL is pasted or typed

In `SubmitEventModal.tsx`:
- Add a `useEffect` watching `lumaUrl` — when it matches a Luma URL pattern (`lu.ma/` or `luma.com/`), auto-trigger `handleFetchLuma()` after a short debounce (300ms)
- Keep the "Fetch Event" button as fallback
- Show loading state immediately on paste

### 4. Luma API: fall back to `geo_address_info` for guests-only addresses
**Current**: Only checks `geo_address_json` (null for guests-only events)
**Target**: Fall back to `geo_address_info.city_state` or `geo_address_info.city`

In `src/app/api/luma/route.ts`:
- After checking `geo_address_json`, also check `geo_address_info`
- Use `geo_address_info.full_address` → `geo_address_info.city_state` → `geo_address_info.city` as fallbacks
- This gives at least city-level location for guests-only events

## Files to modify/create
1. `src/components/DateTimePicker.tsx` — Export internals
2. `src/components/AddressAutocomplete.tsx` — NEW (adapted from rsvpizza)
3. `src/components/SubmitEventModal.tsx` — All 4 changes converge here
4. `src/app/api/luma/route.ts` — geo_address_info fallback
5. `package.json` — Add `@types/google.maps` dev dependency
