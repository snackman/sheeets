# plan.wtf - Multi-Conference Side Event Guide

## Project Overview
A standalone Next.js app that displays crypto/tech conference side events with interactive map, list, and table views. Users can filter events by conference, date range, time range, tags, and more. Star favorites and build a personal itinerary with PNG export and shareable links. Social features include friend connections, check-ins, emoji reactions, and event comments.

**Live**: https://plan.wtf
**Legacy**: https://sheeets.xyz (301 redirects to plan.wtf via .htaccess)
**Vercel**: https://sheeets.vercel.app (redirects to plan.wtf)
**Repo**: https://github.com/snackman/sheeets
**Data Source**: Google Sheet `1xWmIHyEyOmPHfkYuZkucPRlLGWbb9CF6Oqvfl8FUV6k` (https://plan.wtf/data)

---

## Tech Stack
- **Next.js 16** (App Router, Turbopack)
- **TypeScript**
- **Tailwind CSS** (dark theme)
- **Mapbox GL JS** via `react-map-gl` (individual markers, zoom-aware labels)
- **Supabase** (auth via email OTP, itinerary sync, friends, check-ins, reactions, comments, POIs, image caching)
- **Google Sheets API** (service account auth for event submission)
- **Google Analytics** (GA4, measurement ID: `G-2WB3SFJ13V`, custom event tracking)
- **html-to-image** for itinerary PNG export
- **localStorage + Supabase** for user state (stars, itinerary — dual storage with sync)

## Getting Started

```bash
cd sheeets
npm install
npm run dev        # http://localhost:3000
```

### Environment Variables (`.env.local`)
```
NEXT_PUBLIC_MAPBOX_TOKEN=pk.xxx           # Required for map view
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJxxx      # Supabase anon key
SUPABASE_SERVICE_ROLE_KEY=eyJxxx          # For server-side operations
MAPBOX_TOKEN=pk.xxx                        # Server-side geocoding
GOOGLE_SERVICE_ACCOUNT_EMAIL=sheeets-writer@planwtf.iam.gserviceaccount.com
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."
```

### Geocoding (for map view)
Events have addresses but no lat/lng. Two systems:

1. **Build-time script** (populates static cache):
```bash
MAPBOX_SECRET_TOKEN=pk.xxx npx tsx scripts/geocode.ts
```
Creates/updates `src/data/geocoded-addresses.json`. Matched to events via `normalizeAddress()` in `fetch-events.ts`. **Auto-runs on every deploy** via the `prebuild` npm script — skips gracefully if `MAPBOX_SECRET_TOKEN` isn't set. Set the token in Vercel env vars to auto-geocode new addresses on each deploy.

2. **Runtime API** (`/api/geocode`): Events not in the static cache get geocoded on-the-fly via Mapbox. The `useEvents` hook detects un-geocoded addresses and POSTs to this endpoint. Uses proximity bias based on conference city.

The geocode cache also stores a `matchedAddress` field (full street address from Mapbox). This is passed to `AddressLink` via the `navAddress` prop so Lyft/Uber/Google Maps receive the complete address even when the spreadsheet has a shorthand like "The 1up Arcade Bar".

### POI Address Backfill
Existing user-added POIs may have incomplete addresses. Run to fix:
```bash
NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... MAPBOX_SECRET_TOKEN=... npx tsx scripts/backfill-poi-addresses.ts
```

---

## Architecture

### Data Flow
```
Google Sheet (GViz API, multiple tabs)
  → fetch-events.ts (paginated, header detection, tag parsing, geocode lookup, synthetic tags)
    → useEvents hook (lazy-geocodes missing addresses via /api/geocode)
      → EventApp
          ├── MapView (Mapbox GL, auto-centers on events, friend location markers)
          ├── ListView (cards grouped by date, OG images, reactions, comments)
          └── TableView (compact rows with icon-only tags)
```

### Conference Tab System
Each conference tab in `EVENT_TABS` (in `src/lib/constants.ts`) defines:
- `gid` — Google Sheet tab ID
- `name` — Display name (used as filter key)
- `timezone` — IANA timezone for "Now" filter and date defaults
- `dates` — Array of ISO date strings for the date picker
- `center` — `{lat, lng}` for default map center and geocoding proximity

**Current tabs:**

| Tab | GID | Timezone | Dates |
|-----|-----|----------|-------|
| SXSW 2026 | 1543768695 | America/Chicago | Mar 5-18, 2026 |
| ETHCC 2026 | 437576609 | Europe/Paris | Mar 27-Apr 2, 2026 |

Switching conferences resets the date range filter to that conference's dates. If the current time is before or after the conference date range, all events are shown.

**Previously active tabs** (removed, GIDs for reference):
- ETHDenver: 356217373
- Consensus Hong Kong 2026: 377806756

### Auth & User Data
```
Supabase Auth (email OTP via Resend SMTP)
  → AuthContext (signIn, verifyOtp, signOut)
  → useItinerary (dual storage: localStorage + Supabase itineraries table)
  → useCheckIns (fetches check-in counts + user IDs per event for friend indicators)
  → useEventReactions (batch-fetches all reactions, optimistic toggle)
  → useEventComments (per-event comments with profile joins)
  → useEventCommentCounts (batch comment counts)
  → useFriendLocations (upserts own location on mount, fetches friends via RPC)
  → AuthModal (two-step: email → 6-digit code)
  → UserMenu (profile, friends, check-in, submit event)
```

**Auth guards**:
- Starring an event requires auth — pending star completes after login + Supabase sync (race-condition safe via `ready` flag in useItinerary)
- Itinerary filter button requires auth — if user signs out or auth is dismissed, `itineraryOnly` is automatically deselected
- Toggling reactions requires auth — shows auth modal, no pending action stored

**Email config**:
- SMTP via **Resend** (`smtp.resend.com:465`)
- Sender: `noreply@sheeets.xyz`
- DNS records (DKIM, SPF, DMARC) configured on Namecheap cPanel for `sheeets.xyz`
- Rate limit: 30 emails/hour (auto-increased with custom SMTP)

### Event Submission
Users can submit events via the **SubmitEventModal** (accessible from UserMenu):
1. **Step 1**: Paste a Luma URL to auto-fill event details (via `/api/luma`), or enter manually
2. **Step 2**: Editable form with conference selector, all event fields, tag picker
3. **Step 3**: Success confirmation

The submission writes to the **"Add Events Here"** section of the Google Sheet tab. The `findNextEmptyRow()` function in `google-sheets.ts` scans for the marker cell containing "Add Events Here", finds the header row below it, and appends to the first empty row after that.

**Service account**: `sheeets-writer@planwtf.iam.gserviceaccount.com` (GCP project: `planwtf`)
- Google Sheets API enabled
- Shared as Editor on the spreadsheet
- Env vars set in Vercel: `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`

### Social Features

#### Emoji Reactions
- Predefined set: 🔥 ❤️ 💯 👍 🎉 👀 (in `REACTION_EMOJIS` constant)
- Rendered as pills `[🔥 3] [❤️ 1] [+]` via `EmojiReactions` component
- Highlighted border (orange) when user has reacted
- `compact` prop for smaller rendering in map popups
- Optimistic add/remove with revert on error
- Public reactions visible to all users (including anonymous); friends-only requires auth + friendship

#### Event Comments
- `CommentSection` component: expandable, collapsed shows count link
- Scrollable list with avatar initial, name, time-ago, text
- Public/friends visibility toggle on input
- Delete own comments on hover
- `useEventComments(eventId)` hook fetches per-event, joins profiles for display names
- `useEventCommentCounts()` hook batch-fetches counts for all events

#### Friend Location Sharing
- `useFriendLocations` hook: upserts own location via `navigator.geolocation.getCurrentPosition()` on mount (any view, not just map), fetches friends via `get_friends_locations()` RPC, re-fetches every 5 min
- `FriendMarker` component: 32px circular avatar (`unavatar.io/x/{handle}`), green/gray border based on recency, green pulse if <5min ago, 50% opacity if >1h stale, name + time-ago label visible at zoom >= 13

#### Green Check-in Friend Indicators
- `useCheckIns` returns `checkInUsersByEvent: Map<string, string[]>` (user IDs per event)
- EventApp computes `checkedInFriendsByEvent` from check-in user IDs + friends list
- Green MapPin row on EventCard: "Sam, Alex checked in"
- `FriendsGoingModal` supports `accentColor` param ('blue' for itinerary, 'green' for check-in)

### Multi-Tab Sheet Structure
The Google Sheet has multiple tabs. Each event tab has:
- **Header rows** (rows 1-12): Sponsor info, social links, promo content
- **Data header** (row 13): `"", "Start Time", "End Time", "Organizer", "Event Name", "Address", "Cost", "Tags", "Link", "", "", "Note"`
- **Event rows**: Below the header until the first empty row
- **"Add Events Here" section**: Below the main events, with its own header row for user submissions

The parser finds the header row by looking for `col B = "Start Time"`, then reads events until the first empty row.

### File Structure
```
src/
├── app/
│   ├── page.tsx              # Renders EventApp
│   ├── layout.tsx            # Inter font, dark theme, viewport config, GA4 script
│   ├── globals.css           # Tailwind + Mapbox CSS + dark theme vars + safe-area insets
│   ├── itinerary/
│   │   ├── page.tsx          # Standalone itinerary page
│   │   └── s/[code]/page.tsx # Shared itinerary viewer
│   └── api/
│       ├── page.tsx          # Agent API documentation page
│       ├── CodeBlock.tsx     # Tabbed code examples with copy button
│       ├── geocode/route.ts  # Runtime geocoding via Mapbox (POST, batch up to 25)
│       ├── og/route.ts       # OG image resolution (Luma API + HTML scraping, Supabase cache)
│       ├── luma/route.ts     # Luma event scraper for submit form auto-fill
│       └── submit-event/route.ts # Event submission to Google Sheet via service account
├── components/
│   ├── EventApp.tsx          # Main orchestrator - state, hooks, view routing, auth guards
│   ├── Header.tsx            # Logo, view toggle, itinerary badge, auth (sticky)
│   ├── AuthModal.tsx         # Email OTP auth, UserMenu with profile, friends, check-in, submit event
│   ├── SubmitEventModal.tsx  # 3-step event submission: Luma URL → form → success
│   ├── ViewToggle.tsx        # Map | List | Table toggle
│   ├── FilterBar.tsx         # Conference tabs, Now toggle, Filters (conference-aware date bounds)
│   ├── DateTimePicker.tsx    # Custom date dropdown + 30-min time dropdown (accepts dates prop)
│   ├── AddressLink.tsx       # Address tap → Google Maps / Uber / Lyft (mobile sheet, desktop direct)
│   ├── SearchBar.tsx         # Debounced text search (300ms)
│   ├── TagBadge.tsx          # Tag icon with color (supports iconOnly mode, custom SVG crypto icons)
│   ├── EventCard.tsx         # Event card: OG image, details, friends going/checked-in, reactions, comments
│   ├── ListView.tsx          # Cards grouped by date, sticky date headers
│   ├── TableView.tsx         # table-fixed layout, fills viewport, CSS truncate
│   ├── MapView.tsx           # Mapbox map, auto-centers, friend markers, conference-aware center
│   ├── MapViewWrapper.tsx    # Dynamic import wrapper (ssr: false)
│   ├── MapMarker.tsx         # Clock-face SVG pin (white wedge, 19px)
│   ├── EventPopup.tsx        # Map popup with OG image, star, reactions, checked-in friends
│   ├── EmojiReactions.tsx    # Row of emoji pills with picker dropdown
│   ├── CommentSection.tsx    # Expandable comment list with input
│   ├── FriendMarker.tsx      # Map marker for friend locations (avatar, pulse, time-ago)
│   ├── POIPopup.tsx          # POI map popup with AddressLink, share toggle, delete
│   ├── POIMarker.tsx         # POI map pin
│   ├── POISearchBar.tsx      # Mapbox Search Box for adding POIs
│   ├── StarButton.tsx        # Star toggle (yellow), friends count badge (orange)
│   ├── ItineraryPanel.tsx    # Slide-over panel with conflict detection, share, PNG export
│   ├── FriendsPanel.tsx      # Friends list slide-over with remove friend
│   ├── OGImage.tsx           # Lazy-loaded OG image thumbnails (flexible height for non-square images)
│   ├── SponsorsTicker.tsx    # Scrolling sponsor/announcement ticker below header
│   ├── Providers.tsx         # AuthProvider wrapper
│   └── Loading.tsx           # Spinner
├── contexts/
│   └── AuthContext.tsx       # Supabase auth context (email OTP)
├── hooks/
│   ├── useEvents.ts          # Fetch + parse events from GViz, lazy-geocode via /api/geocode
│   ├── useFilters.ts         # Filter state (conference-aware dates, resets on conference switch)
│   ├── useItinerary.ts       # Dual storage: localStorage + Supabase sync
│   ├── useFriends.ts         # Friend list (bidirectional query + profiles)
│   ├── useFriendRequests.ts  # Friend search, send/accept/reject/cancel requests
│   ├── useFriendsItineraries.ts # Friends' event lists (RPC-based)
│   ├── useCheckIns.ts        # Check-in counts + user IDs per event (Map<eventId, count/string[]>)
│   ├── useEventReactions.ts  # Batch reactions with optimistic toggle
│   ├── useEventComments.ts   # Per-event comments with profile joins
│   ├── useEventCommentCounts.ts # Batch comment counts
│   ├── useFriendLocations.ts # Location sharing: upsert own, fetch friends via RPC
│   ├── useProfile.ts         # Current user's profile
│   ├── usePOIs.ts            # Points of interest CRUD
│   └── useGeocoder.ts        # Mapbox Search Box API for POI search
├── lib/
│   ├── geo.ts                # distanceMeters() — haversine distance
│   ├── gviz.ts               # GViz response parser
│   ├── types.ts              # TypeScript types (ETHDenverEvent, FilterState, ReactionEmoji, etc.)
│   ├── constants.ts          # EVENT_TABS (with dates/tz/center), tag colors, REACTION_EMOJIS
│   ├── analytics.ts          # GA4 custom event tracking (gtag wrapper)
│   ├── supabase.ts           # Supabase client (singleton, anon key)
│   ├── google-sheets.ts      # Service account auth, findNextEmptyRow, appendEventRow
│   ├── fetch-events.ts       # GViz fetch + synthetic tag generation + geocode lookup
│   ├── filters.ts            # Filter logic (conference-aware timezone in getConferenceNow)
│   ├── utils.ts              # Date formatting, normalizeAddress, time parsing
│   └── calendar.ts           # ICS export for itinerary
├── data/
│   └── geocoded-addresses.json  # Cached geocoded addresses
scripts/
├── geocode.ts                # Build-time geocoding script (multi-tab, proximity-aware)
└── backfill-poi-addresses.ts # One-time script to fix incomplete POI addresses
packages/
└── mcp-server/               # MCP server package for AI agent integration
supabase/
├── migrations/               # SQL migrations (run via supabase db push --linked)
└── functions/
    └── agent-api/index.ts    # RESTful API edge function for AI agents
public/
└── logo.png                  # plan.wtf brand logo (black on transparent, inverted to white in header)
```

### Key Types (`src/lib/types.ts`)
```typescript
interface ETHDenverEvent {
  id, date, dateISO, startTime, endTime, isAllDay,
  organizer, name, address, cost, isFree,
  vibe,           // Primary tag (first tag)
  tags: string[], // All tags + synthetic tags ($$, Food, Bar)
  conference,     // Which tab this event belongs to
  link, hasFood, hasBar, note,
  lat?, lng?, matchedAddress?,
  timeOfDay, isDuplicate?
}

type ReactionEmoji = '🔥' | '❤️' | '💯' | '👍' | '🎉' | '👀'

interface EventComment {
  id, event_id, user_id, text,
  visibility: 'public' | 'friends',
  created_at, display_name?, x_handle?
}

interface FriendLocation {
  user_id, lat, lng, updated_at,
  display_name?, x_handle?
}

type ViewMode = 'map' | 'list' | 'table'

interface FilterState {
  conference,      // Single-select: which conference to show
  startDateTime,   // ISO local: "2026-03-12T14:00" (conference-aware default)
  endDateTime,     // ISO local: "2026-03-18T23:30"
  vibes,           // Selected tags (includes $$, Food, Bar)
  selectedFriends, // Filter to events where selected friends are going
  itineraryOnly,   // Show itinerary only
  searchQuery,     // Text search
  nowMode          // Show happening-now events
}
```

### Supabase Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `profiles` | User metadata | user_id, display_name, x_handle, email, rsvp_name |
| `itineraries` | User's starred events | user_id, event_ids (text[]), updated_at |
| `check_ins` | User check-ins at events | user_id, event_id, lat, lng; UNIQUE(user_id, event_id) |
| `friendships` | Bidirectional friends (user_a < user_b) | user_a, user_b |
| `friend_requests` | Friend request flow | sender_id, receiver_id, status |
| `friend_codes` | Shareable friend invite codes | user_id, code (unique) |
| `shared_itineraries` | Shareable itinerary links | short_code (unique), event_ids, created_by |
| `event_images` | OG image cache | event_id (PK), source_url, image_url |
| `event_reactions` | Emoji reactions | event_id, user_id, emoji, visibility; UNIQUE(event_id, user_id, emoji) |
| `event_comments` | Event comments | event_id, user_id, text (1-500 chars), visibility |
| `user_locations` | Friend location sharing | user_id (PK), lat, lng, updated_at |
| `rsvps` | RSVP tracking | user_id, event_id, luma_api_id, status, method |
| `pois` | User points of interest | id (uuid), user_id, name, lat, lng, address, category, note, is_public |
| `api_keys` | Agent API keys | user_id, key_hash (SHA-256), key_prefix, scopes, revoked_at |
| `api_rate_limits` | Rate limiting | key_hash, window_start, request_count |
| `events_cache` | 15-min TTL events cache for API | id, conference, date_iso, tags, link, cached_at |

**Supabase project**: `qsiukfwuwbpwyujfahtz` (sheeets)

### RLS Policies (Social Features)

**Reactions & Comments visibility:**
- "Anyone can read public reactions/comments" — no auth required, `visibility = 'public'`
- "Friends can read friends-only reactions/comments" — requires auth + `are_friends()` check
- Authenticated users can insert/delete their own

**`are_friends()` helper** (SECURITY DEFINER): checks `friendships` table for bidirectional friendship.

**`get_friends_locations()` RPC** (SECURITY DEFINER): returns `{user_id, lat, lng, updated_at}[]` for calling user's friends by joining `user_locations` with `friendships`.

### SECURITY DEFINER Functions
- `get_friends_itineraries()` — Returns friends' event_ids
- `get_friends_locations()` — Returns friends' last known locations
- `respond_to_friend_request(request_id, accept)` — Accept/reject + create friendship
- `send_friend_request(receiver)` — Send or auto-accept mutual requests
- `search_users(search_query, search_type)` — Find users by exact email/display_name/x_handle
- `check_rate_limit(key_hash, window_min, max_req)` — Atomic rate limiting counter
- `are_friends(uid1, uid2)` — Check if two users are friends

### Edge Functions

| Function | Auth | Purpose |
|----------|------|---------|
| `agent-api` | API key (`shts_` prefix) | RESTful API for AI agents — events, itinerary, friends, RSVPs, recommendations |

---

## Hosting & DNS

### plan.wtf (primary domain)
- **Registrar**: Namecheap (API user: `snackman`)
- **DNS**: Namecheap BasicDNS (`dns1.registrar-servers.com`)
- **A Record**: `@` → `76.76.21.21` (Vercel)
- **CNAME**: `www` → `cname.vercel-dns.com`
- **SSL**: Vercel auto-provisioned

### sheeets.xyz (legacy, redirects to plan.wtf)
- **Hosting**: Namecheap cPanel (`premium266.web-hosting.com`)
- **DNS**: `dns1.namecheaphosting.com` (hosting DNS, NOT registrar DNS)
- **Redirects**: via `.htaccess` — all paths redirect to `plan.wtf` except `/admin` → Google Sheet
- **Email DNS**: DKIM, SPF, DMARC configured for Resend

### Vercel
- **Team**: `pizza-dao`
- **Project**: `sheeets`
- **Production URL**: https://plan.wtf
- **Auto-deploy**: from `master` branch

### GCP (Google Cloud)
- **Project**: `planwtf` (ID: 352068458659)
- **Service account**: `sheeets-writer@planwtf.iam.gserviceaccount.com`
- **APIs enabled**: Google Sheets API, Google Drive API
- **CLI**: `gcloud` installed via Homebrew, authenticated as `snax.ynot@gmail.com`

### Redirects
| From | To | Method |
|------|----|--------|
| `sheeets.vercel.app/*` | `plan.wtf/*` | Vercel auto-redirect |
| `sheeets.xyz/*` | `plan.wtf` | .htaccess 301 |
| `sheeets.xyz/admin` | Google Sheet (admin) | .htaccess 301 |
| `plan.wtf/data` | Google Sheet (data) | Next.js redirect |

---

## Adding a New Conference Tab

1. Find the tab's `gid` from the spreadsheet HTML: `curl -sL "https://docs.google.com/spreadsheets/d/SHEET_ID/edit" | grep -oE '.{0,50}TAB_NAME.{0,50}'` — look for the number in quotes before the tab name
2. Add to `EVENT_TABS` in `src/lib/constants.ts` with `gid`, `name`, `timezone`, `dates`, and `center`
3. Add a proximity center in `scripts/geocode.ts` → `PROXIMITY_CENTERS` and in `src/app/api/geocode/route.ts` → `PROXIMITY` if the conference is in a new city
4. Run the geocoding script to cache new addresses

---

## Development Notes

### tsconfig Excludes
`packages/` and `supabase/` are excluded from the root tsconfig. They have their own TypeScript configs and dependencies. Next.js will fail to build if these are included.

### Key Patterns
- **Conference-aware defaults**: `useFilters` resets date range when switching conferences via `getDateTimeRangeForConference()`. `getConferenceNow(conference)` uses per-conference timezone. Map centers on conference city.
- **Auth-gated actions**: Star and RSVP use the same pattern — `pendingRef` stores the action, shows AuthModal, completes after login via useEffect
- **Profile fields**: Column is `rsvp_name` (NOT `farcaster_username`)
- **Address links**: Use `<AddressLink>` component everywhere — desktop opens Google Maps, mobile shows Maps/Uber/Lyft drawer. Pass `navAddress` prop with the full Mapbox address.
- **Profile auto-save**: Profile fields debounce-save after 800ms of inactivity
- **Friends refresh**: `refreshFriends` is shared from EventApp → Header → UserMenu
- **Optimistic updates**: Reactions, comments, friend requests all use optimistic UI with revert on error
- **Scroll-based filter bar**: Both table and list views hide the filter bar on scroll down and show it on scroll up. Both have an `overflowAmount > 80` guard to prevent jitter.
- **Contained scroll**: All three views use `h-dvh flex flex-col overflow-hidden` layout
- **Check-in badges**: Green numbered badges on the time field. Green friend rows on event cards.
- **Check-in logic**: Gets GPS, finds itinerary events within 150m that pass "now" filter, upserts to `check_ins` table
- **OG images**: Lazy-loaded via IntersectionObserver. Luma uses API for clean cover images. Other sites (Eventbrite, etc.) use HTML og:image scraping with relative URL resolution. Cached in Supabase `event_images` table.
- **Event submission**: Writes to "Add Events Here" section of the sheet. Finds marker cell, then header row below, appends to first empty row.
- **Prop threading pattern**: Social data (reactions, comments, check-ins, friend locations) flows from hooks in EventApp through view components (ListView/TableView/MapViewWrapper/MapView) to card/popup components.

### Supabase Migrations
Migrations are in `supabase/migrations/`. Push with:
```bash
supabase db push --linked
```
If remote has migrations not found locally, repair with:
```bash
supabase migration repair <version> --status reverted
```

### Known Issues
- `search_users` has two overloaded versions in Supabase — the old one `(text, uuid)` is unused and should be dropped
- `check_ins` RLS policies may block friends' check-ins — if so, create a `get_friends_check_ins()` SECURITY DEFINER RPC
- Check-in/reaction/comment data is fetched once on mount — no realtime subscriptions
- Eventbrite og:image URLs that were cached before the relative-URL fix may still be broken in `event_images` table — clear stale entries or wait for TTL
- The `lightningcss.darwin-arm64.node` module causes build issues locally — use `npx tsc --noEmit` for type checking instead of `npm run build`
