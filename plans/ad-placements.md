# Ad Placement Plan for plan.wtf

## Top 5 Placements by ROI

| Rank | Placement | Revenue | Disruption | Effort |
|------|-----------|---------|------------|--------|
| 1 | **Sponsored Event Cards (ListView)** | HIGH | LOW | LOW-MED |
| 2 | **Enhanced SponsorsTicker** | MEDIUM | VERY LOW | VERY LOW |
| 3 | **Featured Event Upsell (Submit Modal)** | HIGH | LOW | MEDIUM |
| 4 | **Sponsored Map Pins** | HIGH | LOW-MED | MEDIUM |
| 5 | **Itinerary Page Sponsor Banner** | MED-HIGH | LOW | LOW |

---

## All Placement Opportunities

### 1. Sponsored Event Cards in ListView (Native Ad)

**Location:** `src/components/ListView.tsx`, injected between real `EventCard` components within each date group. Insert after every 5th-8th card inside the `{group.events.map(...)}` block (~line 113).

**Format:** Native ad identical to `EventCard` layout (OG image, name, time, address, tags) with a subtle "Sponsored" badge. Highest-value placement — blends naturally with real content.

**Size:** Same as EventCard (~120px height mobile, full content width ~768px).

**UX Disruption:** LOW. Users are already scanning cards; a labeled "Sponsored" card is minimally disruptive. Limit to 1 per date group or 1 per 5-8 events.

**Revenue Potential:** HIGH. Conference organizers and sponsors will pay premium rates for this exact audience.

**Implementation:** Create `SponsoredEventCard` wrapping `EventCard` with "Sponsored" label. Data source: Supabase table or constants. Insert into ListView map loop with index-based gating.

---

### 2. Enhanced SponsorsTicker (Existing Component)

**Location:** `src/components/SponsorsTicker.tsx` — already rendered between Header and FilterBar in EventApp.tsx (line 379).

**Currently:** Simple scrolling text ticker with one sponsor ("Stand With Crypto"). Hardcoded array.

**Enhancement:** Expand to support multiple sponsors with logos, clickable CTAs, rotation. Support per-conference sponsors (different for SXSW vs ETHCC).

**Size:** Current ~28px height, could expand to ~36px with small logos.

**UX Disruption:** VERY LOW. Already exists and accepted by users.

**Revenue Potential:** MEDIUM. Good for "presented by" brand awareness.

**Implementation:** VERY LOW effort — just expand the sponsors array and optionally add image support.

---

### 3. Featured Event Upsell (Submit Modal)

**Location:** `src/components/SubmitEventModal.tsx`, on the success step (step 3, ~line 504).

**Format:** After success confirmation: "Want to feature your event? Promote it to the top of listings for $X" with CTA. Could also be a checkbox in step 2: "Feature this event ($X)".

**Size:** Small card ~80-100px within modal.

**UX Disruption:** LOW. Only shown to event submitters (organizers), not browsers.

**Revenue Potential:** HIGH. Direct revenue from organizers. Proven model (Eventbrite, Meetup). Even $10-50/event adds up with hundreds of events per conference.

**Implementation:** MEDIUM. Requires payment flow (Stripe), "featured" flag in data model, rendering logic to boost featured events.

---

### 4. Sponsored Map Pins

**Location:** `src/components/MapView.tsx`, rendered as additional `Marker` components after the event markers block (~line 473).

**Format:** Branded map pin with sponsor logo or distinct color + "AD" indicator. Clicking opens styled `EventPopup` with sponsor branding + CTA.

**Size:** Same as regular markers (19px pin) with branded label.

**UX Disruption:** LOW-MEDIUM. Users expect pins on maps. Must limit to 3-5 sponsored pins max to avoid clutter.

**Revenue Potential:** HIGH. Location-based ads during conferences are extremely valuable for venue sponsors, afterparties, nearby businesses.

**Implementation:** MEDIUM. New `SponsoredMapMarker` component, data source with lat/lng, popup integration.

---

### 5. Itinerary Page Sponsor Banner

**Location:** `src/app/itinerary/page.tsx` (~line 364) and shared itinerary page `src/app/itinerary/s/[code]/page.tsx` (~line 233).

**Format:** "Your itinerary is powered by [Sponsor]" or "Conference shuttle sponsored by [Sponsor] — book a ride" with CTA.

**Size:** Full content width, 60-80px tall.

**UX Disruption:** LOW. Low-traffic page; single banner feels natural.

**Revenue Potential:** MEDIUM-HIGH for shared itineraries — when users share links, recipients see the sponsor (viral distribution).

**Implementation:** LOW. Simple banner component.

---

### 6. Interstitial Between Date Groups in ListView

**Location:** `src/components/ListView.tsx`, between `<section>` elements for date groups (~line 97). Insert after every 2nd-3rd date group.

**Format:** Horizontal leaderboard-style banner with sponsor branding, message, CTA. Dark theme styled.

**Size:** Full content width, 80-120px tall.

**UX Disruption:** LOW-MEDIUM. Natural transition point between date groups.

**Revenue Potential:** MEDIUM.

**Implementation:** LOW.

---

### 7. Sponsored Rows in TableView

**Location:** `src/components/TableView.tsx`, within `DateGroup` component (~line 401). Insert sponsored row at top of each date section.

**Format:** Table row styled like regular rows but with subtle background highlight (`bg-orange-500/5 border-l-2 border-orange-500`) and "Sponsored" tag.

**Size:** Same as regular table row (~40px).

**UX Disruption:** LOW. TableView users are power users who scan quickly.

**Revenue Potential:** MEDIUM.

**Implementation:** LOW.

---

### 8. Event Popup Contextual Ad

**Location:** `src/components/EventPopup.tsx`, after the note block (~line 206) in `SingleEventContent`.

**Format:** Small contextual line: "Nearby: [Sponsor Venue]" or "Getting there? Book a ride with [Sponsor]".

**Size:** Single line, ~20-24px tall.

**UX Disruption:** LOW-MEDIUM. Popup is compact (300px); must be very minimal.

**Revenue Potential:** MEDIUM. Contextual/location-aware ads command higher CPCs.

**Implementation:** MEDIUM. Requires location-aware ad matching.

---

### 9. Desktop Sidebar (Map View)

**Location:** `src/components/EventApp.tsx`, alongside MapView (~line 411). Add 300px sidebar on `lg:` breakpoint.

**Format:** Vertical tower (300x600) or stacked sponsor cards. "Featured Events" or sponsor info.

**Size:** 300px wide, desktop only.

**UX Disruption:** MEDIUM. Reduces map width on desktop.

**Revenue Potential:** MEDIUM.

**Implementation:** MEDIUM.

---

### 10. API Docs Page Sponsorship

**Location:** `src/app/api/page.tsx` hero section (~line 205) or footer (~line 1131).

**Format:** "Powered by [Sponsor]" or "Build with [Sponsor's API]" banner.

**UX Disruption:** VERY LOW. **Revenue Potential:** LOW. **Implementation:** VERY LOW.

---

## Things to Avoid

1. **Full-screen interstitials/modals** — utility app used actively during conferences on slow mobile. Blocking modals = abandonment.
2. **Ads in FilterBar or header** — primary navigation. Ads here feel like malware.
3. **Auto-playing video** — drains battery/data on mobile conference networks.
4. **Ads in AuthModal or profile** — trust-critical flows. Ads feel predatory.
5. **Excessive sponsored map pins** — more than 3-5 clutters the map (primary value prop).
6. **Ads in FriendsPanel/social features** — social features drive engagement; monetizing them kills stickiness.
7. **Pop-unders or redirects** — crypto audience is ad-averse and technically savvy. Deceptive patterns get called out on Twitter.

---

## Monetization Models

### Per-Conference Sponsorship Tiers

| Tier | Price Range | Includes |
|------|-------------|----------|
| **Presenting** | $5,000-15,000 | Ticker (top billing), 5 sponsored cards, 3 map pins, itinerary banner, logo on shared itineraries |
| **Gold** | $2,000-5,000 | Ticker, 3 sponsored cards, 1 map pin |
| **Silver** | $500-2,000 | Ticker listing, 1 sponsored card |
| **Featured Event** | $25-100/event | Highlighted card, boosted position |

### Self-Serve (Future)

| Model | Placement | Pricing |
|-------|-----------|---------|
| CPC | Sponsored cards, map pins | $0.50-2.00/click |
| CPM | Banners, ticker | $5-15 CPM |
| Flat Rate | Featured event listing | $25-100/event/conference |
| Affiliate | Ride-share links in popups | Revenue share |

**Recommended start:** Per-conference sponsorship tiers (manual sales). Simplest to implement, most lucrative for niche captive audience during conference windows.

---

## Implementation Phases

**Phase 1 — Immediate (0 effort):**
- Expand SponsorsTicker with more paying sponsors
- Add per-conference sponsor filtering

**Phase 2 — Sprint 1 (1-2 days):**
- `SponsoredEventCard` component (EventCard wrapper + "Sponsored" badge)
- Sponsored event data source (Supabase table or constants)
- Inject into ListView
- GA4 tracking for impressions/clicks

**Phase 3 — Sprint 2 (2-3 days):**
- "Feature this event" upsell in SubmitEventModal
- Itinerary page sponsor banner
- Sponsored row support in TableView

**Phase 4 — Sprint 3 (3-5 days):**
- `SponsoredMapMarker` component
- Sponsored pins in MapView
- Contextual sponsor link in EventPopup
- Admin interface for managing sponsor data

**Phase 5 — Future:**
- Self-serve ad submission portal
- Stripe integration for featured event payments
- Desktop sidebar ads
- Sponsor analytics dashboard (impressions, clicks, CTR)
