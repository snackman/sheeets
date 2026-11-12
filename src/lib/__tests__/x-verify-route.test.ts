import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Identity = { provider: string; id: string; identity_data?: Record<string, unknown> };

let tokenUser: { id: string } | null = { id: 'u1' };
let identities: Identity[] = [];
let profileRows: { user_id: string }[] = [{ user_id: 'u1' }];
const updates: Record<string, unknown>[] = [];

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getUser: async () => (tokenUser ? { data: { user: tokenUser }, error: null } : { data: { user: null }, error: { message: 'bad' } }),
      admin: {
        getUserById: async (id: string) => ({ data: { user: { id, identities } }, error: null }),
      },
    },
    from: () => ({
      update: (patch: Record<string, unknown>) => {
        updates.push(patch);
        return {
          eq: () => {
            const result = Promise.resolve({ error: null });
            return Object.assign(result, { select: async () => ({ data: profileRows, error: null }) });
          },
        };
      },
    }),
  }),
}));

import { POST, DELETE } from '@/app/api/profile/x-verify/route';

let n = 0;
function req(method: 'POST' | 'DELETE', opts: { auth?: boolean } = { auth: true }) {
  return new NextRequest('http://localhost/api/profile/x-verify', {
    method,
    headers: {
      'x-real-ip': `12.0.0.${n++ % 250}`,
      ...(opts.auth ? { authorization: 'Bearer aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.bbbb.cccc' } : {}),
    },
  });
}

beforeEach(() => {
  tokenUser = { id: 'u1' };
  identities = [];
  profileRows = [{ user_id: 'u1' }];
  updates.length = 0;
});

describe('POST /api/profile/x-verify', () => {
  it('requires a bearer token', async () => {
    expect((await POST(req('POST', { auth: false }))).status).toBe(401);
    expect(updates).toHaveLength(0);
  });

  it('rejects an invalid token', async () => {
    tokenUser = null;
    expect((await POST(req('POST'))).status).toBe(401);
    expect(updates).toHaveLength(0);
  });

  it('rejects a caller with no linked X identity', async () => {
    identities = [{ provider: 'google', id: 'g1', identity_data: { email: 'a@b.c' } }];
    const res = await POST(req('POST'));
    expect(res.status).toBe(403);
    expect(updates).toHaveLength(0);
  });

  it('accepts a linked X identity and writes the verified columns server-side', async () => {
    identities = [{ provider: 'twitter', id: 'tw-123', identity_data: { user_name: 'alice_eth', avatar_url: 'https://pbs.twimg.com/a.jpg' } }];
    const res = await POST(req('POST'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ x_verified: true, x_handle: 'alice_eth' });
    expect(updates[0]).toMatchObject({ x_handle: 'alice_eth', x_verified: true, x_oauth_id: 'tw-123' });
  });

  it('rejects a handle that is not a valid X handle', async () => {
    identities = [{ provider: 'twitter', id: 'tw-1', identity_data: { user_name: 'bad handle!' } }];
    expect((await POST(req('POST'))).status).toBe(422);
    expect(updates).toHaveLength(0);
  });

  it('404s when the caller has no profile row', async () => {
    identities = [{ provider: 'twitter', id: 'tw-1', identity_data: { user_name: 'alice' } }];
    profileRows = [];
    expect((await POST(req('POST'))).status).toBe(404);
  });
});

describe('DELETE /api/profile/x-verify', () => {
  it('refuses to clear verification while X is still linked', async () => {
    identities = [{ provider: 'twitter', id: 'tw-1', identity_data: { user_name: 'alice' } }];
    expect((await DELETE(req('DELETE'))).status).toBe(409);
    expect(updates).toHaveLength(0);
  });

  it('clears verification once X is unlinked', async () => {
    const res = await DELETE(req('DELETE'));
    expect(res.status).toBe(200);
    expect(updates[0]).toMatchObject({ x_verified: false, x_oauth_id: null });
  });
});
