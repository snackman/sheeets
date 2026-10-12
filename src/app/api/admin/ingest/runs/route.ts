// Admin Ingest Log sub-tab data (§9.3): recent runs + monthly cost vs cap.
import { NextRequest, NextResponse } from 'next/server';
import { isAdminPassword } from '@/lib/admin-auth';
import { listRuns } from '@/lib/ingest/db';
import { checkMonthlyBudget } from '@/lib/ingest/budget';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const password = req.nextUrl.searchParams.get('password');
  if (!isAdminPassword(password)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const conference = req.nextUrl.searchParams.get('conference') || undefined;

  try {
    const [runs, budget] = await Promise.all([listRuns({ conference, limit: 100 }), checkMonthlyBudget()]);
    return NextResponse.json({ runs, budget });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to load runs' }, { status: 500 });
  }
}
