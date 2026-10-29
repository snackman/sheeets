// Ingest schema/ops health. Probes every table, view, RPC and column the
// ingest code depends on and reports which are missing (i.e. a migration
// that hasn't been applied yet -- the pipeline mostly degrades silently),
// plus when the last successful cron ingest run happened.
//
// Always HTTP 200 with { ok, missing, errors, lastRunAt, staleHours } so an
// operator script can read the body; `ok` is false when anything is missing
// or a probe failed for another reason.
//
// Not detectable via PostgREST: whether `ingest_precision` carries the
// latest view *semantics* (e.g. 20261029140000_precision_all_rejects) --
// the column set is unchanged across those migrations. Index migrations
// (20261029160000) are also invisible here; the code doesn't depend on them.
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-guard';
import { getIngestSupabase, isMissingRelationError } from '@/lib/ingest/db';

export const runtime = 'nodejs';

interface Probe {
  /** Human label reported in `missing`. */
  name: string;
  run: () => Promise<{ error: { code?: string; message: string } | null }>;
}

/** Tables/views and the columns the code selects from them. A missing
 *  column (42703) is reported as `table.column set`. */
export const TABLE_PROBES: { table: string; columns: string }[] = [
  { table: 'ingest_candidates', columns: 'id,conference,canonical_key,alt_keys,status,final_score,shadow_route,possible_duplicate_of,published_event_id,published_at,auto_published_at,reject_reason,edits,last_seen_at' },
  { table: 'ingest_sources', columns: 'id,conference,kind,enabled,last_run_at,last_status' },
  { table: 'ingest_runs', columns: 'id,source_id,conference,trigger,status,started_at,finished_at,est_cost_usd' },
  { table: 'ingest_profiles', columns: 'conference,theme_key,auto_publish_enabled,auto_publish_killed_at,max_publish_per_run' },
  { table: 'ingest_labels', columns: 'id,conference,theme_key,label,label_kind,source' },
  { table: 'ingest_link_cache', columns: 'link_key,luma_api_id,resolved_at' },
  { table: 'ingest_publisher_leases', columns: 'lease_key,holder,expires_at' },
  { table: 'ingest_submission_attempts', columns: 'id,created_at,cost_usd' },
  { table: 'ingest_source_proposals', columns: 'id' },
  { table: 'geocoded_addresses', columns: 'normalized_address,lat,lng,matched_address,conference' },
  { table: 'geocode_failures', columns: 'normalized_address,last_attempt_at' },
  // views
  { table: 'ingest_precision', columns: 'conference,source_kind,score_bucket,reviewed_on_theme,reviewed_off_theme,auto_published,shadow_publish_candidates,shadow_publish_rejected_theme' },
  { table: 'ingest_run_cost_by_source_kind', columns: '*' },
];

function buildProbes(): Probe[] {
  const supabase = getIngestSupabase();
  const probes: Probe[] = TABLE_PROBES.map(({ table, columns }) => ({
    name: table,
    run: async () => {
      const { error } = await supabase.from(table).select(columns).limit(1);
      return { error };
    },
  }));
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
  probes.push(
    { name: 'rpc:get_monthly_ingest_cost_usd', run: async () => ({ error: (await supabase.rpc('get_monthly_ingest_cost_usd', { p_month_start: monthStart })).error }) },
    { name: 'rpc:get_monthly_ingest_x_cost_usd', run: async () => ({ error: (await supabase.rpc('get_monthly_ingest_x_cost_usd', { p_month_start: monthStart })).error }) },
    {
      // Acquire + release a throwaway 1s lease on a key no sheet uses.
      name: 'rpc:ingest_try_acquire_publisher_lease',
      run: async () => ({ error: (await supabase.rpc('ingest_try_acquire_publisher_lease', { p_key: 'healthcheck:probe', p_holder: 'healthcheck', p_ttl_seconds: 1 })).error }),
    },
    { name: 'rpc:ingest_release_publisher_lease', run: async () => ({ error: (await supabase.rpc('ingest_release_publisher_lease', { p_key: 'healthcheck:probe', p_holder: 'healthcheck' })).error }) },
  );
  return probes;
}

export async function GET(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const missing: string[] = [];
  const errors: string[] = [];

  const probes = buildProbes();
  const settled = await Promise.all(
    probes.map(async (p) => {
      try {
        return { name: p.name, ...(await p.run()) };
      } catch (err) {
        return { name: p.name, error: { message: err instanceof Error ? err.message : String(err) } as { code?: string; message: string } };
      }
    })
  );
  for (const r of settled) {
    if (!r.error) continue;
    if (isMissingRelationError(r.error)) missing.push(r.name);
    else errors.push(`${r.name}: ${r.error.message.slice(0, 160)}`);
  }

  let lastRunAt: string | null = null;
  let staleHours: number | null = null;
  try {
    const { data, error } = await getIngestSupabase()
      .from('ingest_runs')
      .select('started_at,finished_at')
      .eq('trigger', 'cron')
      .in('status', ['ok', 'partial'])
      .order('started_at', { ascending: false })
      .limit(1);
    if (!error && data && data.length > 0) {
      const row = data[0] as { started_at: string; finished_at: string | null };
      lastRunAt = row.finished_at ?? row.started_at;
      staleHours = Math.round(((Date.now() - new Date(lastRunAt).getTime()) / 3_600_000) * 10) / 10;
    }
  } catch {
    // reported via the ingest_runs probe above
  }

  return NextResponse.json({ ok: missing.length === 0 && errors.length === 0, missing, errors, lastRunAt, staleHours });
}
