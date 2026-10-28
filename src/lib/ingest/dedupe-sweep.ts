// Post-publish dedupe sweep. The publish/approve guards only dedupe at
// insert time, so a team member bulk-importing a Luma calendar into a tab
// AFTER the pipeline published its own row creates a duplicate (Oct 26 2026:
// 47 manual deletions on Devcon 8 / Solana Breakpoint). This sweep finds
// those and removes the PIPELINE's row, keeping the hand-added one.
//
// Safety rules (best-effort heuristics; every doubt resolves to "skip"):
// - A row is only ever treated as the pipeline's own if its link is EXACTLY
//   a published candidate's link, it is the only row with that link, AND its
//   name + start time still match the candidate's event. A curator who
//   edited the pipeline row, or re-used the same URL, is skipped, not deleted.
// - Hand-added rows are never deleted; hand-added duplicates of each other
//   are ignored.
// - Matching is 1:1: one hand-added row justifies removing at most one
//   pipeline row.
// - name+date matches additionally need the same start time and are
//   suppressed when the two links are known to be different Luma events.
// - Rows at/below the curator staging section ("Add Events Here") are ignored.
import type { TabConfig } from '../conferences';
import { normalizeEventLink, LUMA_EVENT_API_ID_RE } from '../luma';
import { deleteSheetRow, getSheetTitle, readRange } from '../google-sheets';
import { claimCandidateStatus, listCandidates, updateCandidate } from './db';
import { normalizeNameForDuplicateCheck } from './dedupe';
import type { IngestCandidateRow } from './types';

/** Max pipeline rows removed per conference per sweep (bounded blast radius). */
export const MAX_SWEEP_DELETES_PER_CONFERENCE = 25;
const DELETE_PACING_MS = 1000;

const COL_DATE = 0;
const COL_START = 1;
const COL_NAME = 4;
const COL_LINK = 8;

export type SweepCandidate = Pick<IngestCandidateRow, 'id' | 'canonical_key' | 'alt_keys' | 'status'> &
  Partial<Pick<IngestCandidateRow, 'review_note'>> & {
    event: Pick<IngestCandidateRow['event'], 'link' | 'name' | 'dateISO' | 'sheetDate'> & { startTime?: string };
  };

export interface SweepMatch {
  candidateId: string;
  /** 0-based index of the pipeline row in the rows array that was given. */
  rowIndex: number;
  /** The pipeline's own link (what the row is located by before deleting). */
  pipelineLink: string;
  handAddedLink: string;
  handAddedRowIndex: number;
  reason: 'slug' | 'name_date';
}

interface SheetRow {
  rowIndex: number;
  date: string;
  start: string;
  name: string;
  link: string;
}

function squash(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function sameDate(cell: string, event: { dateISO: string; sheetDate: string }): boolean {
  const c = cell.trim();
  if (!c) return false;
  if (c === event.dateISO) return true;
  const a = squash(c);
  return !!a && a === squash(event.sheetDate);
}

function sameStart(cell: string, startTime: string | undefined): boolean {
  const a = squash(cell);
  const b = squash(startTime ?? '');
  return !!a && !!b && a === b;
}

/** Rows of the main section only: stops at the staging marker (same
 *  `includes('Add Events Here')` test as google-sheets.ts). */
function mainSectionRows(rows: string[][]): SheetRow[] {
  const out: SheetRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] ?? [];
    if ((r[COL_DATE] ?? '').includes('Add Events Here')) break;
    const link = (r[COL_LINK] ?? '').trim();
    if (!/^https?:\/\//i.test(link)) continue; // header, blank, or link-less row
    out.push({ rowIndex: i, date: r[COL_DATE] ?? '', start: r[COL_START] ?? '', name: r[COL_NAME] ?? '', link });
  }
  return out;
}

/** True when two links are KNOWN to be different Luma events (so a
 *  name+date coincidence must not merge them). Slugs can't be resolved to
 *  evt- ids here, so only provable cases count. */
function knownDistinctLumaEvents(handKey: string | null, cand: SweepCandidate): boolean {
  if (!handKey || !handKey.startsWith('luma:')) return false;
  const candKeys = [cand.canonical_key, ...(cand.alt_keys ?? [])].map((k) => k.toLowerCase()).filter((k) => k.startsWith('luma:'));
  if (candKeys.includes(handKey)) return false;
  const isEvt = (k: string) => LUMA_EVENT_API_ID_RE.test(k.slice('luma:'.length));
  if (isEvt(handKey)) return candKeys.some(isEvt); // two different evt- ids
  return candKeys.some((k) => !isEvt(k)); // two different known vanity slugs
}

export function findSweepMatches(rows: string[][], candidates: SweepCandidate[]): SweepMatch[] {
  const sheet = mainSectionRows(rows);
  const published = candidates.filter(
    (c) => (c.status === 'approved' || c.status === 'auto_published') && !!c.event.link
  );
  const pipelineLinks = new Set(published.map((c) => c.event.link.trim()));

  // Identify each candidate's own row (strictly).
  const owned: { cand: SweepCandidate; row: SheetRow; link: string }[] = [];
  for (const cand of published) {
    const link = cand.event.link.trim();
    const same = sheet.filter((r) => r.link === link);
    if (same.length !== 1) continue; // not on this tab, or ambiguous which row is ours
    const row = same[0];
    if (normalizeNameForDuplicateCheck(row.name) !== normalizeNameForDuplicateCheck(cand.event.name)) continue;
    if (!sameStart(row.start, cand.event.startTime)) continue;
    owned.push({ cand, row, link });
  }

  const matches: SweepMatch[] = [];
  const usedHand = new Set<number>();
  const doneCand = new Set<string>();

  const attempt = (reason: 'slug' | 'name_date') => {
    for (const { cand, row, link } of owned) {
      if (doneCand.has(cand.id)) continue;
      const keys = new Set([cand.canonical_key, ...(cand.alt_keys ?? [])].map((k) => k.toLowerCase()));
      const candName = normalizeNameForDuplicateCheck(cand.event.name);
      for (const r of sheet) {
        if (r.rowIndex === row.rowIndex || usedHand.has(r.rowIndex)) continue;
        if (pipelineLinks.has(r.link)) continue; // another pipeline row, not hand-added
        const key = normalizeEventLink(r.link);
        let ok = false;
        if (reason === 'slug') {
          ok = !!key && keys.has(key);
        } else {
          ok =
            !!candName &&
            normalizeNameForDuplicateCheck(r.name) === candName &&
            sameDate(r.date, cand.event) &&
            sameStart(r.start, cand.event.startTime) &&
            !knownDistinctLumaEvents(key, cand);
        }
        if (!ok) continue;
        usedHand.add(r.rowIndex);
        doneCand.add(cand.id);
        matches.push({ candidateId: cand.id, rowIndex: row.rowIndex, pipelineLink: link, handAddedLink: r.link, handAddedRowIndex: r.rowIndex, reason });
        break;
      }
    }
  };
  attempt('slug'); // strongest evidence first, so name+date can't steal a hand row
  attempt('name_date');
  return matches;
}

export interface SweepResult {
  conference: string;
  candidatesChecked: number;
  found: number;
  removed: number;
  skipped: number;
  errors: number;
}

export interface SweepDeps {
  listCandidates: typeof listCandidates;
  claimCandidateStatus: typeof claimCandidateStatus;
  updateCandidate: typeof updateCandidate;
  getSheetTitle: typeof getSheetTitle;
  readRange: typeof readRange;
  deleteSheetRow: typeof deleteSheetRow;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

const defaultDeps: SweepDeps = {
  listCandidates,
  claimCandidateStatus,
  updateCandidate,
  getSheetTitle,
  readRange,
  deleteSheetRow,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => Date.now(),
};

/**
 * Sweep one conference tab. Never throws: any failure is logged and counted
 * so it can't fail the surrounding ingest run. `deadlineAt` (epoch ms) is
 * checked before every delete.
 */
export async function sweepDuplicateRows(
  tab: Pick<TabConfig, 'gid' | 'name'>,
  deps: SweepDeps = defaultDeps,
  maxDeletes = MAX_SWEEP_DELETES_PER_CONFERENCE,
  deadlineAt: number = Infinity
): Promise<SweepResult> {
  const result: SweepResult = { conference: tab.name, candidatesChecked: 0, found: 0, removed: 0, skipped: 0, errors: 0 };
  try {
    const candidates = (await deps.listCandidates({
      conference: tab.name,
      status: ['approved', 'auto_published'],
      limit: 2000,
    })) as SweepCandidate[];
    result.candidatesChecked = candidates.length;
    if (candidates.length === 0) return result;

    const sheetName = await deps.getSheetTitle(tab.gid);
    const rows = await deps.readRange(sheetName, 'A1:M');
    const matches = findSweepMatches(rows, candidates);
    result.found = matches.length;
    if (matches.length === 0) return result;

    // Bottom-up, and capped.
    const todo = matches.sort((a, b) => b.rowIndex - a.rowIndex).slice(0, maxDeletes);
    result.skipped += matches.length - todo.length;

    for (const [i, m] of todo.entries()) {
      if (deps.now() > deadlineAt) {
        result.skipped += todo.length - i;
        break;
      }
      const cand = candidates.find((c) => c.id === m.candidateId)!;
      let claimed = false;
      try {
        // Claim the status FIRST so reconcile never sees a published
        // candidate whose row vanished (-> unpublished_external, a failure
        // for the kill switch). Then re-read, re-locate and delete with no
        // DB round-trip in between (rows shift; people edit concurrently).
        claimed = !!(await deps.claimCandidateStatus(cand.id, ['approved', 'auto_published'], 'duplicate', {
          duplicate_of: m.handAddedLink,
          review_note: `Swept: pipeline row removed, duplicate of hand-added ${m.handAddedLink} (${m.reason}) on ${new Date().toISOString().slice(0, 10)}`,
        }));
        if (!claimed) {
          result.skipped++;
          continue;
        }
        const fresh = await deps.readRange(sheetName, 'A1:M');
        const again = findSweepMatches(fresh, candidates).find(
          (x) => x.candidateId === cand.id && x.pipelineLink === m.pipelineLink && x.handAddedLink === m.handAddedLink
        );
        if (!again) {
          await revert(deps, cand);
          claimed = false;
          result.skipped++;
          continue;
        }
        await deps.deleteSheetRow(tab.gid, again.rowIndex);
        claimed = false; // done; nothing to revert
        result.removed++;
        await deps.sleep(DELETE_PACING_MS);
      } catch (err) {
        if (claimed) await revert(deps, cand);
        result.errors++;
        console.warn(`[ingest dedupe-sweep] ${tab.name}: failed on candidate ${m.candidateId}: ${err instanceof Error ? err.message : err}`);
      }
    }
  } catch (err) {
    result.errors++;
    console.warn(`[ingest dedupe-sweep] ${tab.name}: sweep failed: ${err instanceof Error ? err.message : err}`);
  }
  console.log(`[ingest dedupe-sweep] ${tab.name}: removed ${result.removed} (found ${result.found}, skipped ${result.skipped}, errors ${result.errors})`);
  return result;
}

async function revert(deps: SweepDeps, cand: SweepCandidate): Promise<void> {
  await deps.updateCandidate(cand.id, { status: cand.status, duplicate_of: null, review_note: cand.review_note ?? null }).catch(() => {});
}
