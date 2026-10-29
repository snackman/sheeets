import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const countMock = vi.fn(async (..._a: unknown[]) => 0);
const recordMock = vi.fn(async (..._a: unknown[]) => {});
vi.mock('@/lib/ledger-rate-limit', () => ({
  countLedgerAttempts: (...a: unknown[]) => countMock(...a),
  recordLedgerAttempt: (...a: unknown[]) => recordMock(...a),
}));

import {
  requireAdmin,
  createAdminSessionToken,
  isValidAdminSessionToken,
  setAdminSessionCookie,
  ADMIN_COOKIE,
  ADMIN_MAX_FAILURES,
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
  countMock.mockReset().mockResolvedValue(0);
  recordMock.mockReset().mockResolvedValue(undefined);
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
    expect(recordMock).not.toHaveBeenCalled();
  });

  it('accepts a cookie even when the client sends a blank password header', async () => {
    const token = createAdminSessionToken()!;
    expect(await requireAdmin(req({ cookie: token, header: '' }), '')).toBeNull();
  });

  it('rejects a bad password with 401 and records the failure', async () => {
    const res = await requireAdmin(req({ header: 'nope' }));
    expect(res?.status).toBe(401);
    expect(recordMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a bad body password', async () => {
    expect((await requireAdmin(req(), 'nope'))?.status).toBe(401);
  });

  it('rejects when no credential is supplied', async () => {
    expect((await requireAdmin(req()))?.status).toBe(401);
    expect(recordMock).not.toHaveBeenCalled();
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

  it('rate limits using the persistent ledger count', async () => {
    countMock.mockResolvedValue(ADMIN_MAX_FAILURES);
    expect((await requireAdmin(req({ header: PW })))?.status).toBe(429);
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
