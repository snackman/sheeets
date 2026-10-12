// Event-ingestion cron (§7, §8). Runs every due enabled source, oldest
// `last_run_at` first, until a wall-clock deadline, then exits — the next
// run picks up where this one stopped. Vercel: `sheeets` is on the Pro plan
// (confirmed via `vercel project inspect` / team billing — see PR
// description), so `vercel.json` schedules this every 4 hours; this handler
// additionally skips any conference outside its active window
// (`startDate - 30 days` through `endDate`) so off-season runs are nearly
// free even if triggered manually.
import { NextResponse } from 'next/server';
import { isCronSecret } from '@/lib/admin-auth';
import { getAllConferenceTabs } from '@/lib/get-conferences';
import { listDueSources, reapStaleRunningRuns } from '@/lib/ingest/db';
import { runSource } from '@/lib/ingest/pipeline';

export const runtime = 'nodejs';
export const maxDuration = 300;

const OVERALL_DEADLINE_MS = 270_000; // leave margin under maxDuration=300
const ACTIVE_WINDOW_PRE_DAYS = 30;

function isInActiveWindow(startDate: string, endDate: string, todayISO: string): boolean {
  const start = new Date(startDate + 'T00:00:00Z');
  start.setUTCDate(start.getUTCDate() - ACTIVE_WINDOW_PRE_DAYS);
  const windowStart = start.toISOString().slice(0, 10);
  return todayISO >= windowStart && todayISO <= endDate;
}

export async function GET(req: Request) {
  if (!isCronSecret(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const reaped = await reapStaleRunningRuns();

  const [sources, tabs] = await Promise.all([listDueSources('luma_ical'), getAllConferenceTabs()]);
  const todayISO = new Date().toISOString().slice(0, 10);

  const results: { sourceId: string; conference: string; status: string; skippedReason?: string }[] = [];
  const startedAt = Date.now();

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

  return NextResponse.json({ reapedStaleRuns: reaped, ran: results.length, results });
}
