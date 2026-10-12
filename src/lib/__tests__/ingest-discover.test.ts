import { describe, it, expect, vi, beforeEach } from 'vitest';

const { scoreCandidateMock } = vi.hoisted(() => ({ scoreCandidateMock: vi.fn() }));
vi.mock('../ingest/scoring', () => ({ scoreCandidate: scoreCandidateMock }));

import { processDiscoveredLink, PacedLinkLimiter, type DiscoveredLinkContext } from '../ingest/discover';
import type { IngestCandidateRow, IngestProfileRow } from '../ingest/types';

function makeProfile(overrides: Partial<IngestProfileRow> = {}): IngestProfileRow {
  return {
    conference: 'ETHDenver',
    theme_key: 'crypto',
    theme_description: 'Crypto side events',
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
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeCandidate(overrides: Partial<IngestCandidateRow> = {}): IngestCandidateRow {
  return {
    id: 'cand-1',
    conference: 'ETHDenver',
    canonical_key: 'luma:discovered-mixer',
    alt_keys: [],
    source_id: 'other-source',
    source_kind: 'telegram_channel',
    sources: [],
    source_ref: null,
    event: {
      name: 'Old snapshot',
      startAt: '2026-03-10T18:00:00.000Z',
      timezone: 'UTC',
      dateISO: '2026-03-10',
      sheetDate: 'Mar 10',
      startTime: '6:00 PM',
      endTime: '',
      address: '',
      isOnline: false,
      organizer: '',
      hosts: [],
      cost: 'Free',
      link: 'https://lu.ma/discovered-mixer',
      descriptionText: '',
      platform: 'luma',
    },
    content_hash: 'stale-hash',
    ical_hash: null,
    status: 'queued',
    filter_reason: null,
    duplicate_of: null,
    possible_duplicate_of: null,
    llm_score: null,
    llm_reason: null,
    llm_tags: null,
    llm_flags: null,
    is_event: null,
    data_quality: null,
    signal_breakdown: {},
    final_score: null,
    route: null,
    shadow_route: null,
    model: null,
    prompt_version: null,
    classified_at: null,
    classify_attempts: 0,
    published_event_id: null,
    sheet_row: null,
    published_at: null,
    auto_published_at: null,
    review_note: null,
    reject_reason: null,
    edits: null,
    reviewed_at: null,
    reviewed_by: null,
    first_seen_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeContext(overrides: Partial<DiscoveredLinkContext> = {}): DiscoveredLinkContext {
  return {
    conference: 'ETHDenver',
    tab: { gid: 1, name: 'ETHDenver', slug: 'ethdenver', timezone: 'America/Denver', dates: ['2026-03-09', '2026-03-10', '2026-03-11'], center: { lat: 39.74, lng: -104.99 } },
    profile: makeProfile(),
    themeProfile: { themeKey: 'crypto', themeName: 'Crypto', themeDescription: '', includeKeywords: [], excludeKeywords: [], publishThreshold: 85, reviewThreshold: 40 },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: {} as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: {} as any,
    sourceId: 'source-1',
    sourceKind: 'host_submission',
    sourceTrust: 'discovery',
    sourceRef: null,
    enrichLimiter: { enrich: vi.fn(async () => null) },
    linkFetchLimiter: new PacedLinkLimiter(5, 0),
    linkIndex: { byKey: new Map() },
    sheetEvents: [],
    otherCandidates: [],
    fewShot: [],
    sponsorNames: [],
    computeHostSignals: () => ({ isTrustedHost: false, isBlockedHost: false, isLearnedBlockedHost: false }),
    canClassify: () => true,
    ...overrides,
  };
}

const VALID_LUMA_PAYLOAD = {
  api_id: 'evt-ABC123',
  event: {
    api_id: 'evt-ABC123',
    name: 'ETHCC Builders Mixer',
    start_at: '2026-03-10T18:00:00.000Z',
    end_at: '2026-03-10T21:00:00.000Z',
    timezone: 'UTC',
    ticket_price_cents: 0,
  },
  hosts: [],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('processDiscoveredLink — enrichment/extraction failure (review finding, MEDIUM item 3)', () => {
  it('returns "unchanged" (never overwrites with an error placeholder) when an existing candidate is present', async () => {
    const existing = makeCandidate({ source_kind: 'telegram_channel', status: 'queued' });
    const enrich = vi.fn(async () => null); // simulate a failed/rate-limited Luma enrichment
    const outcome = await processDiscoveredLink('https://lu.ma/discovered-mixer', existing, makeContext({ enrichLimiter: { enrich } }));
    expect(outcome).toEqual({ kind: 'unchanged', existingId: 'cand-1' });
  });

  it('records a fresh "error" row when there is NO existing candidate to protect', async () => {
    const enrich = vi.fn(async () => null);
    const outcome = await processDiscoveredLink('https://lu.ma/discovered-mixer', null, makeContext({ enrichLimiter: { enrich } }));
    expect(outcome.kind).toBe('row');
    if (outcome.kind === 'row') {
      expect(outcome.row.status).toBe('error');
    }
  });
});

describe('processDiscoveredLink — trust-rank guard (review finding, MEDIUM item 4)', () => {
  it('"protected": a discovery-trust link never touches a candidate from a curated-floor source (luma_ical), and never even attempts enrichment', async () => {
    const existing = makeCandidate({
      source_kind: 'luma_ical',
      status: 'auto_rejected', // NOT final — this is exactly the case a public submission must not revive
      sources: [{ source_id: 'luma-src', kind: 'luma_ical', ref: 'evt-uid-1', seen_at: '2026-01-01T00:00:00.000Z' }],
    });
    const enrich = vi.fn(async () => VALID_LUMA_PAYLOAD);
    const outcome = await processDiscoveredLink(
      'https://lu.ma/discovered-mixer',
      existing,
      makeContext({ sourceTrust: 'discovery', enrichLimiter: { enrich } })
    );
    expect(outcome.kind).toBe('protected');
    if (outcome.kind === 'protected') {
      expect(outcome.existingId).toBe('cand-1');
      expect(outcome.sources).toHaveLength(2); // the old ref plus the new one
    }
    expect(enrich).not.toHaveBeenCalled();
  });

  it('does NOT protect against another discovery-floor source (e.g. telegram_channel) — same trust level dedupes/updates normally', async () => {
    const existing = makeCandidate({ source_kind: 'telegram_channel', status: 'auto_rejected' });
    const enrich = vi.fn(async () => null); // still fails, but we should have gotten PAST the trust guard to try
    await processDiscoveredLink('https://lu.ma/discovered-mixer', existing, makeContext({ sourceTrust: 'discovery', enrichLimiter: { enrich } }));
    expect(enrich).toHaveBeenCalled();
  });

  it('a curated-trust incoming source is never "protected" against (the guard only protects HIGHER-or-equal trust existing rows)', async () => {
    const existing = makeCandidate({ source_kind: 'luma_ical', status: 'auto_rejected' });
    const enrich = vi.fn(async () => null);
    const outcome = await processDiscoveredLink(
      'https://lu.ma/discovered-mixer',
      existing,
      makeContext({ sourceTrust: 'curated', sourceKind: 'luma_ical', enrichLimiter: { enrich } })
    );
    expect(outcome.kind).not.toBe('protected');
    expect(enrich).toHaveBeenCalled();
  });
});

describe('processDiscoveredLink — clears stale duplicate_of/filter_reason when status changes (review finding, MEDIUM item 4)', () => {
  it('a candidate that was previously a "duplicate" with duplicate_of set is returned with duplicate_of: null once it is no longer a duplicate', async () => {
    const existing = makeCandidate({
      source_kind: 'telegram_channel',
      status: 'duplicate',
      duplicate_of: 'evt-stale-dup-id',
      content_hash: 'a-different-hash-so-this-is-not-treated-as-unchanged',
    });
    scoreCandidateMock.mockResolvedValueOnce({
      classifier: {
        output: { is_event: true, theme_score: 70, reason: 'On theme', suggested_tags: [], flags: [], data_quality: 'sufficient' },
        injectionDetected: false,
        inputTokens: 10,
        outputTokens: 5,
        model: 'gpt-5-mini',
        promptVersion: 'v1',
      },
      signals: { breakdown: {}, total: 0, hardReject: false, capRouteAtReview: false },
      finalScore: 70,
      route: 'review',
      shadowRoute: 'review',
    });
    const enrich = vi.fn(async () => VALID_LUMA_PAYLOAD);
    const outcome = await processDiscoveredLink('https://lu.ma/discovered-mixer', existing, makeContext({ enrichLimiter: { enrich } }));
    expect(outcome.kind).toBe('row');
    if (outcome.kind === 'row') {
      expect(outcome.row.status).toBe('queued');
      expect(outcome.row.duplicate_of).toBeNull();
      expect(outcome.row.filter_reason).toBeNull();
    }
  });
});
