import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

process.env.ADMIN_PASSWORD = 'config-test-password';

const getProfileMock = vi.fn();
const upsertProfileMock = vi.fn(async (...args: unknown[]) => args[0]);
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
}));

vi.mock('@/lib/ingest/db', () => ({
  listProfiles: vi.fn(async () => []),
  listSources: vi.fn(async () => []),
  getProfile: (...a: unknown[]) => getProfileMock(...a),
  upsertProfile: (...a: unknown[]) => upsertProfileMock(...a),
  seedProfileRow: (conference: string, themeKey: string) => seedProfileRowMock(conference, themeKey),
  createSource: vi.fn(async () => ({})),
  updateSource: vi.fn(async () => {}),
  deleteSource: vi.fn(async () => {}),
}));

const evaluateAutoPublishEnableGateMock = vi.fn();
vi.mock('@/lib/ingest/gate', () => ({
  evaluateAutoPublishEnableGate: (...a: unknown[]) => evaluateAutoPublishEnableGateMock(...a),
}));

vi.mock('@/lib/ingest/sources/luma-ical', () => ({
  resolveLumaCalendar: vi.fn(),
  fetchLumaIcalFeed: vi.fn(),
  toIcalCandidates: vi.fn(() => []),
}));

vi.mock('@/lib/ingest/filters', () => ({
  isPastEvent: vi.fn(() => false),
}));

import { PUT } from '../../app/api/admin/ingest/config/route';

function putRequest(body: unknown) {
  return new NextRequest('http://localhost/api/admin/ingest/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('PUT /api/admin/ingest/config: server-side auto-publish gate (§13.2)', () => {
  beforeEach(() => {
    getProfileMock.mockReset();
    upsertProfileMock.mockClear();
    evaluateAutoPublishEnableGateMock.mockReset();
  });

  it('refuses to enable auto-publish when the gate is not met', async () => {
    getProfileMock.mockResolvedValue({ conference: 'Test Conf', theme_key: 'crypto', auto_publish_enabled: false });
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
  });

  it('allows enabling auto-publish when the gate is met, and clears any prior kill-switch record', async () => {
    getProfileMock.mockResolvedValue({
      conference: 'Test Conf',
      theme_key: 'crypto',
      auto_publish_enabled: false,
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
    expect(upsertProfileMock).toHaveBeenCalledWith(
      expect.objectContaining({ auto_publish_enabled: true, auto_publish_killed_at: null, auto_publish_kill_reason: null })
    );
  });

  it('does not re-check the gate when auto-publish is already enabled and unrelated fields are saved', async () => {
    getProfileMock.mockResolvedValue({ conference: 'Test Conf', theme_key: 'crypto', auto_publish_enabled: true });

    const res = await PUT(putRequest({ password: 'config-test-password', conference: 'Test Conf', theme_key: 'crypto', radius_km: 50 }));
    expect(res.status).toBe(200);
    expect(evaluateAutoPublishEnableGateMock).not.toHaveBeenCalled();
    expect(upsertProfileMock).toHaveBeenCalled();
  });

  it('does not gate turning auto-publish off', async () => {
    getProfileMock.mockResolvedValue({ conference: 'Test Conf', theme_key: 'crypto', auto_publish_enabled: true });

    const res = await PUT(putRequest({ password: 'config-test-password', conference: 'Test Conf', theme_key: 'crypto', auto_publish_enabled: false }));
    expect(res.status).toBe(200);
    expect(evaluateAutoPublishEnableGateMock).not.toHaveBeenCalled();
  });

  it('rejects an unauthorized request before touching the gate', async () => {
    const res = await PUT(putRequest({ password: 'wrong', conference: 'Test Conf', theme_key: 'crypto', auto_publish_enabled: true }));
    expect(res.status).toBe(401);
    expect(evaluateAutoPublishEnableGateMock).not.toHaveBeenCalled();
  });
});
