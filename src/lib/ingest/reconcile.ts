// Reconcile published candidates against the live sheet, by link (§4 "Reconcile
// step each run"). Event IDs drift when a curator edits name/date/time
// (same caveat as #177), so matching by link (not id) is the only thing that
// survives that.
import type { TabConfig } from '../conferences';
import { canonicalKeyForEvent, findSheetMatchByLink, type SheetLinkEntry, type SheetLinkIndex } from './dedupe';
import { listCandidates, updateCandidate, insertLabel } from './db';
import type { IngestCandidateRow, ThemeKey } from './types';

export interface ReconcileResult {
  checked: number;
  linked: number;
  unpublishedExternal: number;
  skipped: boolean;
  skippedReason?: string;
}

/**
 * A sheet read returning far fewer events than we've already published is
 * more likely a bad/partial read (a gviz hiccup, an empty-rows bug — see
 * `fetchEvents`) than hundreds of curators simultaneously deleting rows.
 * Treating that as "everyone unpublished everything" would be a disaster
 * (review finding, MEDIUM item 8), so reconcile bails out instead.
 */
const MIN_SHEET_EVENTS_RATIO = 0.5;

/**
 * Reconcile every `auto_published`/`approved` candidate for one conference
 * against the current sheet, by link:
 * - found by link, missing/stale `published_event_id` -> fill it in.
 * - not found at all -> the curator deleted it: `unpublished_external` +
 *   an implicit `off_theme` label (`source: 'sheet_removed'`, excluded from
 *   few-shot — it's a weak signal, see `writeRemovedLabel`).
 *
 * Takes the sheet events + link index the caller already built this run
 * (pipeline.ts builds one and reuses it here) rather than re-fetching and
 * re-resolving — avoids a second uncached sheet read and a second round of
 * rate-limited Luma slug lookups (review finding, MEDIUM item 7).
 */
export async function reconcileConference(
  tab: TabConfig,
  themeKey: ThemeKey,
  sheetEvents: SheetLinkEntry[],
  linkIndex: SheetLinkIndex,
  /** When the caller's sheet snapshot was fetched. Candidates published or
   *  reviewed after this are NOT judged against it: the snapshot predates
   *  their sheet row, so absence proves nothing (an admin approve landing
   *  mid-run must not be marked `unpublished_external`). */
  snapshotAt: Date = new Date()
): Promise<ReconcileResult> {
  const published = await listCandidates({
    conference: tab.name,
    status: ['auto_published', 'approved'],
    limit: 2000,
  });

  if (sheetEvents.length === 0) {
    return { checked: published.length, linked: 0, unpublishedExternal: 0, skipped: true, skippedReason: 'sheet read returned 0 events' };
  }
  if (published.length > 0 && sheetEvents.length < published.length * MIN_SHEET_EVENTS_RATIO) {
    return {
      checked: published.length,
      linked: 0,
      unpublishedExternal: 0,
      skipped: true,
      skippedReason: `sheet read returned ${sheetEvents.length} events, suspiciously small vs ${published.length} already-published candidates`,
    };
  }

  let linked = 0;
  let unpublishedExternal = 0;

  for (const candidate of published) {
    // Can't verify a candidate with no resolvable link key — never flag it
    // as removed just because we couldn't check (review finding, item 8).
    if (!canonicalKeyForEvent(candidate.event)) continue;

    // Published/approved after the snapshot was taken -> can't be judged.
    const touchedAt = Math.max(
      candidate.published_at ? Date.parse(candidate.published_at) : 0,
      candidate.reviewed_at ? Date.parse(candidate.reviewed_at) : 0
    );
    if (touchedAt > snapshotAt.getTime()) continue;

    const match = findSheetMatchByLink(linkIndex, candidate.event);
    if (match) {
      if (!candidate.published_event_id || candidate.published_event_id !== match.id) {
        await updateCandidate(candidate.id, { published_event_id: match.id });
        linked++;
      }
      continue;
    }

    // Not found: the curator removed it from the sheet.
    await updateCandidate(candidate.id, { status: 'unpublished_external' });
    await writeRemovedLabel(candidate, themeKey);
    unpublishedExternal++;
  }

  return { checked: published.length, linked, unpublishedExternal, skipped: false };
}

async function writeRemovedLabel(candidate: IngestCandidateRow, themeKey: ThemeKey): Promise<void> {
  await insertLabel({
    candidate_id: candidate.id,
    conference: candidate.conference,
    theme_key: themeKey,
    label: 'off_theme',
    label_kind: 'theme',
    source: 'sheet_removed',
    reason: 'Removed from the sheet after being published by ingestion.',
    example: { name: candidate.event.name, hosts: candidate.event.hosts.map((h) => h.name) },
    model_score: candidate.llm_score,
    model_route: candidate.route,
    // A curator deleting a published row is too noisy/ambiguous a signal
    // (off-theme? duplicate? stale event?) to train the few-shot selector
    // on by default (review finding, MEDIUM item 8).
    excluded_from_fewshot: true,
  });
}
