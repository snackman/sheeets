// Event-ingestion cron (§7, §8). Runs every due enabled source, oldest
// `last_run_at` first, until a wall-clock deadline, then exits — the next
// run picks up where this one stopped. Vercel: `sheeets` is on the Pro plan
// (confirmed via `vercel project inspect` / team billing — see PR
// description), so `vercel.json` schedules this every 4 hours; this handler
// additionally skips any conference outside its active window
// (`startDate - 60 days` through `endDate`) so off-season runs are nearly
// free even if triggered manually.
import { NextResponse } from 'next/server';
import { isCronSecret } from '@/lib/admin-auth';
import { getAllConferenceTabs } from '@/lib/get-conferences';
import { listDueSources, listProfiles, reapStaleRunningRuns } from '@/lib/ingest/db';
import { sweepDuplicateRows, type SweepResult } from '@/lib/ingest/dedupe-sweep';
import { invalidateEventsCache } from '@/lib/fetch-events-cached';
import { runSource } from '@/lib/ingest/pipeline';
import { isInActiveWindow } from '@/lib/ingest/active-window';

export const runtime = 'nodejs';
export const maxDuration = 300;

const OVERALL_DEADLINE_MS = 270_000; // leave margin under maxDuration=300
const SWEEP_DEADLINE_MS = 60_000; // the sweep may use at most the first minute

export async function GET(req: Request) {
  if (!isCronSecret(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const reaped = await reapStaleRunningRuns();

  // Phase 4: also poll X accounts, Meetup searches and sponsor event
  // pages — `runSource` itself skips an `x_account`/`meetup_search` source
  // cleanly (status 'skipped', not 'error') when its credentials aren't
  // configured, so listing them here is harmless even on a deploy with no
  // `X_BEARER_TOKEN`/Meetup OAuth set. `host_submission` sources are
  // intentionally excluded — they are passive (fed by
  // `POST /api/host/submissions`), never polled. Mira series and sheet
  // trackers poll the same way as sponsor pages — no credentials needed.
  const [sources, tabs] = await Promise.all([
    listDueSources(['luma_ical', 'telegram_channel', 'x_account', 'meetup_search', 'sponsor_pages', 'mira_series', 'sheet_tracker']),
    getAllConferenceTabs(),
  ]);
  const todayISO = new Date().toISOString().slice(0, 10);

  const results: { sourceId: string; conference: string; status: string; skippedReason?: string }[] = [];
  const startedAt = Date.now();

  // Dedupe sweep: for each active conference with an ingest profile, delete
  // pipeline-published rows that a hand-added row has since duplicated.
  // Runs BEFORE the sources so this run's reconcile sees the post-sweep
  // sheet. Bounded (25 deletes/conference, shares the overall deadline) and
  // failure-tolerant (sweepDuplicateRows never throws; the outer catch is
  // belt and suspenders) — a sheet error must never fail the ingest run.
  const sweeps: SweepResult[] = [];
  try {
    const profileNames = new Set((await listProfiles()).map((p) => p.conference));
    for (const tab of tabs) {
      if (Date.now() - startedAt > SWEEP_DEADLINE_MS) break;
      const startDate = tab.dates?.[0];
      const endDate = tab.dates?.[tab.dates.length - 1];
      if (!profileNames.has(tab.name) || !startDate || !endDate || !isInActiveWindow(startDate, endDate, todayISO)) continue;
      sweeps.push(await sweepDuplicateRows(tab));
    }
    if (sweeps.some((s) => s.removed > 0)) invalidateEventsCache();
  } catch (err) {
    console.warn(`[ingest cron] dedupe sweep failed: ${err instanceof Error ? err.message : err}`);
  }
  const sweptRemoved = sweeps.reduce((n, s) => n + s.removed, 0);
  console.log(`[ingest cron] dedupe sweep removed ${sweptRemoved} duplicate row(s) across ${sweeps.length} conference(s)`);

  for (const source of sources) {
    if (Date.now() - startedAt > OVERALL_DEADLINE_MS) {
      results.push({ sourceId: source.id, conference: source.conference, status: 'skipped', skippedReason: 'overall_deadline' });
      continue;
    }

    const tab = tabs.find((t) => t.name === source.conference);
    const startDate = tab?.dates?.[0];
    const endDate = tab?.dates?.[tab.dates.length - 1];
    if (!tab || !startDate || !endDate || !isInActiveWindow(startDate, endDate, todayISO)) {
      results.push({ sourceId: source.id, conference: source.conference, status: 'skipped', skippedReason: 'outside_active_window' });
      continue;
    }

    const remaining = OVERALL_DEADLINE_MS - (Date.now() - startedAt);
    try {
      const result = await runSource(source.id, { trigger: 'cron', deadlineMs: Math.max(5000, remaining) });
      results.push({ sourceId: source.id, conference: source.conference, status: result.status });
    } catch (err) {
      results.push({
        sourceId: source.id,
        conference: source.conference,
        status: 'error',
        skippedReason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({ reapedStaleRuns: reaped, dedupeSweep: { removed: sweptRemoved, conferences: sweeps }, ran: results.length, results });
}
