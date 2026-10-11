// Reconcile published candidates against the live sheet, by link (§4 "Reconcile
// step each run"). Event IDs drift when a curator edits name/date/time
// (same caveat as #177), so matching by link (not id) is the only thing that
// survives that.
import { fetchEvents } from '../fetch-events';
import type { TabConfig } from '../conferences';
import { buildSheetLinkIndex, findSheetMatchByLink } from './dedupe';
import { listCandidates, updateCandidate, insertLabel } from './db';
import type { IngestCandidateRow, ThemeKey } from './types';

export interface ReconcileResult {
  checked: number;
  linked: number;
  unpublishedExternal: number;
}

/**
 * Re-read the sheet (uncached) for one conference's tab and reconcile every
 * `auto_published`/`approved` candidate against it:
 * - found by link, missing `published_event_id` -> fill it in.
 * - not found at all -> the curator deleted it: `unpublished_external` +
 *   an implicit `off_theme` label (`source: 'sheet_removed'`), lower weight
 *   than an explicit review decision (handled by the caller/few-shot
 *   selection in Phase 2, not here).
 */
export async function reconcileConference(tab: TabConfig, themeKey: ThemeKey): Promise<ReconcileResult> {
  const sheetEvents = await fetchEvents(undefined, [tab]);
  const linkIndex = await buildSheetLinkIndex(
    sheetEvents.map((e) => ({ id: e.id, link: e.link })),
    { maxResolutions: 50 }
  );

  const published = await listCandidates({
    conference: tab.name,
    status: ['auto_published', 'approved'],
    limit: 2000,
  });

  let linked = 0;
  let unpublishedExternal = 0;

  for (const candidate of published) {
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

  return { checked: published.length, linked, unpublishedExternal };
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
  });
}
