# Sheeets - Multi-Conference Side Event Guide

## Project Overview
A standalone Next.js app that displays crypto conference side events with interactive map, list, and table views. Users can filter events by conference, date range, time range, tags, and more. Star favorites and build a personal itinerary with PNG export and shareable links.

**Live**: https://sheeets.xyz/app (redirects to Vercel)
**Vercel**: https://sheeets.vercel.app
**Repo**: https://github.com/snackman/sheeets
**Data Source**: Google Sheet `1xWmIHyEyOmPHfkYuZkucPRlLGWbb9CF6Oqvfl8FUV6k` (https://sheeets.xyz)

---

## Tech Stack
- **Next.js 16** (App Router, Turbopack)
- **TypeScript**
- **Tailwind CSS** (dark theme)
- **Mapbox GL JS** via `react-map-gl` (individual markers, zoom-aware labels)
- **Supabase** (auth via email OTP, itinerary sync, image caching)
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
```

### Geocoding (for map view)
Events have addresses but no lat/lng. Run the geocoding script to populate coordinates:
```bash
MAPBOX_SECRET_TOKEN=pk.xxx npx tsx scripts/geocode.ts
```
This creates/updates `src/data/geocoded-addresses.json`. Coordinates are matched to events at runtime via `normalizeAddress()` lookup in `fetch-events.ts`.

**Important**: The script uses proximity centers (Denver for ETH Denver, Hong Kong for Consensus) based on the tab name. If addresses geocode incorrectly, delete the bad entries from the JSON cache and re-run — the script only geocodes addresses not already in the cache.

---

## Architecture

### Data Flow
```
Google Sheet (GViz API, multiple tabs)
  → fetch-events.ts (paginated, header detection, tag parsing, geocode lookup, synthetic tags)
    → useEvents hook
      → EventApp
          ├── MapView (Mapbox GL, auto-centers on events, zoom-aware labels, itinerary numbering)
          ├── ListView (cards grouped by date)
          └── TableView (compact rows with icon-only tags)
```

### Auth & User Data
```
Supabase Auth (email OTP)
  → AuthContext (signIn, verifyOtp, signOut)
  → useItinerary (dual storage: localStorage + Supabase itineraries table)
  → AuthModal (two-step: email → 6-digit code)
```

**Auth guards**:
- Starring an event requires auth — if dismissed without signing in, the pending star is cleared
- Itinerary filter button requires auth — if user signs out or auth is dismissed, `itineraryOnly` is automatically deselected

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
│   ├── layout.tsx            # Inter font, dark theme, viewport config (viewportFit: cover)
│   ├── globals.css           # Tailwind + Mapbox CSS + dark theme vars + safe-area insets
│   ├── itinerary/
│   │   ├── page.tsx          # Standalone itinerary page
│   │   └── s/[code]/page.tsx # Shared itinerary viewer
│   └── api/
│       └── og/route.ts       # OG image resolution (Luma API + HTML scraping, Supabase cache)
├── components/
│   ├── EventApp.tsx          # Main orchestrator - state, hooks, view routing, auth guards
│   ├── Header.tsx            # Title, view toggle, itinerary badge, auth
│   ├── AuthModal.tsx         # Email OTP auth (two-step: email → 6-digit code)
│   ├── ViewToggle.tsx        # Map | List | Table toggle
│   ├── FilterBar.tsx         # Conference dropdown (mobile) / tabs (desktop), sliders, tag chips
│   ├── SearchBar.tsx         # Debounced text search (300ms)
│   ├── TagBadge.tsx          # Tag pill with Lucide icon + color (supports iconOnly mode)
│   ├── EventCard.tsx         # Event card for list view
│   ├── ListView.tsx          # Cards grouped by date, sticky date headers
│   ├── TableView.tsx         # Compact rows: star | date | time | organizer | event | location | tags
│   ├── MapView.tsx           # Mapbox map, auto-centers on events, zoom-aware labels
│   ├── MapViewWrapper.tsx    # Dynamic import wrapper (ssr: false), passes isItineraryView
│   ├── MapMarker.tsx         # Colored dot/numbered circle, label card at zoom ≥14, time at ≥16
│   ├── EventPopup.tsx        # Map click popup (single + multi-event), mobile-safe overflow
│   ├── StarButton.tsx        # Star toggle (yellow), mobile touch targets
│   ├── ItineraryPanel.tsx    # Slide-over panel with conflict detection, share, PNG export
│   ├── OGImage.tsx           # Lazy-loaded OG image thumbnails
│   ├── Providers.tsx         # AuthProvider wrapper
│   └── Loading.tsx           # Spinner
├── contexts/
│   └── AuthContext.tsx       # Supabase auth context (email OTP)
├── hooks/
│   ├── useEvents.ts          # Fetch + parse events from GViz
│   ├── useFilters.ts         # Filter state management
│   └── useItinerary.ts       # Dual storage: localStorage + Supabase sync
├── lib/
│   ├── gviz.ts               # GViz response parser
│   ├── types.ts              # TypeScript types (ETHDenverEvent, FilterState, ViewMode)
│   ├── constants.ts          # Sheet ID, event tabs, dates, tag colors, TYPE_TAGS
│   ├── supabase.ts           # Supabase client
│   ├── fetch-events.ts       # GViz fetch + synthetic tag generation + geocode lookup (normalizeAddress)
│   ├── filters.ts            # Filter logic (pure functions, exported parseTimeToMinutes)
│   ├── utils.ts              # Date formatting, normalizeAddress, time parsing
│   └── calendar.ts           # ICS export for itinerary
├── data/
│   └── geocoded-addresses.json  # Cached geocoded addresses (Denver + Hong Kong)
scripts/
└── geocode.ts                # Build-time geocoding script (multi-tab, proximity-aware)
```

### Key Types (`src/lib/types.ts`)
```typescript
interface ETHDenverEvent {
  id, date, dateISO, startTime, endTime, isAllDay,
  organizer, name, address, cost, isFree,
  vibe,           // Primary tag (first tag)
  tags: string[], // All tags + synthetic tags (FREE/$$, 🍕 Food, 🍺 Bar)
  conference,     // Which tab this event belongs to
  link, hasFood, hasBar, note,
  lat?, lng?, timeOfDay, isDuplicate?
}

type ViewMode = 'map' | 'list' | 'table'

interface FilterState {
  conference,     // Single-select: which conference to show
  selectedDays,   // Date range (empty = all days)
  timeStart,      // 0-24 hour range start
  timeEnd,        // 0-24 hour range end
  vibes,          // Selected tags (includes FREE, $$, Food, Bar)
  itineraryOnly,  // Show itinerary only
  searchQuery,    // Text search
  nowMode         // Show happening-now events
}
```

### Supabase Tables
```
itineraries       - user_id (PK), event_ids (array), updated_at
shared_itineraries - Used for shareable itinerary links
event_images      - Cached OG images (event_id PK, source_url, image_url)
```

---

## Features

### Views
- **Table** (default): Compact rows in a contained scroll area (`maxHeight: calc(100vh - 220px)`). Sticky thead with date label tracking (WHEN column updates to show current date as you scroll). Star | Date | Time | Organizer (15 char) | Event (25 char, linked) | Location (20 char, linked to Google Maps) | Tags (max 3 icons + count).
- **List**: Event cards grouped by date with sticky headers (solid bg, no gap). Title links to RSVP URL.
- **Map**: Mapbox GL with individual markers, colored by primary tag. Auto-centers on events (switches between Denver and Hong Kong when changing conferences). Zoom-aware labels (name at ≥14, time at ≥16). Numbered pins when itinerary filter is active. Click markers for popup details.

### Filtering
- **Conference selector**: Dropdown on mobile, inline tabs on desktop
- **Now mode**: Shows events happening now or starting within 1 hour (auto-refreshes every 5 min)
- **Day range slider**: Dual-handle slider for selecting a date range
- **Time range slider**: Continuous 0-24h dual-handle slider
- **Type chips**: FREE, $$, 🍕 Food, 🍺 Bar, Conference, Hackathon, etc. (intersection filter)
- **Tag chips**: Topic tags like AI, DeFi, NFTs, etc.
- **Text search**: Across name, organizer, address, note, tags, conference (300ms debounce)

### Synthetic Tags
Generated at data load time in `fetch-events.ts`:
- `isFree` → adds `"FREE"` tag; otherwise adds `"$$"` tag
- `hasFood` → adds `"🍕 Food"` tag
- `hasBar` → adds `"🍺 Bar"` tag

These appear as filterable type chips alongside Conference, Hackathon, etc. Ordering is controlled by `TYPE_TAGS` in `constants.ts`.

### User Features
- **Auth**: Email OTP via Supabase (sign in required to star events)
- **Star/favorite** events (synced: localStorage + Supabase)
- **Itinerary builder** with slide-over panel
- **Conflict detection** for overlapping events
- **Share itinerary**: Shareable link with code, PNG export, ICS calendar download
- **Filter modes**: Show itinerary only, now mode

### Mobile Optimizations
- **Viewport**: `viewportFit: cover` with safe-area-inset CSS variables
- **Dynamic viewport height**: `h-dvh` for map mode (handles mobile browser chrome)
- **Touch targets**: 44px minimum on interactive elements (markers, buttons)
- **Active states**: All interactive elements have `active:` feedback for touch
- **Conference dropdown**: Popover menu on mobile instead of inline tabs
- **Responsive text**: Search count shortens on narrow screens
- **iOS auto-zoom prevention**: Inputs have `font-size: 16px`
- **Reduced margins**: `px-2` on mobile, `px-4` on sm+ breakpoint

### Tag Icons (Lucide React)

| Tag | Icon | Tag | Icon |
|-----|------|-----|------|
| Conference | Landmark | Networking | Users |
| Panel/Talk | Mic | Devs/Builders | Wrench |
| Hackathon | Code | VCs/Angels | TrendingUp |
| AI | Bot | DeFi | Coins |
| DAOs | Users | NFTs | Image |
| DePIN | Cpu | RWA | Globe |
| ETH | Diamond | BTC | Coins |
| SOL | Sun | Gaming | Gamepad2 |
| Art | Palette | Wellness | Heart |
| Brunch | Coffee | Bar/Pub | Beer |
| Jobs/Hiring | Briefcase | Memecoins | Smile |
| Party | Music | Workshop | GraduationCap |

---

## Hosting & DNS

- **Vercel**: Auto-deploys from `master` branch at https://sheeets.vercel.app
- **sheeets.xyz/app**: 301 redirect via cPanel .htaccess → Vercel
- **sheeets.xyz**: Main domain hosted on Namecheap cPanel (premium266.web-hosting.com)
- **DNS/redirects**: Managed via cPanel API (see `C:\Users\samgo\OneDrive\Documents\PizzaDAO\Code\namecheap`)

---

## Adding a New Conference Tab

1. Find the tab's `gid` from the spreadsheet URL or HTML source
2. Add to `EVENT_TABS` in `src/lib/constants.ts`:
   ```typescript
   { gid: 123456789, name: 'Conference Name 2026' }
   ```
3. Update `EVENT_DATES` if the new conference has dates outside the current range
4. Update `defaultFilters.conference` in `src/hooks/useFilters.ts` if you want a different default
5. Add a proximity center in `scripts/geocode.ts` → `PROXIMITY_CENTERS` if the conference is in a new city
6. Run the geocoding script to cache new addresses

The parser auto-detects the header row and reads events until the first empty row, so no column mapping changes are needed as long as the tab follows the same layout.

---

## Open Plans

### Luma RSVP Integration (`plans/luma-rsvp.md`)
- **Status**: Planned, not yet implemented
- **Approach**: Use Luma's official embed checkout widget to open registration overlay inside sheeets
- **Key finding**: Luma's official API (`add-guests`) requires the event host's API key — not viable for aggregating 3rd-party events. The embed widget works for any public Luma event without API keys.
- **Existing code**: `src/app/api/og/route.ts` already calls `api.lu.ma/url?url={slug}` for Luma event lookups — reusable for slug→eventId resolution
- **Blocker**: Need to verify embed widget works with URL slugs vs `evt-` IDs

---

## Recent Changes (2026-02-12)

### Consensus Hong Kong Map Fix
- Cleaned 47 bad geocode entries that had Denver/random coordinates for Hong Kong addresses
- Re-geocoded with Mapbox using Hong Kong proximity center, manually fixed 5 remaining
- Fixed address normalization mismatch: `fetch-events.ts` now uses `normalizeAddress()` (same as geocode script) instead of inline `.toLowerCase().trim()`
- Map auto-centers on events' average location — switches to Hong Kong when viewing Consensus

### UI Fixes
- **Mobile margins**: Halved left/right padding on mobile (`px-4` → `px-2 sm:px-4`) across Header, FilterBar, ListView, TableView
- **List view sticky headers**: Fixed transparent sliver between header and date labels (solid bg, 1px overlap)
- **Itinerary auth guard**: `itineraryOnly` filter auto-deselects if user is not signed in; pending star ref cleared when auth modal dismissed
- **Table scroll**: Reverted to original contained scroll (`overflow-auto` + `maxHeight`) — window-scroll approaches broke sticky thead and date label tracking on mobile due to `overflow-x-auto` creating a scroll context

### Table Scroll Architecture Note
Multiple approaches were tried to make filters scroll away while keeping the table header sticky:
1. **Window scroll + sticky thead at `top: 57px`** — broke because `overflow-x-auto` on the table wrapper creates a scroll context, preventing vertical sticky
2. **Sticky scroll container** — table wrapper itself is `position: sticky` with internal `overflow: auto` — worked on desktop but had UX issues on mobile (nested scroll contexts)
3. **Reverted to contained scroll** — `overflow: auto` + `maxHeight: calc(100vh - 220px)` with `sticky top-0` thead inside the container. This is the proven approach where everything works (sticky header, date tracking, horizontal scroll). Trade-off: filter bar stays visible above the table.

---

## Known Limitations

### Table Scroll vs Filter Visibility
The table view uses a contained scroll area, so the filter bar stays visible above it. Attempts to make filters scroll away broke the sticky table header on mobile. A future approach could use JavaScript-driven fixed positioning for the thead.

### End Times Mostly Empty
The sheet has very few end times populated. Most events show only start time.

### Google Sheets "Tables" Feature
Some sheet tabs may use Google's "Tables" feature which can cap GViz results. The fetch code paginates (500 rows per page, up to 5000) to mitigate this.

---

## Deploy

Pushes to `master` auto-deploy via Vercel GitHub integration.

Manual deploy:
```bash
vercel --prod
```

### Environment Variables on Vercel
```
NEXT_PUBLIC_MAPBOX_TOKEN=pk.xxx
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJxxx
```

---

## Development Notes

### Adding New Tag Colors/Icons
- Colors: Edit `src/lib/constants.ts` → `VIBE_COLORS` map. Unknown tags fall back to gray (`#6B7280`).
- Icons: Edit `src/components/TagBadge.tsx` → `TAG_ICONS` map. Tags without an icon show color pill only.

### Adding Synthetic Tags
Edit `src/lib/fetch-events.ts` where synthetic tags are appended after tag parsing. Add to `TYPE_TAGS` in `constants.ts` for ordering in the filter UI.

### localStorage Keys
All user data stored under keys prefixed with `sheeets-`:
- `sheeets-itinerary`
- `sheeets-view`

### Workflow
- All implementation goes through git worktrees with draft PRs for Vercel preview
- Task tracking via `sheets-claude` CLI (Google Sheets integration)
- Plans saved to `plans/` directory, moved to `plans/done/` after completion
