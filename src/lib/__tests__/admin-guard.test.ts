import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// Stateful fake of the ledger: reserve = insert then count (like the real one).
const ledgerRows: { id: number; key: string }[] = [];
let nextId = 1;
let ledgerDown = false;
let revokedBefore = 0;
let revocationReadFails = false;
const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
vi.mock('@/lib/ledger-rate-limit', () => ({
  reserveLedgerAttempt: async (_scope: string, req: NextRequest) => {
    if (ledgerDown) return { id: null, count: null };
    const key = req.headers.get('x-real-ip') ?? '';
    const id = nextId++;
    ledgerRows.push({ id, key });
    await Promise.resolve();
    return { id: String(id), count: ledgerRows.filter((r) => r.key === key).length };
  },
  releaseLedgerAttempt: async (id: string | null) => {
    const i = ledgerRows.findIndex((r) => String(r.id) === id);
    if (i >= 0) ledgerRows.splice(i, 1);
  },
  countLedgerAttempts: async (_scope: string, req: NextRequest) => {
    if (ledgerDown) return 0;
    const key = req.headers.get('x-real-ip') ?? '';
    return ledgerRows.filter((r) => r.key === key).length;
  },
  countLedgerScope: async () => (ledgerDown ? null : ledgerRows.length),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () =>
            revocationReadFails ? { data: null, error: { message: 'x' } } : { data: { value: { ts: revokedBefore } }, error: null },
        }),
      }),
      upsert: async (row: { value: { ts: number } }) => {
        revokedBefore = row.value.ts;
        return { error: null };
      },
    }),
  }),
}));

import {
  requireAdmin,
  createAdminSessionToken,
  isValidAdminSessionToken,
  setAdminSessionCookie,
  ADMIN_COOKIE,
  ADMIN_MAX_FAILURES,
  ADMIN_GLOBAL_ALERT_THRESHOLD,
  hasValidAdminSession,
  revokeAllAdminSessions,
  _resetAdminGuardForTests,
} from '../admin-guard';

const PW = 'guard-test-password';

function req(opts: { header?: string; cookie?: string; url?: string; ip?: string } = {}) {
  const headers: Record<string, string> = { 'x-real-ip': opts.ip ?? '1.1.1.1' };
  if (opts.header !== undefined) headers['x-admin-password'] = opts.header;
  if (opts.cookie) headers.cookie = `${ADMIN_COOKIE}=${opts.cookie}`;
  return new NextRequest(opts.url ?? 'http://localhost/api/admin/x', { headers });
}

beforeEach(() => {
  process.env.ADMIN_PASSWORD = PW;
  delete process.env.ADMIN_SESSION_SECRET;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  delete process.env.ADMIN_SESSION_VERSION;
  ledgerRows.length = 0;
  ledgerDown = false;
  revokedBefore = 0;
  revocationReadFails = false;
  _resetAdminGuardForTests();
});

describe('requireAdmin', () => {
  it('accepts the x-admin-password header', async () => {
    expect(await requireAdmin(req({ header: PW }))).toBeNull();
  });

  it('accepts a password from the JSON body', async () => {
    expect(await requireAdmin(req(), PW)).toBeNull();
  });

  it('accepts a valid session cookie with no password', async () => {
    const token = createAdminSessionToken()!;
    expect(await requireAdmin(req({ cookie: token }))).toBeNull();
    expect(ledgerRows).toHaveLength(0);
  });

  it('accepts a cookie even when the client sends a blank password header', async () => {
    const token = createAdminSessionToken()!;
    expect(await requireAdmin(req({ cookie: token, header: '' }), '')).toBeNull();
  });

  it('rejects a bad password with 401 and keeps the reservation', async () => {
    const res = await requireAdmin(req({ header: 'nope' }));
    expect(res?.status).toBe(401);
    expect(ledgerRows).toHaveLength(1);
  });

  it('rejects a bad body password', async () => {
    expect((await requireAdmin(req(), 'nope'))?.status).toBe(401);
  });

  it('rejects when no credential is supplied', async () => {
    expect((await requireAdmin(req()))?.status).toBe(401);
    expect(ledgerRows).toHaveLength(0);
  });

  it('rejects the ?password= query param', async () => {
    const res = await requireAdmin(req({ url: `http://localhost/api/admin/x?password=${PW}` }));
    expect(res?.status).toBe(401);
  });

  it('rejects a tampered, expired, or foreign cookie', async () => {
    const token = createAdminSessionToken()!;
    const [exp, sig] = token.split('.');
    expect(isValidAdminSessionToken(`${Number(exp) + 1000}.${sig}`)).toBe(false);
    expect(isValidAdminSessionToken(token, Number(exp) + 1)).toBe(false);
    expect(isValidAdminSessionToken('garbage')).toBe(false);
    expect(isValidAdminSessionToken(`${token}.extra`)).toBe(false);
    expect((await requireAdmin(req({ cookie: `${Number(exp) + 1000}.${sig}` })))?.status).toBe(401);
    // Token minted under another secret is rejected after the secret changes.
    process.env.ADMIN_SESSION_SECRET = 'different';
    expect(isValidAdminSessionToken(token)).toBe(false);
  });

  it('fails closed when ADMIN_PASSWORD is unset', async () => {
    delete process.env.ADMIN_PASSWORD;
    expect(createAdminSessionToken()).toBeNull();
    expect((await requireAdmin(req({ header: '' }), ''))?.status).toBe(401);
    expect((await requireAdmin(req({ header: 'anything' })))?.status).toBe(401);
  });

  it('rate limits per IP in memory after repeated failures, even for the right password', async () => {
    for (let i = 0; i < ADMIN_MAX_FAILURES; i++) {
      expect((await requireAdmin(req({ header: 'bad' })))?.status).toBe(401);
    }
    expect((await requireAdmin(req({ header: 'bad' })))?.status).toBe(429);
    expect((await requireAdmin(req({ header: PW })))?.status).toBe(429);
    // A different IP is unaffected.
    expect(await requireAdmin(req({ header: PW, ip: '2.2.2.2' }))).toBeNull();
  });

  it('rate limits using the persistent ledger when memory is cold', async () => {
    for (let i = 0; i < ADMIN_MAX_FAILURES; i++) ledgerRows.push({ id: nextId++, key: '1.1.1.1' });
    expect((await requireAdmin(req({ header: PW })))?.status).toBe(429);
  });

  it('refunds the reservation on a successful login (reset semantics)', async () => {
    for (let i = 0; i < ADMIN_MAX_FAILURES - 1; i++) await requireAdmin(req({ header: 'bad' }));
    expect(await requireAdmin(req({ header: PW }))).toBeNull();
    expect(ledgerRows).toHaveLength(ADMIN_MAX_FAILURES - 1);
    // Still under the limit: another success is accepted, an extra bad guess is a 401 not a 429.
    expect(await requireAdmin(req({ header: PW }))).toBeNull();
    expect((await requireAdmin(req({ header: 'bad' })))?.status).toBe(401);
  });

  it('50 parallel bad guesses: at most the limit pass the gate (rest are 429)', async () => {
    const results = await Promise.all(Array.from({ length: 50 }, () => requireAdmin(req({ header: 'bad' }))));
    const denied = results.filter((r) => r?.status === 401).length;
    const limited = results.filter((r) => r?.status === 429).length;
    expect(denied).toBeLessThanOrEqual(ADMIN_MAX_FAILURES);
    expect(denied + limited).toBe(50);
  });

  it('parallel guesses that include the correct password cannot exceed the limit either', async () => {
    const reqs = [...Array.from({ length: 30 }, () => 'bad'), PW];
    const results = await Promise.all(reqs.map((h) => requireAdmin(req({ header: h }))));
    const passedGate = results.filter((r) => r === null || r.status === 401).length;
    expect(passedGate).toBeLessThanOrEqual(ADMIN_MAX_FAILURES);
  });

  it('one IP spraying cannot affect another IP, and limited requests insert nothing', async () => {
    for (let i = 0; i < ADMIN_MAX_FAILURES; i++) await requireAdmin(req({ header: 'bad', ip: '3.3.3.3' }));
    const rowsAfterLimit = ledgerRows.length;
    for (let i = 0; i < 20; i++) expect((await requireAdmin(req({ header: 'bad', ip: '3.3.3.3' })))?.status).toBe(429);
    expect(ledgerRows.length).toBe(rowsAfterLimit);
    expect(await requireAdmin(req({ header: PW, ip: '4.4.4.4' }))).toBeNull();
  });

  it('many IPs failing never blocks a correct login (no global lockout), but warns', async () => {
    warnSpy.mockClear();
    for (let i = 0; i < ADMIN_GLOBAL_ALERT_THRESHOLD + 5; i++) {
      await requireAdmin(req({ header: 'bad', ip: `10.0.${Math.floor(i / 250)}.${i % 250}` }));
    }
    expect(await requireAdmin(req({ header: PW, ip: '9.9.9.9' }))).toBeNull();
    await new Promise((r) => setTimeout(r, 10));
    expect(warnSpy).toHaveBeenCalled();
  });

  it('still limits per IP in memory when the ledger is down', async () => {
    ledgerDown = true;
    for (let i = 0; i < ADMIN_MAX_FAILURES; i++) await requireAdmin(req({ header: 'bad' }));
    expect((await requireAdmin(req({ header: PW })))?.status).toBe(429);
  });
});

describe('session version and revocation', () => {
  it('ADMIN_SESSION_VERSION change invalidates existing tokens', async () => {
    const token = createAdminSessionToken()!;
    expect(isValidAdminSessionToken(token)).toBe(true);
    process.env.ADMIN_SESSION_VERSION = '2';
    expect(isValidAdminSessionToken(token)).toBe(false);
    expect(isValidAdminSessionToken(createAdminSessionToken()!)).toBe(true);
  });

  it('revokeAllAdminSessions invalidates sessions issued before it', async () => {
    const old = createAdminSessionToken(Date.now() - 60_000)!;
    expect((await requireAdmin(req({ cookie: old }))) ).toBeNull();
    expect(await revokeAllAdminSessions()).toBe(true);
    _resetAdminGuardForTests();
    expect((await requireAdmin(req({ cookie: old })))?.status).toBe(401);
    // A fresh login after revocation works.
    const fresh = createAdminSessionToken(Date.now() + 5)!;
    expect(await hasValidAdminSession(req({ cookie: fresh }) )).toBe(true);
  });

  it('fails closed for cookies only if revocation state was never read; header still works', async () => {
    revocationReadFails = true;
    expect((await requireAdmin(req({ cookie: createAdminSessionToken()! })))?.status).toBe(401);
    expect(await requireAdmin(req({ header: PW }))).toBeNull();
  });

  it('keeps using the last good revocation value when a later read errors', async () => {
    const token = createAdminSessionToken()!;
    expect(await requireAdmin(req({ cookie: token }))).toBeNull(); // good read cached
    revocationReadFails = true;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 60_000); // cache expired, read now errors
    try {
      const fresh = createAdminSessionToken()!;
      expect(await requireAdmin(req({ cookie: fresh }))).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('setAdminSessionCookie', () => {
  it('sets an httpOnly, Secure, SameSite=Strict cookie that validates', () => {
    const res = NextResponse.json({ ok: true });
    setAdminSessionCookie(res);
    const c = res.cookies.get(ADMIN_COOKIE)!;
    expect(c.httpOnly).toBe(true);
    expect(c.secure).toBe(true);
    expect(c.sameSite).toBe('strict');
    expect(c.maxAge).toBe(12 * 60 * 60);
    expect(isValidAdminSessionToken(c.value)).toBe(true);
  });
});
