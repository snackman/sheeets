# Looker Studio Dashboard Setup for plan.wtf

## Quick Start

1. Open [Looker Studio](https://lookerstudio.google.com/)
2. Click **Create → Report**
3. Add data source: **Google Analytics** → select **Sheeets.xyz** account → **property 524531628**
4. Click **Add to Report**

## Recommended Dashboard Pages

### Page 1: Traffic Overview
- **Scorecard**: Sessions, Users, New Users, Bounce Rate (date range: last 30 days)
- **Time series chart**: Sessions over time (daily)
- **Table**: Sessions by Source/Medium (top 10)
- **Pie chart**: Sessions by Device Category
- **Bar chart**: Top 10 Landing Pages (dimension: pagePath)

### Page 2: Conference Performance
- **Scorecard**: Total Page Views
- **Table**: Page views by `pagePath` filtered to `/{conference-slug}` pages
- **Bar chart**: Conference select events by `conference` custom dimension
- **Time series**: Conference page views over time

### Page 3: User Engagement
- **Funnel chart**: session_start → onboarding_start → onboarding_complete → itinerary → check_in
- **Scorecard**: Onboarding completion rate (onboarding_complete / onboarding_start)
- **Scorecard**: Auth conversion rate (auth_success / auth_prompt)
- **Table**: Top events by eventCount
- **Bar chart**: Tag toggles by `tag` custom dimension

### Page 4: Conversions & Monetization
- **Table**: Key conversion events (auth_success, itinerary, check_in, submit_event_success, ad_click, rsvp_confirm)
- **Time series**: Conversion events over time
- **Scorecard**: Total ad clicks
- **Table**: Ad clicks by `placement` custom dimension

### Page 5: Audiences
- **Scorecard**: Power Users count
- **Scorecard**: Onboarding Dropoffs count
- **Scorecard**: Engaged Unauthenticated count
- **Table**: User properties breakdown (conference_slug, is_authenticated)

## Custom Dimensions Available
All 19 custom dimensions registered in GA4 are available as dimensions in Looker Studio:
- view_mode, conference, tag, action, search_term, event_name, trigger, placement, step, modal, provider, visibility, category, emoji, test_id, variant_id
- User-scoped: conference_slug, has_itinerary, is_authenticated

## Filters
Add a **date range control** and **conference dropdown** (using `conference` dimension) to every page.
