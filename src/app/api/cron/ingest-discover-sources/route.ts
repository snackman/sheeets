// Calendar auto-discovery cron (plan item 3) — a SEPARATE, once-per-day
// cron entry (see `vercel.json`) from `/api/cron/ingest` (every 4 hours):
// for each active conference with ingestion enabled, finds Luma calendars
// worth proposing as new curated sources and writes `ingest_source_proposals`
// rows for an admin to accept/dismiss in the Config tab. NEVER creates a
// real `ingest_sources` row itself — see `discoverCalendarSources`'s doc
// comment and the admin accept flow
// (`POST /api/admin/ingest/source-proposals`).
import { NextResponse } from 'next/server';
import { isCronSecret } from '@/lib/admin-auth';
import { getAllConferenceTabs } from '@/lib/get-conferences';
import { getProfile } from '@/lib/ingest/db';
import { discoverCalendarSources } from '@/lib/ingest/discover-calendars';
import { isInActiveWindow } from '@/lib/ingest/active-window';

export const runtime = 'nodejs';
export const maxDuration = 300;

const OVERALL_DEADLINE_MS = 270_000; // leave margin under maxDuration=300
// Each conference's two phases (resolve candidates' calendars, then
// evaluate them) get this much time EACH by default — see
// `discoverCalendarSources`'s doc comment (review finding, HIGH item B:
// phase 1 alone used to be able to consume an entire shared deadline,
// so phase 2 never ran at all).
const PHASE_DEADLINE_MS = 20_000;
/** Floor so neither phase is ever squeezed to ~0ms when the OVERALL
 *  cron deadline is running low across many conferences — a late
 *  conference in the loop still gets a meaningful (if reduced) shot at
 *  both phases rather than phase 2 being starved again, just by a
 *  different cause. */
const MIN_PHASE_DEADLINE_MS = 2500;

export async function GET(req: Request) {
  if (!isCronSecret(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const tabs = await getAllConferenceTabs();
  const todayISO = new Date().toISOString().slice(0, 10);
  const startedAt = Date.now();

  const results: { conference: string; status: string; skippedReason?: string; proposalsWritten?: number; error?: string }[] = [];

  for (const tab of tabs) {
    if (Date.now() - startedAt > OVERALL_DEADLINE_MS) {
      results.push({ conference: tab.name, status: 'skipped', skippedReason: 'overall_deadline' });
      continue;
    }
    const startDate = tab.dates?.[0];
    const endDate = tab.dates?.[tab.dates.length - 1];
    if (!startDate || !endDate || !isInActiveWindow(startDate, endDate, todayISO)) {
      results.push({ conference: tab.name, status: 'skipped', skippedReason: 'outside_active_window' });
      continue;
    }

    try {
      const profile = await getProfile(tab.name);
      if (!profile || !profile.enabled) {
        results.push({ conference: tab.name, status: 'skipped', skippedReason: 'ingestion_not_enabled' });
        continue;
      }
      // Split whatever's left of the OVERALL budget evenly between this
      // conference's two phases, each floored at `MIN_PHASE_DEADLINE_MS`
      // — so a late conference (overall budget running low) still gets a
      // real, non-zero shot at phase 2, instead of phase 1 alone eating
      // whatever's left (review finding, HIGH item B).
      const remaining = OVERALL_DEADLINE_MS - (Date.now() - startedAt);
      const perPhaseBudget = Math.max(MIN_PHASE_DEADLINE_MS, Math.min(PHASE_DEADLINE_MS, remaining / 2));
      const result = await discoverCalendarSources(tab.name, tab, profile, {
        phase1DeadlineMs: perPhaseBudget,
        phase2DeadlineMs: perPhaseBudget,
      });
      results.push({ conference: tab.name, status: 'ok', proposalsWritten: result.proposalsWritten.length });
    } catch (err) {
      results.push({ conference: tab.name, status: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  }

  return NextResponse.json({ ran: results.length, results });
}
