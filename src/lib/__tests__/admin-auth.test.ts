import { describe, it, expect, beforeAll } from 'vitest';
import { isCronSecret, getAdminPassword, isAdminPassword } from '../admin-auth';

function makeReq(opts: { header?: string | null; query?: string | null }) {
  const headers = new Headers();
  if (opts.header != null) headers.set('x-admin-password', opts.header);
  const searchParams = new URLSearchParams();
  if (opts.query != null) searchParams.set('password', opts.query);
  return { headers, nextUrl: { searchParams } };
}

const SECRET = 'cron-test-secret-value';

beforeAll(() => {
  process.env.CRON_SECRET = SECRET;
});

describe('isCronSecret (LOW: timing-safe cron secret check)', () => {
  it('accepts the correct `Bearer <secret>` header', () => {
    expect(isCronSecret(`Bearer ${SECRET}`)).toBe(true);
  });

  it('rejects a wrong secret', () => {
    expect(isCronSecret('Bearer wrong-secret')).toBe(false);
  });

  it('rejects a missing header', () => {
    expect(isCronSecret(null)).toBe(false);
  });

  it('rejects a header missing the Bearer prefix', () => {
    expect(isCronSecret(SECRET)).toBe(false);
  });

  it('rejects a secret that is a prefix of the real one (would short-circuit a naive !== compare)', () => {
    expect(isCronSecret(`Bearer ${SECRET.slice(0, -1)}`)).toBe(false);
  });

  it('fails closed when CRON_SECRET is unset', () => {
    const prev = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    expect(isCronSecret(`Bearer ${SECRET}`)).toBe(false);
    process.env.CRON_SECRET = prev;
  });
});

describe('getAdminPassword (admin GET routes: header over query-param)', () => {
  it('prefers the x-admin-password header when both are present', () => {
    const req = makeReq({ header: 'from-header', query: 'from-query' });
    expect(getAdminPassword(req)).toBe('from-header');
  });

  it('does NOT read the ?password= query param (removed)', () => {
    const req = makeReq({ header: null, query: 'from-query' });
    expect(getAdminPassword(req)).toBeNull();
  });

  it('returns null when neither is present', () => {
    const req = makeReq({ header: null, query: null });
    expect(getAdminPassword(req)).toBeNull();
  });

  it('round-trips through isAdminPassword the same way either source would', () => {
    const prev = process.env.ADMIN_PASSWORD;
    process.env.ADMIN_PASSWORD = 'super-secret';
    const headerReq = makeReq({ header: 'super-secret', query: null });
    const queryReq = makeReq({ header: null, query: 'super-secret' });
    expect(isAdminPassword(getAdminPassword(headerReq))).toBe(true);
    expect(isAdminPassword(getAdminPassword(queryReq))).toBe(false);
    process.env.ADMIN_PASSWORD = prev;
  });
});
