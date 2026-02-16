# Luma RSVP - Embed Widget + Copy-Paste Fields

## Approach

Use Luma's official `checkout-button.js` widget to open their RSVP form in an overlay on our page. Show the user's profile fields (name, email) with copy buttons alongside the flow for easy form-filling.

**Flow:**
1. User clicks RSVP badge on a Luma event
2. Modal opens with their profile fields (name, email) + copy buttons
3. "Open RSVP Form" button triggers Luma's checkout widget (stays on our page)
4. User fills out Luma form (copy-pasting from our fields)
5. User clicks "Done - I RSVP'd" -> we record it in `rsvps` table

## Key Technical Details

- Luma's `checkout-button.js` creates an iframe to `lu.ma/embed/event/{id}/simple`
- This bypasses `x-frame-options: SAMEORIGIN` because it's Luma's dedicated embed URL
- The widget is triggered via `data-luma-action="checkout"` + `data-luma-event-id={id}`
- We extract the Luma slug from the event link using `getLumaSlug()`
- Try slug directly as the event ID first; if Luma needs the API ID, resolve client-side

## What to keep from the old branch

- `src/lib/luma.ts` concepts -- `isLumaUrl()` and `getLumaSlug()` utilities
- `rsvps` table -- already exists in Supabase with correct schema
- `trackRsvp` analytics concept
- `LumaEmbedOverlay` checkout widget pattern (script loading + trigger)

## What NOT to do (old branch mistakes)

- Do NOT rename `rsvp_name` to `farcaster_username` (column doesn't exist)
- Do NOT delete AddressLink, DateTimePicker, POI system, or rewrite filters
- Do NOT create edge functions -- not needed for this approach
- Do NOT touch filter/types/useFilters -- start fresh from master

## Files to Create

### 1. `src/lib/luma.ts`
```ts
export function isLumaUrl(url: string): boolean
export function getLumaSlug(url: string): string | null
```

### 2. `src/components/RsvpButton.tsx`
Small badge button:
- Only renders for Luma events (`isLumaUrl(event.link)`)
- Two states: idle ("RSVP" orange) / confirmed ("RSVP'd" green checkmark)
- On click: triggers RSVP flow

### 3. `src/hooks/useRsvp.ts`
Simple hook:
- Load user's confirmed RSVPs from `rsvps` table on mount
- `getRsvpStatus(eventId)` -> `'idle' | 'confirmed'`
- `openRsvp(eventId, lumaUrl)` -> sets active RSVP event (opens overlay)
- `markConfirmed(eventId)` -> insert into `rsvps` table
- `activeRsvp` state for which event's overlay is open

### 4. `src/components/RsvpOverlay.tsx`
Portal-based overlay with two stages:

**Stage 1 - Copy-paste fields:**
- Event name header + close button
- Profile fields (name, email) with copy-to-clipboard buttons
- "Open RSVP Form" button -> loads Luma widget, transitions to stage 2
- If not logged in, profile section shows "Log in to see your details"

**Stage 2 - Luma widget active:**
- Luma's checkout overlay is open on top
- Our overlay shows "Done - I RSVP'd" and "Cancel" buttons behind it
- When Luma overlay closes, user sees our buttons

**Implementation:**
- Load `checkout-button.js` on mount
- Hidden `<a>` with `data-luma-action="checkout"` + `data-luma-event-id={slug}`
- "Open RSVP Form" programmatically clicks the hidden link
- Mobile-first layout (stacked), works on iPhone SE (375px)

## Files to Modify

### 5. `src/lib/analytics.ts`
Add: `trackRsvp` event tracking

### 6. `src/components/EventCard.tsx`
- Add optional `rsvpStatus` and `onRsvp` props
- Render `<RsvpButton>` in tags/badges row for Luma events

### 7. `src/components/EventPopup.tsx`
- Same as EventCard -- add RSVP props, render badge

### 8. `src/components/EventApp.tsx`
- Import and use `useRsvp` hook
- Auth-gate: if not logged in when clicking RSVP, show auth modal first
- Pass `getRsvpStatus` and `onRsvp` down to all views
- Render `<RsvpOverlay>` when `activeRsvp` is set

### 9-12. ListView, TableView, MapView, MapViewWrapper
- Thread `getRsvpStatus` and `onRsvp` props through to EventCard/EventPopup

## Database

No migrations needed. Existing `rsvps` table schema:
- `id`, `user_id`, `event_id`, `luma_api_id` (nullable), `status`, `method`, `created_at`
- RLS: authenticated users can read/insert/update their own rows
- For this approach: `method = 'manual'`, `status = 'confirmed'`, `luma_api_id = null`

## Verification

- [ ] RSVP button appears only on events with Luma links
- [ ] Clicking RSVP when logged out triggers auth modal
- [ ] Profile fields show name + email with working copy buttons
- [ ] "Open RSVP Form" triggers Luma checkout widget (stays on page)
- [ ] "Done" records RSVP in DB, button changes to green "RSVP'd"
- [ ] RSVP state persists across page reloads
- [ ] Works on mobile (iPhone SE 375px)
- [ ] No regressions to existing features (filters, POIs, address links, etc.)
