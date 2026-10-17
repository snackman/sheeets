/**
 * One-off cleanup for the Devcon 8 / Breakpoint duplicate-event incident
 * (2026-10-16): a buggy script wrote 63 false "no api id" rows into
 * `ingest_link_cache`. While those rows existed, the publish/approve
 * dedupe guard (`src/lib/ingest/dedupe.ts#buildSheetLinkIndex`) couldn't
 * resolve the sheet's short Luma links to their stable api id, so it
 * missed that a candidate's canonical `/event/evt-…` link was the SAME
 * event as a curator's hand-added short-link row — and published a
 * second, redundant row.
 *
 * This script finds those pairs in a tab (same normalized name + date,
 * one row with a short Luma link, the other with the canonical
 * `/event/evt-…` link), confirms them with a LIVE (never cached) slug
 * resolution, and — only when exactly one side of the pair is identified
 * as a pipeline-published row via `ingest_candidates` — deletes the
 * pipeline copy and marks its candidate `duplicate`.
 *
 * Safety:
 *  - `--dry-run` (or omitting write access) logs every planned change
 *    without touching the sheet or the database. Run this FIRST.
 *  - A pair is only "confirmed" when the short link's LIVE resolution
 *    (never read from `ingest_link_cache` — that cache is exactly what
 *    caused the incident) equals the other row's evt- id. Anything that
 *    doesn't resolve, or resolves to something else, is "unconfirmed"
 *    and left untouched.
 *  - A confirmed pair is only acted on when EXACTLY ONE side matches an
 *    `ingest_candidates` row (status `approved` or `auto_published`) for
 *    this conference. If both sides match, or neither does, the pair is
 *    "ambiguous" and skipped — never guess which row to delete.
 *  - Deletes rows bottom-up (highest absolute row first) within a tab, so
 *    earlier-computed row numbers for rows ABOVE a deleted row stay valid.
 *  - Idempotent: once a pipeline row is deleted, its (name, date) group
 *    only has one row left, so a re-run finds no pair there at all.
 *  - Never writes an `ingest_labels` row — this is dedupe cleanup, not a
 *    theme-rejection decision.
 *
 * Usage:
 *   npx tsx scripts/dedupe-sheet-pipeline-copies.ts [--gid <gid>] [--dry-run]
 *
 * `--gid` restricts the run to one conference tab (e.g. 698718887 for
 * "Devcon 8 2026", 1565660642 for "Solana Breakpoint 2026"); omit it to
 * scan every configured conference tab.
 *
 * Required env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.
 */
import { getSheetTitle, readRange, deleteSheetRow } from '../src/lib/google-sheets';
import { getAllConferenceTabs } from '../src/lib/get-conferences';
import { generateEventId } from '../src/lib/fetch-events';
import { parseDateToISO } from '../src/lib/utils';
import { normalizeEventLink, getValidLumaSlug, getLumaEventApiId } from '../src/lib/luma';
import { normalizeNameForDuplicateCheck } from '../src/lib/ingest/dedupe';
import { LumaEnrichmentLimiter } from '../src/lib/ingest/enrich';
import { getIngestSupabase, updateCandidate } from '../src/lib/ingest/db';
import type { TabConfig } from '../src/lib/conferences';
import type { IngestCandidateRow } from '../src/lib/ingest/types';

function parseArgs(argv: string[]) {
  const gidIdx = argv.indexOf('--gid');
  return {
    gid: gidIdx !== -1 ? Number(argv[gidIdx + 1]) : undefined,
    dryRun: argv.includes('--dry-run'),
  };
}

/** One parsed event row from the sheet, with its ABSOLUTE (1-based) row
 *  number — mirrors `fetch-events.ts#fetchEvents`'s column layout (A:L)
 *  and forward-fill-blank-date behavior exactly, so `generateEventId`
 *  below produces the SAME id the live site/app would for this row. */
interface SheetEventRow {
  absoluteRow: number; // 1-based, matches the real spreadsheet row
  date: string; // raw display text, e.g. "Mon, November 16" (forward-filled)
  dateISO: string;
  startTime: string;
  name: string;
  link: string;
  food: boolean;
  bar: boolean;
  note: string;
}

function cellBool(val: string | undefined): boolean {
  if (!val) return false;
  const v = val.toLowerCase().trim();
  return ['true', 'yes', '1', 'y', 'x', '✓', '✔'].includes(v);
}

/** Parses raw `A:L` rows (as `readRange` returns them — FORMATTED_VALUE,
 *  one entry per absolute row starting at row 1) into event rows, mirroring
 *  `fetch-events.ts#fetchEvents`: skip everything up through the header row
 *  (col B "Start Time" or col E "Event Name"), forward-fill blank dates,
 *  require a non-empty name, and stop at the first fully-blank row after
 *  the header — the same rows the live site/app would read. */
function parseSheetRows(rawRows: string[][]): SheetEventRow[] {
  let headerIdx = -1;
  for (let i = 0; i < rawRows.length; i++) {
    const colB = (rawRows[i]?.[1] || '').toLowerCase().trim();
    const colE = (rawRows[i]?.[4] || '').toLowerCase().trim();
    if (colB === 'start time' || colE === 'event name') {
      headerIdx = i;
      break;
    }
  }

  const out: SheetEventRow[] = [];
  let currentDate = '';
  const startIdx = headerIdx === -1 ? 0 : headerIdx + 1;

  for (let i = startIdx; i < rawRows.length; i++) {
    const row = rawRows[i] || [];
    const dateVal = (row[0] || '').trim();
    const startTime = (row[1] || '').trim();
    const name = (row[4] || '').trim();

    if (!dateVal && !startTime && !name) break; // first blank row ends the list

    if (dateVal) currentDate = dateVal;
    if (!name) continue; // a continuation/spacer row with no event

    out.push({
      absoluteRow: i + 1,
      date: currentDate,
      dateISO: parseDateToISO(currentDate),
      startTime,
      name,
      link: (row[8] || '').trim(),
      food: cellBool(row[9]),
      bar: cellBool(row[10]),
      note: (row[11] || '').trim(),
    });
  }

  return out;
}

type LinkKind = 'short' | 'evt' | 'other';

function classifyLink(link: string): { kind: LinkKind; key: string | null } {
  const key = normalizeEventLink(link);
  if (!key) return { kind: 'other', key: null };
  if (key.startsWith('luma:evt-')) return { kind: 'evt', key };
  if (key.startsWith('luma:')) return { kind: 'short', key };
  return { kind: 'other', key };
}

interface ConfirmedPair {
  name: string;
  dateISO: string;
  shortRow: SheetEventRow;
  evtRow: SheetEventRow;
}

interface PairOutcome {
  name: string;
  dateISO: string;
  shortRow: SheetEventRow;
  evtRow: SheetEventRow;
  outcome: 'confirmed' | 'unconfirmed' | 'ambiguous_group';
  reason?: string;
}

/** Groups rows by normalized name + date, and returns candidate pairs:
 *  a group of exactly 2 rows where one is a short Luma link and the other
 *  is a canonical `/event/evt-…` link. Groups that don't fit that shape
 *  (size != 2, or both rows the same link kind) are reported separately
 *  as "ambiguous_group" so nothing with more than one plausible duplicate
 *  silently falls through. */
function findCandidatePairs(rows: SheetEventRow[]): { pairs: ConfirmedPair[]; ambiguousGroups: SheetEventRow[][] } {
  const groups = new Map<string, SheetEventRow[]>();
  for (const row of rows) {
    const normName = normalizeNameForDuplicateCheck(row.name);
    if (!normName || !row.dateISO) continue;
    const key = `${normName}|${row.dateISO}`;
    const arr = groups.get(key) ?? [];
    arr.push(row);
    groups.set(key, arr);
  }

  const pairs: ConfirmedPair[] = [];
  const ambiguousGroups: SheetEventRow[][] = [];

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    if (group.length > 2) {
      ambiguousGroups.push(group);
      continue;
    }
    const [a, b] = group;
    const aKind = classifyLink(a.link).kind;
    const bKind = classifyLink(b.link).kind;
    if (aKind === 'short' && bKind === 'evt') {
      pairs.push({ name: a.name, dateISO: a.dateISO, shortRow: a, evtRow: b });
    } else if (aKind === 'evt' && bKind === 'short') {
      pairs.push({ name: a.name, dateISO: a.dateISO, shortRow: b, evtRow: a });
    } else {
      // Same name+date, but not a short-link/evt- pair (e.g. two unrelated
      // non-Luma links that merely share a name+date, or two evt- rows) —
      // not this script's incident shape; flag it so Snax can look.
      ambiguousGroups.push(group);
    }
  }

  return { pairs, ambiguousGroups };
}

/** Live, rate-limited, NEVER-cached resolution — reading `ingest_link_cache`
 *  here would be exactly the bug this cleanup exists for. One retry on a
 *  null result (a transient failure and a real "no such event" both come
 *  back as `null` from the limiter; a single attempt isn't trustworthy
 *  enough to permanently write off a pair). */
async function resolveShortLinkLive(link: string, enrichLimiter: LumaEnrichmentLimiter): Promise<string | null> {
  const slug = getValidLumaSlug(link);
  if (!slug) return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const payload = await enrichLimiter.enrich({ slug });
    const apiId = payload ? getLumaEventApiId(payload) : null;
    if (apiId) return apiId.toLowerCase();
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return null;
}

function fmtRow(row: SheetEventRow): string {
  return `row ${row.absoluteRow} (${row.link || '(no link)'})`;
}

async function processTab(tab: TabConfig, dryRun: boolean) {
  console.log(`\n=== ${tab.name} (gid ${tab.gid}) ===`);
  const sheetTitle = await getSheetTitle(tab.gid);
  const rawRows = await readRange(sheetTitle, 'A:L');
  const rows = parseSheetRows(rawRows);
  console.log(`Read ${rawRows.length} raw row(s), parsed ${rows.length} event row(s).`);

  const { pairs, ambiguousGroups } = findCandidatePairs(rows);
  console.log(`Found ${pairs.length} candidate short-link/evt- pair(s), ${ambiguousGroups.length} ambiguous group(s) (same name+date, not a clean pair).`);

  // Live-resolve every candidate pair's short link (never from cache).
  // `LumaEnrichmentLimiter` is self-paced at 1 req/sec, same policy as the
  // live pipeline/every other Luma lookup in this app.
  const enrichLimiter = new LumaEnrichmentLimiter(500, 1000);
  const outcomes: PairOutcome[] = [];
  for (const pair of pairs) {
    const resolvedEvtId = await resolveShortLinkLive(pair.shortRow.link, enrichLimiter);
    const expectedEvtId = classifyLink(pair.evtRow.link).key?.slice('luma:'.length) ?? null;
    if (!resolvedEvtId || !expectedEvtId || resolvedEvtId !== expectedEvtId) {
      outcomes.push({ ...pair, outcome: 'unconfirmed', reason: resolvedEvtId ? `resolved to ${resolvedEvtId}, expected ${expectedEvtId}` : 'short link did not resolve' });
    } else {
      outcomes.push({ ...pair, outcome: 'confirmed' });
    }
  }

  // Which side is the pipeline copy: a row whose link matches an
  // `ingest_candidates` row (status approved/auto_published) for this
  // conference. Fetched once per tab, not per pair.
  const supabase = getIngestSupabase();
  const { data: candidateRows, error } = await supabase
    .from('ingest_candidates')
    .select('*')
    .eq('conference', tab.name)
    .in('status', ['approved', 'auto_published']);
  if (error) throw new Error(`Failed to list ingest_candidates for "${tab.name}": ${error.message}`);
  const candidates = (candidateRows ?? []) as IngestCandidateRow[];
  const candidateByLinkKey = new Map<string, IngestCandidateRow>();
  for (const c of candidates) {
    const key = normalizeEventLink(c.event?.link);
    if (key && !candidateByLinkKey.has(key)) candidateByLinkKey.set(key, c);
  }

  const confirmed = outcomes.filter((o) => o.outcome === 'confirmed');
  const unconfirmed = outcomes.filter((o) => o.outcome === 'unconfirmed');

  type Actionable = { outcome: PairOutcome; pipelineRow: SheetEventRow; curatorRow: SheetEventRow; pipelineCandidate: IngestCandidateRow };
  const actionable: Actionable[] = [];
  const ambiguousPipeline: PairOutcome[] = [];

  for (const o of confirmed) {
    const shortKey = classifyLink(o.shortRow.link).key;
    const evtKey = classifyLink(o.evtRow.link).key;
    const shortIsPipeline = shortKey ? candidateByLinkKey.has(shortKey) : false;
    const evtIsPipeline = evtKey ? candidateByLinkKey.has(evtKey) : false;

    if (shortIsPipeline === evtIsPipeline) {
      // Both or neither — never guess.
      ambiguousPipeline.push(o);
      continue;
    }
    const pipelineRow = shortIsPipeline ? o.shortRow : o.evtRow;
    const curatorRow = shortIsPipeline ? o.evtRow : o.shortRow;
    const pipelineKey = shortIsPipeline ? shortKey : evtKey;
    const pipelineCandidate = pipelineKey ? candidateByLinkKey.get(pipelineKey) : undefined;
    if (!pipelineCandidate) {
      ambiguousPipeline.push(o);
      continue;
    }
    actionable.push({ outcome: o, pipelineRow, curatorRow, pipelineCandidate });
  }

  // --- Report ---------------------------------------------------------
  console.log(`\n--- Dry-run table: ${tab.name} ---`);
  console.log(
    'name | date | curator row/link | pipeline row/link | note/food/bar differences (pipeline has, curator lacks)'
  );
  for (const a of actionable) {
    const noteDiff = a.pipelineRow.note && !a.curatorRow.note ? `note="${a.pipelineRow.note}"` : null;
    const foodDiff = a.pipelineRow.food && !a.curatorRow.food ? 'food' : null;
    const barDiff = a.pipelineRow.bar && !a.curatorRow.bar ? 'bar' : null;
    const diffs = [noteDiff, foodDiff, barDiff].filter(Boolean).join(', ') || '(none)';
    console.log(
      `${a.outcome.name} | ${a.outcome.dateISO} | ${fmtRow(a.curatorRow)} | ${fmtRow(a.pipelineRow)} [DELETE] | ${diffs}`
    );
  }
  if (actionable.length === 0) console.log('(no confirmed, actionable pairs)');

  console.log(`\nUnconfirmed (${unconfirmed.length}) — left untouched:`);
  for (const o of unconfirmed) {
    console.log(`  ${o.name} | ${o.dateISO} | ${fmtRow(o.shortRow)} vs ${fmtRow(o.evtRow)} — ${o.reason}`);
  }

  const ambiguousCount = ambiguousGroups.length + ambiguousPipeline.length;
  console.log(`\nAmbiguous (${ambiguousCount}) — left untouched:`);
  for (const g of ambiguousGroups) {
    console.log(`  group of ${g.length}: ${g.map(fmtRow).join(', ')} (same name+date, not a clean short/evt- pair)`);
  }
  for (const o of ambiguousPipeline) {
    console.log(`  ${o.name} | ${o.dateISO} | ${fmtRow(o.shortRow)} vs ${fmtRow(o.evtRow)} — both or neither side matches an approved/auto_published candidate`);
  }

  if (dryRun) {
    console.log(`\n[dry run] ${tab.name}: would delete ${actionable.length} pipeline row(s). Nothing written.`);
    return;
  }

  if (actionable.length === 0) {
    console.log(`\n${tab.name}: nothing to delete.`);
    return;
  }

  // Delete bottom-up (highest absolute row first) so earlier row numbers
  // for rows ABOVE a deleted row stay valid.
  const sorted = [...actionable].sort((x, y) => y.pipelineRow.absoluteRow - x.pipelineRow.absoluteRow);
  for (const a of sorted) {
    console.log(`Deleting ${tab.name} row ${a.pipelineRow.absoluteRow} (${a.pipelineRow.link})...`);
    await deleteSheetRow(tab.gid, a.pipelineRow.absoluteRow - 1); // 0-based
  }

  for (const a of actionable) {
    const curatorEventId = generateEventId(tab.name, a.curatorRow.date, a.curatorRow.startTime, a.curatorRow.name);
    await updateCandidate(a.pipelineCandidate.id, {
      status: 'duplicate',
      duplicate_of: curatorEventId,
      review_note:
        `scripts/dedupe-sheet-pipeline-copies.ts: this candidate's published row was a pipeline copy of the ` +
        `curator's short-link row (sheet row ${a.curatorRow.absoluteRow}, "${a.curatorRow.name}" on ${a.curatorRow.dateISO}). ` +
        `Removed from the sheet; the stale ingest_link_cache incident (2026-10-16) hid this from the normal dedupe guard.`,
    });
  }

  console.log(`\n${tab.name}: deleted ${actionable.length} pipeline row(s) and marked their candidates duplicate.`);
  console.log(
    'Note: this script runs out-of-process, so the live app\'s in-memory events cache ' +
      '(`fetch-events-cached.ts#invalidateEventsCache`, a Next.js `revalidateTag` call) has no reachable path from ' +
      'here — it will refresh on its own 5-minute TTL.'
  );
}

async function main() {
  const { gid, dryRun } = parseArgs(process.argv.slice(2));

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
    process.exit(1);
  }
  if (dryRun) {
    console.log('Running with --dry-run: nothing will be written.');
  } else {
    console.warn('Running WITHOUT --dry-run — this will delete sheet rows and update ingest_candidates.');
  }

  const allTabs = await getAllConferenceTabs();
  const tabs = gid !== undefined ? allTabs.filter((t) => t.gid === gid) : allTabs;
  if (gid !== undefined && tabs.length === 0) {
    console.error(`No configured conference tab with gid ${gid}.`);
    process.exit(1);
  }

  for (const tab of tabs) {
    await processTab(tab, dryRun);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
