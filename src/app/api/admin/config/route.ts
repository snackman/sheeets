import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('admin_config')
    .select('key, value');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const config: Record<string, unknown> = {};
  for (const row of data) {
    config[row.key] = row.value;
  }

  return NextResponse.json(config);
}

export async function POST(req: NextRequest) {
  const supabase = getSupabase();
  const body = await req.json();
  const { password, key, value } = body;

  if (password !== 'trusttheplan') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!key || value === undefined) {
    return NextResponse.json({ error: 'Missing key or value' }, { status: 400 });
  }

  const { error } = await supabase
    .from('admin_config')
    .upsert({ key, value, updated_at: new Date().toISOString() });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
