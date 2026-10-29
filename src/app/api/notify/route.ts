import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { parseBody } from '@/lib/api-validation';
import { createRateLimiter, getClientIp } from '@/lib/rate-limit';

// Per-IP limit (in-process; resets on cold start, not shared across instances).
const limiter = createRateLimiter(5, 10 * 60 * 1000);

const NotifySchema = z.object({
  email: z.string().max(254).email('Valid email is required'),
  conference_slug: z.string().min(1, 'conference_slug is required').max(100),
  conference_name: z.string().min(1, 'conference_name is required').max(200),
});

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(req: NextRequest) {
  if (!limiter.check(getClientIp(req))) {
    return NextResponse.json({ error: 'Too many requests. Try again later.' }, { status: 429 });
  }

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
    console.error('notify upsert failed:', error.message);
    return NextResponse.json({ error: 'Failed to save. Please try again.' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
