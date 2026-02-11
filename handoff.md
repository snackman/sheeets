# Sheeets - Multi-Conference Side Event Map

## Project Overview
A standalone Next.js app that displays crypto conference side events on an interactive Mapbox map with list, table, and map views. Users can filter events by conference, date range, tags, time of day, and more. Star favorites and build a personal itinerary.

**Repo**: https://github.com/snackman/sheeets
**Data Source**: Google Sheet `1xWmIHyEyOmPHfkYuZkucPRlLGWbb9CF6Oqvfl8FUV6k` (https://sheeets.xyz)

---

## Tech Stack
- **Next.js 16** (App Router, Turbopack)
- **TypeScript**
- **Tailwind CSS** (dark theme)
- **Mapbox GL JS** via `react-map-gl` + `supercluster` for clustering
- **localStorage** for user state (stars, itinerary)
- No database, no auth

## Getting Started

```bash
cd sheeets
npm install
npm run dev        # http://localhost:3000
```

### Environment Variables (`.env.local`)
```
NEXT_PUBLIC_MAPBOX_TOKEN=pk.xxx    # Required for map view
```

### Geocoding (for map view)
Events have addresses but no lat/lng. Run the geocoding script to populate coordinates:
```bash
MAPBOX_SECRET_TOKEN=pk.xxx npx tsx scripts/geocode.ts
```
This creates/updates `src/data/geocoded-addresses.json`. The script fetches addresses from all event tabs and geocodes them via the Mapbox API.

---

## Architecture

### Data Flow
```
Google Sheet (GViz API, multiple tabs)
  → fetch-events.ts (paginated, header detection, tag parsing)
    → useEvents hook
      → EventApp
          ├── MapView (Mapbox GL)
          ├── ListView (cards)
          └── TableView (rows)
```

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
| Conference List | 749044131 | ~245 | Different schema (not used) |

To add a new conference tab, add its gid and name to `EVENT_TABS` in `src/lib/constants.ts`.

### File Structure
```
src/
├── app/
│   ├── page.tsx              # Renders EventApp
│   ├── layout.tsx            # Inter font, dark theme, metadata
│   └── globals.css           # Tailwind + Mapbox CSS + dark theme vars
├── components/
│   ├── EventApp.tsx          # Main orchestrator - state, hooks, view routing
│   ├── Header.tsx            # Title, view toggle, itinerary badge
│   ├── ViewToggle.tsx        # Map | List | Table toggle (data-driven)
│   ├── FilterBar.tsx         # Conference selector, day range slider, time, tags, quick filters
│   ├── SearchBar.tsx         # Debounced text search (300ms)
│   ├── EventCard.tsx         # Event card (used in list + popups)
│   ├── ListView.tsx          # Cards grouped by date
│   ├── TableView.tsx         # One row per event table (organizer, event, tags, location w/ Maps links)
│   ├── MapView.tsx           # Mapbox map with supercluster
│   ├── MapViewWrapper.tsx    # Dynamic import wrapper (ssr: false)
│   ├── MapMarker.tsx         # Colored dot by primary tag
│   ├── ClusterMarker.tsx     # Orange circle with count
│   ├── EventPopup.tsx        # Map click popup
│   ├── StarButton.tsx        # Star toggle (yellow)
│   ├── ItineraryButton.tsx   # Calendar toggle (orange)
│   ├── ItineraryPanel.tsx    # Slide-over panel with conflict detection
│   └── Loading.tsx           # Spinner
├── hooks/
│   ├── useEvents.ts          # Fetch + parse events from GViz
│   ├── useFilters.ts         # Filter state management (conference, day range, tags, etc.)
│   ├── useStarred.ts         # localStorage starred events
│   └── useItinerary.ts       # localStorage itinerary events
├── lib/
│   ├── gviz.ts               # GViz response parser
│   ├── types.ts              # TypeScript types
│   ├── constants.ts          # Sheet ID, event tabs, dates, tag colors, storage keys
│   ├── utils.ts              # Date/time parsing, address normalization
│   ├── fetch-events.ts       # GViz fetch with pagination, header detection, tag parsing
│   └── filters.ts            # Filter logic (pure functions)
├── data/
│   └── geocoded-addresses.json  # Cached geocoded addresses
scripts/
└── geocode.ts                # Build-time geocoding script (all tabs)
```

### Key Types (`src/lib/types.ts`)
```typescript
interface ETHDenverEvent {
  id, date, dateISO, startTime, endTime, isAllDay,
  organizer, name, address, cost, isFree,
  vibe,           // Primary tag (first tag)
  tags: string[], // All tags from comma-separated Tags column
  conference,     // Which tab this event belongs to
  link, hasFood, hasBar, note,
  lat?, lng?, timeOfDay
}

type ViewMode = 'map' | 'list' | 'table'

interface FilterState {
  conference,     // Single-select: which conference to show
  selectedDays,   // Date range (empty = all days)
  timeOfDay, vibes,
  freeOnly, hasFood, hasBar,
  starredOnly, itineraryOnly, searchQuery
}
```

---

## Features

### Views
- **Table** (default): Compact spreadsheet-style rows. Organizer | Event (linked) | Tags (colored pills) | Location (links to Google Maps) | Cost | Food/Bar indicators.
- **List**: Event cards grouped by date with sticky headers.
- **Map**: Mapbox GL with clustered markers, colored by primary tag. Click markers for popup details.

### Filtering
- **Conference selector**: Single-select toggle between conferences (ETH Denver / Consensus HK)
- **Day range slider**: Dual-handle slider for selecting a date range
- **Time of day**: Morning / Afternoon / Evening / Night / All Day
- **Tag chips**: Multi-select (intersection — event must have ALL selected tags)
- **Quick filters**: Free only, Has food, Has bar
- **Text search**: Across name, organizer, address, note, tags, conference (300ms debounce)

### User Features (localStorage, no auth)
- **Star/favorite** events (persists across sessions)
- **Itinerary builder** with slide-over panel
- **Conflict detection** for overlapping events in itinerary
- **Filter modes**: Show starred only, show itinerary only

---

## Adding a New Conference Tab

1. Find the tab's `gid` from the spreadsheet URL or HTML source
2. Add to `EVENT_TABS` in `src/lib/constants.ts`:
   ```typescript
   { gid: 123456789, name: 'Conference Name 2026' }
   ```
3. Update `EVENT_DATES` if the new conference has dates outside the current range
4. Update `defaultFilters.conference` in `src/hooks/useFilters.ts` if you want a different default
5. Run the geocoding script to cache new addresses

The parser auto-detects the header row and reads events until the first empty row, so no column mapping changes are needed as long as the tab follows the same layout.

---

## Known Limitations

### Geocoding Proximity Bias
The geocoding script uses Denver, CO as the proximity center. Hong Kong addresses often geocode incorrectly (defaulting to Denver or unrelated locations). A future improvement would be to detect the conference location and use the appropriate proximity center.

### End Times Mostly Empty
The sheet has very few end times populated. Most events show only start time.

### Google Sheets "Tables" Feature
Some sheet tabs may use Google's "Tables" feature which can cap GViz results. The fetch code paginates (500 rows per page, up to 5000) to mitigate this.

---

## Deploy to Vercel

```bash
vercel link
vercel env add NEXT_PUBLIC_MAPBOX_TOKEN
vercel --prod
```

Or connect the GitHub repo to Vercel for auto-deploy on push.

---

## Development Notes

### Adding New Tag Colors
Edit `src/lib/constants.ts` → `VIBE_COLORS` map. Any unknown tag falls back to gray (`#6B7280`).

### localStorage Keys
All user data stored under keys prefixed with `ethdenver-2025-`:
- `ethdenver-2025-starred`
- `ethdenver-2025-itinerary`
