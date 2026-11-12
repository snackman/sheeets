import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createRateLimiter } from '../rate-limit';

vi.mock('@/lib/ingest/db', () => ({
  recordSubmissionAttempt: async () => 'row-1',
  countRecentSubmissionAttempts: async () => {
    throw new Error('count failed');
  },
  deleteSubmissionAttempt: async () => {},
  countRecentAttemptsByTag: async () => 0,
}));

import { reserveLedgerAttempt } from '../ledger-rate-limit';

describe('reserveLedgerAttempt', () => {
  it('keeps the row id when the count fails so it can be refunded', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const req = new NextRequest('http://localhost/x', { headers: { 'x-real-ip': '1.2.3.4' } });
    expect(await reserveLedgerAttempt('admin', req, 1000)).toEqual({ id: 'row-1', count: null });
  });
});

describe('createRateLimiter eviction', () => {
  it('drops expired buckets once the map grows large', () => {
    vi.useFakeTimers();
    const l = createRateLimiter(1, 1000);
    for (let i = 0; i < 1000; i++) l.check(`k${i}`);
    vi.advanceTimersByTime(2000);
    expect(l.check('fresh')).toBe(true);
    expect(l.check('k0')).toBe(true); // expired entry was reset, not retained as blocked
    vi.useRealTimers();
  });
});
