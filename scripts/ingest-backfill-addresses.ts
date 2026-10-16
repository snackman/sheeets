/**
 * One-off backfill for Bug: "addresses are always empty".
 *
 * `normalize.ts` used to hardcode `event.address = ''` for every Luma iCal
 * candidate (it never read the enriched payload's address fields, and
 * never fell back to the iCal LOCATION field), so every NON-FINAL
 * candidate ingested before that fix has a blank Address column once
 * approved. This script fills `event.address` (and, where it helps,
 * `event.lat`/`event.lng`) for existing candidates WITHOUT re-classifying
 * them — `llm_score`/`route`/`status`/every other classification field is
 * left exactly as-is.
 *
 * Resolution order, same as the live pipeline (`normalize.ts` +
 * `pipeline.ts`):
 *   1. The enriched Luma address, via a FRESH (rate-limited) re-enrichment
 *      call — most of these candidates never got enriched the first time
 *      (Luma enrichment is rate-limited to ~100/run), so this is usually
 *      the only way to recover it now.
 *   2. The iCal LOCATION field, if it looks like a real address (not a
 *      URL, not empty) — recovered by re-fetching the source calendar's
 *      iCal feed once per conference/source and matching each candidate
 *      back to its VEVENT by `source_ref` (the VEVENT's UID).
 *   3. Reverse-geocode the candidate's own lat/lng (Mapbox), if it has any.
 *   4. "<conference city> (venue on event page)" — last resort.
 *
 * Idempotent: a candidate whose `event.address` is already non-empty is
 * skipped entirely, so re-running this script after a partial run (or
 * after a normal pipeline run has since filled some in) only touches what
 * still needs it.
 *
 * Usage:
 *   npx tsx scripts/ingest-backfill-addresses.ts [--conference "Devcon 8"] [--dry-run] [--limit 500]
 *
 * Required env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Optional env: MAPBOX_SECRET_TOKEN (without it, priority 3 is skipped and
 *   every candidate with no usable address/LOCATION falls straight to
 *   priority 4's conference-city fallback).
 */
import { listCandidates, updateCandidate, getSource, getIngestSupabase } from '../src/lib/ingest/db';
import { getAllConferenceTabs } from '../src/lib/get-conferences';
import { fetchLumaIcalFeed } from '../src/lib/ingest/sources/luma-ical';
import { LumaEnrichmentLimiter } from '../src/lib/ingest/enrich';
import { ReverseGeocodeLimiter, upsertGeocodedAddress, geocodeAddressCached } from '../src/lib/ingest/filters';
import { addressFromLumaGeoFields, looksLikeRealAddress } from '../src/lib/ingest/normalize';
import type { IngestCandidateRow, CandidateStatus } from '../src/lib/ingest/types';
import type { VEvent } from '../src/lib/ingest/ical';
import type { TabConfig } from '../src/lib/conferences';

const NON_FINAL_STATUSES: CandidateStatus[] = ['queued', 'auto_rejected', 'filtered_out', 'pending_classify'];

function parseArgs(argv: string[]) {
  const conferenceIdx = argv.indexOf('--conference');
  const limitIdx = argv.indexOf('--limit');
  return {
    conference: conferenceIdx !== -1 ? argv[conferenceIdx + 1] : undefined,
    dryRun: argv.includes('--dry-run'),
    limit: limitIdx !== -1 ? Number(argv[limitIdx + 1]) : 2000,
  };
}

/** `https://luma.com/event/evt-ABC123` -> `evt-ABC123`. Luma iCal
 *  candidates always have this exact link shape (the VEVENT's UID always
 *  resolves to a stable api id — see `lumaEventApiIdFromUid` — regardless
 *  of whether enrichment ever succeeded the first time), so this recovers
 *  the api id to re-enrich with, without needing to touch the iCal feed. */
function apiIdFromLumaEventLink(link: string | null | undefined): string | null {
  if (!link) return null;
  const m = link.match(/\/event\/(evt-[A-Za-z0-9]+)/i);
  return m ? m[1] : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const { conference, dryRun, limit } = parseArgs(process.argv.slice(2));

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
    process.exit(1);
  }
  if (!process.env.MAPBOX_SECRET_TOKEN && !process.env.NEXT_PUBLIC_MAPBOX_TOKEN) {
    console.warn('No MAPBOX_SECRET_TOKEN configured — priority 3 (reverse-geocode) will be skipped; falling back to the conference-city label for candidates with no usable address.');
  }

  const candidates = await listCandidates({ conference, status: NON_FINAL_STATUSES, limit });
  const needsBackfill = candidates.filter((c) => !c.event.address);
  console.log(`Found ${candidates.length} non-final candidate(s)${conference ? ` for "${conference}"` : ''}; ${needsBackfill.length} need an address.`);
  if (needsBackfill.length === 0) return;

  const tabs = await getAllConferenceTabs();
  const tabByName = new Map<string, TabConfig>(tabs.map((t) => [t.name, t]));

  const enrichLimiter = new LumaEnrichmentLimiter(100, 1000);
  const reverseGeocodeLimiter = new ReverseGeocodeLimiter();
  const supabase = getIngestSupabase();

  // Re-fetch each distinct luma_ical source's calendar feed ONCE, building
  // a uid -> VEVENT map so priority 2 (iCal LOCATION) can be recovered
  // without a per-candidate network call. Lazy + memoized: most
  // conferences in a run share one source.
  const icalFeedBySourceId = new Map<string, Map<string, VEvent>>();
  async function locationForCandidate(candidate: IngestCandidateRow): Promise<string | null> {
    if (candidate.source_kind !== 'luma_ical' || !candidate.source_id || !candidate.source_ref) return null;
    let feed = icalFeedBySourceId.get(candidate.source_id);
    if (!feed) {
      feed = new Map();
      icalFeedBySourceId.set(candidate.source_id, feed);
      try {
        const source = await getSource(candidate.source_id);
        const calendarApiId = (source?.config as { calendar_api_id?: string } | undefined)?.calendar_api_id;
        if (calendarApiId) {
          const vevents = await fetchLumaIcalFeed(calendarApiId);
          for (const v of vevents) feed.set(v.uid, v);
        }
      } catch (err) {
        console.warn(`  Could not re-fetch iCal feed for source ${candidate.source_id}: ${err instanceof Error ? err.message : err}`);
      }
    }
    const vevent = feed.get(candidate.source_ref);
    return vevent && looksLikeRealAddress(vevent.location) ? (vevent.location as string).trim() : null;
  }

  function conferenceCityLabel(conferenceName: string, cached: Map<string, string>): Promise<string> {
    const existing = cached.get(conferenceName);
    if (existing) return Promise.resolve(existing);
    const tab = tabByName.get(conferenceName);
    if (!tab) {
      cached.set(conferenceName, conferenceName);
      return Promise.resolve(conferenceName);
    }
    return reverseGeocodeLimiter.resolve(tab.center.lat, tab.center.lng).then((resolved) => {
      const label = resolved?.city || conferenceName;
      cached.set(conferenceName, label);
      return label;
    });
  }
  const cityLabelCache = new Map<string, string>();

  let filled = 0;
  let stillEmpty = 0;
  const skippedAlreadyFilled = candidates.length - needsBackfill.length;
  let i = 0;

  for (const candidate of needsBackfill) {
    i++;
    const label = `[${i}/${needsBackfill.length}] ${candidate.conference} / ${candidate.event.name || candidate.canonical_key}`;

    // Priority 1: fresh Luma re-enrichment (rate-limited, same limiter a
    // live run would use).
    let address = '';
    let lat = candidate.event.lat ?? null;
    let lng = candidate.event.lng ?? null;
    const apiId = apiIdFromLumaEventLink(candidate.event.link);
    if (apiId && !enrichLimiter.exhausted) {
      const enrichment = await enrichLimiter.enrich({ apiId });
      if (enrichment?.event) address = addressFromLumaGeoFields(enrichment.event as Record<string, unknown>);
    }

    // Priority 2: iCal LOCATION (re-fetched feed).
    if (!address) {
      const locationAddress = await locationForCandidate(candidate);
      if (locationAddress) address = locationAddress;
    }

    // A real address from priority 1/2 but no coordinates yet: forward-
    // geocode it (same as the live pipeline's existing fallback).
    if (address && (lat == null || lng == null)) {
      const tab = tabByName.get(candidate.conference);
      if (tab) {
        const geocoded = await geocodeAddressCached(supabase, address, tab.center, candidate.conference);
        if (geocoded) {
          lat = geocoded.lat;
          lng = geocoded.lng;
        }
      }
    }

    // Priority 3: reverse-geocode this candidate's own lat/lng.
    if (!address && lat != null && lng != null) {
      const resolved = await reverseGeocodeLimiter.resolve(lat, lng);
      if (resolved) address = resolved.label;
    }

    // Priority 4: conference-city fallback.
    if (!address) {
      address = `${await conferenceCityLabel(candidate.conference, cityLabelCache)} (venue on event page)`;
    }

    if (!address) {
      console.log(`${label}: could not resolve an address (unexpected — priority 4 should always produce one).`);
      stillEmpty++;
      continue;
    }

    console.log(`${label}: -> "${address}"`);
    filled++;

    if (dryRun) continue;

    await updateCandidate(candidate.id, {
      event: { ...candidate.event, address, lat, lng },
    });
    if (lat != null && lng != null) {
      await upsertGeocodedAddress(supabase, address, lat, lng, candidate.conference);
    }

    // Luma enrichment is rate-limited server-side too; the limiter already
    // paces its own calls, but space out the rest of the loop's writes a
    // touch so a large backfill doesn't hammer Supabase/Mapbox back-to-back.
    await sleep(50);
  }

  console.log(
    `\nDone${dryRun ? ' (dry run — nothing written)' : ''}. Filled: ${filled}, already had an address: ${skippedAlreadyFilled}, still empty: ${stillEmpty}.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
