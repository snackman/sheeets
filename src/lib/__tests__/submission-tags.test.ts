// Tags written to the sheet by the public submit route must be sanitized to
// the sheet's dropdown values; zero valid tags stays a valid submission.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { sanitizeSheetTagString } from '@/lib/ingest/sheet-tags';

const appendEventRowMock = vi.fn(async (..._a: unknown[]) => 42);
const insertMock = vi.fn(async (..._a: unknown[]) => ({}));

vi.mock('@/lib/google-sheets', () => ({
  appendEventRow: (...a: unknown[]) => appendEventRowMock(...a),
  getSheetTitle: async () => 'Sheet',
}));
vi.mock('@/lib/get-conferences', () => ({
  getConferenceTabs: async () => [{ name: 'Conf', gid: 1 }],
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: () => ({ insert: (...a: unknown[]) => insertMock(...a) }) }),
}));

import { POST } from '@/app/api/submit-event/route';

const req = (tags: string) =>
  new NextRequest('http://localhost/api/submit-event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conference: 'Conf', event: { name: 'E', date: 'Mon', tags } }),
  });

describe('sanitizeSheetTagString', () => {
  it('maps aliases, drops unknowns, dedupes', () => {
    expect(sanitizeSheetTagString('devs, DRINKS, nonsense, Devs/Builders, ai')).toBe('Devs/Builders, Bar/Pub, AI');
  });
  it('returns empty for empty/invalid input', () => {
    expect(sanitizeSheetTagString('')).toBe('');
    expect(sanitizeSheetTagString('foo, nonsense')).toBe('');
    expect(sanitizeSheetTagString(undefined)).toBe('');
  });
});

describe('picker tag aliases', () => {
  it.each([
    ['Workshop', 'Panel/Talk'], ['Session', 'Panel/Talk'], ['Education', 'Panel/Talk'],
    ['Demo Day', 'Panel/Talk'], ['Showcase', 'Panel/Talk'], ['Meetup', 'Networking'],
    ['Activation', 'Networking'], ['Founders', 'Devs/Builders'], ['Tech', 'Devs/Builders'],
    ['Lounge', 'Bar/Pub'], ['Music', 'Performance'], ['Comedy', 'Performance'],
    ['Screening', 'Performance'], ['Exhibition', 'Art'], ['Film/TV', 'Art'], ['Culture', 'Art'],
  ])('%s -> %s', (raw, want) => {
    expect(sanitizeSheetTagString(raw)).toBe(want);
  });
  it('drops Special Event, Vibe, Free', () => {
    expect(sanitizeSheetTagString('Special Event, Vibe, Free')).toBe('');
  });
});

describe('POST /api/submit-event tags', () => {
  beforeEach(() => {
    appendEventRowMock.mockClear();
    insertMock.mockClear();
  });

  it('sanitizes tags for the sheet but stores raw tags in Supabase', async () => {
    const res = await POST(req('Devs, Drinks, bogus'));
    expect(res.status).toBe(200);
    expect((appendEventRowMock.mock.calls[0][1] as { tags: string }).tags).toBe('Devs/Builders, Bar/Pub');
    expect((insertMock.mock.calls[0][0] as { tags: string }).tags).toBe('Devs, Drinks, bogus');
  });

  it('keeps the submission valid with zero valid tags', async () => {
    const res = await POST(req('bogus'));
    expect(res.status).toBe(200);
    expect((appendEventRowMock.mock.calls[0][1] as { tags: string }).tags).toBe('');
  });
});
