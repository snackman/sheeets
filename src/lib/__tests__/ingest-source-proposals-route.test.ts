// Route tests for /api/admin/ingest/source-proposals (plan item 3's
// Accept/Dismiss flow). Focused on review finding, LOW item 5: accepting
// a proposal whose calendar already exists as a source must be a no-op
// success, not a 500.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

process.env.ADMIN_PASSWORD = 'proposals-test-password';

const listSourceProposalsMock = vi.fn(async (..._args: unknown[]) => [] as unknown[]);
const getSourceProposalByIdMock = vi.fn(async (..._args: unknown[]) => null as unknown);
const decideSourceProposalMock = vi.fn(async (..._args: unknown[]) => {});
// `enabled: true` by default — most tests aren't exercising the "re-enable
// a disabled source" minor fix, so the happy path shouldn't trip it.
const createLumaIcalSourceIdempotentMock = vi.fn(async (..._args: unknown[]) => ({ id: 'src-1', enabled: true }) as unknown);
const getProfileMock = vi.fn(async (..._args: unknown[]) => null as { auto_publish_enabled: boolean } | null);
const updateSourceMock = vi.fn(async (..._args: unknown[]) => {});

vi.mock('@/lib/ingest/db', () => ({
  listSourceProposals: (...a: unknown[]) => listSourceProposalsMock(...a),
  getSourceProposalById: (...a: unknown[]) => getSourceProposalByIdMock(...a),
  decideSourceProposal: (...a: unknown[]) => decideSourceProposalMock(...a),
  createLumaIcalSourceIdempotent: (...a: unknown[]) => createLumaIcalSourceIdempotentMock(...a),
  getProfile: (...a: unknown[]) => getProfileMock(...a),
  updateSource: (...a: unknown[]) => updateSourceMock(...a),
}));

import { GET, POST } from '@/app/api/admin/ingest/source-proposals/route';

function getRequest(params: Record<string, string>) {
  return new NextRequest(`http://localhost/api/admin/ingest/source-proposals?${new URLSearchParams(params)}`);
}

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/admin/ingest/source-proposals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getProfileMock.mockResolvedValue(null);
});

describe('GET /api/admin/ingest/source-proposals', () => {
  it('401s without the admin password', async () => {
    const res = await GET(getRequest({ conference: 'DAS London' }));
    expect(res.status).toBe(401);
  });

  it('lists only "proposed" proposals for the conference', async () => {
    listSourceProposalsMock.mockResolvedValue([{ id: '11111111-1111-4111-8111-111111111111', status: 'proposed' }]);
    const res = await GET(getRequest({ password: 'proposals-test-password', conference: 'DAS London' }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.proposals).toEqual([{ id: '11111111-1111-4111-8111-111111111111', status: 'proposed' }]);
    expect(listSourceProposalsMock).toHaveBeenCalledWith('DAS London', 'proposed');
  });
});

describe('POST /api/admin/ingest/source-proposals: decide (accept/dismiss)', () => {
  const proposal = { id: '11111111-1111-4111-8111-111111111111', conference: 'DAS London', calendar_api_id: 'cal-abc', calendar_name: 'The Best Event', status: 'proposed' };

  it('404s when the proposal does not exist', async () => {
    getSourceProposalByIdMock.mockResolvedValue(null);
    const res = await POST(postRequest({ password: 'proposals-test-password', id: '22222222-2222-4222-8222-222222222222', decision: 'accepted' }));
    expect(res.status).toBe(404);
  });

  it('refuses to re-decide an already-decided proposal', async () => {
    getSourceProposalByIdMock.mockResolvedValue({ ...proposal, status: 'dismissed' });
    const res = await POST(postRequest({ password: 'proposals-test-password', id: '11111111-1111-4111-8111-111111111111', decision: 'accepted' }));
    expect(res.status).toBe(400);
    expect(createLumaIcalSourceIdempotentMock).not.toHaveBeenCalled();
  });

  it('accept: creates the curated luma_ical source and marks the proposal accepted', async () => {
    getSourceProposalByIdMock.mockResolvedValue(proposal);
    createLumaIcalSourceIdempotentMock.mockResolvedValue({ id: 'src-1', enabled: true });
    const res = await POST(postRequest({ password: 'proposals-test-password', id: '11111111-1111-4111-8111-111111111111', decision: 'accepted' }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(createLumaIcalSourceIdempotentMock).toHaveBeenCalledWith(
      expect.objectContaining({ conference: 'DAS London', calendar_api_id: 'cal-abc', trust: 'curated' })
    );
    expect(decideSourceProposalMock).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', 'accepted', 'admin');
  });

  // Review finding, LOW item 5.
  it('accept: when the calendar already exists as a source (idempotent helper absorbs the 23505), still returns success and marks the proposal accepted', async () => {
    getSourceProposalByIdMock.mockResolvedValue(proposal);
    // `createLumaIcalSourceIdempotent` itself never throws on a duplicate —
    // it resolves to the EXISTING row (see its own db.ts tests) — so the
    // route just needs to not treat that as anything other than success.
    createLumaIcalSourceIdempotentMock.mockResolvedValue({ id: 'src-existing', enabled: true });
    const res = await POST(postRequest({ password: 'proposals-test-password', id: '11111111-1111-4111-8111-111111111111', decision: 'accepted' }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(decideSourceProposalMock).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', 'accepted', 'admin');
  });

  it('accept: forces discovery trust when auto-publish is already enabled for the conference', async () => {
    getSourceProposalByIdMock.mockResolvedValue(proposal);
    getProfileMock.mockResolvedValue({ auto_publish_enabled: true });
    createLumaIcalSourceIdempotentMock.mockResolvedValue({ id: 'src-1', enabled: true });
    await POST(postRequest({ password: 'proposals-test-password', id: '11111111-1111-4111-8111-111111111111', decision: 'accepted' }));
    expect(createLumaIcalSourceIdempotentMock).toHaveBeenCalledWith(expect.objectContaining({ trust: 'discovery' }));
  });

  // Minor review finding: Accept must re-enable an existing-but-disabled
  // source (e.g. the idempotent-duplicate case resolved to a source an
  // admin had turned off) rather than silently leaving it disabled.
  it('accept: re-enables an existing source that is currently disabled', async () => {
    getSourceProposalByIdMock.mockResolvedValue(proposal);
    createLumaIcalSourceIdempotentMock.mockResolvedValue({ id: 'src-disabled', enabled: false });
    const res = await POST(postRequest({ password: 'proposals-test-password', id: '11111111-1111-4111-8111-111111111111', decision: 'accepted' }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.reenabled).toBe(true);
    expect(updateSourceMock).toHaveBeenCalledWith('src-disabled', { enabled: true });
    expect(decideSourceProposalMock).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', 'accepted', 'admin');
  });

  it('accept: does NOT touch an already-enabled source', async () => {
    getSourceProposalByIdMock.mockResolvedValue(proposal);
    createLumaIcalSourceIdempotentMock.mockResolvedValue({ id: 'src-1', enabled: true });
    const res = await POST(postRequest({ password: 'proposals-test-password', id: '11111111-1111-4111-8111-111111111111', decision: 'accepted' }));
    const json = await res.json();
    expect(json.reenabled).toBeUndefined();
    expect(updateSourceMock).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it('dismiss: never creates a source, just marks the proposal dismissed', async () => {
    getSourceProposalByIdMock.mockResolvedValue(proposal);
    const res = await POST(postRequest({ password: 'proposals-test-password', id: '11111111-1111-4111-8111-111111111111', decision: 'dismissed' }));
    expect(res.status).toBe(200);
    expect(createLumaIcalSourceIdempotentMock).not.toHaveBeenCalled();
    expect(decideSourceProposalMock).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', 'dismissed', 'admin');
  });
});
