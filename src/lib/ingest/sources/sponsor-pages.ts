// Sponsor event-page source (Phase 4, plans/event-ingestion.md §3.6, §10).
// Fetches a conference's sponsors' "events" pages (either admin-entered
// known URLs, or discovered from each sponsor's own homepage via
// `event_sponsors.sponsor_url` — the same table `scripts/crawl-sponsors.ts`/
// `sponsor-extraction.ts` already populate), pulls allowlisted outbound
// event links out of the HTML, and hands every one to the shared
// discovered-link engine (`discover.ts`) — same pattern as Telegram/X.
//
// Unlike X/Meetup, this source needs no external credentials — it's always
// "configured" in the sense of the admin availability badges, but a source
// with no URLs and no discoverable sponsor websites simply finds nothing
// (and says so in the run log), same as an empty Telegram channel.
//
// §10 requirements this module is responsible for:
// - every fetch goes through `safeFetch` (SSRF-safe, size/time capped)
// - robots.txt is respected (checked once per host per run, cached)
// - rate-limited and capped per run (`PacedLinkLimiter`-style pacing plus a
//   hard `MAX_PAGES_PER_RUN` ceiling, and at most 2 pages per sponsor when
//   discovering from a sponsor's own site, per the plan)
import type { SupabaseClient } from '@supabase/supabase-js';
import { safeFetch, SafeFetchError } from '../../safe-fetch';
import { decodeHtmlEntities } from '../../event-extractors';
import { isAllowlistedEventLink } from '../allowlist';

const USER_AGENT = 'plan.wtf event-ingest (+https://plan.wtf)';
export const PAGE_TIMEOUT_MS = 10_000;
const PAGE_MAX_BYTES = 3 * 1024 * 1024;
export const ROBOTS_TIMEOUT_MS = 6_000;
const ROBOTS_MAX_BYTES = 256 * 1024;
/** How long one `fetchSponsorPageLinks` call can take in the worst case
 *  (robots.txt fetch timeout + page fetch timeout + the per-page pacing
 *  sleep below), rounded up — re-review item 4's "~17s" margin.
 *  `pipeline.ts#processSponsorPagesSource` checks this margin against the
 *  run deadline BEFORE starting each page, not just checking whether the
 *  deadline has already passed, so a page that would blow through the
 *  cron's deadline is never started in the first place. */
export const SPONSOR_PAGE_WORST_CASE_MS = ROBOTS_TIMEOUT_MS + PAGE_TIMEOUT_MS + 500;

/** Hard ceiling on sponsor PAGES fetched by ONE `fetchSponsorPageLinks`
 *  call site, i.e. per `sponsor_pages` SOURCE per RUN (plan §3.6: "cap the
 *  number of pages per run") — NOT a cross-source/cross-conference total;
 *  a conference with several `sponsor_pages` sources gets this cap applied
 *  to each of them independently (re-review item 8's "fix the cap
 *  comment" — the original comment overclaimed "across every sponsor_pages
 *  source"). */
export const MAX_PAGES_PER_RUN = 20;
/** Exactly how many pages one sponsor contributes when pages are
 *  DISCOVERED from their own site (plan §3.6: "fetch the homepage plus
 *  /events ... max 2 pages per sponsor") — homepage + a same-origin
 *  `/events` guess, always exactly these two, never a general "up to N"
 *  (re-review item 8: the prior doc comment implied this constant could be
 *  tuned to admit more pages per sponsor; the loop below hardcodes exactly
 *  homepage+`/events` regardless of this constant's value, so changing it
 *  to anything other than 2 would not do what its name implies). Explicit
 *  admin-entered URLs aren't subject to this at all — an admin who lists 5
 *  URLs for one sponsor gets all 5 (still bounded by `MAX_PAGES_PER_RUN`
 *  overall). */
export const MAX_PAGES_PER_SPONSOR_WHEN_DISCOVERED = 2;

/* ------------------------------------------------------------------ */
/* robots.txt (simplified: User-agent: * group only, longest-prefix-match  */
/* Allow/Disallow — enough to "respect robots.txt" without a full parser) */
/* ------------------------------------------------------------------ */

interface RobotsRules {
  disallow: string[];
  allow: string[];
  /** Set when the server's robots.txt itself returned a 5xx (re-review
   *  item 7) — treated as "disallow everything" rather than "no
   *  robots.txt" (fail OPEN only applies to a genuinely MISSING robots.txt,
   *  not one the server is currently failing to serve). */
  disallowAll?: boolean;
}

const DISALLOW_ALL_RULES: RobotsRules = { disallow: ['/'], allow: [], disallowAll: true };

/** Parse every group's `Allow`/`Disallow` prefixes out of a robots.txt
 *  body, keeping only rules from groups that apply to us (a literal `*`
 *  user-agent — this app sends no per-bot-name robots.txt handling).
 *  Ignores `Sitemap`, `Crawl-delay`, and every other field — simplified,
 *  but sufficient to avoid fetching a path a site has explicitly asked
 *  crawlers not to touch.
 *
 *  Re-review item 7 ("group consecutive User-agent lines correctly"):
 *  robots.txt groups are formed by ONE OR MORE consecutive `User-agent`
 *  lines followed by their shared `Allow`/`Disallow` lines (e.g. `User-
 *  agent: Googlebot` then `User-agent: *` then shared rules applies to
 *  BOTH). The previous version treated every single `User-agent` line as
 *  its own group, so `User-agent: Googlebot` immediately followed by
 *  `User-agent: *` would have the `*` line "win" only by coincidence of
 *  being last, and a FILE ordered the other way (`*` then a named bot)
 *  would have incorrectly dropped the rules meant for both. This instead
 *  accumulates a `pendingAgents` list across consecutive `User-agent`
 *  lines and only "seals" it into the active group once the first
 *  Allow/Disallow line for that group is seen; a `User-agent` line seen
 *  AFTER a group has already been sealed starts a brand-new group. */
export function parseRobotsTxt(text: string): RobotsRules {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/#.*$/, '').trim());
  const disallow: string[] = [];
  const allow: string[] = [];
  let pendingAgents: string[] = [];
  let sealedAgents: string[] | null = null;
  let sawAnyAgentLine = false;

  for (const line of lines) {
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();

    if (field === 'user-agent') {
      sawAnyAgentLine = true;
      if (sealedAgents !== null) {
        // The previous group already received its directives — this
        // starts a brand-new group rather than extending it.
        pendingAgents = [];
        sealedAgents = null;
      }
      pendingAgents.push(value.toLowerCase());
      continue;
    }
    if (field !== 'disallow' && field !== 'allow') continue;

    if (sealedAgents === null) {
      // First directive line for this group of consecutive User-agent
      // lines — seal it now. A malformed file with directives before any
      // User-agent line at all is treated as applying to everyone, same
      // as most real crawlers do.
      sealedAgents = sawAnyAgentLine ? pendingAgents : ['*'];
    }
    if (!sealedAgents.includes('*')) continue; // this group doesn't apply to us.

    if (field === 'disallow' && value !== '') disallow.push(value);
    if (field === 'allow' && value !== '') allow.push(value);
  }
  return { disallow, allow };
}

/** Convert one robots.txt path pattern to a regex. Re-review item 7:
 *  supports the two wildcards the spec defines — `*` (any sequence of
 *  characters, including none) and a trailing `$` (anchors the END of the
 *  URL, rather than matching it as a prefix-continuation). Every other
 *  regex-special character in the pattern is escaped so it's matched
 *  literally. */
function patternToRegex(pattern: string): RegExp {
  const hasEndAnchor = pattern.endsWith('$');
  const body = hasEndAnchor ? pattern.slice(0, -1) : pattern;
  const escaped = body.replace(/[.+?^(){}|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp('^' + escaped + (hasEndAnchor ? '$' : ''));
}

/** True if `path` is allowed under `rules` — the rule with the longest
 *  PATTERN (as a proxy for specificity, standard robots.txt semantics)
 *  that matches wins; an Allow and Disallow of equal length both matching
 *  favors Allow. `rules.disallowAll` (a robots.txt 5xx) always disallows,
 *  skipping pattern matching entirely. */
export function isPathAllowed(path: string, rules: RobotsRules): boolean {
  if (rules.disallowAll) return false;
  let best: { allowed: boolean; length: number } | null = null;
  for (const d of rules.disallow) {
    if (patternToRegex(d).test(path) && (!best || d.length > best.length)) best = { allowed: false, length: d.length };
  }
  for (const a of rules.allow) {
    if (patternToRegex(a).test(path) && (!best || a.length >= best.length)) best = { allowed: true, length: a.length };
  }
  return best ? best.allowed : true;
}

/** Per-run cache so the same host's robots.txt is fetched at most once. */
export type RobotsCache = Map<string, RobotsRules | null>;

export function createRobotsCache(): RobotsCache {
  return new Map();
}

/**
 * True if `url` may be fetched under its host's robots.txt. Fails OPEN
 * (returns true) if robots.txt is missing, unreachable, or unparseable —
 * the overwhelming majority of sites have no robots.txt at all, and that
 * must never block a legitimate fetch; this only ever narrows access when
 * a real robots.txt explicitly disallows the path.
 */
export async function isAllowedByRobots(url: string, cache: RobotsCache): Promise<boolean> {
  let origin: string;
  let path: string;
  try {
    const u = new URL(url);
    origin = `${u.protocol}//${u.host}`;
    path = u.pathname + (u.search || '');
  } catch {
    return false;
  }

  let rules = cache.get(origin);
  if (rules === undefined) {
    rules = await fetchRobotsRules(origin);
    cache.set(origin, rules);
  }
  if (!rules) return true; // no robots.txt (or couldn't read it) -> allowed
  return isPathAllowed(path, rules);
}

/**
 * Re-review item 7 ("re-check robots.txt on the redirect target, or set
 * maxRedirects: 0 and treat a redirect as a skip"): picks the second,
 * simpler option. `maxRedirects: 0` makes `safeFetch` throw
 * `SafeFetchError` on any 3xx instead of silently following it to a
 * DIFFERENT origin's robots.txt (which would describe rules for the wrong
 * site entirely) — caught below and treated the same as "no robots.txt
 * reachable," i.e. fail OPEN, same as a network error or a 404. A genuine
 * 5xx (the origin reached, but reported it's failing) is handled
 * separately as disallow-all, since that's NOT the same as "no robots.txt
 * exists."
 */
async function fetchRobotsRules(origin: string): Promise<RobotsRules | null> {
  try {
    const res = await safeFetch(`${origin}/robots.txt`, {
      timeoutMs: ROBOTS_TIMEOUT_MS,
      maxBytes: ROBOTS_MAX_BYTES,
      maxRedirects: 0,
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/plain' },
    });
    if (res.status >= 500) return DISALLOW_ALL_RULES; // re-review item 7: 5xx -> disallow-all, not fail-open.
    if (!res.ok) return null; // 4xx (incl. the common 404 "no robots.txt") -> fail open.
    return parseRobotsTxt(res.text);
  } catch {
    return null; // unreachable (incl. a redirect, now thrown by maxRedirects: 0) -> fail open.
  }
}

/* ------------------------------------------------------------------ */
/* Page fetch + link extraction                                        */
/* ------------------------------------------------------------------ */

function extractHrefs(html: string): string[] {
  const hrefs: string[] = [];
  const re = /<a\b[^>]*\bhref="([^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    hrefs.push(decodeHtmlEntities(m[1]));
  }
  return hrefs;
}

/**
 * Fetch one sponsor page and return its allowlisted outbound event links
 * (deduped, absolute URLs). Returns `[]` (never throws) on a fetch failure
 * or a robots.txt disallow — a single bad sponsor URL must not fail the
 * whole run, same tolerance as a Telegram channel that 404s.
 */
export async function fetchSponsorPageLinks(url: string, robotsCache: RobotsCache): Promise<string[]> {
  if (!(await isAllowedByRobots(url, robotsCache))) return [];

  let html: string;
  try {
    const res = await safeFetch(url, {
      timeoutMs: PAGE_TIMEOUT_MS,
      maxBytes: PAGE_MAX_BYTES,
      maxRedirects: 3,
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
    });
    if (!res.ok) return [];
    html = res.text;
  } catch (err) {
    if (err instanceof SafeFetchError) return [];
    throw err;
  }

  const links = new Set<string>();
  for (const href of extractHrefs(html)) {
    let absolute: string;
    try {
      absolute = new URL(href, url).href;
    } catch {
      continue;
    }
    if (isAllowlistedEventLink(absolute)) links.add(absolute);
  }
  return Array.from(links);
}

/* ------------------------------------------------------------------ */
/* Resolving WHICH pages to fetch this run                             */
/* ------------------------------------------------------------------ */

export interface ResolveSponsorPageUrlsResult {
  urls: string[];
  /** The offset to persist (`ingest_sources.cursor.sponsor_offset`) for
   *  NEXT run's rotation (re-review item 8), or `null` when rotation
   *  doesn't apply (admin-entered URLs, or no sponsors found at all) —
   *  callers should only write a new cursor when this is non-null. */
  nextOffset: number | null;
}

/**
 * Admin-entered known URLs (if any) win outright — no rotation (every run
 * fetches the same explicit list). Otherwise, discover candidate pages
 * from this conference's own `event_sponsors.sponsor_url` rows — each
 * sponsor's homepage plus a same-origin `/events` guess (exactly
 * `MAX_PAGES_PER_SPONSOR_WHEN_DISCOVERED` = 2 pages, see its doc comment),
 * capped overall at `MAX_PAGES_PER_RUN`. Never throws: a missing/erroring
 * `event_sponsors` table (it predates ingestion, same tolerance as
 * `sponsors.ts#getSponsorNamesForConference`) just means no pages to
 * discover, not a failed run.
 *
 * Re-review item 8 ("rotate the sponsor selection"): when there are more
 * sponsors than one run can cover, the DISCOVERED list is rotated by
 * `offset` (an offset cursor, `ingest_sources.cursor.sponsor_offset`) so
 * every sponsor eventually gets crawled over successive runs instead of
 * the same handful at the front of the list winning forever.
 */
export async function resolveSponsorPageUrls(
  supabase: SupabaseClient,
  conference: string,
  configuredUrls: string[],
  opts: { offset?: number } = {}
): Promise<ResolveSponsorPageUrlsResult> {
  if (configuredUrls.length > 0) return { urls: configuredUrls.slice(0, MAX_PAGES_PER_RUN), nextOffset: null };

  let sponsorUrls: string[] = [];
  try {
    const { data, error } = await supabase
      .from('event_sponsors')
      .select('sponsor_url')
      .eq('conference', conference)
      .not('sponsor_url', 'is', null);
    if (error) {
      if ((error as { code?: string }).code === '42P01') return { urls: [], nextOffset: null };
      throw new Error(`Failed to load sponsor websites: ${error.message}`);
    }
    sponsorUrls = Array.from(
      new Set((data ?? []).map((r) => (r as { sponsor_url: string | null }).sponsor_url).filter((u): u is string => !!u))
    );
  } catch {
    return { urls: [], nextOffset: null };
  }
  if (sponsorUrls.length === 0) return { urls: [], nextOffset: null };

  // Rotate so a different sponsor starts the list each run once there are
  // more sponsors than one run can get through.
  const rawOffset = opts.offset ?? 0;
  const offset = ((rawOffset % sponsorUrls.length) + sponsorUrls.length) % sponsorUrls.length;
  const rotated = [...sponsorUrls.slice(offset), ...sponsorUrls.slice(0, offset)];

  const pages: string[] = [];
  let sponsorsVisited = 0;
  for (const homepage of rotated) {
    if (pages.length >= MAX_PAGES_PER_RUN) break;
    sponsorsVisited++;
    // Re-review item 8: wrap URL construction in try/catch so one bad
    // `sponsor_url` skips just that sponsor rather than failing the run,
    // AND normalize a bare domain (e.g. "example.com", which `new URL()`
    // otherwise rejects outright as a relative reference with no
    // protocol) to `https://` first, so a sponsor stored without a scheme
    // isn't silently dropped.
    const normalized = /^https?:\/\//i.test(homepage) ? homepage : `https://${homepage}`;
    let base: URL;
    try {
      base = new URL(normalized);
    } catch {
      continue;
    }
    pages.push(base.href);
    if (pages.length >= MAX_PAGES_PER_RUN) break;
    // Exactly homepage + /events — see MAX_PAGES_PER_SPONSOR_WHEN_DISCOVERED's doc comment.
    try {
      pages.push(new URL('/events', base.origin).href);
    } catch {
      // base.origin is always valid once `base` parsed, so this can't
      // realistically throw — defensive only.
    }
  }

  return { urls: pages.slice(0, MAX_PAGES_PER_RUN), nextOffset: (offset + sponsorsVisited) % sponsorUrls.length };
}
