// Admin Ingest Log sub-tab data (§9.3): recent runs + monthly cost vs cap.
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-guard';
import { listRuns } from '@/lib/ingest/db';
import { checkMonthlyBudget } from '@/lib/ingest/budget';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const conference = req.nextUrl.searchParams.get('conference') || undefined;

  try {
    const [runs, budget] = await Promise.all([listRuns({ conference, limit: 100 }), checkMonthlyBudget()]);
    return NextResponse.json({ runs, budget });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to load runs' }, { status: 500 });
  }
}
