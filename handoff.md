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
│       └── og/route.ts       # OG image resolution (Luma API + HTML scraping, Supabase cache, 1h TTL)
├── components/
│   ├── EventApp.tsx          # Main orchestrator - state, hooks, view routing, auth guards
│   ├── Header.tsx            # Title, view toggle, itinerary badge, auth (sticky + shrink-0)
│   ├── AuthModal.tsx         # Email OTP auth (two-step: email → 6-digit code)
│   ├── ViewToggle.tsx        # Map | List | Table toggle
│   ├── FilterBar.tsx         # Conference dropdown (mobile) / tabs (desktop), sliders, tag chips
│   ├── DualRangeSlider.tsx   # Custom pointer-based dual-handle slider (direction-aware)
│   ├── SearchBar.tsx         # Debounced text search (300ms)
│   ├── TagBadge.tsx          # Tag icon with color (supports iconOnly mode, custom SVG crypto icons)
│   ├── EventCard.tsx         # Event card for list view (image left, details right)
│   ├── ListView.tsx          # Cards grouped by date, sticky date headers
│   ├── TableView.tsx         # table-fixed layout, fills viewport, CSS truncate
│   ├── MapView.tsx           # Mapbox map, auto-centers on events (IQR outlier exclusion)
│   ├── MapViewWrapper.tsx    # Dynamic import wrapper (ssr: false), passes isItineraryView
│   ├── MapMarker.tsx         # Clock-face SVG pin (dark bg + colored time wedge), always-visible labels (name + organizer), #N badges for itinerary
│   ├── EventPopup.tsx        # Map popup matching list card design (OG image, star, tags icons), multi-event scroll list
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
│   ├── constants.ts          # Sheet ID, event tabs, dates, tag colors (3 groups), TYPE_TAGS
│   ├── analytics.ts          # GA4 custom event tracking (gtag wrapper)
│   ├── supabase.ts           # Supabase client
│   ├── fetch-events.ts       # GViz fetch + synthetic tag generation + geocode lookup
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
  tags: string[], // All tags + synthetic tags ($$, 🍕 Food, 🍺 Bar)
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
  vibes,          // Selected tags (includes $$, Food, Bar)
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

**Supabase project**: `qsiukfwuwbpwyujfahtz` (sheeets)

---

## Features

### Views
- **Table** (default): `table-fixed` layout with `w-full min-w-[900px]`. Columns fill available width with percentages: organizer 25%, event 26%, tags 22%, location 15% (star and when are fixed-width). Single-line rows with CSS `truncate`. Tags show as icon-only, no wrapping. FilterBar stays visible on desktop, collapses on mobile scroll. Sticky thead with date label tracking.
- **List**: Event cards with image on left, details on right. Organizer directly under event name (no "By" prefix). Calendar icon on date/time row, pin icon on location. Cards grouped by date with sticky headers. Header sticky at top. Natural page scroll (`min-h-screen`).
- **Map**: Mapbox GL with clock-face SVG pins (dark circle + colored time wedge). Pin color by time of day: yellow (morning), orange (noon–6pm), purple (evening). Always-visible labels (event name + organizer). Auto-centers on events using IQR-based outlier exclusion (won't recenter when filters remove all events). Multi-event pins show count badge. Itinerary pins show `#N` stop badges. Popup cards match list view design (OG image, star, tags, etc).

### Layout Architecture
```
Table/Map view:  h-dvh flex flex-col overflow-hidden
  Header         sticky top-0 shrink-0
  FilterBar      shrink-0 (mobile: collapses on scroll; desktop: always visible)
  main           flex-1 min-h-0 (+ min-w-0 for table)
    TableView    flex-1 min-h-0 min-w-0 → overflow-auto container

List view:       min-h-screen (natural page scroll)
  Header         sticky top-0
  FilterBar      shrink-0
  main           natural flow
```

**Key CSS insight**: All flex ancestors of the table scroll container need `min-w-0` to override the default `min-width: auto`. Without this, the 900px-wide table prevents flex items from shrinking below content width, breaking horizontal scroll on mobile.

### Filtering
- **Conference selector**: Dropdown on mobile, inline tabs on desktop
- **Now mode**: Shows events happening now or starting within 1 hour (auto-refreshes every 5 min)
- **Day range slider**: Custom `DualRangeSlider` component with pointer events — picks endpoint by drag direction when handles overlap
- **Time range slider**: Same `DualRangeSlider` component, continuous 0-24h
- **Type chips**: $$, 🍕 Food, 🍺 Bar, Conference, Hackathon, etc. (intersection filter)
- **Tag chips**: Topic tags like AI, DeFi, NFTs, etc.
- **Text search**: Across name, organizer, address, note, tags, conference (300ms debounce)

### Tag System

**Three color groups** (matching the source spreadsheet):

| Group | Color | Tags |
|-------|-------|------|
| Green (`#34D399`) | Event formats | Conference, Panel/Talk, Hackathon, Networking, Workshop, Party, Brunch, Bar/Pub, Meetup, Demo Day, Dinner, Wellness, Performance, Art, 🍕 Food, 🍺 Bar |
| Blue (`#3B82F6`) | Builders & business | Devs/Builders, VCs/Angels, Jobs/Hiring |
| Yellow (`#FBBF24`) | Crypto & topics | DePIN, AI, DeFi, NFTs, Memecoins, Ordinals, BTC, ETH, SOL, DAOs, RWA, Gaming |
| Purple (`#A855F7`) | Cost | $$ (paid entry, shown as Ticket icon) |

**Tag Icons** (Lucide React + custom SVGs):

| Tag | Icon | Tag | Icon |
|-----|------|-----|------|
| Conference | IdCardLanyard | Networking | Handshake |
| Panel/Talk | Mic | Devs/Builders | Wrench |
| Hackathon | Trophy | VCs/Angels | CircleDollarSign |
| AI | Bot | DeFi | ChartCandlestick |
| DAOs | Vote | NFTs | Image |
| DePIN | Cpu | RWA | House |
| ETH | Custom SVG | BTC | Custom SVG |
| SOL | Custom SVG | Gaming | Gamepad2 |
| Art | Palette | Wellness | Heart |
| Brunch | Coffee | Bar/Pub | Beer |
| Jobs/Hiring | Briefcase | Memecoins | Smile |
| Party | PartyPopper | Workshop | GraduationCap |
| $$ | Ticket | Meetup | Handshake |

**Synthetic Tags** (generated at data load time in `fetch-events.ts`):
- Paid events → `"$$"` tag (purple ticket icon). Free events get no cost tag.
- `hasFood` → `"🍕 Food"` tag
- `hasBar` → `"🍺 Bar"` tag

### Google Analytics (GA4) Custom Events

All tracked via `src/lib/analytics.ts`:

| Event | Trigger | Parameters |
|-------|---------|------------|
| `view_change` | Table/List/Map toggle | `view_mode` |
| `conference_select` | Conference tab/dropdown | `conference` |
| `tag_toggle` | Type or tag filter pill | `tag`, `active` |
| `day_range` | Day slider | `start_day`, `end_day` |
| `time_range` | Time slider | `start_hour`, `end_hour` |
| `now_mode` | Now button | `active` |
| `search` | Search input (2+ chars, debounced) | `search_term` |
| `itinerary` | Star button | `event_id`, `action` (add/remove) |
| `event_click` | Event link click | `event_name`, `url` |
| `auth_prompt` | Sign in shown | `trigger` (star/sign_in_button/itinerary_button) |
| `auth_success` | OTP verified | — |
| `sign_out` | Sign out | — |
| `locate_me` | Map locate button | — |
| `clear_filters` | Clear all button | — |

**GA4 portal setup needed**: Create custom dimensions in Admin > Custom definitions for `view_mode`, `conference`, `tag`, `search_term`, `event_name`, `trigger`, `action`. Build explorations for event link clicks, view mode usage, tag popularity, search terms, and auth funnel.

### DualRangeSlider Component
Custom slider replacing native `<input type="range">` overlays. Uses pointer events with `setPointerCapture` for reliable drag handling. When both handles overlap at the same position:
- Drag right → moves the end handle
- Drag left → moves the start handle
- Click away from overlap → picks nearest handle

### User Features
- **Auth**: Email OTP via Supabase (sign in required to star events)
- **Star/favorite** events (synced: localStorage + Supabase)
- **Itinerary builder** with slide-over panel
- **Conflict detection** for overlapping events
- **Share itinerary**: Shareable link with code, PNG export, ICS calendar download
- **Filter modes**: Show itinerary only, now mode

### Mobile Optimizations
- **Viewport**: `viewportFit: cover` with safe-area-inset CSS variables
- **Dynamic viewport height**: `h-dvh` for table/map views (handles mobile browser chrome)
- **Flex layout with min-w-0**: Prevents 900px table from blowing out flex containers on mobile
- **Touch targets**: 44px minimum on interactive elements (markers, buttons)
- **Active states**: All interactive elements have `active:` feedback for touch
- **Conference dropdown**: Popover menu on mobile instead of inline tabs
- **Responsive text**: Search count shortens on narrow screens
- **iOS auto-zoom prevention**: Inputs have `font-size: 16px`
- **Reduced margins**: `px-2` on mobile, `px-4` on sm+ breakpoint

---

## Hosting & DNS

- **Vercel**: Auto-deploys from `master` branch at https://sheeets.vercel.app
- **sheeets.xyz/app**: 301 redirect via cPanel .htaccess → Vercel
- **sheeets.xyz**: Main domain hosted on Namecheap cPanel (premium266.web-hosting.com)
- **DNS**: Managed via cPanel (nameservers: `dns1.namecheaphosting.com`, `dns2.namecheaphosting.com`)
- **Email DNS**: DKIM, SPF, DMARC records configured for Resend on sheeets.xyz via cPanel
- **DNS management**: Use cPanel API (not Namecheap API) since domain uses hosting nameservers, not BasicDNS. See `namecheap/setup_sheeets_resend_dns.py` for example.

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

### Theme Toggle (`plans/tomato-46571-theme-toggle.md`)
- **Status**: PR #18 open (draft), Vercel preview deployed
- **Branch**: `tomato-46571-theme-toggle`
- **Scope**: Full light/dark theme toggle with Google Sheets-inspired light palette, 22 files modified

---

## Recent Changes (2026-02-13, Session 3)

### Map View Overhaul
- **Clock-face SVG pins**: Dark circle (`#1e293b`) with colored time wedge (yellow morning, orange afternoon, purple evening). All-day events show solid colored circle.
- **Always-visible labels**: Event name (line 1), organizer in gray (line 2), tag icons (line 3). No zoom gating.
- **Itinerary pins**: Clock-face + white `#N` stop badge (same style as multi-event count badge)
- **List-style popup cards**: OG image, star button, event name, organizer, date/time with calendar icon, tag icons. Multi-event scroll list uses same card layout.
- **No false recenter**: Map stays in place when "Now" or other filters remove all located events (was snapping to Denver)
- **OG image flash fix**: Added `key={event.id}` to force remount when switching popup events

### Mobile UX
- **Filter collapse on landscape**: Changed breakpoint from `sm:` to `lg:` so landscape phones also auto-hide filters on table scroll
- **Combined Event/Organizer column (portrait)**: Table hides Organizer column below `sm:` breakpoint, shows organizer as second line in Event cell. Reduced table min-width to 640px on portrait.

### Auth Fix
- **Pending star race condition**: Star clicked while logged out was lost after login because Supabase sync overwrote the itinerary. Added `ready` flag to `useItinerary` that's true only after initial sync completes. Pending star effect waits for `ready` before toggling.

---

## Recent Changes (2026-02-12, Session 2)

### Tag System Overhaul
- **3 color groups**: Green (event formats), Blue (builders/business), Yellow (crypto/topics), Purple (cost)
- **Icon updates**: Conference→IdCardLanyard, Networking→Handshake, VCs/Angels→CircleDollarSign, Hackathon→Trophy, DeFi→ChartCandlestick, DAOs→Vote, RWA→House, Party→PartyPopper
- **Custom SVG icons**: ETH (ethereum diamond), BTC (bitcoin B), SOL (solana bars)
- **Removed colored circle backgrounds**: Icons render at their tag color directly, larger sizes (w-4/w-5)
- **FREE tag removed**: Paid events show purple Ticket icon (`$$`), free events have no cost indicator

### GA4 Custom Event Tracking
- New `src/lib/analytics.ts` — lightweight gtag wrapper
- 14 custom events tracked across all components (view changes, filters, search, itinerary, auth, map, event clicks)

### Table View Improvements
- **Columns fill viewport**: `table-fixed` with `w-full`, percentage-based column widths (organizer 25%, event 26%, tags 22%, where 15%)
- **No hard JS truncation**: Replaced 15/25/20 character limits with CSS `truncate`
- **Tags single-line**: No wrapping, overflow hidden
- **Filter bar stays visible on desktop**: Collapse-on-scroll is mobile-only (`sm:` breakpoint override)

### List View Improvements
- **Event images moved to left** side of cards
- **Organizer**: Removed "By" prefix, left-aligned directly under event name
- **Date/time row**: Added Calendar icon, left-aligned with location row (matching MapPin icon)

### Map View
- **Outlier exclusion**: IQR-based filtering on lat/lng before computing center — prevents faraway events from pulling the viewport off the main cluster

### OG Image Cache
- Reduced CDN cache TTL from 24h to 1h (`Cache-Control: max-age=3600, s-maxage=3600`) so image overrides take effect faster

---

## Previous Changes (2026-02-12, Session 1)

### Google Analytics
- Added GA4 tracking (`G-2WB3SFJ13V`) via `next/script` with `afterInteractive` strategy in `layout.tsx`

### Email / Auth
- Configured Resend SMTP for Supabase auth emails (`noreply@sheeets.xyz`)
- Set up DNS records (DKIM, SPF, DMARC) for `sheeets.xyz` via cPanel API
- Rate limit increased to 30 emails/hour (from 2) with custom SMTP

### Mobile Table View Overhaul
- **Layout**: Switched from `calc(100vh - 220px)` to flex-based `h-dvh` layout with `flex-1 min-h-0`
- **Horizontal scroll**: Fixed via `min-w-0` on all flex ancestors (classic flexbox `min-width: auto` bug)
- **Header**: Always visible — `sticky top-0 shrink-0` (sticky works in list view, shrink-0 works in flex views)
- **FilterBar**: Collapses with `max-h-0` transition when table is scrolled down, reappears at top
- **Filter panel**: `overflow-hidden` only applied during collapse animation, not when visible

### DualRangeSlider
- Replaced native `<input type="range">` overlay hack with custom component
- Uses pointer events with capture for reliable drag handling
- Resolves overlapping handles by drag direction instead of z-index heuristic

### Consensus Hong Kong Map Fix
- Cleaned 47 bad geocode entries, re-geocoded with Hong Kong proximity center

---

## Known Limitations

### End Times Mostly Empty
The sheet has very few end times populated. Most events show only start time.

### Google Sheets "Tables" Feature
Some sheet tabs may use Google's "Tables" feature which can cap GViz results. The fetch code paginates (500 rows per page, up to 5000) to mitigate this.

### OG Image Cache
Event images are cached in the `event_images` Supabase table. To override a cached image, update the `image_url` column directly:
```sql
UPDATE event_images SET image_url = 'https://...' WHERE event_id = 'evt-xxx';
```
Cache TTL is 1 hour at the CDN level. A redeploy also clears edge caches.

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
- Colors: Edit `src/lib/constants.ts` → `VIBE_COLORS` map. Three groups: green (event formats), blue (builders), yellow (crypto). Unknown tags fall back to gray (`#6B7280`).
- Icons: Edit `src/components/TagBadge.tsx` → `TAG_ICONS` map. Supports both Lucide icons and custom SVG components via `IconComponent` type.

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
