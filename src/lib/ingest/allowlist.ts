// Event-platform link allowlist (Phase 3, plans/event-ingestion.md §3.2/§10):
// a discovery source (Telegram, a curated event's own description, a host
// submission) may surface arbitrary URLs. We only ever ENRICH/FETCH a link
// whose host is one of the handful of event platforms this app already
// knows how to parse — Luma, Partiful, Eventbrite, Meetup, Posh. Everything
// else is recorded as "seen" (for audit) but never fetched, so a discovery
// source can never be used to make this server fetch an arbitrary URL.
//
// Reuses `detectPlatform` (event-extractors.ts) rather than re-declaring the
// host list a second time — that function is exactly "is this URL one of
// the five platforms we can parse", which is the same question the
// allowlist needs answered, and keeps both lists from drifting apart.
import { detectPlatform, type Platform } from '../event-extractors';

export { type Platform };

/** True if `url` points at one of the allowlisted event platforms (Luma,
 *  Partiful, Eventbrite, Meetup, Posh) and is therefore safe to fetch/enrich
 *  from a discovery source. Anything else (a blog, a tweet, a random site)
 *  returns false and must never be fetched from discovered text. */
export function isAllowlistedEventLink(url: string): boolean {
  return detectPlatform(url) !== null;
}

/** Which allowlisted platform a URL belongs to, or null if it isn't one. */
export function allowlistedPlatformFor(url: string): Platform | null {
  return detectPlatform(url);
}
