// Mira (miragather.com, formerly cryptonomads) series source — community
// side-event aggregator pages, e.g. https://miragather.com/Devcon8SideEvents2026.
//
// Verified live (2026-10-17): the site returns 403 for a plain/non-browser
// User-Agent and 200 for a browser-shaped one (any string starting
// "Mozilla/5.0" worked, including one with our own identifying suffix — see
// `MIRA_USER_AGENT`), and both the homepage and every series page embed a
// Next.js `<script id="__NEXT_DATA__">` block with the page's data as JSON:
//   - homepage: `props.pageProps.seriesMenuItems` — every series Mira
//     tracks (slug, display location, start/end dates, event counts).
//   - a series page: `props.pageProps.{mainEvents, sideEvents}` — each
//     event has (among other fields) `name`, `startDate`/`endDate`, `city`,
//     a `website` link (mostly lu.ma), and `tags`.
//
// Breakpoint and DAS London currently share ONE series
// (`Breakpoint2026SideEvents2026`) — see `MiraSeriesSourceConfig`'s doc
// comment in `types.ts` for how the split is handled (per-conference
// `dateWindowFilter`, not here).
import { safeFetch, SafeFetchError } from '../../safe-fetch';

/** Looks like a browser UA to miragather.com's bot-blocking (verified live:
 *  a bare "Mozilla/5.0 (compatible; ...)" string is accepted), while still
 *  self-identifying — same posture as every other fetch in this module
 *  ("every fetch identifies itself" per plan §10), just with the UA shaped
 *  so the site doesn't 403 it outright. */
const MIRA_USER_AGENT = 'Mozilla/5.0 (compatible; plan.wtf event-ingest/1.0; +https://plan.wtf)';

const MIRA_TIMEOUT_MS = 12_000;
const MIRA_MAX_BYTES = 8 * 1024 * 1024;

/** Series slugs seen live are plain alphanumeric (e.g.
 *  "Devcon8SideEvents2026", "Breakpoint2026SideEvents2026"); allow `-`/`_`
 *  too defensively since Mira doesn't document the charset, but anchor the
 *  pattern so it can never smuggle a path segment or query string into the
 *  fetch URL. */
export const MIRA_SERIES_SLUG_RE = /^[A-Za-z0-9_-]{1,120}$/;

export function isValidMiraSeriesSlug(slug: string): boolean {
  return MIRA_SERIES_SLUG_RE.test(slug);
}

/** Accepts a bare slug or a full `miragather.com/<slug>` (or legacy
 *  `cryptonomads.org/<slug>`) URL, normalized to the bare slug — mirrors
 *  `normalizeTelegramHandle`'s "accept the common paste forms" pattern. */
export function normalizeMiraSeriesSlug(input: string): string | null {
  let raw = input.trim();
  if (!raw) return null;
  const urlMatch = raw.match(/^(?:https?:\/\/)?(?:www\.)?(?:miragather\.com|cryptonomads\.org)\/([^/?#]+)/i);
  if (urlMatch) raw = urlMatch[1];
  return isValidMiraSeriesSlug(raw) ? raw : null;
}

export class MiraFetchError extends Error {}

/** Parse the `props.pageProps` object out of a Next.js page's
 *  `__NEXT_DATA__` script tag. Throws `MiraFetchError` if the tag is
 *  missing or isn't well-formed JSON — Mira changing its page structure
 *  entirely is a real failure, not a "nothing found" case. */
export function parseMiraNextData(html: string): Record<string, unknown> {
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) throw new MiraFetchError('Could not find __NEXT_DATA__ on the Mira page.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    throw new MiraFetchError('Mira page __NEXT_DATA__ was not valid JSON.');
  }
  const pageProps = (parsed as { props?: { pageProps?: unknown } })?.props?.pageProps;
  if (!pageProps || typeof pageProps !== 'object') {
    throw new MiraFetchError('Mira page had no props.pageProps.');
  }
  return pageProps as Record<string, unknown>;
}

async function fetchMiraHtml(url: string): Promise<string> {
  let res;
  try {
    res = await safeFetch(url, {
      timeoutMs: MIRA_TIMEOUT_MS,
      maxBytes: MIRA_MAX_BYTES,
      maxRedirects: 3,
      headers: { 'User-Agent': MIRA_USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
    });
  } catch (err) {
    throw new MiraFetchError(err instanceof SafeFetchError ? err.message : 'Could not reach miragather.com.');
  }
  if (!res.ok) throw new MiraFetchError(`miragather.com returned ${res.status} for ${url}.`);
  return res.text;
}

/** One event as it appears in a Mira series page's `mainEvents`/`sideEvents`
 *  arrays. Only the fields this source actually uses — the real payload has
 *  many more (hosts, images, tags, etc.) that aren't needed here. Every
 *  field is untrusted, community-submitted text. */
export interface MiraEvent {
  id: string;
  name: string;
  /** ISO datetime (UTC), when present and parseable. */
  startDate: string | null;
  endDate: string | null;
  city: string | null;
  /** The event's outbound link — mostly lu.ma, sometimes an arbitrary
   *  non-allowlisted site. Never fetched unless it passes
   *  `isAllowlistedEventLink` (enforced by the caller, `pipeline.ts`). */
  website: string | null;
  tags: string | null;
  seriesSlug: string | null;
}

function coerceString(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v.trim();
  return null;
}

/** A Mira event's `city` field is sometimes a single-element array instead
 *  of a bare string (seen live on at least one series) — normalize both
 *  shapes to a plain string. */
function coerceCity(v: unknown): string | null {
  if (Array.isArray(v)) return coerceString(v[0]);
  return coerceString(v);
}

function parseMiraEvent(raw: unknown): MiraEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = coerceString(r.id);
  const name = coerceString(r.name);
  if (!id || !name) return null;
  return {
    id,
    name,
    startDate: coerceString(r.startDate),
    endDate: coerceString(r.endDate),
    city: coerceCity(r.city),
    website: coerceString(r.website),
    tags: coerceString(r.tags),
    seriesSlug: coerceString(r.seriesSlug),
  };
}

/** Fetch one Mira series page and return its `mainEvents` + `sideEvents`,
 *  combined (both arrays share the same event shape — "main" vs "side" is
 *  just how Mira categorizes them, not a difference this source cares
 *  about). */
export async function fetchMiraSeriesEvents(seriesSlug: string): Promise<MiraEvent[]> {
  if (!isValidMiraSeriesSlug(seriesSlug)) throw new MiraFetchError(`Invalid Mira series slug: ${seriesSlug}`);
  const html = await fetchMiraHtml(`https://miragather.com/${seriesSlug}`);
  const pageProps = parseMiraNextData(html);
  const mainEvents = Array.isArray(pageProps.mainEvents) ? pageProps.mainEvents : [];
  const sideEvents = Array.isArray(pageProps.sideEvents) ? pageProps.sideEvents : [];
  return [...mainEvents, ...sideEvents].map(parseMiraEvent).filter((e): e is MiraEvent => e !== null);
}

/** One entry in the Mira homepage's series menu (§9.1: "ideally with a
 *  dropdown from seriesMenuItems"). */
export interface MiraSeriesMenuItem {
  slug: string;
  title: string;
  location: string | null;
  /** Human-readable date range, e.g. "1 Nov - 18 Nov" — display only. */
  date: string | null;
  startDate: string | null;
  endDate: string | null;
  numEvents: number | null;
}

function parseMiraSeriesMenuItem(raw: unknown): MiraSeriesMenuItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const slug = coerceString(r.slug);
  const title = coerceString(r.title);
  if (!slug || !title || !isValidMiraSeriesSlug(slug)) return null;
  return {
    slug,
    title,
    location: coerceString(r.location),
    date: coerceString(r.date),
    startDate: coerceString(r.startDate),
    endDate: coerceString(r.endDate),
    numEvents: typeof r.numEvents === 'number' ? r.numEvents : null,
  };
}

/** Fetch the Mira homepage and return every series it lists — used to
 *  populate the admin "add a Mira series" dropdown. */
export async function fetchMiraSeriesMenu(): Promise<MiraSeriesMenuItem[]> {
  const html = await fetchMiraHtml('https://miragather.com/');
  const pageProps = parseMiraNextData(html);
  const items = Array.isArray(pageProps.seriesMenuItems) ? pageProps.seriesMenuItems : [];
  return items.map(parseMiraSeriesMenuItem).filter((e): e is MiraSeriesMenuItem => e !== null);
}
