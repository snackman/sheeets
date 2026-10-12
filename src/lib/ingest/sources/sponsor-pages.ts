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
const PAGE_TIMEOUT_MS = 10_000;
const PAGE_MAX_BYTES = 3 * 1024 * 1024;
const ROBOTS_TIMEOUT_MS = 6_000;
const ROBOTS_MAX_BYTES = 256 * 1024;

/** Hard per-run ceiling on sponsor PAGES fetched (plan §3.6: "cap the
 *  number of pages per run") — independent of how many sponsors/sources
 *  are configured. At most this many `fetchSponsorPageLinks` calls happen
 *  in one run across every `sponsor_pages` source for a conference. */
export const MAX_PAGES_PER_RUN = 20;
/** At most this many pages per sponsor when discovering from their own
 *  site (plan §3.6: "fetch the homepage plus /events ... max 2 pages per
 *  sponsor"). Explicit admin-entered URLs aren't subject to this — an
 *  admin who lists 5 URLs for one sponsor gets all 5 (still bounded by
 *  `MAX_PAGES_PER_RUN` overall). */
export const MAX_PAGES_PER_SPONSOR_WHEN_DISCOVERED = 2;

/* ------------------------------------------------------------------ */
/* robots.txt (simplified: User-agent: * group only, longest-prefix-match  */
/* Allow/Disallow — enough to "respect robots.txt" without a full parser) */
/* ------------------------------------------------------------------ */

interface RobotsRules {
  disallow: string[];
  allow: string[];
}

/** Parse the `User-agent: *` group's `Allow`/`Disallow` prefixes out of a
 *  robots.txt body. Ignores `Sitemap`, `Crawl-delay`, and every other
 *  group — simplified, but sufficient to avoid fetching a path a site has
 *  explicitly asked crawlers not to touch. */
export function parseRobotsTxt(text: string): RobotsRules {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/#.*$/, '').trim());
  const disallow: string[] = [];
  const allow: string[] = [];
  let inWildcardGroup = false;
  let sawAnyAgentLine = false;

  for (const line of lines) {
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();

    if (field === 'user-agent') {
      // A new agent line starts a new group; once we've seen ANY
      // agent-line, only continue treating further Allow/Disallow lines
      // as applying to our group if this one is specifically '*'.
      sawAnyAgentLine = true;
      inWildcardGroup = value === '*';
      continue;
    }
    if (!sawAnyAgentLine) {
      // Malformed file with rules before any User-agent line — treat as
      // applying to everyone, same as most real crawlers do.
      inWildcardGroup = true;
    }
    if (field === 'disallow' && inWildcardGroup && value !== '') disallow.push(value);
    if (field === 'allow' && inWildcardGroup && value !== '') allow.push(value);
  }
  return { disallow, allow };
}

/** True if `path` is allowed under `rules` — longest matching prefix wins
 *  (standard robots.txt semantics); an Allow and Disallow of equal length
 *  both matching favors Allow. */
export function isPathAllowed(path: string, rules: RobotsRules): boolean {
  let best: { allowed: boolean; length: number } | null = null;
  for (const d of rules.disallow) {
    if (path.startsWith(d) && (!best || d.length > best.length)) best = { allowed: false, length: d.length };
  }
  for (const a of rules.allow) {
    if (path.startsWith(a) && (!best || a.length >= best.length)) best = { allowed: true, length: a.length };
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

async function fetchRobotsRules(origin: string): Promise<RobotsRules | null> {
  try {
    const res = await safeFetch(`${origin}/robots.txt`, {
      timeoutMs: ROBOTS_TIMEOUT_MS,
      maxBytes: ROBOTS_MAX_BYTES,
      maxRedirects: 2,
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/plain' },
    });
    if (!res.ok) return null;
    return parseRobotsTxt(res.text);
  } catch {
    return null;
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

/**
 * Admin-entered known URLs (if any) win outright. Otherwise, discover
 * candidate pages from this conference's own `event_sponsors.sponsor_url`
 * rows — each sponsor's homepage plus a same-origin `/events` guess, up to
 * `MAX_PAGES_PER_SPONSOR_WHEN_DISCOVERED` pages per sponsor — capped
 * overall at `MAX_PAGES_PER_RUN`. Never throws: a missing/erroring
 * `event_sponsors` table (it predates ingestion, same tolerance as
 * `sponsors.ts#getSponsorNamesForConference`) just means no pages to
 * discover, not a failed run.
 */
export async function resolveSponsorPageUrls(
  supabase: SupabaseClient,
  conference: string,
  configuredUrls: string[]
): Promise<string[]> {
  if (configuredUrls.length > 0) return configuredUrls.slice(0, MAX_PAGES_PER_RUN);

  let sponsorUrls: string[] = [];
  try {
    const { data, error } = await supabase
      .from('event_sponsors')
      .select('sponsor_url')
      .eq('conference', conference)
      .not('sponsor_url', 'is', null);
    if (error) {
      if ((error as { code?: string }).code === '42P01') return [];
      throw new Error(`Failed to load sponsor websites: ${error.message}`);
    }
    sponsorUrls = Array.from(
      new Set((data ?? []).map((r) => (r as { sponsor_url: string | null }).sponsor_url).filter((u): u is string => !!u))
    );
  } catch {
    return [];
  }

  const pages: string[] = [];
  for (const homepage of sponsorUrls) {
    if (pages.length >= MAX_PAGES_PER_RUN) break;
    let base: URL;
    try {
      base = new URL(homepage);
    } catch {
      continue;
    }
    pages.push(base.href);
    if (pages.length >= MAX_PAGES_PER_RUN) break;
    if (MAX_PAGES_PER_SPONSOR_WHEN_DISCOVERED > 1) {
      pages.push(new URL('/events', base.origin).href);
    }
  }
  return pages.slice(0, MAX_PAGES_PER_RUN);
}
