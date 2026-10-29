// Manual "Run now" (§7, §9.1/§9.3). Runs one source, or every enabled source
// for a conference, synchronously and returns the result — including a
// `dryRun` preview that classifies without writing anything.
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-guard';
import { parseBody, IngestRunActionSchema } from '@/lib/api-validation';
import { listSources } from '@/lib/ingest/db';
import { runSource } from '@/lib/ingest/pipeline';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const { data, error: parseError } = await parseBody(req, IngestRunActionSchema);
  if (parseError) return parseError;

  const { password, sourceId, conference, dryRun } = data;
  const denied = await requireAdmin(req, password);
  if (denied) return denied;

  try {
    const sourceIds = sourceId
      ? [sourceId]
      : (await listSources(conference)).filter((s) => s.enabled).map((s) => s.id);

    if (sourceIds.length === 0) {
      return NextResponse.json({ error: 'No enabled sources found.' }, { status: 404 });
    }

    const results = [];
    for (const id of sourceIds) {
      const result = await runSource(id, { trigger: 'manual', dryRun, deadlineMs: 240_000 });
      results.push({ sourceId: id, ...result });
    }

    return NextResponse.json({ success: true, dryRun: !!dryRun, results });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Run failed' }, { status: 500 });
  }
}
