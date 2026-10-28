// Post-publish dedupe sweep. The publish/approve guards only dedupe at
// insert time, so a team member bulk-importing a Luma calendar into a tab
// AFTER the pipeline published its own row creates a duplicate (Oct 26 2026:
// 47 manual deletions on Devcon 8 / Solana Breakpoint). This sweep finds
// those and removes the PIPELINE's row, keeping the hand-added one.
//
// Safety rules, all enforced by the pure `findSweepMatches`:
// - Only a row whose link is EXACTLY a published candidate's link is ever a
//   deletion target (the pipeline's own row). Hand-added rows are never
//   deleted, and two hand-added rows duplicating each other are ignored.
// - If that exact link appears on more than one row, we can't tell which is
//   ours, so nothing is deleted.
// - Rows at/below the curator staging section ("Add Events Here") are ignored.
import type { TabConfig } from '../conferences';
import { normalizeEventLink } from '../luma';
import { deleteSheetRow, getSheetTitle, readRange } from '../google-sheets';
import { claimCandidateStatus, listCandidates, updateCandidate } from './db';
import { normalizeNameForDuplicateCheck } from './dedupe';
import type { IngestCandidateRow } from './types';

/** Max pipeline rows removed per conference per sweep (bounded blast radius). */
export const MAX_SWEEP_DELETES_PER_CONFERENCE = 25;
const DELETE_PACING_MS = 1000;

const COL_DATE = 0;
const COL_NAME = 4;
const COL_LINK = 8;

export type SweepCandidate = Pick<IngestCandidateRow, 'id' | 'canonical_key' | 'alt_keys' | 'status'> & Partial<Pick<IngestCandidateRow, 'review_note'>> & {
  event: Pick<IngestCandidateRow['event'], 'link' | 'name' | 'dateISO' | 'sheetDate'>;
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

/** Rows of the main section only: stops at the staging marker. */
function mainSectionRows(rows: string[][]): SheetRow[] {
  const out: SheetRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] ?? [];
    if ((r[COL_DATE] ?? '').trim().toLowerCase().startsWith('add events here')) break;
    const link = (r[COL_LINK] ?? '').trim();
    if (!/^https?:\/\//i.test(link)) continue; // header, blank, or link-less row
    out.push({ rowIndex: i, date: r[COL_DATE] ?? '', name: r[COL_NAME] ?? '', link });
  }
  return out;
}

export function findSweepMatches(rows: string[][], candidates: SweepCandidate[]): SweepMatch[] {
  const sheet = mainSectionRows(rows);
  const published = candidates.filter(
    (c) => (c.status === 'approved' || c.status === 'auto_published') && !!c.event.link
  );
  const pipelineLinks = new Set(published.map((c) => c.event.link.trim()));
  const matches: SweepMatch[] = [];
  const handled = new Set<string>();

  for (const cand of published) {
    if (handled.has(cand.id)) continue;
    const link = cand.event.link.trim();
    const own = sheet.filter((r) => r.link === link);
    if (own.length !== 1) continue; // not on this tab, or ambiguous which row is ours
    const ownRow = own[0];

    const keys = new Set([cand.canonical_key, ...(cand.alt_keys ?? [])].map((k) => k.toLowerCase()));
    const candName = normalizeNameForDuplicateCheck(cand.event.name);

    let found: SweepMatch | null = null;
    for (const r of sheet) {
      if (r.rowIndex === ownRow.rowIndex) continue;
      if (pipelineLinks.has(r.link)) continue; // another pipeline row, not hand-added
      const key = normalizeEventLink(r.link);
      if (key && keys.has(key)) {
        found = { candidateId: cand.id, rowIndex: ownRow.rowIndex, pipelineLink: link, handAddedLink: r.link, handAddedRowIndex: r.rowIndex, reason: 'slug' };
        break;
      }
      if (
        !found &&
        candName &&
        normalizeNameForDuplicateCheck(r.name) === candName &&
        sameDate(r.date, cand.event)
      ) {
        found = { candidateId: cand.id, rowIndex: ownRow.rowIndex, pipelineLink: link, handAddedLink: r.link, handAddedRowIndex: r.rowIndex, reason: 'name_date' };
        // keep looking: a slug match is a stronger reason
      }
    }
    if (found) {
      matches.push(found);
      handled.add(cand.id);
    }
  }
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
}

const defaultDeps: SweepDeps = {
  listCandidates,
  claimCandidateStatus,
  updateCandidate,
  getSheetTitle,
  readRange,
  deleteSheetRow,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

/**
 * Sweep one conference tab. Never throws: any failure is logged and counted
 * so it can't fail the surrounding ingest run.
 */
export async function sweepDuplicateRows(
  tab: Pick<TabConfig, 'gid' | 'name'>,
  deps: SweepDeps = defaultDeps,
  maxDeletes = MAX_SWEEP_DELETES_PER_CONFERENCE
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

    for (const m of todo) {
      const cand = candidates.find((c) => c.id === m.candidateId)!;
      try {
        // Fresh read right before deleting: rows shift, people edit concurrently.
        const fresh = await deps.readRange(sheetName, 'A1:M');
        const again = findSweepMatches(fresh, [cand]).find((x) => x.candidateId === cand.id && x.pipelineLink === m.pipelineLink);
        if (!again) {
          result.skipped++;
          continue;
        }
        // Claim the status first so reconcile never sees a published
        // candidate whose row vanished (-> unpublished_external, a failure
        // for the kill switch). Revert if the delete fails.
        const claimed = await deps.claimCandidateStatus(cand.id, ['approved', 'auto_published'], 'duplicate', {
          duplicate_of: again.handAddedLink,
          review_note: `Swept: pipeline row removed, duplicate of hand-added ${again.handAddedLink} (${again.reason}) on ${new Date().toISOString().slice(0, 10)}`,
        });
        if (!claimed) {
          result.skipped++;
          continue;
        }
        try {
          await deps.deleteSheetRow(tab.gid, again.rowIndex);
        } catch (err) {
          await deps.updateCandidate(cand.id, { status: cand.status, duplicate_of: null, review_note: cand.review_note ?? null }).catch(() => {});
          throw err;
        }
        result.removed++;
        await deps.sleep(DELETE_PACING_MS);
      } catch (err) {
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
