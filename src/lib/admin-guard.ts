import { createHmac, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { isAdminPassword } from '@/lib/admin-auth';
import { getClientIp } from '@/lib/rate-limit';
import { reserveLedgerAttempt, releaseLedgerAttempt, countLedgerScope, countLedgerAttempts } from '@/lib/ledger-rate-limit';
import { sendAlert } from '@/lib/alert';

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
/** Non-blocking signal: failed attempts across ALL clients per window above
 *  this log a warning (and ping ALERT_WEBHOOK_URL when set). It never blocks. */
export const ADMIN_GLOBAL_ALERT_THRESHOLD = 100;

const SCOPE = 'admin';

// In-memory per-IP counters (per instance; reset on cold start). A slot is
// reserved synchronously BEFORE the password is compared and refunded on
// success, so parallel requests cannot all slip past a read-then-check gap.
const memBlocked = new Map<string, { count: number; windowStart: number }>();
const MEM_SWEEP_SIZE = 500;

function memSweep(now: number) {
  if (memBlocked.size < MEM_SWEEP_SIZE) return;
  for (const [k, v] of memBlocked) {
    if (now - v.windowStart >= ADMIN_FAILURE_WINDOW_MS) memBlocked.delete(k);
  }
}

/** Reserve a slot for `ip`; false (and nothing recorded) if the IP is already at its limit. */
function memTryReserve(ip: string): boolean {
  const now = Date.now();
  memSweep(now);
  const b = memBlocked.get(ip);
  if (!b || now - b.windowStart >= ADMIN_FAILURE_WINDOW_MS) {
    memBlocked.set(ip, { count: 1, windowStart: now });
    return true;
  }
  if (b.count >= ADMIN_MAX_FAILURES) return false;
  b.count += 1;
  return true;
}
function memRefund(ip: string) {
  const b = memBlocked.get(ip);
  if (b && b.count > 0) b.count -= 1;
}

// Global failure tracking for the non-blocking alert only.
let memGlobal = { count: 0, windowStart: 0 };
function memGlobalFailure(): number {
  const now = Date.now();
  if (now - memGlobal.windowStart >= ADMIN_FAILURE_WINDOW_MS) memGlobal = { count: 1, windowStart: now };
  else memGlobal.count += 1;
  return memGlobal.count;
}

/** Exposed for tests. */
export function _resetAdminGuardForTests() {
  memBlocked.clear();
  memGlobal = { count: 0, windowStart: 0 };
  revokedCache = null;
  revokedErrorUntil = 0;
}

/**
 * Session revocation (two levers):
 *  - ADMIN_SESSION_VERSION env var is mixed into the signing key; changing it
 *    (and redeploying) invalidates every outstanding session cookie.
 *  - Logging out (DELETE /api/admin/verify with a valid session) stores a
 *    "revoked before" timestamp in the admin_config row `admin_session_revoked_before`;
 *    any session issued earlier is rejected (checked server-side, cached ~10s).
 */
function sessionKey(): Buffer | null {
  const version = process.env.ADMIN_SESSION_VERSION || '1';
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (secret) return createHmac('sha256', secret).update(`admin-session-key-v1:${version}`).digest();
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return null;
  return createHmac('sha256', pw).update(`admin-session-key-v1:${version}`).digest();
}

const REVOKED_KEY = 'admin_session_revoked_before';
const REVOKED_TTL_MS = 10_000;
const REVOKED_ERROR_BACKOFF_MS = 5_000;
// Last successfully read value; kept across read errors so a brief DB blip
// does not log the admin out. Null only if there has never been a good read.
let revokedCache: { at: number; value: number } | null = null;
let revokedErrorUntil = 0;

function revocationClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

/** Epoch ms before which sessions are revoked; null only if never successfully read. */
async function getRevokedBefore(now = Date.now()): Promise<number | null> {
  if (revokedCache && now - revokedCache.at < REVOKED_TTL_MS) return revokedCache.value;
  if (now < revokedErrorUntil) return revokedCache?.value ?? null;
  const supabase = revocationClient();
  if (!supabase) return revokedCache?.value ?? null;
  try {
    const { data, error } = await supabase.from('admin_config').select('value').eq('key', REVOKED_KEY).maybeSingle();
    if (error) throw new Error(error.message);
    const v = Number((data?.value as { ts?: number } | null)?.ts ?? 0);
    revokedCache = { at: now, value: Number.isFinite(v) ? v : 0 };
    return revokedCache.value;
  } catch {
    revokedErrorUntil = now + REVOKED_ERROR_BACKOFF_MS;
    return revokedCache?.value ?? null;
  }
}

/** Invalidate every session issued up to now. */
export async function revokeAllAdminSessions(now = Date.now()): Promise<boolean> {
  const supabase = revocationClient();
  if (!supabase) return false;
  try {
    const { error } = await supabase
      .from('admin_config')
      .upsert({ key: REVOKED_KEY, value: { ts: now }, updated_at: new Date(now).toISOString() });
    if (error) return false;
    revokedCache = { at: now, value: now };
    return true;
  } catch {
    return false;
  }
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

/** True when the request carries a currently valid, non-revoked admin session cookie. */
export async function hasValidAdminSession(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get(ADMIN_COOKIE)?.value;
  if (!isValidAdminSessionToken(token)) return false;
  const exp = Number(token!.split('.')[0]);
  const issuedAt = exp - ADMIN_SESSION_TTL_MS;
  const revokedBefore = await getRevokedBefore();
  if (revokedBefore === null) return false; // fail closed if revocation state is unreadable
  return issuedAt > revokedBefore;
}

/**
 * Check a password credential with brute-force protection. Returns
 * `'ok' | 'denied' | 'limited'`.
 *
 * Per-IP only: a client already over its limit is refused WITHOUT recording
 * anything, so one noisy IP cannot affect another IP's login. Otherwise the
 * attempt is reserved (memory slot + ledger insert, then count) BEFORE the
 * password is compared, so concurrent requests cannot all pass the check; a
 * correct password refunds its reservation. There is deliberately no global
 * blocking ceiling; mass failures only raise a warning/alert.
 */
export async function checkAdminPassword(req: NextRequest, password: unknown): Promise<'ok' | 'denied' | 'limited'> {
  const ip = getClientIp(req);
  if (!memTryReserve(ip)) return 'limited';

  // Already over the persistent limit: refuse without inserting a row.
  if ((await countLedgerAttempts(SCOPE, req, ADMIN_FAILURE_WINDOW_MS)) >= ADMIN_MAX_FAILURES) {
    memRefund(ip);
    return 'limited';
  }

  const ledger = await reserveLedgerAttempt(SCOPE, req, ADMIN_FAILURE_WINDOW_MS);
  if (ledger.count !== null && ledger.count > ADMIN_MAX_FAILURES) {
    // Lost a race against concurrent attempts: give the row back.
    memRefund(ip);
    await releaseLedgerAttempt(ledger.id);
    return 'limited';
  }

  if (isAdminPassword(password)) {
    memRefund(ip);
    await releaseLedgerAttempt(ledger.id);
    return 'ok';
  }

  void noteFailure();
  return 'denied';
}

/** Non-blocking: warn / alert when failures across all clients spike. */
async function noteFailure(): Promise<void> {
  try {
    const mem = memGlobalFailure();
    if (mem < ADMIN_GLOBAL_ALERT_THRESHOLD) return;
    const ledger = await countLedgerScope(SCOPE, ADMIN_FAILURE_WINDOW_MS);
    const total = Math.max(mem, ledger ?? 0);
    const msg = `admin login: ${total} failed attempts in 15 min across clients`;
    console.warn(`[admin-guard] ${msg}`);
    await sendAlert('admin_login_failures', msg);
  } catch {
    // never affects the login result
  }
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

  if (await hasValidAdminSession(req)) return null;

  // No credential at all (e.g. an expired session): plain 401, not counted as a guess.
  return unauthorized();
}
