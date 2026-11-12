import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: null }), maybeSingle: async () => ({ data: null }) }) }),
      insert: async () => ({ error: null }),
      upsert: async () => ({ error: null }),
    }),
  }),
}));
vi.mock('@/lib/safe-fetch', () => ({
  safeFetch: async () => {
    throw new Error('network disabled in tests');
  },
  SafeFetchError: class SafeFetchError extends Error {},
}));
vi.mock('@/lib/error-store', () => ({ recordAppErrors: async () => ({ ok: true, recorded: 0 }) }));
vi.mock('@/lib/fetch-events-cached', () => ({ getEventLinkById: async () => null }));

import { POST as fetchEventPost } from '@/app/api/fetch-event/route';
import { GET as ogGet } from '@/app/api/og/route';
import { POST as errorsPost } from '@/app/api/errors/route';
import { POST as eventsTrackPost } from '@/app/api/events/track/route';
import { POST as adsTrackPost } from '@/app/api/ads/track/route';
import { POST as abTrackPost } from '@/app/api/ab/track/route';

function post(path: string, ip: string, body: unknown = {}) {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-real-ip': ip },
    body: JSON.stringify(body),
  });
}

/** Calls `fn` `limit` times (none may be 429), then once more (must be 429); another IP is unaffected. */
async function expectLimited(fn: (ip: string) => Promise<Response>, limit: number, ipBase: string) {
  for (let i = 0; i < limit; i++) {
    expect((await fn(ipBase)).status).not.toBe(429);
  }
  expect((await fn(ipBase)).status).toBe(429);
  expect((await fn(`${ipBase}-other`)).status).not.toBe(429);
}

describe('per-IP rate limits on public endpoints', () => {
  it('/api/fetch-event', async () => {
    await expectLimited((ip) => fetchEventPost(post('/api/fetch-event', ip, { url: 'not a url' })), 20, '11.0.0.1');
  });
  it('/api/og (arbitrary URL path)', async () => {
    let n = 0;
    await expectLimited(
      (ip) => ogGet(new NextRequest(`http://localhost/api/og?url=https://example.com/${n++}`, { headers: { 'x-real-ip': ip } })),
      30,
      '11.0.0.2'
    );
  });
  it('/api/errors', async () => {
    await expectLimited((ip) => errorsPost(post('/api/errors', ip, { message: 'x' })), 30, '11.0.0.3');
  });
  it('/api/events/track', async () => {
    await expectLimited((ip) => eventsTrackPost(post('/api/events/track', ip)), 60, '11.0.0.4');
  });
  it('/api/ads/track', async () => {
    await expectLimited((ip) => adsTrackPost(post('/api/ads/track', ip)), 60, '11.0.0.5');
  });
  it('/api/ab/track', async () => {
    await expectLimited((ip) => abTrackPost(post('/api/ab/track', ip)), 60, '11.0.0.6');
  });
});
