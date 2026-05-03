# plan.wtf - Multi-Conference Side Event Guide

## Project Overview
A standalone Next.js app that displays crypto/tech conference side events with interactive map, list, table, and gallery views. Landing page at `plan.wtf` shows active conference cards with event counts, days-away badges, social links, and upcoming conferences with "Notify Me" email signups. Users can filter events by conference, date range, time range, tags, and more. Add events to your plan and build a personal itinerary with PNG export and shareable links. Social features include friend connections, check-ins, emoji reactions, and event comments. RSVP flow for Luma events with in-app registration overlay.

**Live**: https://plan.wtf
**Repo**: https://github.com/snackman/sheeets
**Data Source**: Google Sheet `1xWmIHyEyOmPHfkYuZkucPRlLGWbb9CF6Oqvfl8FUV6k` (https://plan.wtf/data)

---

## Tech Stack
- **Next.js 16** (App Router, Turbopack)
- **TypeScript**
- **Tailwind CSS** (CSS custom properties theme system with `data-theme` attribute)
- **Mapbox GL JS** via `react-map-gl` (individual markers, zoom-aware labels)
- **Supabase** (auth via email OTP, itinerary sync, friends, check-ins, reactions, comments, POIs, image caching, ad tracking, profile pictures via Storage, RSVPs)
- **OpenAI** (GPT-4o-mini for sponsor extraction in crawl script)
- **@tanstack/react-virtual** (list virtualization for scroll performance)
- **Google Sheets API** (service account auth for event submission)
- **Google Analytics** (GA4, custom event tracking)
- **html-to-image** for itinerary PNG export
- **localStorage + Supabase** for user state (plan items, itinerary, hidden events — dual storage with sync)

---

## Recent Changes (This Session — May 3, 2026)

All changes on branch `pineapple-22344-itinerary-overhaul` (PR #123).

### Share Card Flyer Gallery
- **New file**: `src/app/api/image-proxy/route.ts` — server-side image proxy to bypass CORS for html-to-image canvas rendering
- **ShareCardModal** (`src/components/ShareCardModal.tsx`):
  - Pre-fetches flyer images as data URLs: checks `imageCache` → batch POST `/api/og` → proxy via `/api/image-proxy` → FileReader → data URL map
  - Flyers/Text Only toggle (`ShareCardMode` type) — skips image pre-fetching in text mode
  - Passes `flyerImages` map and `mode` prop to template
- **ShareCardTemplate** (`src/components/ShareCardTemplate.tsx`):
  - **Gallery mode** (default): 2-column grid of 486px square flyer tiles with event name (22px bold) and time (19px) above each image. Dark placeholder for events without flyers.
  - **Text mode**: Classic layout with time + event name + address in a list
  - End times now shown (e.g., "6:00p - 9:00p")
  - Exported `ShareCardMode` type

### /plan Page Improvements
- **Friend avatars**: Added `useFriends()` + `useFriendsItineraries()` hooks, computes `friendsByEvent` map, passes `friendsGoing` prop to EventCard (blue left border + avatar stack)
- **Google Calendar export**: Added `GoogleCalendarButton` (icon-only, 18px CalendarPlus) to header with `conferenceTimezone` and `exportableEvents` memos
- **View mode sync**: /plan page reads `STORAGE_KEYS.VIEW_MODE` from localStorage on mount via useEffect + `viewModeRestored` gate to prevent flash
- **Header cleanup**:
  - Removed "My Plan (N events)" heading
  - Conference dropdown moved next to back arrow (same flex group)
  - Back button navigates to `/<conference-slug>` instead of `/`
  - Logo replaces calendar emoji, heading says "My Plan" not "plan.wtf"
  - CalendarX icon replaced with plan.wtf logo in empty state
- **Schedule conflicts removed**: Removed conflict banner, per-card indicators, border styling, `detectConflicts` import
- **Larger link/copy icons**: Bumped from `w-3.5 h-3.5` to `w-4 h-4` in EventCard to match StarButton

---

## Open PRs
| PR | Branch | Description | Preview |
|----|--------|-------------|---------|
| #126 | `calzone-34833-gallery-view` | Gallery view (flyer grid) | https://sheeets-git-calzone-34833-gallery-view-pizza-dao.vercel.app |
| #125 | `onion-98806-admin-submissions` | Admin submissions approval queue | https://sheeets-git-onion-98806-admin-submissions-pizza-dao.vercel.app |
| #123 | `pineapple-22344-itinerary-overhaul` | Itinerary page overhaul + share card flyer gallery | https://sheeets-git-pineapple-22344-itinerary-overhaul-pizza-dao.vercel.app |
| #122 | `worktree-agent-ab7637fb` | Luma RSVP flow + profile fields | https://sheeets-git-worktree-agent-ab7637fb-pizza-dao.vercel.app |
| #89 | `image-ad-column` | Image ad column (stale) | — |
| #78 | `luma-gmail-importer` | Gmail Luma importer (stale) | — |

---

## Pending Work

### Not yet pushed
- **Blue header theme changes** — on local `calzone-34833-luma-rsvp` branch (globals.css, Header.tsx, ViewToggle.tsx, AuthModal.tsx)

### Gallery view card redesign
- Updated plan at `plans/flyer-gallery-view.md` — overlay bar on image instead of text below, StarButton (not stars)
- Not yet implemented

### DB migration needed
- `supabase/migrations/20260502_add_profile_fields.sql` — `ALTER TABLE profiles ADD COLUMN telegram_handle text; ADD COLUMN company text;`
- Must be applied to Supabase production before merging PR #122

### Luma pre-fill research (concluded)
- Luma embed iframe does NOT support pre-filling name/email via URL params or postMessage
- Only supported params: `coupon`, `utm_source`
- Server-side API registration possible but requires organizer Luma Plus API keys (not viable for arbitrary events)
- Current copy-fields approach is the best available UX

---

## Plans

### Active
- `plans/pineapple-22344-itinerary-overhaul.md` — Itinerary overhaul + share card flyer gallery (PR #123, ready to merge)
- `plans/flyer-gallery-view.md` — Gallery view (implemented, card redesign pending)

### Pending (not yet implemented)
- `plans/admin-conference-management.md`
- `plans/automated-testing.md`
- `plans/calendar-export.md`
- `plans/event-click-tracking.md`
- `plans/featured-events.md`
- `plans/google-calendar-export.md`
- `plans/image-ad-column.md`
- `plans/instant-geocoding.md`
- `plans/itinerary-privacy.md`
- `plans/luma-gmail-importer.md`
- `plans/pineapple-49198-ai-sponsor-extraction.md`
- `plans/profile-picture.md`
- `plans/salami-77082-landing-page.md`
- `plans/sponsor-admin-ui.md`
- `plans/sponsor-crawling.md`

### Done
- `plans/done/ad-placements.md`
- `plans/done/olive-29895-checkin-buttons.md`
- `plans/done/per-conference-ad-inventory.md`
- `plans/done/submit-form-improvements.md`
- `plans/done/sxsw-theme.md`
- `plans/done/sxsw-theme-v2.md`
- `plans/done/tomato-46571-theme-toggle.md`

---

## Key Architecture Notes

### Share Card Image Pipeline
- **Image proxy**: `/api/image-proxy?url=<encoded>` — server-side fetch bypasses CORS for html-to-image canvas rendering
- **Pre-fetch flow**: `imageCache` (OGImage.tsx) → batch POST `/api/og` → proxy fetch → FileReader → data URL map
- **Two modes**: `ShareCardMode` = `'gallery'` (flyer grid) or `'text'` (classic list). Text mode skips image fetching entirely.
- **Rendering**: html-to-image `toPng()` at 2x pixel ratio, 1080px card width. Uses explicit pixel sizes (not CSS grid/aspectRatio) for html-to-image compatibility.

### RSVP System
- `isLumaUrl()` / `getLumaSlug()` in `src/lib/luma.ts` — matches `lu.ma`, `luma.com`, `www.luma.com`
- `useRsvp` hook — loads confirmed RSVPs from `rsvps` table, manages overlay state
- `RsvpButton` — only renders for Luma events (inline `isLumaUrl` check)
- `RsvpOverlay` — self-contained portal with inline `getLumaSlug`, copy fields, Luma iframe
- Embed URL: `https://lu.ma/embed/event/{slug}/simple` (also works with `luma.com`)
- DB table: `rsvps` (id, user_id, event_id, luma_api_id, status, method, created_at)

### Performance Caching
- **Edge caching**: `/api/events` (5min), `/api/geocoded-addresses` (1hr) via `Cache-Control` headers
- **Server cache**: `fetchEventsCached()` uses `unstable_cache` with 5min revalidation
- **SSR hydration**: `[slug]/page.tsx` passes `initialEvents` to `EventApp` — zero loading spinner
- **Client cache**: sessionStorage with 5min staleness in `useEvents` hook
- **OG image cache**: Module-level `imageCache` Map in `OGImage.tsx`, batch POST `/api/og` for gallery

### Friend Data Pipeline
- `Friend` type (`src/lib/types.ts`) — raw Supabase profile fields (`user_id`, `avatar_url`, `x_handle`, etc.)
- `FriendInfo` type — lightweight view type (`userId`, `displayName`, `avatarUrl`, `xHandle`)
- `useFriendsItineraries` hook — fetches friend itineraries, merges display names + avatars
- `useConferenceData` hook — builds `friendsByEvent` and `checkedInFriendsByEvent` maps (both `Map<string, FriendInfo[]>`)
- `UserAvatar` component — fallback chain: uploaded avatar → X/Twitter photo via unavatar.io → deterministic color initials

### Theme System
- Themes defined as CSS custom properties in `src/app/globals.css` using `[data-theme="name"]` selectors
- Theme metadata in `src/lib/themes.ts` — `ThemeId` union type + `THEME_OPTIONS` array
- **Header variables**: `--theme-header-bg`, `--theme-header-border`, `--theme-header-logo-filter`, `--theme-header-text`, `--theme-header-control-*`, `--theme-header-accent-*`
- Per-conference theme selection via admin config (`theme:{conference}` key in Supabase)
- 8 themes: dark, paper, light, light-blue, sxsw, sxsw2, gdc, ethcc

### Icon System
- Most icons from `lucide-react`
- Custom planwtf calendar SVG at `src/components/icons/CalendarIcon.tsx`
- Event add-to-plan: `Plus`/`Check` in circular container (`StarButton.tsx`)
- View toggle: Map, List, Table, LayoutGrid (gallery)
