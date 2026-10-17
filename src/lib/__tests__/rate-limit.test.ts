import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRateLimiter } from '../rate-limit';

describe('createRateLimiter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows up to `max` calls per key within the window', () => {
    const limiter = createRateLimiter(3, 60_000);
    expect(limiter.check('1.2.3.4')).toBe(true);
    expect(limiter.check('1.2.3.4')).toBe(true);
    expect(limiter.check('1.2.3.4')).toBe(true);
    expect(limiter.check('1.2.3.4')).toBe(false);
  });

  it('tracks each key independently', () => {
    const limiter = createRateLimiter(1, 60_000);
    expect(limiter.check('1.2.3.4')).toBe(true);
    expect(limiter.check('5.6.7.8')).toBe(true);
    expect(limiter.check('1.2.3.4')).toBe(false);
    expect(limiter.check('5.6.7.8')).toBe(false);
  });

  it('resets the count once the window has elapsed', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const limiter = createRateLimiter(1, 1000);
    expect(limiter.check('1.2.3.4')).toBe(true);
    expect(limiter.check('1.2.3.4')).toBe(false);
    vi.setSystemTime(1500);
    expect(limiter.check('1.2.3.4')).toBe(true);
  });
});
