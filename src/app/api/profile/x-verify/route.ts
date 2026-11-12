import { NextRequest, NextResponse } from 'next/server';
import type { User } from '@supabase/supabase-js';
import { getUserFromRequest, getServiceSupabase } from '@/lib/server-auth';
import { createRateLimiter, getClientIp } from '@/lib/rate-limit';

/**
 * Server-side X (Twitter) verification.
 *
 * The profile's `x_verified`, `x_handle`, `x_oauth_id` and `x_avatar_url`
 * columns are only ever written here, with the service role, after the
 * caller's linked X identity has been read from Supabase Auth (admin
 * getUserById) using the caller's own bearer token to establish who they are.
 * A DB trigger (see migrations) stops browser clients from changing them.
 *
 *  POST   -> mark the caller verified from their linked X identity
 *  DELETE -> clear verification (only once the X identity is no longer linked)
 */

const limiter = createRateLimiter(20, 10 * 60 * 1000);

const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;

function twitterIdentityOf(user: User) {
  return user.identities?.find((i) => i.provider === 'twitter' || i.provider === 'x') ?? null;
}

async function loadAuthoritativeUser(userId: string): Promise<User | null> {
  const { data, error } = await getServiceSupabase().auth.admin.getUserById(userId);
  if (error || !data?.user) return null;
  return data.user;
}

export async function POST(req: NextRequest) {
  if (!limiter.check(getClientIp(req))) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }
  const auth = await getUserFromRequest(req);
  if (auth.error) return auth.error;

  const user = await loadAuthoritativeUser(auth.user.id);
  const identity = user ? twitterIdentityOf(user) : null;
  if (!user || !identity) {
    return NextResponse.json({ error: 'No linked X account' }, { status: 403 });
  }

  const data = (identity.identity_data ?? {}) as Record<string, unknown>;
  const rawHandle = data.user_name ?? data.preferred_username;
  const handle = typeof rawHandle === 'string' ? rawHandle.replace(/^@/, '') : '';
  if (!HANDLE_RE.test(handle) || !identity.id) {
    return NextResponse.json({ error: 'Linked X account has no usable handle' }, { status: 422 });
  }
  const avatar = typeof data.avatar_url === 'string' && /^https:\/\//.test(data.avatar_url) ? data.avatar_url : null;

  const { data: rows, error } = await getServiceSupabase()
    .from('profiles')
    .update({ x_handle: handle, x_verified: true, x_oauth_id: identity.id, x_avatar_url: avatar })
    .eq('user_id', user.id)
    .select('user_id');
  if (error) {
    console.error('[x-verify] profile update failed:', error.message);
    return NextResponse.json({ error: 'Could not update profile' }, { status: 500 });
  }
  if (!rows || rows.length === 0) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  }
  return NextResponse.json({ x_verified: true, x_handle: handle });
}

export async function DELETE(req: NextRequest) {
  if (!limiter.check(getClientIp(req))) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }
  const auth = await getUserFromRequest(req);
  if (auth.error) return auth.error;

  const user = await loadAuthoritativeUser(auth.user.id);
  if (!user) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  if (twitterIdentityOf(user)) {
    return NextResponse.json({ error: 'X account is still linked' }, { status: 409 });
  }

  const { error } = await getServiceSupabase()
    .from('profiles')
    .update({ x_verified: false, x_oauth_id: null, x_avatar_url: null })
    .eq('user_id', user.id);
  if (error) {
    console.error('[x-verify] profile clear failed:', error.message);
    return NextResponse.json({ error: 'Could not update profile' }, { status: 500 });
  }
  return NextResponse.json({ x_verified: false });
}
