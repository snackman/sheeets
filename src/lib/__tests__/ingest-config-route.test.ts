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

const recordAdhocXCostMock = vi.fn(async (..._args: unknown[]) => {});
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
  recordAdhocXCost: (...a: unknown[]) => recordAdhocXCostMock(...a),
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

const isXConfiguredMock = vi.fn(() => true);
const resolveXUserMock = vi.fn(async (handle: string) => ({ id: `uid-${handle}`, username: handle, name: handle }));
vi.mock('@/lib/ingest/sources/x', () => ({
  isXConfigured: () => isXConfiguredMock(),
  normalizeXHandle: (input: string) => {
    const raw = input.trim().replace(/^@/, '');
    return /^[A-Za-z0-9_]{1,15}$/.test(raw) ? raw : null;
  },
  resolveXUser: (handle: string) => resolveXUserMock(handle),
  X_USER_READ_COST_USD: 0.01,
}));

const isMeetupConfiguredMock = vi.fn(() => false);
vi.mock('@/lib/ingest/sources/meetup', () => ({
  isMeetupConfigured: () => isMeetupConfiguredMock(),
}));

const checkMonthlyXBudgetMock = vi.fn(async () => ({ spentUsd: 0, capUsd: 15, exceeded: false }));
vi.mock('@/lib/ingest/budget', () => ({
  checkMonthlyXBudget: () => checkMonthlyXBudgetMock(),
}));

import { PUT, PATCH, POST, GET } from '../../app/api/admin/ingest/config/route';

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

function getRequest(params: Record<string, string>) {
  const url = new URL('http://localhost/api/admin/ingest/config');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url);
}

describe('GET /api/admin/ingest/config: sourceAvailability (Phase 4, §9.1 item 4)', () => {
  beforeEach(() => {
    isXConfiguredMock.mockReset().mockReturnValue(true);
    isMeetupConfiguredMock.mockReset().mockReturnValue(false);
  });

  it('reports whether X and Meetup are configured, and the credential-free kinds as always true', async () => {
    const res = await GET(getRequest({ password: 'config-test-password' }));
    const json = await res.json();
    expect(json.sourceAvailability).toEqual({
      luma_ical: true,
      telegram_channel: true,
      x_account: true,
      meetup_search: false,
      sponsor_pages: true,
      mira_series: true,
      sheet_tracker: true,
    });
  });
});

describe('POST /api/admin/ingest/config: Phase 4 source kinds (§3.6/§3.7/§3.3, §10 item 4)', () => {
  beforeEach(() => {
    createSourceMock.mockClear();
    isXConfiguredMock.mockReset().mockReturnValue(true);
    resolveXUserMock.mockClear();
    isMeetupConfiguredMock.mockReset().mockReturnValue(false);
    checkMonthlyXBudgetMock.mockReset().mockResolvedValue({ spentUsd: 0, capUsd: 15, exceeded: false });
    recordAdhocXCostMock.mockClear();
  });

  it('x_account: normalizes the handle, resolves the user id, and forces discovery trust', async () => {
    const res = await POST(postRequest({ password: 'config-test-password', conference: 'Test Conf', kind: 'x_account', input: '@EthSideEvents' }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(resolveXUserMock).toHaveBeenCalledWith('EthSideEvents');
    expect(createSourceMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'x_account', trust: 'discovery', config: { handle: 'EthSideEvents', userId: 'uid-EthSideEvents' } })
    );
    expect(json.source).toBeTruthy();
  });

  it('x_account: rejects an invalid handle without calling resolveXUser', async () => {
    const res = await POST(postRequest({ password: 'config-test-password', conference: 'Test Conf', kind: 'x_account', input: 'not a handle!' }));
    expect(res.status).toBe(400);
    expect(resolveXUserMock).not.toHaveBeenCalled();
  });

  it('x_account: rejects when X is not configured (disabled-when-unconfigured, item 1)', async () => {
    isXConfiguredMock.mockReturnValue(false);
    const res = await POST(postRequest({ password: 'config-test-password', conference: 'Test Conf', kind: 'x_account', input: 'ethsideevents' }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toMatch(/not configured/i);
    expect(resolveXUserMock).not.toHaveBeenCalled();
  });

  // Re-review item 9: resolveXUser is a billable "User: Read" - check the
  // monthly X budget before spending it, and record it once spent.
  it('x_account: rejects when the monthly X budget is already exceeded, without calling resolveXUser', async () => {
    checkMonthlyXBudgetMock.mockResolvedValue({ spentUsd: 15, capUsd: 15, exceeded: true });
    const res = await POST(postRequest({ password: 'config-test-password', conference: 'Test Conf', kind: 'x_account', input: 'ethsideevents' }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toMatch(/budget/i);
    expect(resolveXUserMock).not.toHaveBeenCalled();
    expect(recordAdhocXCostMock).not.toHaveBeenCalled();
  });

  it('x_account: records the $0.01 "User: Read" cost once the lookup succeeds', async () => {
    const res = await POST(postRequest({ password: 'config-test-password', conference: 'Test Conf', kind: 'x_account', input: 'ethsideevents' }));
    expect(res.status).toBe(200);
    expect(recordAdhocXCostMock).toHaveBeenCalledWith('Test Conf', 0.01);
  });

  it('x_account: does not record cost when resolveXUser fails', async () => {
    resolveXUserMock.mockRejectedValueOnce(new Error('X account not found.'));
    const res = await POST(postRequest({ password: 'config-test-password', conference: 'Test Conf', kind: 'x_account', input: 'ethsideevents' }));
    expect(res.status).toBe(400);
    expect(recordAdhocXCostMock).not.toHaveBeenCalled();
  });

  it('meetup_search: creates a discovery-trust source from a free-text query, with a "requires Meetup Pro" warning when unconfigured', async () => {
    const res = await POST(postRequest({ password: 'config-test-password', conference: 'Test Conf', kind: 'meetup_search', input: 'defi builders' }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(createSourceMock).toHaveBeenCalledWith(expect.objectContaining({ kind: 'meetup_search', trust: 'discovery', config: { query: 'defi builders' } }));
    expect(json.warning).toMatch(/Meetup Pro/i);
  });

  it('meetup_search: no warning once Meetup is configured', async () => {
    isMeetupConfiguredMock.mockReturnValue(true);
    const res = await POST(postRequest({ password: 'config-test-password', conference: 'Test Conf', kind: 'meetup_search', input: 'ai builders' }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.warning).toBeUndefined();
  });

  it('meetup_search: rejects an empty query', async () => {
    const res = await POST(postRequest({ password: 'config-test-password', conference: 'Test Conf', kind: 'meetup_search', input: '   ' }));
    expect(res.status).toBe(400);
  });

  it('sponsor_pages: parses one-per-line URLs into config.urls, always discovery trust', async () => {
    const res = await POST(
      postRequest({
        password: 'config-test-password',
        conference: 'Test Conf',
        kind: 'sponsor_pages',
        input: 'https://acme.example.com/events\nhttps://beta.example.com/events\n',
      })
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(createSourceMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'sponsor_pages', trust: 'discovery', config: { urls: ['https://acme.example.com/events', 'https://beta.example.com/events'] } })
    );
    expect(json.source).toBeTruthy();
  });

  it('sponsor_pages: "*" means discover from this conference\'s own sponsors (empty urls list)', async () => {
    const res = await POST(postRequest({ password: 'config-test-password', conference: 'Test Conf', kind: 'sponsor_pages', input: '*' }));
    expect(res.status).toBe(200);
    expect(createSourceMock).toHaveBeenCalledWith(expect.objectContaining({ kind: 'sponsor_pages', config: { urls: [] } }));
  });

  it('sponsor_pages: rejects input that is neither a URL nor "*"', async () => {
    const res = await POST(postRequest({ password: 'config-test-password', conference: 'Test Conf', kind: 'sponsor_pages', input: 'not a url' }));
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/admin/ingest/config: Phase 4 kinds are ALWAYS discovery trust (§10 item 4)', () => {
  beforeEach(() => {
    getSourceMock.mockReset();
    getProfileMock.mockReset();
  });

  it.each(['x_account', 'meetup_search', 'sponsor_pages'])('refuses to promote a %s source off discovery trust', async (kind) => {
    getSourceMock.mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111', conference: 'Test Conf', kind, trust: 'discovery' });
    const res = await PATCH(patchRequest({ password: 'config-test-password', id: '11111111-1111-4111-8111-111111111111', trust: 'curated' }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toMatch(/always discovery trust/);
  });

  it('allows a no-op "trust: discovery" patch on an x_account source', async () => {
    getSourceMock.mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111', conference: 'Test Conf', kind: 'x_account', trust: 'discovery' });
    const res = await PATCH(patchRequest({ password: 'config-test-password', id: '11111111-1111-4111-8111-111111111111', trust: 'discovery' }));
    expect(res.status).toBe(200);
  });
});
