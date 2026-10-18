/**
 * Cleanup for the 2026-10-18 incident: discovered-link candidates stuck in
 * `status: 'error'` with no reason (mostly a shared Mira series feeding
 * two conferences, where enrichment 404'd on a lowercased Luma api id —
 * see `discover.ts#lumaApiIdFromUrl`).
 *
 * Re-evaluates every existing `error` row against its conference's date
 * window, using the cheapest date available:
 *   1. the row's own `event.dateISO` (a classify-failure row has real data),
 *   2. the Mira series page that listed it (one fetch per series),
 *   3. one paced Luma lookup by slug (`--no-luma` to skip; capped by
 *      `--luma-max`).
 * Out-of-window rows become `filtered_out` (with the window reason). Every
 * other row is LEFT `error` for the live pipeline to retry; if it has no
 * reason yet, one is recorded so no error row is reasonless.
 *
 * Safety / idempotency:
 *  - Only ever touches rows that are still `status = 'error'` at write
 *    time (`.eq('status', 'error')` on every update) — re-running after a
 *    successful run finds nothing left to change for the out-of-window
 *    ones and does not re-annotate rows that already have a reason.
 *  - Never writes `ingest_link_cache`.
 *  - DRY RUN BY DEFAULT: prints the plan and counts; pass `--apply` to write.
 *
 * Usage:
 *   npx tsx scripts/ingest-reevaluate-error-rows.ts [--conference "DAS London 2026"] [--limit 500] [--no-luma] [--luma-max 40] [--apply]
 *
 * Required env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import { getIngestSupabase, getProfile } from '../src/lib/ingest/db';
import { getAllConferenceTabs } from '../src/lib/get-conferences';
import { getTabConfig, type TabConfig } from '../src/lib/conferences';
import { normalizeEventLink, getValidLumaSlug, LUMA_EVENT_API_ID_RE } from '../src/lib/luma';
import { LumaEnrichmentLimiter } from '../src/lib/ingest/enrich';
import { dateWindowFilter } from '../src/lib/ingest/filters';
import { normalizeDiscoveredLumaEvent } from '../src/lib/ingest/normalize';
import { sourceDateWindowPrefilter, sourceDateToLocalISO, type DiscoveredLinkHints } from '../src/lib/ingest/discover';
import { fetchMiraSeriesEvents, buildMiraHintsByUrl, normalizeMiraSeriesSlug } from '../src/lib/ingest/sources/mira';
import type { IngestProfileRow, CandidateSourceRef, NormalizedEvent } from '../src/lib/ingest/types';

export const LEGACY_ERROR_REASON = 'error: legacy_error: no reason recorded (pre-2026-10-18 fix); pending retry';

interface ErrorRow {
  id: string;
  conference: string;
  canonical_key: string;
  alt_keys: string[] | null;
  source_ref: string | null;
  sources: CandidateSourceRef[] | null;
  event: Partial<NormalizedEvent> | null;
  filter_reason: string | null;
}

function parseArgs(argv: string[]) {
  const val = (flag: string) => {
    const i = argv.indexOf(flag);
    return i !== -1 ? argv[i + 1] : undefined;
  };
  return {
    conference: val('--conference'),
    limit: Number(val('--limit') ?? 500),
    apply: argv.includes('--apply'),
    luma: !argv.includes('--no-luma'),
    lumaMax: Number(val('--luma-max') ?? 40),
  };
}

function miraSlugsFor(row: ErrorRow): string[] {
  const refs = [row.source_ref, ...(row.sources ?? []).filter((s) => s.kind === 'mira_series').map((s) => s.ref)];
  const slugs = new Set<string>();
  for (const ref of refs) {
    if (!ref || !/miragather\.com|cryptonomads\.org/i.test(ref)) continue;
    const slug = normalizeMiraSeriesSlug(ref);
    if (slug) slugs.add(slug);
  }
  return [...slugs];
}

/** Short (non-evt) Luma slug for a row, from its keys or its link. */
function lumaSlugFor(row: ErrorRow): string | null {
  const fromLink = row.event?.link ? getValidLumaSlug(row.event.link) : null;
  if (fromLink && fromLink.toLowerCase() !== 'event' && !LUMA_EVENT_API_ID_RE.test(fromLink)) return fromLink;
  for (const key of [row.canonical_key, ...(row.alt_keys ?? [])]) {
    if (!key.startsWith('luma:')) continue;
    const part = key.slice('luma:'.length);
    if (!LUMA_EVENT_API_ID_RE.test(part)) return part;
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const supabase = getIngestSupabase();

  let query = supabase
    .from('ingest_candidates')
    .select('id, conference, canonical_key, alt_keys, source_ref, sources, event, filter_reason')
    .eq('status', 'error')
    .order('first_seen_at', { ascending: true })
    .limit(args.limit);
  if (args.conference) query = query.eq('conference', args.conference);
  const { data, error } = await query;
  if (error) throw new Error(`Failed to list error rows: ${error.message}`);
  const rows = (data ?? []) as ErrorRow[];

  const tabs = await getAllConferenceTabs();
  const profiles = new Map<string, IngestProfileRow | null>();
  const miraHints = new Map<string, Map<string, DiscoveredLinkHints>>(); // series slug -> link key -> hints
  const limiter = new LumaEnrichmentLimiter(args.lumaMax, 1000);

  const counts: Record<string, number> = {};
  const bump = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);
  const plan: { id: string; conference: string; key: string; action: string; detail: string }[] = [];

  for (const row of rows) {
    bump('error_rows_scanned');
    const tab: TabConfig | undefined = getTabConfig(row.conference, tabs);
    if (!profiles.has(row.conference)) profiles.set(row.conference, await getProfile(row.conference));
    const profile = profiles.get(row.conference) ?? null;
    if (!tab || !profile || tab.dates.length === 0) {
      bump('left:no_conference_config');
      plan.push({ id: row.id, conference: row.conference, key: row.canonical_key, action: 'leave', detail: 'no tab/profile' });
      continue;
    }
    const window = { startDate: tab.dates[0], endDate: tab.dates[tab.dates.length - 1] };
    const keys = [row.canonical_key, ...(row.alt_keys ?? [])];

    let verdict: { out: boolean; reason?: string; via: string; dateISO: string } | null = null;

    // 1. Real event data already on the row.
    if (row.event?.dateISO) {
      const f = dateWindowFilter({ dateISO: row.event.dateISO }, window, profile);
      verdict = { out: !f.pass, reason: f.pass ? undefined : f.reason, via: 'row', dateISO: row.event.dateISO };
    }

    // 2. Mira listing (same slack rule as the live pre-enrichment filter).
    if (!verdict) {
      for (const slug of miraSlugsFor(row)) {
        if (!miraHints.has(slug)) {
          try {
            const events = await fetchMiraSeriesEvents(slug);
            const byKey = new Map<string, DiscoveredLinkHints>();
            for (const [url, hint] of buildMiraHintsByUrl(events)) {
              const k = normalizeEventLink(url);
              if (k) byKey.set(k, hint);
            }
            miraHints.set(slug, byKey);
          } catch (err) {
            console.warn(`Mira fetch failed for ${slug}: ${err instanceof Error ? err.message : err}`);
            miraHints.set(slug, new Map());
          }
        }
        const hint = keys.map((k) => miraHints.get(slug)!.get(k)).find(Boolean);
        if (!hint) continue;
        const dateISO = sourceDateToLocalISO(hint.startDate, tab.timezone);
        if (!dateISO) continue;
        const pre = sourceDateWindowPrefilter(hint, { tab, profile });
        if (pre) verdict = { out: true, reason: pre.reason, via: 'mira', dateISO };
        else if (dateWindowFilter({ dateISO }, window, profile).pass) verdict = { out: false, via: 'mira', dateISO };
        // else: within the prefilter's slack — let Luma's own date decide.
        break;
      }
    }

    // 3. One paced Luma lookup by slug.
    let lumaNote = '';
    if (!verdict && args.luma) {
      const slug = lumaSlugFor(row);
      if (slug) {
        const result = await limiter.enrichResult({ slug });
        const normalized = result.status === 'ok' ? normalizeDiscoveredLumaEvent({ payload: result.payload, fallbackLink: row.event?.link ?? '' }) : null;
        if (normalized?.dateISO) {
          const f = dateWindowFilter({ dateISO: normalized.dateISO }, window, profile);
          verdict = { out: !f.pass, reason: f.pass ? undefined : f.reason, via: 'luma', dateISO: normalized.dateISO };
        } else {
          lumaNote = result.status === 'ok' ? 'luma:no_start' : `luma:${result.status}`;
        }
      }
    }

    if (verdict?.out) {
      bump('to_filtered_out');
      bump(`to_filtered_out:${row.conference}`);
      bump(`to_filtered_out:via_${verdict.via}`);
      const filterReason = `${verdict.reason} [cleanup 2026-10-18: ${verdict.via} date ${verdict.dateISO}]`;
      plan.push({ id: row.id, conference: row.conference, key: row.canonical_key, action: 'filtered_out', detail: filterReason });
      if (args.apply) {
        const { error: upErr } = await supabase
          .from('ingest_candidates')
          .update({ status: 'filtered_out', filter_reason: filterReason })
          .eq('id', row.id)
          .eq('status', 'error');
        if (upErr) throw new Error(`Update failed for ${row.id}: ${upErr.message}`);
      }
      continue;
    }

    const why = verdict ? `in_window(${verdict.via} ${verdict.dateISO})` : lumaNote || 'no_date';
    bump('left_for_retry');
    bump(`left_for_retry:${why.split('(')[0]}`);
    const needsReason = !row.filter_reason;
    if (needsReason) bump('left_for_retry:reason_backfilled');
    plan.push({ id: row.id, conference: row.conference, key: row.canonical_key, action: 'leave', detail: `${why}${needsReason ? ' +reason' : ''}` });
    if (args.apply && needsReason) {
      const { error: upErr } = await supabase
        .from('ingest_candidates')
        .update({ filter_reason: `${LEGACY_ERROR_REASON} [${why}]` })
        .eq('id', row.id)
        .eq('status', 'error')
        .is('filter_reason', null);
      if (upErr) throw new Error(`Update failed for ${row.id}: ${upErr.message}`);
    }
  }

  for (const p of plan) console.log(`${p.action.padEnd(12)} ${p.conference.padEnd(20)} ${p.key.padEnd(40)} ${p.detail}`);
  console.log(`\n${args.apply ? 'APPLIED' : 'DRY RUN (pass --apply to write)'} — counts:`);
  for (const [k, v] of Object.entries(counts).sort()) console.log(`  ${k}: ${v}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
