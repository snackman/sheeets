# plan.wtf - Multi-Conference Side Event Guide

## Project Overview
A standalone Next.js app that displays crypto conference side events with interactive map, list, and table views. Users can filter events by conference, date range, time range, tags, and more. Star favorites and build a personal itinerary with PNG export and shareable links.

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
- **Supabase** (auth via email OTP, itinerary sync, friends, POIs, image caching)
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
SUPABASE_SERVICE_ROLE_KEY=eyJxxx           # For server-side operations
MAPBOX_TOKEN=pk.xxx                        # Server-side geocoding
```

### Geocoding (for map view)
Events have addresses but no lat/lng. Two systems:

1. **Build-time script** (populates static cache):
```bash
MAPBOX_SECRET_TOKEN=pk.xxx npx tsx scripts/geocode.ts
```
Creates/updates `src/data/geocoded-addresses.json`. Matched to events via `normalizeAddress()` in `fetch-events.ts`.

2. **Runtime API** (`/api/geocode`): Events not in the static cache get geocoded on-the-fly via Mapbox. The `useEvents` hook detects un-geocoded addresses and POSTs to this endpoint. Uses proximity bias (Denver/Hong Kong) based on conference name.

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
          ├── MapView (Mapbox GL, auto-centers on events, zoom-aware labels, itinerary numbering)
          ├── ListView (cards grouped by date)
          └── TableView (compact rows with icon-only tags)
```

### Auth & User Data
```
Supabase Auth (email OTP via Resend SMTP)
  → AuthContext (signIn, verifyOtp, signOut)
  → useItinerary (dual storage: localStorage + Supabase itineraries table)
  → AuthModal (two-step: email → 6-digit code)
```

**Auth guards**:
- Starring an event requires auth — pending star completes after login + Supabase sync (race-condition safe via `ready` flag in useItinerary)
- Itinerary filter button requires auth — if user signs out or auth is dismissed, `itineraryOnly` is automatically deselected

**Email config**:
- SMTP via **Resend** (`smtp.resend.com:465`)
- Sender: `noreply@sheeets.xyz`
- DNS records (DKIM, SPF, DMARC) configured on Namecheap cPanel for `sheeets.xyz`
- Rate limit: 30 emails/hour (auto-increased with custom SMTP)

### Multi-Tab Sheet Structure
The Google Sheet has multiple tabs. Each event tab has:
- **Header rows** (rows 1-12): Sponsor info, social links, promo content
- **Data header** (row 13): `"", "Start Time", "End Time", "Organizer", "Event Name", "Address", "Cost", "Tags", "Link", "", "", "Note"`
- **Event rows**: Below the header until the first empty row

The parser finds the header row by looking for `col B = "Start Time"`, then reads events until the first empty row.

**Current tabs:**

| Tab | GID | Events | Dates |
|-----|-----|--------|-------|
| ETH Denver 2026 | 356217373 | ~228 | Feb 10-21, 2026 |
| Consensus Hong Kong 2026 | 377806756 | ~360 | Feb 10-12, 2026 |

To add a new conference tab, add its gid and name to `EVENT_TABS` in `src/lib/constants.ts`.

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
│       └── og/route.ts       # OG image resolution (Luma API + HTML scraping, Supabase cache, 1h TTL)
├── components/
│   ├── EventApp.tsx          # Main orchestrator - state, hooks, view routing, auth guards
│   ├── Header.tsx            # Logo, view toggle, itinerary badge, auth at far right (sticky + shrink-0)
│   ├── AuthModal.tsx         # Email OTP auth, UserMenu with profile (auto-save), friends, check-in
│   ├── ViewToggle.tsx        # Map | List | Table toggle
│   ├── FilterBar.tsx         # Conference dropdown (mobile) / tabs (desktop), datetime pickers, tag chips
│   ├── DateTimePicker.tsx    # Custom date dropdown (Feb 10-21) + 30-min time dropdown
│   ├── AddressLink.tsx       # Address tap → Google Maps / Uber / Lyft (mobile sheet, desktop direct)
│   ├── SearchBar.tsx         # Debounced text search (300ms)
│   ├── TagBadge.tsx          # Tag icon with color (supports iconOnly mode, custom SVG crypto icons)
│   ├── EventCard.tsx         # Event card for list view (image left, details right)
│   ├── ListView.tsx          # Cards grouped by date, sticky date headers
│   ├── TableView.tsx         # table-fixed layout, fills viewport, CSS truncate
│   ├── MapView.tsx           # Mapbox map, auto-centers on events (IQR outlier exclusion)
│   ├── MapViewWrapper.tsx    # Dynamic import wrapper (ssr: false), passes isItineraryView
│   ├── MapMarker.tsx         # Clock-face SVG pin (white wedge, 19px, tick marks at 12/3/6/9)
│   ├── EventPopup.tsx        # Map popup matching list card design (OG image, star, tags icons)
│   ├── POIPopup.tsx          # POI map popup with AddressLink, share toggle, delete
│   ├── POIMarker.tsx         # POI map pin
│   ├── POISearchBar.tsx      # Mapbox Search Box for adding POIs
│   ├── StarButton.tsx        # Star toggle (yellow), mobile touch targets
│   ├── ItineraryPanel.tsx    # Slide-over panel with conflict detection, share, PNG export
│   ├── FriendsPanel.tsx      # Friends list slide-over with remove friend
│   ├── OGImage.tsx           # Lazy-loaded OG image thumbnails
│   ├── SponsorsTicker.tsx    # Scrolling sponsor ticker below header
│   ├── Providers.tsx         # AuthProvider wrapper
│   └── Loading.tsx           # Spinner
├── contexts/
│   └── AuthContext.tsx       # Supabase auth context (email OTP)
├── hooks/
│   ├── useEvents.ts          # Fetch + parse events from GViz, lazy-geocode via /api/geocode
│   ├── useFilters.ts         # Filter state management
│   ├── useItinerary.ts       # Dual storage: localStorage + Supabase sync
│   ├── useFriends.ts         # Friend list (bidirectional query + profiles)
│   ├── useFriendRequests.ts  # Friend search, send/accept/reject/cancel requests
│   ├── useFriendsItineraries.ts # Friends' event lists (RPC-based)
│   ├── useProfile.ts         # Current user's profile
│   ├── usePOIs.ts            # Points of interest CRUD
│   └── useGeocoder.ts        # Mapbox Search Box API for POI search (full_address + place_name)
├── lib/
│   ├── gviz.ts               # GViz response parser
│   ├── types.ts              # TypeScript types (ETHDenverEvent, FilterState, ViewMode)
│   ├── constants.ts          # Sheet ID, event tabs, dates, tag colors (3 groups), TYPE_TAGS
│   ├── analytics.ts          # GA4 custom event tracking (gtag wrapper)
│   ├── supabase.ts           # Supabase client
│   ├── fetch-events.ts       # GViz fetch + synthetic tag generation + geocode lookup
│   ├── filters.ts            # Filter logic (pure functions, exported parseTimeToMinutes)
│   ├── utils.ts              # Date formatting, normalizeAddress, time parsing
│   └── calendar.ts           # ICS export for itinerary
├── data/
│   └── geocoded-addresses.json  # Cached geocoded addresses (Denver + Hong Kong, 137 entries)
scripts/
├── geocode.ts                # Build-time geocoding script (multi-tab, proximity-aware)
└── backfill-poi-addresses.ts # One-time script to fix incomplete POI addresses via reverse geocoding
packages/
└── mcp-server/               # MCP server package for AI agent integration (separate tsconfig)
supabase/
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
  lat?, lng?, timeOfDay, isDuplicate?
}

type ViewMode = 'map' | 'list' | 'table'

interface FilterState {
  conference,      // Single-select: which conference to show
  startDateTime,   // ISO local: "2026-02-16T14:00" (default: now in Denver time, snapped to :00/:30)
  endDateTime,     // ISO local: "2026-02-21T23:30" (default: last event day 23:30)
  vibes,           // Selected tags (includes $$, Food, Bar)
  selectedFriends, // Filter to events where selected friends are going
  itineraryOnly,   // Show itinerary only
  searchQuery,     // Text search
  nowMode          // Show happening-now events
}

interface UserProfile {
  user_id, email, display_name, x_handle, rsvp_name
}
```

### Supabase Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `profiles` | User metadata | user_id, display_name, x_handle, email, rsvp_name |
| `itineraries` | User's starred events | user_id, event_ids (text[]), updated_at |
| `friendships` | Bidirectional friends (user_a < user_b) | user_a, user_b |
| `friend_requests` | Friend request flow | sender_id, receiver_id, status (pending/accepted/rejected) |
| `friend_codes` | Shareable friend invite codes | user_id, code (unique) |
| `shared_itineraries` | Shareable itinerary links | short_code (unique), event_ids, created_by |
| `event_images` | OG image cache | event_id (PK), source_url, image_url |
| `rsvps` | RSVP tracking | user_id, event_id, luma_api_id (nullable), status, method, UNIQUE(user_id,event_id) |
| `pois` | User points of interest | id (uuid), user_id, name, lat, lng, address, category, note, is_public |
| `api_keys` | Agent API keys | user_id, key_hash (SHA-256), key_prefix, scopes, revoked_at |
| `api_rate_limits` | Rate limiting | key_hash, window_start, request_count |
| `events_cache` | 15-min TTL events cache for API | id, conference, date_iso, tags, link, cached_at |

**Supabase project**: `qsiukfwuwbpwyujfahtz` (sheeets)

### Edge Functions

| Function | Version | Auth | Purpose |
|----------|---------|------|---------|
| `agent-api` | v4 | API key (`shts_` prefix) | RESTful API for AI agents — events, itinerary, friends, RSVPs, recommendations |

### SECURITY DEFINER Functions
- `get_friends_itineraries()` — Returns friends' event_ids (scoped to auth.uid())
- `respond_to_friend_request(request_id, accept)` — Accept/reject + create friendship
- `send_friend_request(receiver)` — Send or auto-accept mutual requests
- `search_users(search_query, search_type)` — Find users by exact email/display_name/x_handle (returns rsvp_name, not farcaster_username)
- `check_rate_limit(key_hash, window_min, max_req)` — Atomic rate limiting counter

---

## Hosting & DNS

### plan.wtf (primary domain)
- **Registrar**: Namecheap (API user: `snackman`)
- **DNS**: Namecheap BasicDNS (`dns1.registrar-servers.com`)
- **A Record**: `@` → `76.76.21.21` (Vercel)
- **CNAME**: `www` → `cname.vercel-dns.com`
- **SSL**: Vercel auto-provisioned (manually issued via `vercel certs issue plan.wtf`)

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
- **Preview**: branch pushes create preview URLs automatically

### Redirects
| From | To | Method |
|------|----|--------|
| `sheeets.vercel.app/*` | `plan.wtf/*` | Vercel auto-redirect (custom domain) |
| `sheeets.xyz/*` | `plan.wtf/*` | .htaccess 301 |
| `sheeets.xyz/admin` | Google Sheet (admin) | .htaccess 301 |
| `plan.wtf/data` | Google Sheet (data) | Next.js redirect in next.config.ts |

---

## Adding a New Conference Tab

1. Find the tab's `gid` from the spreadsheet URL or HTML source
2. Add to `EVENT_TABS` in `src/lib/constants.ts`
3. Update `EVENT_DATES` if the new conference has dates outside the current range
4. Add a proximity center in `scripts/geocode.ts` → `PROXIMITY_CENTERS` and in `src/app/api/geocode/route.ts` → `PROXIMITY` if the conference is in a new city
5. Run the geocoding script to cache new addresses

---

## Development Notes

### tsconfig Excludes
`packages/` and `supabase/` are excluded from the root tsconfig. They have their own TypeScript configs and dependencies. Next.js will fail to build if these are included because their dependencies (MCP SDK, Deno) aren't in the root `node_modules`.

### Key Patterns
- **Auth-gated actions**: Star and RSVP use the same pattern — `pendingRef` stores the action, shows AuthModal, completes after login via useEffect
- **Profile fields**: Column is `rsvp_name` (NOT `farcaster_username` — the Supabase `search_users` function was updated to match)
- **Address links**: Use `<AddressLink>` component everywhere (events AND POIs) — desktop opens Google Maps, mobile shows Maps/Uber/Lyft drawer
- **POI addresses**: `useGeocoder` extracts both `place_name` (short) and `full_address` (complete street address) from Mapbox. POIs store `full_address` for accurate navigation links.
- **Profile auto-save**: Profile fields debounce-save after 800ms of inactivity, showing a green checkmark on success
- **Friends refresh**: `refreshFriends` is shared from EventApp → Header → UserMenu so accepting a request updates the friends list everywhere without page reload
- **Optimistic updates**: Sending a friend request immediately updates the search results and outgoing requests list before the server confirms

### Known Issues
- `search_users` has two overloaded versions in Supabase — the old one `(text, uuid)` is unused and should be dropped: `DROP FUNCTION IF EXISTS public.search_users(text, uuid);`
- `send_friend_request` debug alert is currently active (remove after confirming it works)
