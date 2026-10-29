import { NextRequest, NextResponse } from 'next/server';
import { checkAdminPassword, setAdminSessionCookie, clearAdminSessionCookie, hasValidAdminSession } from '@/lib/admin-guard';

/**
 * Password login. On success also issues a signed, httpOnly, Secure,
 * SameSite=Strict session cookie (12h) which every admin route accepts in
 * place of the password. Failed attempts are rate limited per IP by
 * `checkAdminPassword` (persistent ledger + in-memory fallback).
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const result = await checkAdminPassword(req, body?.password);
  if (result === 'limited') {
    return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });
  }
  if (result !== 'ok') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  setAdminSessionCookie(res);
  return res;
}

/** Is the caller's session cookie still valid? */
export async function GET(req: NextRequest) {
  return hasValidAdminSession(req)
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

/** Log out: clear the session cookie. */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  clearAdminSessionCookie(res);
  return res;
}
