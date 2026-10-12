// X (Twitter) account source (Phase 4, plans/event-ingestion.md §3.7, §10).
// Polls ONE curated account's recent posts via the X API v2
// (`GET /2/users/:id/tweets`), extracts outbound links, and hands every
// allowlisted one to the shared discovered-link engine (`discover.ts`) —
// same pattern as the Telegram source (`sources/telegram.ts`), just with a
// paid, metered fetch instead of a free HTML poll.
//
// Disabled unless `X_BEARER_TOKEN` is set (§Phase 4 item 1: "Disabled unless
// X_BEARER_TOKEN is set. If it's missing, skip the source cleanly and show
// 'not configured' in admin") — `isXConfigured()` is the single switch every
// caller (the cron/pipeline, the admin config route) checks.
//
// Cost: X's pay-per-use pricing is $0.005 per "Posts: Read" resource
// (docs.x.com pricing, verified in the plan's §3.7/§12). A run reads AT MOST
// `MAX_RESULTS_PER_ACCOUNT_PER_RUN` posts per account per run (one API call,
// no pagination), so the per-account-per-run cost is bounded and
// predictable — `MAX_RESULTS_PER_ACCOUNT_PER_RUN * X_POST_READ_COST_USD`.
// `pipeline.ts` additionally checks the dedicated monthly X-spend cap
// (`budget.ts#checkXMonthlyBudget`, `INGEST_X_MONTHLY_USD_CAP`) BEFORE making
// this call at all, and records the actual cost (posts read, not links
// found) as this run's `ingest_runs.est_cost_usd` so it counts toward both
// that cap and the general ingest-cost total (`get_monthly_ingest_cost_usd`
// already sums every `ingest_runs` row regardless of kind).
import { safeFetch, SafeFetchError } from '../../safe-fetch';

export class XFetchError extends Error {}

/** $0.005 per "Posts: Read" resource (docs.x.com/x-api/getting-started/pricing). */
export const X_POST_READ_COST_USD = 0.005;

/** One API call per account per run, capped at this many results — bounds
 *  the per-account-per-run spend to `10 * $0.005 = $0.05` regardless of how
 *  often an account posts. X's `tweets` endpoint requires `max_results` in
 *  [5, 100]. */
export const MAX_RESULTS_PER_ACCOUNT_PER_RUN = 10;

export function isXConfigured(): boolean {
  return !!process.env.X_BEARER_TOKEN;
}

/** X usernames: 1-15 chars, letters/digits/underscore (X's own limit). */
export const X_HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;

export function isValidXHandle(handle: string): boolean {
  return X_HANDLE_RE.test(handle);
}

/** Accept a bare handle, `@handle`, or an `x.com/<handle>`/`twitter.com/<handle>`
 *  URL and normalize to the bare handle — or null if it doesn't look valid.
 *  Same shape as `sources/telegram.ts#normalizeTelegramHandle`. */
export function normalizeXHandle(input: string): string | null {
  let raw = input.trim();
  if (!raw) return null;
  const urlMatch = raw.match(/^(?:https?:\/\/)?(?:www\.)?(?:x|twitter)\.com\/([^/?#]+)/i);
  if (urlMatch) raw = urlMatch[1];
  raw = raw.replace(/^@/, '').trim();
  return isValidXHandle(raw) ? raw : null;
}

function bearerHeaders(): Record<string, string> {
  const token = process.env.X_BEARER_TOKEN;
  if (!token) throw new XFetchError('X_BEARER_TOKEN is not set.');
  return { Authorization: `Bearer ${token}`, 'User-Agent': 'plan.wtf event-ingest (+https://plan.wtf)' };
}

const X_TIMEOUT_MS = 15_000;
const X_MAX_BYTES = 2 * 1024 * 1024;

export interface ResolvedXUser {
  id: string;
  username: string;
  name: string;
}

/**
 * Resolve a handle to its stable numeric user id (one "User: Read" call,
 * $0.01) — done ONCE when an admin adds the source
 * (`/api/admin/ingest/config` POST), never on every run, so the per-run
 * cost is only the tweet-read calls (§3.7 cost estimate assumes this).
 */
export async function resolveXUser(handle: string): Promise<ResolvedXUser> {
  if (!isValidXHandle(handle)) throw new XFetchError(`Invalid X handle: ${handle}`);
  const res = await safeFetch(`https://api.x.com/2/users/by/username/${encodeURIComponent(handle)}`, {
    headers: bearerHeaders(),
    timeoutMs: X_TIMEOUT_MS,
    maxBytes: X_MAX_BYTES,
    maxRedirects: 2,
  });
  if (!res.ok) throw new XFetchError(`X returned ${res.status} resolving @${handle}.`);
  let json: { data?: { id?: string; username?: string; name?: string }; errors?: unknown };
  try {
    json = JSON.parse(res.text);
  } catch {
    throw new XFetchError(`X returned invalid JSON resolving @${handle}.`);
  }
  if (!json.data?.id) throw new XFetchError(`X account @${handle} not found.`);
  return { id: json.data.id, username: json.data.username || handle, name: json.data.name || handle };
}

export interface XPost {
  id: string;
  text: string;
  /** Outbound http(s) links from `entities.urls[].expanded_url`, falling
   *  back to a plain-text URL scan if the API omitted entities for some
   *  reason — never trusted as anything but a candidate link to allowlist-
   *  check (same untrusted-data posture as Telegram message links). */
  links: string[];
}

export interface XPostsPage {
  posts: XPost[];
  /** The API's own `meta.newest_id` — the cursor to persist as this
   *  source's `since_id` for next run (§Phase 4 item 1: "Use since_id
   *  cursors so each post is read only once"). Null when the response had
   *  no posts (nothing new — the existing cursor stays as-is). */
  newestId: string | null;
  /** Number of posts actually returned — the billable "Posts: Read" count,
   *  used to compute this call's cost (`resultCount * X_POST_READ_COST_USD`),
   *  independent of how many (if any) contained a link. */
  resultCount: number;
}

const BARE_URL_RE = /https?:\/\/[^\s)<>"']+/gi;

function extractLinksFromText(text: string): string[] {
  return Array.from(new Set(text.match(BARE_URL_RE) ?? []));
}

interface XApiTweet {
  id: string;
  text: string;
  entities?: { urls?: { url: string; expanded_url?: string }[] };
}

/** Parse one `GET /2/users/:id/tweets` JSON response into plain posts. Pure
 *  function (no fetch) so it can be unit-tested against a saved fixture. */
export function parseXTweetsResponse(json: {
  data?: XApiTweet[];
  meta?: { newest_id?: string; result_count?: number };
}): XPostsPage {
  const data = json.data ?? [];
  const posts: XPost[] = data.map((t) => {
    const entityLinks = (t.entities?.urls ?? [])
      .map((u) => u.expanded_url || u.url)
      .filter((u): u is string => !!u);
    const links = entityLinks.length > 0 ? entityLinks : extractLinksFromText(t.text || '');
    return { id: t.id, text: t.text || '', links: Array.from(new Set(links)) };
  });
  return {
    posts,
    newestId: json.meta?.newest_id ?? (posts.length > 0 ? posts[0].id : null),
    resultCount: typeof json.meta?.result_count === 'number' ? json.meta.result_count : posts.length,
  };
}

/**
 * Fetch one page of a user's recent posts (one API call, no pagination —
 * see the cost-bounding doc comment above). `sinceId`, when set, is passed
 * through so a post already read in a prior run is never billed/read again
 * (§Phase 4 item 1's since_id requirement); X returns only posts newer than
 * it. Excludes retweets and replies — we only care about the account's own
 * original posts.
 */
export async function fetchXUserPosts(userId: string, opts: { sinceId?: string | null; maxResults?: number } = {}): Promise<XPostsPage> {
  const maxResults = Math.min(100, Math.max(5, opts.maxResults ?? MAX_RESULTS_PER_ACCOUNT_PER_RUN));
  const params = new URLSearchParams({
    max_results: String(maxResults),
    'tweet.fields': 'entities,created_at',
    exclude: 'retweets,replies',
  });
  if (opts.sinceId) params.set('since_id', opts.sinceId);

  let res;
  try {
    res = await safeFetch(`https://api.x.com/2/users/${encodeURIComponent(userId)}/tweets?${params.toString()}`, {
      headers: bearerHeaders(),
      timeoutMs: X_TIMEOUT_MS,
      maxBytes: X_MAX_BYTES,
      maxRedirects: 2,
    });
  } catch (err) {
    if (err instanceof SafeFetchError) throw new XFetchError(err.message);
    throw err;
  }
  if (!res.ok) throw new XFetchError(`X returned ${res.status} fetching posts for user ${userId}.`);

  let json: { data?: XApiTweet[]; meta?: { newest_id?: string; result_count?: number } };
  try {
    json = JSON.parse(res.text);
  } catch {
    throw new XFetchError(`X returned invalid JSON fetching posts for user ${userId}.`);
  }
  return parseXTweetsResponse(json);
}
