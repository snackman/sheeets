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
// against a candidate's own name/hosts/organizer/description — a candidate
// whose host or title literally names a known sponsor org for this
// conference is a reasonable positive theme-fit signal even before any
// link exists between the two rows.
import { getIngestSupabase } from './db';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

/** First known sponsor name that appears (case-insensitive, word-boundary,
 *  same style as `signals.ts`'s keyword matcher) in `text`, or null. */
export function matchSponsorName(text: string, sponsorNames: string[]): string | null {
  for (const name of sponsorNames) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    const re = new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(trimmed)}(?![A-Za-z0-9])`, 'i');
    if (re.test(text)) return trimmed;
  }
  return null;
}
