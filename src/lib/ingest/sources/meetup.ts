// Meetup GraphQL source (Phase 4, plans/event-ingestion.md §3.3, §10).
// Searches Meetup's official `eventSearch` GraphQL API by topic keyword,
// centered on the conference's own location and dates, and hands every
// result's `eventUrl` to the shared discovered-link engine (`discover.ts`)
// — the SAME engine Telegram/X links go through, which runs it through the
// existing `parseMeetup` extractor (`event-extractors.ts`, already
// allowlisted for `meetup.com`) rather than this module inventing a second
// Meetup normalizer, per the plan: "Map the results through the existing
// Meetup extractor/normalizer, then processDiscoveredLink."
//
// Disabled unless Meetup OAuth credentials are configured (§Phase 4 item 3:
// "Disabled unless Meetup OAuth credentials are set (OAuth clients require
// Meetup Pro). If credentials are missing, skip cleanly and show 'requires
// Meetup Pro' in admin") — `isMeetupConfigured()` is the single switch.
//
// Auth: Meetup OAuth consumers (which require an active Meetup Pro
// subscription to even create, per the plan's §3.3 research) use a
// standard OAuth2 refresh-token grant for server-to-server access — same
// "long-lived refresh token, periodically exchanged for a short-lived
// access token" shape this repo already uses for GA4
// (`GA4_CLIENT_ID`/`GA4_CLIENT_SECRET`/`GA4_REFRESH_TOKEN` in `.env.local`),
// so `MEETUP_CLIENT_ID`/`MEETUP_CLIENT_SECRET`/`MEETUP_REFRESH_TOKEN` follow
// that same naming convention. The one-time authorization-code exchange
// that produces the initial refresh token happens OUTSIDE this app (Meetup's
// OAuth consent flow, done once by whoever owns the Pro subscription).
//
// Every outbound call — including the token refresh and the GraphQL POST —
// goes through `safeFetch` (plan §10), which supports `method: 'POST'` for
// exactly this kind of fixed, internal (never discovery-supplied) endpoint.
//
// Schema note: the plan flags this explicitly — "Verify the exact input
// shape against the live schema at implementation time" — and this was
// implemented without live access to `api.meetup.com/gql-ext`. The query
// below reflects Meetup's documented post-Feb-2025 `eventSearch` shape
// (meetup.com/graphql/guide: keywordSearch was split into groupSearch and
// eventSearch).
//
// Re-review item 6: a GraphQL `errors` array or an unparseable response body
// is now treated as a RUN ERROR (thrown, logged via console.error) rather
// than silently degrading to zero results — a real schema drift needs to
// surface somewhere an admin will see it (the run's `ingest_runs.error`,
// via `pipeline.ts`/`runSource`'s existing catch-and-record path), not get
// swallowed as an indistinguishable "found nothing this run."
// `parseMeetupEventSearchResponse` itself stays defensive for a
// SUCCESSFUL, errors-free response's PER-EDGE shape (a node missing an id
// or eventUrl is just skipped) — that's normal/expected sparseness, not
// drift.
import { safeFetch, SafeFetchError } from '../../safe-fetch';

export class MeetupFetchError extends Error {}

export function isMeetupConfigured(): boolean {
  return !!(process.env.MEETUP_CLIENT_ID && process.env.MEETUP_CLIENT_SECRET && process.env.MEETUP_REFRESH_TOKEN);
}

const TOKEN_TIMEOUT_MS = 10_000;
const GRAPHQL_TIMEOUT_MS = 15_000;
const GRAPHQL_MAX_BYTES = 3 * 1024 * 1024;

/** In-memory access-token cache (module-level, mirrors `enrich.ts`'s
 *  `HourlyWindowLumaLimiter` pattern) — not persisted across cold starts,
 *  which is fine: a fresh instance just re-exchanges the refresh token once. */
let cachedToken: { accessToken: string; expiresAt: number } | null = null;

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
}

async function fetchFreshAccessToken(): Promise<{ accessToken: string; expiresAt: number }> {
  const clientId = process.env.MEETUP_CLIENT_ID;
  const clientSecret = process.env.MEETUP_CLIENT_SECRET;
  const refreshToken = process.env.MEETUP_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new MeetupFetchError('Meetup OAuth credentials are not set.');
  }
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  }).toString();

  let res;
  try {
    res = await safeFetch('https://secure.meetup.com/oauth2/access', {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeoutMs: TOKEN_TIMEOUT_MS,
      maxBytes: 64 * 1024,
      maxRedirects: 0,
    });
  } catch (err) {
    if (err instanceof SafeFetchError) throw new MeetupFetchError(err.message);
    throw err;
  }
  if (!res.ok) throw new MeetupFetchError(`Meetup token refresh returned ${res.status}.`);

  let json: TokenResponse;
  try {
    json = JSON.parse(res.text);
  } catch {
    throw new MeetupFetchError('Meetup token refresh returned invalid JSON.');
  }
  if (!json.access_token) throw new MeetupFetchError('Meetup token refresh returned no access_token.');
  const ttlMs = (typeof json.expires_in === 'number' ? json.expires_in : 3600) * 1000;
  return { accessToken: json.access_token, expiresAt: Date.now() + ttlMs - 30_000 };
}

async function getMeetupAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.accessToken;
  cachedToken = await fetchFreshAccessToken();
  return cachedToken.accessToken;
}

/** Only used by tests to reset the memoized token between suites. */
export function _resetMeetupTokenCacheForTests() {
  cachedToken = null;
}

export interface MeetupSearchParams {
  query: string;
  lat: number;
  lon: number;
  radiusMi: number;
  /** "YYYY-MM-DD", inclusive — the conference's own date window (plus the
   *  profile's pre/post days), so the search doesn't need its own separate
   *  filter config. */
  startDateISO: string;
  endDateISO: string;
}

export interface MeetupSearchResult {
  id: string;
  title: string;
  eventUrl: string;
}

const EVENT_SEARCH_QUERY = `
query EventSearch($filter: EventSearchFilter!) {
  eventSearch(filter: $filter) {
    count
    edges {
      node {
        id
        title
        eventUrl
      }
    }
  }
}
`;

interface EventSearchGraphQLResponse {
  data?: {
    eventSearch?: {
      edges?: { node?: { id?: string; title?: string; eventUrl?: string } | null }[] | null;
    } | null;
  };
  errors?: { message?: string }[];
}

/** Pure parser — no fetch — so it's unit-testable against a saved fixture.
 *  Defensive: any missing/unexpected field is skipped rather than thrown
 *  (schema-drift note above). */
export function parseMeetupEventSearchResponse(json: EventSearchGraphQLResponse): MeetupSearchResult[] {
  const edges = json.data?.eventSearch?.edges ?? [];
  const results: MeetupSearchResult[] = [];
  for (const edge of edges) {
    const node = edge?.node;
    if (!node?.id || !node?.eventUrl) continue;
    results.push({ id: node.id, title: node.title || '', eventUrl: node.eventUrl });
  }
  return results;
}

/**
 * Run one `eventSearch` query. Throws only on a transport/HTTP failure —
 * a malformed/unexpected response body returns an empty array (see the
 * module-level schema-drift note), so a schema change degrades this source
 * to zero results rather than failing the run.
 */
export async function searchMeetupEvents(params: MeetupSearchParams): Promise<MeetupSearchResult[]> {
  const accessToken = await getMeetupAccessToken();
  // Re-review item 6: this is miles (as the param name always said), not
  // km — the old `radiusKm` local was simply misnamed; no unit conversion
  // ever happened here. Meetup's `radius` filter is documented in miles.
  const radiusMiles = Math.max(1, Math.min(100, params.radiusMi));
  const body = JSON.stringify({
    query: EVENT_SEARCH_QUERY,
    variables: {
      filter: {
        query: params.query,
        lat: params.lat,
        lon: params.lon,
        radius: radiusMiles,
        startDateRange: params.startDateISO,
        endDateRange: params.endDateISO,
      },
    },
  });

  let res;
  try {
    res = await safeFetch('https://api.meetup.com/gql-ext', {
      method: 'POST',
      body,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'plan.wtf event-ingest (+https://plan.wtf)',
      },
      timeoutMs: GRAPHQL_TIMEOUT_MS,
      maxBytes: GRAPHQL_MAX_BYTES,
      maxRedirects: 0,
    });
  } catch (err) {
    if (err instanceof SafeFetchError) throw new MeetupFetchError(err.message);
    throw err;
  }
  if (!res.ok) throw new MeetupFetchError(`Meetup eventSearch returned ${res.status}.`);

  let json: EventSearchGraphQLResponse;
  try {
    json = JSON.parse(res.text);
  } catch (err) {
    // Re-review item 6: invalid JSON is a run error, not a silent "found
    // nothing" — log it so schema/response drift is visible.
    console.error('[ingest] Meetup eventSearch returned invalid JSON', {
      error: err instanceof Error ? err.message : String(err),
      bodyPreview: res.text.slice(0, 500),
    });
    throw new MeetupFetchError('Meetup eventSearch returned invalid JSON.');
  }
  if (json.errors && json.errors.length > 0) {
    const message = json.errors.map((e) => e.message || 'unknown error').join('; ');
    // Re-review item 6: a GraphQL `errors` array (e.g. a filter field this
    // module got wrong, or a schema change) is a run error, not a silent
    // "found nothing" — log it so drift shows up instead of looking
    // identical to "no matching events this run."
    console.error('[ingest] Meetup eventSearch returned GraphQL errors (possible schema drift)', { errors: json.errors });
    throw new MeetupFetchError(`Meetup eventSearch returned errors: ${message}`);
  }
  return parseMeetupEventSearchResponse(json);
}
