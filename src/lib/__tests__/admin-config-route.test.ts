import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/ledger-rate-limit', () => ({
  countLedgerAttempts: async () => 0,
  recordLedgerAttempt: async () => {},
}));

const rows = [
  { key: 'conferences', value: [{ name: 'Secret Conf', hidden: true }] },
  { key: 'ab_tests', value: [
    { id: 'x', name: 'X', description: 'internal', status: 'running', placement: 'hero-copy', conference: '', winnerId: 'w', created_at: 'd', variants: [{ id: 'a', name: 'A', weight: 50, config: { t: 1 } }] },
    { id: 'y', status: 'draft', placement: 'p', variants: [] },
  ] },
  { key: 'theme:PBW', value: { c: 1 } },
  { key: 'sponsors', value: [{ name: 'S' }] },
  { key: 'native_ads', value: [] },
  { key: 'upsell_copy', value: { heading: 'h' } },
  { key: 'advertise_page:PBW', value: { a: 1 } },
  { key: 'ad_inventory:PBW', value: [] },
];
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: () => ({ select: async () => ({ data: rows, error: null }) }) }),
}));

import { GET } from '@/app/api/admin/config/route';

beforeEach(() => {
  process.env.ADMIN_PASSWORD = 'cfg-pass';
});

describe('GET /api/admin/config', () => {
  it('strips hidden conferences and non-public keys for anonymous callers', async () => {
    const res = await GET(new NextRequest('http://localhost/api/admin/config'));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.conferences).toBeUndefined();
    expect(json['theme:PBW']).toBeDefined();
    expect(json.ab_tests).toHaveLength(1);
    expect(json.ab_tests[0]).toEqual({ id: 'x', name: 'X', status: 'running', placement: 'hero-copy', conference: '', variants: [{ id: 'a', name: 'A', weight: 50, config: { t: 1 } }] });
    expect(json.sponsors).toBeDefined();
    expect(json.native_ads).toBeDefined();
    expect(json.upsell_copy).toBeDefined();
    expect(json['advertise_page:PBW']).toBeDefined();
    expect(json['ad_inventory:PBW']).toBeDefined();
  });

  it('returns the full config to an authenticated admin', async () => {
    const res = await GET(new NextRequest('http://localhost/api/admin/config', { headers: { 'x-admin-password': 'cfg-pass' } }));
    const json = await res.json();
    expect(json.conferences).toBeDefined();
    expect(json.ab_tests).toHaveLength(2);
    expect(json.ab_tests[0].description).toBe('internal');
  });

  it('401s on a wrong admin password instead of falling back to the public view', async () => {
    const res = await GET(new NextRequest('http://localhost/api/admin/config', { headers: { 'x-admin-password': 'bad' } }));
    expect(res.status).toBe(401);
  });
});
