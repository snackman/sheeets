# Plan: Luma RSVP from Sheeets

## Context
Users want to RSVP to Luma events without leaving sheeets. Many events in the dataset have `lu.ma/*` links.

## Research Findings

### Option A: Thin Proxy (server-side RSVP)
- Luma's **official API** (`POST /v1/event/add-guests`) requires a Luma Plus API key **per event organizer** — not viable since we aggregate events from hundreds of hosts.
- The alternative is reverse-engineering Luma's browser form submission endpoint. This is fragile (no API contract, can break anytime, CAPTCHA risk).

### Option B: Luma Embed Checkout Widget (recommended)
Luma provides an official embeddable registration button:
```html
<script id="luma-checkout" src="https://embed.lu.ma/checkout-button.js" />
<button data-luma-action="checkout" data-luma-event-id="evt-XXXXX">Register</button>
```
- Opens Luma's checkout overlay **inside sheeets** — no new tab, no redirect
- Official/supported — won't break or violate ToS
- Handles paid events, approval-gated events, custom questions natively
- User authenticates with Luma inside the overlay (their account, their IP)
- **Challenge**: Needs `evt-` format event ID, but our data has URL slugs (`lu.ma/some-slug`)

### Option C: Pre-filled redirect
- Open `lu.ma/event-slug` in new tab
- Research found **no documented query param** for pre-filling email
- Lowest effort but worst UX (leaves the app)

## Recommended Approach: Option B (Embed Widget)

### Phase 1: Resolve event IDs
- For each Luma URL, we need the `evt-` ID
- Options to get it:
  1. **Scrape on ingest**: When events are loaded, fetch the lu.ma page and extract the event ID from page metadata/scripts
  2. **Luma oEmbed/API lookup**: Check if `GET https://public-api.luma.com/v1/event/get?slug=some-slug` works without auth
  3. **Runtime lookup**: When user clicks RSVP, fetch the lu.ma page server-side, extract evt ID, then open the widget
- Store resolved `lumaEventId` on the event object to avoid repeated lookups

### Phase 2: Embed the widget
- Load `embed.lu.ma/checkout-button.js` script (once, in layout or on-demand)
- When user clicks RSVP on a Luma event, trigger the checkout overlay with the evt ID
- For non-Luma events, keep the current behavior (open link in new tab)

### Phase 3: Batch RSVP for itinerary
- "RSVP All" button on itinerary page
- Opens Luma checkout overlay for each Luma event sequentially
- User confirms each one (since the overlay handles auth/payment/custom questions)
- Skip non-Luma events (show count of skipped)

## Database Changes
- Add `luma_event_id` column to event cache/storage (or resolve at runtime)
- No user profile changes needed (Luma handles auth in its own overlay)

## Files to Modify
| File | Change |
|------|--------|
| `src/lib/types.ts` | Add `lumaEventId?: string` to ETHDenverEvent |
| `src/app/layout.tsx` | Load Luma checkout script |
| `src/components/EventPopup.tsx` | RSVP button triggers checkout overlay for Luma events |
| `src/components/EventCard.tsx` | Same RSVP logic |
| `src/components/TableView.tsx` | Same RSVP logic |
| `src/app/itinerary/page.tsx` | "RSVP All" button |
| Event parsing/fetching | Resolve luma event IDs from slugs |

## Open Questions
1. Does Luma's public API support looking up events by slug without auth?
2. Can the embed widget accept a slug instead of evt- ID?
3. Does the checkout overlay work well on mobile?

## Risks
- If Luma changes the embed widget, it breaks (but this is an official/supported integration)
- Event ID resolution adds a network request per Luma event on first load
- The overlay may not pre-fill user info (user types their email each time in the Luma overlay)
