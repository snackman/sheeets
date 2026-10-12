import { describe, it, expect, beforeAll } from 'vitest';
import { isCronSecret } from '../admin-auth';

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
