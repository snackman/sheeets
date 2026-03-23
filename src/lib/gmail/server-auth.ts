import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Get authenticated Supabase user from a request's Authorization header.
 * The frontend sends the Supabase access token as a Bearer token.
 */
export async function getAuthenticatedUser(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return { user: null, error: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) };
  }

  const token = authHeader.substring(7);
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return { user: null, error: NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 }) };
  }

  return { user, error: null };
}
