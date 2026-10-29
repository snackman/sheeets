import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { parseBody, AdminConfigSchema } from '@/lib/api-validation';
import { isPublicConfigKey, sanitizePublicConfigValue } from '@/lib/public-config';
import { requireAdmin, hasValidAdminSession } from '@/lib/admin-guard';
import { invalidateConferenceConfigCache } from '@/lib/get-conferences';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(req: NextRequest) {
  // Full config only for an authenticated admin (header password or session
  // cookie); a wrong password header is a 401, no credential is the public view.
  const wantsAdmin = !!req.headers.get('x-admin-password') || hasValidAdminSession(req);
  if (wantsAdmin) {
    const denied = await requireAdmin(req);
    if (denied) return denied;
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('admin_config')
    .select('key, value');

  if (error) {
    console.error('admin config read failed:', error.message);
    return NextResponse.json({ error: 'Failed to load config' }, { status: 500 });
  }

  const config: Record<string, unknown> = {};
  for (const row of data) {
    if (wantsAdmin) config[row.key] = row.value;
    else if (isPublicConfigKey(row.key)) config[row.key] = sanitizePublicConfigValue(row.key, row.value);
  }

  return NextResponse.json(config, wantsAdmin ? { headers: { 'Cache-Control': 'private, no-store' } } : undefined);
}

export async function POST(req: NextRequest) {
  const { data, error: parseError } = await parseBody(req, AdminConfigSchema);
  if (parseError) return parseError;

  const { password, key, value } = data;

  const denied = await requireAdmin(req, password);
  if (denied) return denied;

  const supabase = getSupabase();
  const { error } = await supabase
    .from('admin_config')
    .upsert({ key, value, updated_at: new Date().toISOString() });

  if (error) {
    console.error('admin config write failed:', error.message);
    return NextResponse.json({ error: 'Failed to save config' }, { status: 500 });
  }

  invalidateConferenceConfigCache();
  return NextResponse.json({ success: true });
}
