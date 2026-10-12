// Sponsor-name signal wiring (Phase 2 follow-up from 1b — see
// `pipeline.ts`'s old `sponsorMatch: null` TODO, plans/event-ingestion.md
// §5.4 "Known sponsor name (from `event_sponsors`) in name, hosts or
// description").
//
// `event_sponsors` rows are keyed by an already-published sheet `event_id`
// (see `supabase/migrations/20260419120000_event_sponsors.sql`), which a
// pre-publish ingestion candidate doesn't have yet, so this never looks a
// candidate up by event_id. Instead it pulls the distinct sponsor names
// already crawled for ANY of a conference's published events
// (`scripts/crawl-sponsors.ts`) and matches those names, as plain text,
// against a candidate's own HOST/ORGANIZER identity fields (callers in
// `pipeline.ts`/the queue route build that text, deliberately excluding
// the event name and free-text description — review finding, MEDIUM item
// 8: a sponsor being merely MENTIONED in a title/description is much
// weaker evidence than it being the actual host/organizer, and was the
// main source of false-positive risk).
import { getIngestSupabase } from './db';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Crypto/web3 sponsor names that are ALSO common, generic English words or
 * very short tickers/acronyms (review finding, MEDIUM item 8: "Add a
 * stoplist for 'Base', 'Near', 'Open', 'AI', 'Ledger' and similar"). For
 * these, case-insensitive whole-word matching is far too permissive — "a
 * base camp meetup" or "an open bar" would otherwise "match" sponsors
 * named "Base"/"Open". Matched against the host/organizer text this module
 * does, a false hit is less likely than against full descriptions, but
 * still possible (an organizer display name containing an ordinary word).
 * Entries here (plus anything shorter than `MIN_UNAMBIGUOUS_SPONSOR_LENGTH`)
 * require an EXACT-CASE match instead of case-insensitive.
 */
const AMBIGUOUS_SPONSOR_NAMES = new Set([
  'base', 'near', 'open', 'ai', 'ledger', 'link', 'core', 'sol', 'ton', 'ref', 'render', 'story', 'sign',
]);
const MIN_UNAMBIGUOUS_SPONSOR_LENGTH = 4;

export async function getSponsorNamesForConference(conference: string): Promise<string[]> {
  const supabase = getIngestSupabase();
  const { data, error } = await supabase
    .from('event_sponsors')
    .select('sponsor_name')
    .eq('conference', conference);
  if (error) {
    // `event_sponsors` predates ingestion and isn't guaranteed to exist in
    // every environment (e.g. a fresh preview DB before the sponsor-crawl
    // script has ever run there) — missing sponsor data is not a reason to
    // fail the whole ingestion run, same tolerance as the admin
    // sponsor-data route's `42P01` ("table not yet created") handling.
    if ((error as { code?: string }).code === '42P01') return [];
    throw new Error(`Failed to load sponsor names: ${error.message}`);
  }
  const names = new Set(
    (data ?? [])
      .map((r) => (r as { sponsor_name: string | null }).sponsor_name)
      .filter((n): n is string => !!n && n.trim().length > 0)
  );
  return Array.from(names);
}

/**
 * First known sponsor name that appears, word-boundary matched, in `text`
 * (the caller's host/organizer text), or null. Case-insensitive for an
 * ordinary, unambiguous sponsor name (same style as `signals.ts`'s keyword
 * matcher); for a short or common-word name (the stoplist above, or
 * anything under `MIN_UNAMBIGUOUS_SPONSOR_LENGTH` chars), the match is
 * case-SENSITIVE instead — it must appear with the sponsor's own
 * capitalization, not any-case (review finding, MEDIUM item 8).
 */
export function matchSponsorName(text: string, sponsorNames: string[]): string | null {
  for (const name of sponsorNames) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    const ambiguous = trimmed.length < MIN_UNAMBIGUOUS_SPONSOR_LENGTH || AMBIGUOUS_SPONSOR_NAMES.has(trimmed.toLowerCase());
    const re = new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(trimmed)}(?![A-Za-z0-9])`, ambiguous ? '' : 'i');
    if (re.test(text)) return trimmed;
  }
  return null;
}
