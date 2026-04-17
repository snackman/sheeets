import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { parseBody } from '@/lib/api-validation';

const NotifySchema = z.object({
  email: z.string().email('Valid email is required'),
  conference_slug: z.string().min(1, 'conference_slug is required'),
  conference_name: z.string().min(1, 'conference_name is required'),
});

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(req: NextRequest) {
  const { data, error: parseError } = await parseBody(req, NotifySchema);
  if (parseError) return parseError;

  const supabase = getSupabase();

  const { error } = await supabase.from('conference_notifications').upsert(
    {
      email: data.email.toLowerCase().trim(),
      conference_slug: data.conference_slug,
      conference_name: data.conference_name,
    },
    { onConflict: 'email,conference_slug' }
  );

  if (error) {
    if (error.code === '42P01') {
      return NextResponse.json({ success: true, note: 'table not yet created' });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
