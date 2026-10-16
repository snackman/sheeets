/**
 * One-off cleanup for Bug: "short Luma links bypass dedupe".
 *
 * Before the live-code fix (`src/lib/ingest/discover.ts`), a short
 * `lu.ma/<slug>` link discovered via Telegram, sheet-mining, or a host
 * submission (`processDiscoveredLink`) canonicalized to `luma:<slug>` —
 * NOT the curated iCal path's `luma:evt-…` (the event's stable api id, via
 * its VEVENT UID) for the exact same event. So instead of being deduped
 * against the calendar's own candidate, it was ingested as a brand-new,
 * never-deduped row — including resurfacing events an admin had already
 * rejected under their evt- key.
 *
 * This script finds every EXISTING candidate stuck under one of those
 * short-slug keys, resolves the slug to its stable Luma api id (reading
 * `ingest_link_cache` when a resolution is already known, otherwise one
 * live, rate-limited lookup — same policy as the live pipeline, minus the
 * cache WRITE, see "Safety" below), and — only when a candidate under the
 * resolved `luma:evt-…` key ALREADY exists for the same conference — marks
 * the slug candidate `duplicate` (`duplicate_of` = that evt- candidate's
 * id).
 *
 * Safety:
 *  - The evt- candidate is NEVER written to — only the slug candidate's
 *    own row changes.
 *  - A slug candidate already in a FINAL status (approved, auto_published,
 *    rejected, unpublished, unpublished_external) is left alone, not
 *    marked duplicate — it may be a published/decided row in its own
 *    right (e.g. published to the sheet before the evt- candidate ever
 *    existed), and retroactively demoting it to "duplicate" could orphan
 *    that.
 *  - Idempotent: a slug candidate that's already `duplicate` of the same
 *    evt- candidate is skipped. Safe to re-run.
 *  - `--dry-run` logs every planned change without writing anything.
 *  - This script NEVER writes to the shared `ingest_link_cache` table (only
 *    the live pipeline/`discover.ts` do that) — it reads a cached api id
 *    when one is already known, but a cold or "confirmed no api id" cache
 *    entry always gets a fresh live re-check here rather than being
 *    trusted blindly or persisted back. A one-off migration like this is
 *    exactly the case where re-verifying is cheap and safe, and NOT
 *    writing to shared infrastructure means a transient failure here can
 *    never poison the cache the live pipeline relies on.
 *
 * Usage:
 *   npx tsx scripts/ingest-merge-shortlink-dupes.ts [--conference "Devcon 8"] [--dry-run] [--limit 5000]
 *
 * Required env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import { getIngestSupabase, getCandidateByKey, getCachedLumaApiId, updateCandidate } from '../src/lib/ingest/db';
import { getLumaEventApiId, getValidLumaSlug, LUMA_SLUG_RE, LUMA_EVENT_API_ID_RE } from '../src/lib/luma';
import { LumaEnrichmentLimiter } from '../src/lib/ingest/enrich';
import { FINAL_CANDIDATE_STATUSES } from '../src/lib/ingest/types';
import type { IngestCandidateRow } from '../src/lib/ingest/types';

/** `luma:<slug>` where `<slug>` is NOT already an `evt-…` api id. */
const NON_EVT_LUMA_SLUG_KEY_RE = /^luma:(?!evt-)/i;

function parseArgs(argv: string[]) {
  const conferenceIdx = argv.indexOf('--conference');
  const limitIdx = argv.indexOf('--limit');
  return {
    conference: conferenceIdx !== -1 ? argv[conferenceIdx + 1] : undefined,
    dryRun: argv.includes('--dry-run'),
    limit: limitIdx !== -1 ? Number(argv[limitIdx + 1]) : 5000,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** One live resolution attempt via the rate limiter, with a single retry
 *  (after a short backoff) on a null/failed result — `LumaEnrichmentLimiter
 *  .enrich` collapses a real "no api id" and a transient network/rate-limit
 *  error into the same `null`, so a single failed attempt isn't trustworthy
 *  enough on its own for a one-off migration to permanently skip a
 *  candidate over. */
async function resolveWithRetry(slug: string, enrichLimiter: LumaEnrichmentLimiter): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const payload = await enrichLimiter.enrich({ slug });
    const apiId = payload ? getLumaEventApiId(payload) : null;
    if (apiId) return apiId;
    if (attempt === 0) await sleep(2000);
  }
  return null;
}

async function main() {
  const { conference, dryRun, limit } = parseArgs(process.argv.slice(2));

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
    process.exit(1);
  }
  if (!dryRun) {
    console.warn('Running WITHOUT --dry-run — this will write `status: duplicate` to matched candidates.');
  }

  const supabase = getIngestSupabase();
  let query = supabase.from('ingest_candidates').select('*');
  if (conference) query = query.eq('conference', conference);
  query = query.order('first_seen_at', { ascending: true }).limit(limit);
  const { data, error } = await query;
  if (error) throw new Error(`Failed to list candidates: ${error.message}`);
  const all = (data ?? []) as IngestCandidateRow[];

  const slugCandidates = all.filter((c) => NON_EVT_LUMA_SLUG_KEY_RE.test(c.canonical_key));
  console.log(
    `Scanned ${all.length} candidate(s)${conference ? ` for "${conference}"` : ''}; ${slugCandidates.length} have a short-slug Luma canonical_key.`
  );
  if (slugCandidates.length === 0) return;

  // Same rate limit (1 req/s) every other Luma lookup in this app respects
  // — most of these will hit the cache (`ingest_link_cache`, shared with
  // `buildSheetLinkIndex`/`discover.ts`'s own resolution) rather than
  // needing a live call at all.
  const enrichLimiter = new LumaEnrichmentLimiter(100, 1000);

  let resolvedCount = 0;
  let merged = 0;
  let alreadyMerged = 0;
  let noEvtCandidateYet = 0;
  let unresolved = 0;
  let skippedFinal = 0;
  let i = 0;

  for (const candidate of slugCandidates) {
    i++;
    const label = `[${i}/${slugCandidates.length}] [${candidate.conference}] ${candidate.canonical_key} ("${candidate.event.name || 'untitled'}")`;

    // The slug lives in `canonical_key` itself (that's exactly what makes
    // it match `NON_EVT_LUMA_SLUG_KEY_RE` above) — NOT necessarily in
    // `event.link`, which a later enrichment pass may have already
    // rewritten to the full `/event/evt-…` URL once the api id became
    // known by other means. Using `event.link` here would hit the SAME
    // "/event/<id>" bug `normalizeEventLink`'s own #177 fix describes:
    // `getValidLumaSlug` on that link returns the literal path segment
    // "event", not the real slug, and every single lookup would 404.
    const slugFromKey = candidate.canonical_key.slice('luma:'.length);
    const slug = LUMA_SLUG_RE.test(slugFromKey) ? slugFromKey : getValidLumaSlug(candidate.event.link);
    if (!slug) {
      console.log(`${label}: could not parse a slug from canonical_key "${candidate.canonical_key}" — skipping.`);
      continue;
    }

    // Trust an already-cached api id (a real resolution, no need to re-ask
    // Luma). A cold or "confirmed no api id" cache entry is always
    // re-checked live here rather than trusted — see the file-level note
    // on why this script never WRITES that cache back.
    const cached = await getCachedLumaApiId(candidate.canonical_key);
    let apiId: string | null = cached ?? null;
    if (!apiId) {
      apiId = await resolveWithRetry(slug, enrichLimiter);
    }
    if (!apiId || !LUMA_EVENT_API_ID_RE.test(apiId)) {
      console.log(`${label}: could not resolve a stable api id — leaving as-is.`);
      unresolved++;
      continue;
    }
    resolvedCount++;
    const evtKey = `luma:${apiId.toLowerCase()}`;

    const evtCandidate = await getCandidateByKey(candidate.conference, evtKey);
    if (!evtCandidate) {
      console.log(`${label}: resolves to ${evtKey}, but no candidate exists under that key yet — leaving as-is.`);
      noEvtCandidateYet++;
      continue;
    }
    if (evtCandidate.id === candidate.id) {
      continue; // Shouldn't happen — guard anyway.
    }

    if (candidate.status === 'duplicate' && candidate.duplicate_of === evtCandidate.id) {
      alreadyMerged++; // Idempotent: a previous run already did this one.
      continue;
    }

    if (FINAL_CANDIDATE_STATUSES.includes(candidate.status)) {
      console.log(
        `${label}: is already final ("${candidate.status}") in its own right — NOT marking duplicate (would risk orphaning a decision/publish). Resolve by hand.`
      );
      skippedFinal++;
      continue;
    }

    console.log(`${label}: -> duplicate of ${evtKey} (candidate ${evtCandidate.id}, status "${evtCandidate.status}").`);
    merged++;
    if (dryRun) continue;

    await updateCandidate(candidate.id, {
      status: 'duplicate',
      duplicate_of: evtCandidate.id,
    });
  }

  console.log(
    `\nDone${dryRun ? ' (dry run — nothing written)' : ''}. ` +
      `Resolved an api id for ${resolvedCount}/${slugCandidates.length}. ` +
      `Merged: ${merged}, already merged: ${alreadyMerged}, no evt- candidate yet: ${noEvtCandidateYet}, ` +
      `final (left alone): ${skippedFinal}, unresolved: ${unresolved}.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
