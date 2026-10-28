// Admin approve must write sanitized tags to the sheet; zero valid tags still approves.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

process.env.ADMIN_PASSWORD = 'subs-test-password';

let submissionTags = 'Workshop, bogus';
const insertRowMock = vi.fn(async (..._a: unknown[]) => 7);

vi.mock('@/lib/google-sheets', () => ({
  insertEventRowSorted: (...a: unknown[]) => insertRowMock(...a),
  getSheetTitle: async () => 'Sheet',
  findReviewRow: async () => null,
  deleteSheetRow: async () => {},
  writeCell: async () => {},
}));
vi.mock('@/lib/get-conferences', () => ({
  getConferenceTabs: async () => [{ name: 'Conf', gid: 1 }],
}));
vi.mock('@/lib/fetch-events-cached', () => ({ invalidateEventsCache: () => {} }));
vi.mock('@/lib/geocoded-addresses', () => ({ writeGeocodedAddress: async () => {} }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.single = async () => ({
        data: {
          conference: 'Conf', event_name: 'E', event_date: 'Mon', start_time: '', end_time: '',
          organizer: '', address: '', cost: 'Free', tags: submissionTags, link: '',
          has_food: false, has_bar: false, note: '', coords_lat: null, coords_lng: null,
        },
        error: null,
      });
      chain.update = () => chain;
      chain.then = (res: (v: unknown) => void) => res({ error: null });
      return chain;
    },
  }),
}));

import { POST } from '@/app/api/admin/submissions/route';

const ID = '11111111-1111-4111-8111-111111111111';
const req = (edits?: { tags: string }) =>
  new NextRequest('http://localhost/api/admin/submissions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'subs-test-password', action: 'approve', id: ID, edits }),
  });

describe('admin approve tags', () => {
  beforeEach(() => insertRowMock.mockClear());

  it('sanitizes stored submission tags', async () => {
    submissionTags = 'Workshop, bogus, drinks';
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect((insertRowMock.mock.calls[0][2] as { tags: string }).tags).toBe('Panel/Talk, Bar/Pub');
  });

  it('sanitizes admin-edited tags', async () => {
    const res = await POST(req({ tags: 'Devs, nope' }));
    expect(res.status).toBe(200);
    expect((insertRowMock.mock.calls[0][2] as { tags: string }).tags).toBe('Devs/Builders');
  });

  it('approves with zero valid tags', async () => {
    submissionTags = 'Vibe, Free';
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect((insertRowMock.mock.calls[0][2] as { tags: string }).tags).toBe('');
  });
});
