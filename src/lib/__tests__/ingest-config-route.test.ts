import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

process.env.ADMIN_PASSWORD = 'config-test-password';

const getProfileMock = vi.fn();
const upsertProfileMock = vi.fn(async (...args: unknown[]) => args[0]);
const updateProfilePatchMock = vi.fn(async (...args: unknown[]) => args[1]);
const getSourceMock = vi.fn();
const updateSourceMock = vi.fn(async (..._args: unknown[]) => {});
const createSourceMock = vi.fn(async (...args: unknown[]) => args[0]);
const seedProfileRowMock = vi.fn((conference: string, themeKey: string) => ({
  conference,
  theme_key: themeKey,
  theme_description: '',
  include_keywords: [],
  exclude_keywords: [],
  trusted_hosts: [],
  blocked_hosts: [],
  publish_threshold: 85,
  review_threshold: 40,
  auto_publish_enabled: false,
  radius_km: 40,
  window_pre_days: 3,
  window_post_days: 1,
  allow_online: false,
  max_llm_calls_per_run: 150,
  max_publish_per_run: 25,
  enabled: true,
  auto_publish_killed_at: null,
  auto_publish_kill_reason: null,
  auto_publish_enabled_at: null,
}));

vi.mock('@/lib/ingest/db', () => ({
  listProfiles: vi.fn(async () => []),
  listSources: vi.fn(async () => []),
  getProfile: (...a: unknown[]) => getProfileMock(...a),
  upsertProfile: (...a: unknown[]) => upsertProfileMock(...a),
  updateProfilePatch: (...a: unknown[]) => updateProfilePatchMock(...a),
  seedProfileRow: (conference: string, themeKey: string) => seedProfileRowMock(conference, themeKey),
  createSource: (...a: unknown[]) => createSourceMock(...a),
  updateSource: (...a: unknown[]) => updateSourceMock(...a),
  deleteSource: vi.fn(async () => {}),
  getSource: (...a: unknown[]) => getSourceMock(...a),
}));

const evaluateAutoPublishEnableGateMock = vi.fn();
vi.mock('@/lib/ingest/gate', () => ({
  evaluateAutoPublishEnableGate: (...a: unknown[]) => evaluateAutoPublishEnableGateMock(...a),
}));

vi.mock('@/lib/ingest/sources/luma-ical', () => ({
  resolveLumaCalendar: vi.fn(async () => ({ apiId: 'cal-TEST1234', slug: 'test-cal', name: 'Test Calendar' })),
  fetchLumaIcalFeed: vi.fn(),
  toIcalCandidates: vi.fn(() => []),
}));

vi.mock('@/lib/ingest/filters', () => ({
  isPastEvent: vi.fn(() => false),
}));

import { PUT, PATCH, POST } from '../../app/api/admin/ingest/config/route';

function putRequest(body: unknown) {
  return new NextRequest('http://localhost/api/admin/ingest/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function patchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/admin/ingest/config', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/admin/ingest/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('PUT /api/admin/ingest/config: server-side auto-publish gate (§13.2)', () => {
  beforeEach(() => {
    getProfileMock.mockReset();
    upsertProfileMock.mockClear();
    updateProfilePatchMock.mockClear();
    evaluateAutoPublishEnableGateMock.mockReset();
  });

  it('refuses to enable auto-publish when the gate is not met', async () => {
    getProfileMock.mockResolvedValue({ conference: 'Test Conf', theme_key: 'crypto', auto_publish_enabled: false, publish_threshold: 85 });
    evaluateAutoPublishEnableGateMock.mockResolvedValue({
      eligible: false,
      sample: { sampleSize: 10, positive: 10, precision: 1 },
      minSampleSize: 50,
      threshold: 0.95,
      reason: 'Needs 50+ labeled items at the publish threshold (have 10).',
    });

    const res = await PUT(putRequest({ password: 'config-test-password', conference: 'Test Conf', theme_key: 'crypto', auto_publish_enabled: true }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/Cannot enable auto-publish yet/);
    expect(upsertProfileMock).not.toHaveBeenCalled();
    expect(updateProfilePatchMock).not.toHaveBeenCalled();
  });

  it('allows enabling auto-publish when the gate is met, clears any prior kill-switch record, and writes ONLY the patch (existing row -> updateProfilePatch, review finding MEDIUM item 7)', async () => {
    getProfileMock.mockResolvedValue({
      conference: 'Test Conf',
      theme_key: 'crypto',
      auto_publish_enabled: false,
      publish_threshold: 85,
      auto_publish_killed_at: '2027-01-01T00:00:00.000Z',
      auto_publish_kill_reason: 'previously killed',
    });
    evaluateAutoPublishEnableGateMock.mockResolvedValue({
      eligible: true,
      sample: { sampleSize: 60, positive: 58, precision: 58 / 60 },
      minSampleSize: 50,
      threshold: 0.95,
      reason: 'Meets the gate.',
    });

    const res = await PUT(putRequest({ password: 'config-test-password', conference: 'Test Conf', theme_key: 'crypto', auto_publish_enabled: true }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.profile.auto_publish_enabled).toBe(true);
    expect(upsertProfileMock).not.toHaveBeenCalled(); // existing row -> never the full-row path
    expect(updateProfilePatchMock).toHaveBeenCalledWith(
      'Test Conf',
      expect.objectContaining({ auto_publish_enabled: true, auto_publish_killed_at: null, auto_publish_kill_reason: null })
    );
    // The patch sent must NOT include fields the admin didn't touch (e.g.
    // radius_km) — only what was actually in the request (review finding,
    // MEDIUM item 7: never resend a full previously-read row).
    const sentPatch = updateProfilePatchMock.mock.calls[0][1];
    expect(sentPatch).not.toHaveProperty('radius_km');
    expect(sentPatch).toHaveProperty('auto_publish_enabled_at'); // the fresh-enable timestamp IS set
  });

  it('writes the full seeded row via upsertProfile for a BRAND NEW profile (no existing row to clobber)', async () => {
    getProfileMock.mockResolvedValue(null);

    const res = await PUT(putRequest({ password: 'config-test-password', conference: 'New Conf', theme_key: 'crypto', enabled: true }));
    expect(res.status).toBe(200);
    expect(upsertProfileMock).toHaveBeenCalled();
    expect(updateProfilePatchMock).not.toHaveBeenCalled();
  });

  it('does not re-check the gate when auto-publish is already enabled and unrelated fields are saved, and uses updateProfilePatch', async () => {
    getProfileMock.mockResolvedValue({ conference: 'Test Conf', theme_key: 'crypto', auto_publish_enabled: true, publish_threshold: 85 });

    const res = await PUT(putRequest({ password: 'config-test-password', conference: 'Test Conf', theme_key: 'crypto', radius_km: 50 }));
    expect(res.status).toBe(200);
    expect(evaluateAutoPublishEnableGateMock).not.toHaveBeenCalled();
    expect(updateProfilePatchMock).toHaveBeenCalled();
    expect(upsertProfileMock).not.toHaveBeenCalled();
  });

  it('does not gate turning auto-publish off', async () => {
    getProfileMock.mockResolvedValue({ conference: 'Test Conf', theme_key: 'crypto', auto_publish_enabled: true, publish_threshold: 85 });

    const res = await PUT(putRequest({ password: 'config-test-password', conference: 'Test Conf', theme_key: 'crypto', auto_publish_enabled: false }));
    expect(res.status).toBe(200);
    expect(evaluateAutoPublishEnableGateMock).not.toHaveBeenCalled();
  });

  it('rejects an unauthorized request before touching the gate', async () => {
    const res = await PUT(putRequest({ password: 'wrong', conference: 'Test Conf', theme_key: 'crypto', auto_publish_enabled: true }));
    expect(res.status).toBe(401);
    expect(evaluateAutoPublishEnableGateMock).not.toHaveBeenCalled();
  });

  describe('gate bypass via threshold (review finding, CRITICAL item 3)', () => {
    it('rejects changing publish_threshold while auto-publish is already on', async () => {
      getProfileMock.mockResolvedValue({ conference: 'Test Conf', theme_key: 'crypto', auto_publish_enabled: true, publish_threshold: 85 });

      const res = await PUT(putRequest({ password: 'config-test-password', conference: 'Test Conf', theme_key: 'crypto', publish_threshold: 40 }));
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toMatch(/Cannot change the publish threshold/);
      expect(updateProfilePatchMock).not.toHaveBeenCalled();
      expect(upsertProfileMock).not.toHaveBeenCalled();
    });

    it('rejects lowering publish_threshold in the SAME request that turns auto-publish on', async () => {
      getProfileMock.mockResolvedValue({ conference: 'Test Conf', theme_key: 'crypto', auto_publish_enabled: false, publish_threshold: 85 });
      // Even if the gate WOULD pass, the threshold change must still be refused.
      evaluateAutoPublishEnableGateMock.mockResolvedValue({ eligible: true, sample: { sampleSize: 60, positive: 59, precision: 59 / 60 }, minSampleSize: 50, threshold: 0.95, reason: 'Meets the gate.' });

      const res = await PUT(
        putRequest({ password: 'config-test-password', conference: 'Test Conf', theme_key: 'crypto', auto_publish_enabled: true, publish_threshold: 40 })
      );
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toMatch(/Cannot change the publish threshold/);
      expect(evaluateAutoPublishEnableGateMock).not.toHaveBeenCalled(); // rejected before even reaching the gate check
    });

    it('allows setting publish_threshold on a BRAND NEW profile (no prior threshold to "change")', async () => {
      getProfileMock.mockResolvedValue(null);
      const res = await PUT(putRequest({ password: 'config-test-password', conference: 'New Conf', theme_key: 'crypto', publish_threshold: 70 }));
      expect(res.status).toBe(200);
    });

    it('allows changing publish_threshold when auto-publish is off and not being turned on', async () => {
      getProfileMock.mockResolvedValue({ conference: 'Test Conf', theme_key: 'crypto', auto_publish_enabled: false, publish_threshold: 85 });
      const res = await PUT(putRequest({ password: 'config-test-password', conference: 'Test Conf', theme_key: 'crypto', publish_threshold: 40 }));
      expect(res.status).toBe(200);
    });

    it('allows re-saving the SAME publish_threshold value while auto-publish is on (not actually a change)', async () => {
      getProfileMock.mockResolvedValue({ conference: 'Test Conf', theme_key: 'crypto', auto_publish_enabled: true, publish_threshold: 85 });
      const res = await PUT(putRequest({ password: 'config-test-password', conference: 'Test Conf', theme_key: 'crypto', publish_threshold: 85 }));
      expect(res.status).toBe(200);
    });
  });
});

describe('PATCH /api/admin/ingest/config: gate bypass via discovery-trust (review finding, CRITICAL item 3)', () => {
  beforeEach(() => {
    getSourceMock.mockReset();
    getProfileMock.mockReset();
    updateSourceMock.mockClear();
  });

  it('rejects changing a source\'s trust level while auto-publish is enabled for its conference', async () => {
    getSourceMock.mockResolvedValue({ id: '3fa85f64-5717-4562-b3fc-2c963f66afa6', conference: 'Test Conf', trust: 'discovery' });
    getProfileMock.mockResolvedValue({ conference: 'Test Conf', auto_publish_enabled: true });

    const res = await PATCH(patchRequest({ password: 'config-test-password', id: '3fa85f64-5717-4562-b3fc-2c963f66afa6', trust: 'curated' }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/Cannot change a source's trust level/);
    expect(updateSourceMock).not.toHaveBeenCalled();
  });

  it('allows changing trust when auto-publish is OFF for that conference', async () => {
    getSourceMock.mockResolvedValue({ id: '3fa85f64-5717-4562-b3fc-2c963f66afa6', conference: 'Test Conf', trust: 'discovery' });
    getProfileMock.mockResolvedValue({ conference: 'Test Conf', auto_publish_enabled: false });

    const res = await PATCH(patchRequest({ password: 'config-test-password', id: '3fa85f64-5717-4562-b3fc-2c963f66afa6', trust: 'curated' }));
    expect(res.status).toBe(200);
    expect(updateSourceMock).toHaveBeenCalled();
  });

  it('allows re-saving the SAME trust value while auto-publish is on (not actually a change)', async () => {
    getSourceMock.mockResolvedValue({ id: '3fa85f64-5717-4562-b3fc-2c963f66afa6', conference: 'Test Conf', trust: 'curated' });
    getProfileMock.mockResolvedValue({ conference: 'Test Conf', auto_publish_enabled: true });

    const res = await PATCH(patchRequest({ password: 'config-test-password', id: '3fa85f64-5717-4562-b3fc-2c963f66afa6', trust: 'curated' }));
    expect(res.status).toBe(200);
  });

  it('allows an update that does not touch trust at all, regardless of auto-publish', async () => {
    getSourceMock.mockResolvedValue({ id: '3fa85f64-5717-4562-b3fc-2c963f66afa6', conference: 'Test Conf', trust: 'discovery' });
    getProfileMock.mockResolvedValue({ conference: 'Test Conf', auto_publish_enabled: true });

    const res = await PATCH(patchRequest({ password: 'config-test-password', id: '3fa85f64-5717-4562-b3fc-2c963f66afa6', enabled: false }));
    expect(res.status).toBe(200);
    expect(getProfileMock).not.toHaveBeenCalled(); // never even needed to check — trust wasn't in the patch
    expect(updateSourceMock).toHaveBeenCalled();
  });
});

describe('POST /api/admin/ingest/config: new sources while auto-publish is on (review finding, MEDIUM item 2a)', () => {
  beforeEach(() => {
    getProfileMock.mockReset();
    createSourceMock.mockClear();
  });

  it('forces a brand-new source to discovery trust when the conference has auto-publish on, even if curated/host was requested', async () => {
    getProfileMock.mockResolvedValue({ conference: 'Test Conf', auto_publish_enabled: true });

    const res = await POST(postRequest({ password: 'config-test-password', conference: 'Test Conf', kind: 'luma_ical', input: 'luma.com/test-cal', trust: 'curated' }));
    expect(res.status).toBe(200);
    expect(createSourceMock).toHaveBeenCalledWith(expect.objectContaining({ trust: 'discovery' }));
  });

  it('uses the requested (or default curated) trust when auto-publish is off', async () => {
    getProfileMock.mockResolvedValue({ conference: 'Test Conf', auto_publish_enabled: false });

    const res = await POST(postRequest({ password: 'config-test-password', conference: 'Test Conf', kind: 'luma_ical', input: 'luma.com/test-cal', trust: 'host' }));
    expect(res.status).toBe(200);
    expect(createSourceMock).toHaveBeenCalledWith(expect.objectContaining({ trust: 'host' }));
  });

  it('defaults to curated (not discovery) when there is no profile yet for the conference', async () => {
    getProfileMock.mockResolvedValue(null);

    const res = await POST(postRequest({ password: 'config-test-password', conference: 'Brand New Conf', kind: 'luma_ical', input: 'luma.com/test-cal' }));
    expect(res.status).toBe(200);
    expect(createSourceMock).toHaveBeenCalledWith(expect.objectContaining({ trust: 'curated' }));
  });
});

describe('PUT /api/admin/ingest/config: blocks ADDING include_keywords/trusted_hosts while auto-publish is on (review finding, MEDIUM item 2b)', () => {
  beforeEach(() => {
    getProfileMock.mockReset();
    updateProfilePatchMock.mockClear();
    upsertProfileMock.mockClear();
  });

  it('rejects adding an include keyword while auto-publish is on', async () => {
    getProfileMock.mockResolvedValue({
      conference: 'Test Conf', theme_key: 'crypto', auto_publish_enabled: true, publish_threshold: 85,
      include_keywords: ['defi'], trusted_hosts: [],
    });

    const res = await PUT(putRequest({ password: 'config-test-password', conference: 'Test Conf', theme_key: 'crypto', include_keywords: ['defi', 'nft'] }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/Cannot add include keywords/);
    expect(updateProfilePatchMock).not.toHaveBeenCalled();
  });

  it('allows REMOVING an include keyword while auto-publish is on (only lowers scores)', async () => {
    getProfileMock.mockResolvedValue({
      conference: 'Test Conf', theme_key: 'crypto', auto_publish_enabled: true, publish_threshold: 85,
      include_keywords: ['defi', 'nft'], trusted_hosts: [],
    });

    const res = await PUT(putRequest({ password: 'config-test-password', conference: 'Test Conf', theme_key: 'crypto', include_keywords: ['defi'] }));
    expect(res.status).toBe(200);
    expect(updateProfilePatchMock).toHaveBeenCalled();
  });

  it('allows adding an include keyword when auto-publish is off', async () => {
    getProfileMock.mockResolvedValue({
      conference: 'Test Conf', theme_key: 'crypto', auto_publish_enabled: false, publish_threshold: 85,
      include_keywords: ['defi'], trusted_hosts: [],
    });

    const res = await PUT(putRequest({ password: 'config-test-password', conference: 'Test Conf', theme_key: 'crypto', include_keywords: ['defi', 'nft'] }));
    expect(res.status).toBe(200);
  });

  it('rejects adding a trusted host while auto-publish is on', async () => {
    getProfileMock.mockResolvedValue({
      conference: 'Test Conf', theme_key: 'crypto', auto_publish_enabled: true, publish_threshold: 85,
      include_keywords: [], trusted_hosts: [{ kind: 'organizer', name: 'Existing Org' }],
    });

    const res = await PUT(
      putRequest({
        password: 'config-test-password',
        conference: 'Test Conf',
        theme_key: 'crypto',
        trusted_hosts: [{ kind: 'organizer', name: 'Existing Org' }, { kind: 'organizer', name: 'New Org' }],
      })
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/Cannot add trusted hosts/);
    expect(updateProfilePatchMock).not.toHaveBeenCalled();
  });

  it('allows REMOVING a trusted host while auto-publish is on', async () => {
    getProfileMock.mockResolvedValue({
      conference: 'Test Conf', theme_key: 'crypto', auto_publish_enabled: true, publish_threshold: 85,
      include_keywords: [], trusted_hosts: [{ kind: 'organizer', name: 'Existing Org' }, { kind: 'organizer', name: 'Other Org' }],
    });

    const res = await PUT(
      putRequest({
        password: 'config-test-password',
        conference: 'Test Conf',
        theme_key: 'crypto',
        trusted_hosts: [{ kind: 'organizer', name: 'Existing Org' }],
      })
    );
    expect(res.status).toBe(200);
    expect(updateProfilePatchMock).toHaveBeenCalled();
  });

  it('allows adding a trusted host for a BRAND NEW profile (no prior list to compare against)', async () => {
    getProfileMock.mockResolvedValue(null);

    const res = await PUT(
      putRequest({ password: 'config-test-password', conference: 'New Conf', theme_key: 'crypto', trusted_hosts: [{ kind: 'organizer', name: 'New Org' }] })
    );
    expect(res.status).toBe(200);
  });

  it('does not block exclude_keywords or blocked_hosts changes (only lowers scores — left untouched by this guard)', async () => {
    getProfileMock.mockResolvedValue({
      conference: 'Test Conf', theme_key: 'crypto', auto_publish_enabled: true, publish_threshold: 85,
      include_keywords: [], trusted_hosts: [], exclude_keywords: ['scam'], blocked_hosts: [],
    });

    const res = await PUT(
      putRequest({
        password: 'config-test-password',
        conference: 'Test Conf',
        theme_key: 'crypto',
        exclude_keywords: ['scam', 'rug'],
        blocked_hosts: [{ kind: 'organizer', name: 'Bad Org' }],
      })
    );
    expect(res.status).toBe(200);
  });
});
