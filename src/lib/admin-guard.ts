import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { isAdminPassword } from '@/lib/admin-auth';
import { getClientIp } from '@/lib/rate-limit';
import { recordLedgerAttempt, countLedgerAttempts } from '@/lib/ledger-rate-limit';

/**
 * Shared guard for every admin route.
 *
 * Accepts, in order:
 *  1. `x-admin-password` header
 *  2. a `password` the route already parsed from its JSON body
 *  3. a signed, httpOnly session cookie issued by `/api/admin/verify`
 *
 * (A `?password=` query param is NOT accepted.)
 *
 * Failed password attempts are rate limited per client IP: persistently via
 * the Supabase `ingest_submission_attempts` ledger (shared across serverless
 * instances) plus an in-memory limiter as a fallback if the ledger is
 * unreachable. Comparison stays timing-safe.
 */

export const ADMIN_COOKIE = 'admin_session';
export const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const ADMIN_MAX_FAILURES = 10;
export const ADMIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;

const SCOPE = 'admin';
// In-memory fallback counter (per instance; resets on cold start).
const memBlocked = new Map<string, { count: number; windowStart: number }>();

function memCount(ip: string): number {
  const b = memBlocked.get(ip);
  if (!b || Date.now() - b.windowStart >= ADMIN_FAILURE_WINDOW_MS) return 0;
  return b.count;
}
function memRecord(ip: string) {
  const now = Date.now();
  const b = memBlocked.get(ip);
  if (!b || now - b.windowStart >= ADMIN_FAILURE_WINDOW_MS) memBlocked.set(ip, { count: 1, windowStart: now });
  else b.count += 1;
}

/** Exposed for tests. */
export function _resetAdminGuardForTests() {
  memBlocked.clear();
}

function sessionKey(): Buffer | null {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (secret) return createHmac('sha256', secret).update('admin-session-key-v1').digest();
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return null;
  return createHmac('sha256', pw).update('admin-session-key-v1').digest();
}

function sign(payload: string, key: Buffer): string {
  return createHmac('sha256', key).update(payload).digest('base64url');
}

/** Mint a session cookie value `<expiryMs>.<sig>`, or null if no key material is configured. */
export function createAdminSessionToken(now = Date.now()): string | null {
  const key = sessionKey();
  if (!key) return null;
  const exp = String(now + ADMIN_SESSION_TTL_MS);
  return `${exp}.${sign(exp, key)}`;
}

export function isValidAdminSessionToken(token: string | undefined | null, now = Date.now()): boolean {
  if (!token) return false;
  const key = sessionKey();
  if (!key) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [exp, sig] = parts;
  if (!exp || !sig || !/^\d+$/.test(exp)) return false;
  const expected = Buffer.from(sign(exp, key));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
  return Number(exp) > now;
}

export function setAdminSessionCookie(res: NextResponse): void {
  const token = createAdminSessionToken();
  if (!token) return;
  res.cookies.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    maxAge: Math.floor(ADMIN_SESSION_TTL_MS / 1000),
  });
}

export function clearAdminSessionCookie(res: NextResponse): void {
  res.cookies.set(ADMIN_COOKIE, '', { httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: 0 });
}

/** True when the request carries a currently valid admin session cookie. */
export function hasValidAdminSession(req: NextRequest): boolean {
  return isValidAdminSessionToken(req.cookies.get(ADMIN_COOKIE)?.value);
}

/**
 * Check a password credential with brute-force protection. Returns
 * `'ok' | 'denied' | 'limited'`.
 */
export async function checkAdminPassword(req: NextRequest, password: unknown): Promise<'ok' | 'denied' | 'limited'> {
  const ip = getClientIp(req);
  if (memCount(ip) >= ADMIN_MAX_FAILURES) return 'limited';
  if ((await countLedgerAttempts(SCOPE, req, ADMIN_FAILURE_WINDOW_MS)) >= ADMIN_MAX_FAILURES) return 'limited';
  if (isAdminPassword(password)) return 'ok';
  memRecord(ip);
  await recordLedgerAttempt(SCOPE, req);
  return 'denied';
}

function tooMany() {
  return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });
}
function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

/**
 * Returns `null` if the request is authorized as admin, otherwise the
 * 401/429 response to return immediately.
 *
 * @param bodyPassword the `password` field a route parsed from its JSON body, if any.
 */
export async function requireAdmin(req: NextRequest, bodyPassword?: unknown): Promise<NextResponse | null> {
  // Empty strings count as "not supplied" so a cookie-only client that sends a blank header still works.
  const headerPassword = req.headers.get('x-admin-password') || null;
  const supplied = headerPassword ?? (typeof bodyPassword === 'string' && bodyPassword !== '' ? bodyPassword : null);

  if (supplied !== null) {
    const result = await checkAdminPassword(req, supplied);
    if (result === 'ok') return null;
    return result === 'limited' ? tooMany() : unauthorized();
  }

  if (hasValidAdminSession(req)) return null;

  // No credential at all (e.g. an expired session): plain 401, not counted as a guess.
  return unauthorized();
}
