// Public community-tracker Google Sheet source (e.g. the Build3 tracker,
// `1MDHdcFf69FEk_Zm48mJmYjzgrePxxpptMyY7MlzMBgg`) — a link-shared Sheet
// someone else maintains, not one of Snax's own curated tabs.
//
// Verified live (2026-10-17) against the real Build3 sheet:
//   - `GET .../export?format=csv` returns a 401/redirect-to-login for a
//     public link-shared (not "published to web") Sheet — not usable.
//   - `GET .../gviz/tq?...` is the app's OWN authenticated path for its own
//     sheet (`google-sheets.ts`) — for a THIRD-PARTY sheet we don't have a
//     service-account grant on, that's not an option either, and even when
//     reachable, gviz only ever returns a cell's typed VALUE, never the
//     real href behind a `=HYPERLINK(...)` formula or rich-text link — which
//     is exactly what a tracker sheet uses for its event links.
//   - `GET .../htmlview/sheet?gid=<gid>` (NOT the bare `.../htmlview`, which
//     returns a JS-only shell with no `<a>` tags at all) returns a fully
//     rendered, PUBLIC, UNAUTHENTICATED HTML snapshot of one tab, with every
//     cell's real hyperlink as `<a href="https://www.google.com/url?q=
//     <REAL_URL>&sa=D&...">` — Google's own click-tracking redirect wrapper.
//     This is the proven, reliable path to real event URLs.
import { safeFetch, SafeFetchError } from '../../safe-fetch';
import { decodeHtmlEntities } from '../../event-extractors';
import { isAllowlistedEventLink } from '../allowlist';

/** Google Sheets ids are base64url-ish: letters, digits, `-`, `_`, commonly
 *  40-50 chars but not fixed-length — bounded generously so this can never
 *  smuggle a path segment or query string into the fetch URL. */
export const SHEET_TRACKER_ID_RE = /^[A-Za-z0-9_-]{10,100}$/;

export function isValidSheetTrackerId(id: string): boolean {
  return SHEET_TRACKER_ID_RE.test(id);
}

/** Accepts a bare sheet id or a full `docs.google.com/spreadsheets/d/<id>/...`
 *  URL (optionally with a `gid=` or `#gid=` fragment), returning the id and,
 *  if present, the gid. */
export function parseSheetTrackerInput(input: string): { sheetId: string; gid: number | null } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let sheetId = trimmed;
  let gid: number | null = null;

  const urlMatch = trimmed.match(/\/spreadsheets\/d\/([^/?#]+)/);
  if (urlMatch) {
    sheetId = urlMatch[1];
    const gidMatch = trimmed.match(/[?#&]gid=(\d+)/);
    if (gidMatch) gid = parseInt(gidMatch[1], 10);
  }

  if (!isValidSheetTrackerId(sheetId)) return null;
  return { sheetId, gid };
}

const SHEET_TRACKER_TIMEOUT_MS = 12_000;
const SHEET_TRACKER_MAX_BYTES = 6 * 1024 * 1024;
const SHEET_TRACKER_USER_AGENT = 'plan.wtf event-ingest (+https://plan.wtf)';

export class SheetTrackerFetchError extends Error {}

/** Fetch one tab's rendered HTML snapshot via `/htmlview/sheet?gid=`.
 *  `gid` defaults to `0` (a spreadsheet's first tab) when omitted — see
 *  `SheetTrackerSourceConfig`'s doc comment. */
export async function fetchSheetTrackerHtml(sheetId: string, gid: number = 0): Promise<string> {
  if (!isValidSheetTrackerId(sheetId)) throw new SheetTrackerFetchError(`Invalid sheet id: ${sheetId}`);
  if (!Number.isInteger(gid) || gid < 0) throw new SheetTrackerFetchError(`Invalid gid: ${gid}`);
  const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/htmlview/sheet?gid=${gid}`;
  let res;
  try {
    res = await safeFetch(url, {
      timeoutMs: SHEET_TRACKER_TIMEOUT_MS,
      maxBytes: SHEET_TRACKER_MAX_BYTES,
      maxRedirects: 2,
      headers: { 'User-Agent': SHEET_TRACKER_USER_AGENT, Accept: 'text/html' },
    });
  } catch (err) {
    throw new SheetTrackerFetchError(err instanceof SafeFetchError ? err.message : 'Could not reach Google Sheets.');
  }
  if (!res.ok) throw new SheetTrackerFetchError(`Google Sheets returned ${res.status} for sheet ${sheetId} (gid ${gid}).`);
  return res.text;
}

function extractHrefs(html: string): string[] {
  const hrefs: string[] = [];
  const re = /<a\b[^>]*\bhref="([^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    hrefs.push(decodeHtmlEntities(m[1]));
  }
  return hrefs;
}

/** Unwrap Google's `https://www.google.com/url?q=<REAL_URL>&sa=D&...`
 *  click-tracking redirect, used for every outbound link in an
 *  `/htmlview` snapshot. Returns the href unchanged if it isn't one of
 *  these (e.g. an in-sheet anchor, or a link Google didn't wrap). */
export function unwrapGoogleRedirect(href: string): string {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return href;
  }
  if (!/(^|\.)google\.com$/i.test(url.hostname) || url.pathname !== '/url') return href;
  const q = url.searchParams.get('q');
  return q || href;
}

/** Parse one `/htmlview/sheet?gid=` snapshot and return every allowlisted
 *  (Luma/Partiful/Eventbrite/Meetup/Posh) outbound event link, deduped. */
export function extractSheetTrackerLinks(html: string): string[] {
  const links = new Set<string>();
  for (const href of extractHrefs(html)) {
    const real = unwrapGoogleRedirect(href);
    if (isAllowlistedEventLink(real)) links.add(real);
  }
  return Array.from(links);
}

/** Fetch + parse in one call — the only entry point `pipeline.ts` needs. */
export async function fetchSheetTrackerLinks(sheetId: string, gid: number = 0): Promise<string[]> {
  const html = await fetchSheetTrackerHtml(sheetId, gid);
  return extractSheetTrackerLinks(html);
}
