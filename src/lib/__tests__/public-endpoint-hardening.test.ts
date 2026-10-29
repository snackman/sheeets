import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { SubmitEventSchema, GeocodeSchema } from '../api-validation';

const countMock = vi.fn(async (..._a: unknown[]) => 0);
vi.mock('@/lib/ledger-rate-limit', () => ({
  countLedgerAttempts: (...a: unknown[]) => countMock(...a),
  recordLedgerAttempt: async () => {},
}));
const appendMock = vi.fn(async (..._a: unknown[]) => 7);
vi.mock('@/lib/google-sheets', () => ({
  appendEventRow: (...a: unknown[]) => appendMock(...a),
  getSheetTitle: async () => 'Sheet',
}));
vi.mock('@/lib/get-conferences', () => ({ getConferenceTabs: async () => [{ name: 'Conf', gid: 1 }] }));
const upsertMock = vi.fn(async (..._a: unknown[]) => ({ error: { message: 'secret internal detail', code: 'XX' } }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: () => ({ insert: async () => ({}), upsert: (...a: unknown[]) => upsertMock(...a) }) }),
}));

import { POST as submitPost } from '@/app/api/submit-event/route';
import { POST as notifyPost } from '@/app/api/notify/route';
import { POST as geocodePost } from '@/app/api/geocode/route';

const submitReq = (ip = '9.9.9.9', body: unknown = { conference: 'Conf', event: { name: 'E', date: 'Mon' } }) =>
  new NextRequest('http://localhost/api/submit-event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-real-ip': ip },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  countMock.mockReset().mockResolvedValue(1);
  appendMock.mockClear();
  delete process.env.TURNSTILE_SECRET_KEY;
});

describe('SubmitEventSchema length caps', () => {
  it('rejects oversized fields', () => {
    const ok = { conference: 'Conf', event: { name: 'E', date: 'Mon' } };
    expect(SubmitEventSchema.safeParse(ok).success).toBe(true);
    expect(SubmitEventSchema.safeParse({ ...ok, event: { ...ok.event, name: 'x'.repeat(201) } }).success).toBe(false);
    expect(SubmitEventSchema.safeParse({ ...ok, event: { ...ok.event, note: 'x'.repeat(2001) } }).success).toBe(false);
    expect(SubmitEventSchema.safeParse({ ...ok, event: { ...ok.event, link: 'x'.repeat(2001) } }).success).toBe(false);
  });
  it('caps geocode batches', () => {
    const a = { normalized: 'a', raw: 'a', conference: 'c' };
    expect(GeocodeSchema.safeParse({ addresses: Array(51).fill(a) }).success).toBe(false);
    expect(GeocodeSchema.safeParse({ addresses: [{ ...a, raw: 'x'.repeat(501) }] }).success).toBe(false);
  });
});

describe('POST /api/submit-event rate limiting', () => {
  it('accepts a normal submission', async () => {
    const res = await submitPost(submitReq());
    expect(res.status).toBe(200);
  });
  it('429s when the persistent ledger says the IP is over its limit, without writing to the sheet', async () => {
    countMock.mockResolvedValue(6);
    const res = await submitPost(submitReq('8.8.8.8'));
    expect(res.status).toBe(429);
    expect(appendMock).not.toHaveBeenCalled();
  });
  it('429s via the in-memory fallback when the ledger is unreachable', async () => {
    countMock.mockResolvedValue(0);
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await submitPost(submitReq('7.7.7.7'))).status);
    expect(statuses.slice(0, 5).every((s) => s === 200)).toBe(true);
    expect(statuses[6]).toBe(429);
  });
  it('rejects a missing captcha token when Turnstile is configured', async () => {
    process.env.TURNSTILE_SECRET_KEY = 's';
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = 'k';
    const res = await submitPost(submitReq('6.6.6.6'));
    expect(res.status).toBe(400);
    delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  });
  it('returns a generic 500 without leaking the error message', async () => {
    appendMock.mockRejectedValueOnce(new Error('sheet token abc123 invalid'));
    const res = await submitPost(submitReq('5.5.5.5'));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('abc123');
  });
});

describe('POST /api/notify', () => {
  const notifyReq = (ip: string, email = 'a@b.co') =>
    new NextRequest('http://localhost/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-real-ip': ip },
      body: JSON.stringify({ email, conference_slug: 's', conference_name: 'n' }),
    });
  it('hides raw DB errors', async () => {
    const res = await notifyPost(notifyReq('4.4.4.4'));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('secret internal detail');
  });
  it('rejects over-long emails and rate limits per IP', async () => {
    expect((await notifyPost(notifyReq('3.3.3.3', `${'a'.repeat(250)}@b.co`))).status).toBe(400);
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await notifyPost(notifyReq('2.2.2.2'))).status);
    expect(statuses).toContain(429);
  });
});

describe('POST /api/geocode', () => {
  it('rate limits per IP', async () => {
    delete process.env.MAPBOX_TOKEN;
    delete process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    const mk = () =>
      new NextRequest('http://localhost/api/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-real-ip': '1.2.3.4' },
        body: JSON.stringify({ addresses: [] }),
      });
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await geocodePost(mk())).status);
    expect(statuses.slice(0, 10).every((s) => s === 500)).toBe(true); // no token configured, but past the limiter
    expect(statuses[11]).toBe(429);
  });
});
