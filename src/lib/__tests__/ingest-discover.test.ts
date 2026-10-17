import { describe, it, expect, vi, beforeEach } from 'vitest';

const { scoreCandidateMock } = vi.hoisted(() => ({ scoreCandidateMock: vi.fn() }));
vi.mock('../ingest/scoring', () => ({ scoreCandidate: scoreCandidateMock }));

// Short-Luma-link resolution (Bug: "short Luma links bypass dedupe") goes
// through `./db`'s link cache + alt-key lookup. Defaulted to "a cached,
// NOT-stale negative" (`{apiId: null, resolvedAt: <now>}` — see
// `db.ts#getCachedLumaApiIdEntry` / `dedupe.ts#STALE_NEGATIVE_CACHE_MS`) so
// every PRE-EXISTING test below (all of which use a bare `lu.ma/<slug>`
// URL) exercises exactly the same code path it did before the stale-cache
// and limiter-exhaustion fixes: no resolution attempted at all, straight
// through to `ctx.enrichLimiter.enrich({slug})`. Tests that care about
// resolution itself override this per-test.
const { getCachedLumaApiIdEntryMock, setCachedLumaApiIdMock, getCandidateByKeyOrAltKeyMock } = vi.hoisted(() => ({
  getCachedLumaApiIdEntryMock: vi.fn(async (): Promise<{ apiId: string | null; resolvedAt: string } | undefined> => ({
    apiId: null,
    resolvedAt: new Date().toISOString(),
  })),
  setCachedLumaApiIdMock: vi.fn(async (): Promise<void> => undefined),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getCandidateByKeyOrAltKeyMock: vi.fn(async (): Promise<any> => null),
}));
vi.mock('../ingest/db', () => ({
  getCachedLumaApiIdEntry: getCachedLumaApiIdEntryMock,
  setCachedLumaApiId: setCachedLumaApiIdMock,
  getCandidateByKeyOrAltKey: getCandidateByKeyOrAltKeyMock,
}));

import { processDiscoveredLink, PacedLinkLimiter, type DiscoveredLinkContext } from '../ingest/discover';
import type { EnrichLimiter, EnrichRef } from '../ingest/enrich';
import type { LumaEventPayload } from '../luma';
import type { IngestCandidateRow, IngestProfileRow } from '../ingest/types';

/**
 * Wrap a plain `(ref) => Promise<payload|null>` mock (the shape every test
 * below already uses) into a full `EnrichLimiter` — `enrichResult`
 * delegates to the SAME spy (so a test's `expect(enrich).toHaveBeenCalled
 * Times(n)` still reflects every underlying call, whether `discover.ts`
 * reaches it via `.enrich()` or `.enrichResult()`), mapping a `null`
 * return to `'not_found'` — the old tests' own intent for "Luma returned
 * nothing"/a failed lookup. `exhausted` is always false here; exhaustion
 * gets its own dedicated tests with a purpose-built stub below. */
function stubLimiter(enrich: (ref: EnrichRef) => Promise<LumaEventPayload | null>): EnrichLimiter {
  return {
    enrich,
    enrichResult: async (ref) => {
      const payload = await enrich(ref);
      return payload ? { status: 'ok', payload } : { status: 'not_found' };
    },
    exhausted: false,
  };
}

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
    enrichLimiter: stubLimiter(vi.fn(async () => null)),
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
    const outcome = await processDiscoveredLink('https://lu.ma/discovered-mixer', existing, makeContext({ enrichLimiter: stubLimiter(enrich) }));
    expect(outcome).toEqual({ kind: 'unchanged', existingId: 'cand-1' });
  });

  it('records a fresh "error" row when there is NO existing candidate to protect', async () => {
    const enrich = vi.fn(async () => null);
    const outcome = await processDiscoveredLink('https://lu.ma/discovered-mixer', null, makeContext({ enrichLimiter: stubLimiter(enrich) }));
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
      makeContext({ sourceTrust: 'discovery', enrichLimiter: stubLimiter(enrich) })
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
    await processDiscoveredLink('https://lu.ma/discovered-mixer', existing, makeContext({ sourceTrust: 'discovery', enrichLimiter: stubLimiter(enrich) }));
    expect(enrich).toHaveBeenCalled();
  });

  it('a curated-trust incoming source is never "protected" against (the guard only protects HIGHER-or-equal trust existing rows)', async () => {
    const existing = makeCandidate({ source_kind: 'luma_ical', status: 'auto_rejected' });
    const enrich = vi.fn(async () => null);
    const outcome = await processDiscoveredLink(
      'https://lu.ma/discovered-mixer',
      existing,
      makeContext({ sourceTrust: 'curated', sourceKind: 'luma_ical', enrichLimiter: stubLimiter(enrich) })
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
    const outcome = await processDiscoveredLink('https://lu.ma/discovered-mixer', existing, makeContext({ enrichLimiter: stubLimiter(enrich) }));
    expect(outcome.kind).toBe('row');
    if (outcome.kind === 'row') {
      expect(outcome.row.status).toBe('queued');
      expect(outcome.row.duplicate_of).toBeNull();
      expect(outcome.row.filter_reason).toBeNull();
    }
  });
});

// Bug: "short Luma links bypass dedupe" — a short `lu.ma/<slug>` link
// discovered via Telegram/sheet-mining/a host submission used to
// canonicalize to a DIFFERENT key (`luma:<slug>`) than the curated iCal
// path's `luma:evt-…` for the SAME event, so it was processed as a
// brand-new candidate instead of being deduped/protected against the one
// the curated calendar already created — including resurfacing events an
// admin had already rejected.
describe('processDiscoveredLink — short Luma link canonicalization (Bug: "short Luma links bypass dedupe")', () => {
  it('resolves a cold-cache short link to its evt- canonical key, records the slug as an alt key, and reuses the resolution payload (no second enrichment call)', async () => {
    getCachedLumaApiIdEntryMock.mockResolvedValueOnce(undefined); // cold cache: never resolved before
    getCandidateByKeyOrAltKeyMock.mockResolvedValueOnce(null); // no existing evt- candidate yet
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
    const outcome = await processDiscoveredLink('https://lu.ma/discovered-mixer', null, makeContext({ enrichLimiter: stubLimiter(enrich) }));

    expect(outcome.kind).toBe('row');
    if (outcome.kind === 'row') {
      expect(outcome.row.canonical_key).toBe('luma:evt-abc123');
      expect(outcome.row.alt_keys).toEqual(['luma:discovered-mixer']);
    }
    // One enrichment call total — used BOTH to resolve the api id and to
    // build the normalized event, not enriched twice for the same link.
    expect(enrich).toHaveBeenCalledTimes(1);
    expect(setCachedLumaApiIdMock).toHaveBeenCalledWith('luma:discovered-mixer', 'evt-ABC123');
    expect(getCandidateByKeyOrAltKeyMock).toHaveBeenCalledWith('ETHDenver', 'luma:evt-abc123');
  });

  it('a short link for an event already REJECTED under its evt- key stays rejected (skipped_final, never re-queued)', async () => {
    getCachedLumaApiIdEntryMock.mockResolvedValueOnce({ apiId: 'evt-ABC123', resolvedAt: new Date().toISOString() }); // warm cache: resolved previously
    const rejectedEvtCandidate = makeCandidate({
      id: 'evt-candidate-1',
      canonical_key: 'luma:evt-abc123',
      alt_keys: [],
      source_kind: 'luma_ical',
      status: 'rejected',
    });
    getCandidateByKeyOrAltKeyMock.mockResolvedValueOnce(rejectedEvtCandidate);
    const enrich = vi.fn(async () => VALID_LUMA_PAYLOAD);
    // The caller's own cheap lookup (by the raw slug key) found nothing —
    // exactly the real-world case: the row only exists under its evt- key.
    const outcome = await processDiscoveredLink('https://lu.ma/discovered-mixer', null, makeContext({ enrichLimiter: stubLimiter(enrich) }));

    expect(outcome).toEqual({ kind: 'skipped_final', existingId: 'evt-candidate-1', canonicalKey: 'luma:evt-abc123' });
    // Protection kicks in before any enrichment/classification spend.
    expect(enrich).not.toHaveBeenCalled();
    expect(scoreCandidateMock).not.toHaveBeenCalled();
  });

  it('a short link for an event already APPROVED under its evt- key is also skipped_final', async () => {
    getCachedLumaApiIdEntryMock.mockResolvedValueOnce({ apiId: 'evt-ABC123', resolvedAt: new Date().toISOString() });
    const approvedEvtCandidate = makeCandidate({
      id: 'evt-candidate-2',
      canonical_key: 'luma:evt-abc123',
      alt_keys: ['luma:discovered-mixer'],
      source_kind: 'luma_ical',
      status: 'approved',
    });
    getCandidateByKeyOrAltKeyMock.mockResolvedValueOnce(approvedEvtCandidate);
    const enrich = vi.fn(async () => VALID_LUMA_PAYLOAD);
    const outcome = await processDiscoveredLink('https://lu.ma/discovered-mixer', null, makeContext({ enrichLimiter: stubLimiter(enrich) }));

    expect(outcome).toEqual({ kind: 'skipped_final', existingId: 'evt-candidate-2', canonicalKey: 'luma:evt-abc123' });
    expect(enrich).not.toHaveBeenCalled();
  });

  it('does not attempt resolution for a link that already IS an evt- link', async () => {
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
    const outcome = await processDiscoveredLink(
      'https://luma.com/event/evt-ABC123',
      null,
      makeContext({ enrichLimiter: stubLimiter(vi.fn(async () => VALID_LUMA_PAYLOAD)) })
    );
    expect(getCachedLumaApiIdEntryMock).not.toHaveBeenCalled();
    expect(getCandidateByKeyOrAltKeyMock).not.toHaveBeenCalled();
    expect(outcome.kind).not.toBe('invalid');
  });
});

// Review finding, HIGH ("exhausting the Luma limiter poisons
// ingest_link_cache"): `resolveLumaShortLinkKey` must never write a FALSE
// permanent negative when it couldn't actually ask Luma (exhausted budget,
// or a transient error) — and must re-resolve a stale cached negative
// (#193's fix, applied to this second write path into the same cache).
describe('processDiscoveredLink — short Luma link resolution never poisons the cache on an unavailable lookup, and re-resolves stale negatives', () => {
  it('an exhausted limiter writes NO cache entry (cold cache)', async () => {
    getCachedLumaApiIdEntryMock.mockResolvedValueOnce(undefined); // cold cache
    getCandidateByKeyOrAltKeyMock.mockResolvedValueOnce(null);
    const enrichLimiter: import('../ingest/enrich').EnrichLimiter = {
      enrich: vi.fn(async () => null),
      enrichResult: vi.fn(async () => ({ status: 'unavailable' as const })),
      exhausted: true,
    };
    const outcome = await processDiscoveredLink('https://lu.ma/discovered-mixer', null, makeContext({ enrichLimiter }));
    expect(setCachedLumaApiIdMock).not.toHaveBeenCalled();
    // No resolution happened, so this falls through to the slug canonical
    // key and the main enrichment call — which also fails (unavailable) —
    // same "no existing candidate, record a fresh error row" outcome as
    // any other enrichment failure, NOT a poisoned permanent miss.
    expect(outcome.kind).toBe('row');
  });

  it('a transient (non-"not_found") error during resolution also writes NO cache entry', async () => {
    getCachedLumaApiIdEntryMock.mockResolvedValueOnce(undefined);
    getCandidateByKeyOrAltKeyMock.mockResolvedValueOnce(null);
    const enrichLimiter: import('../ingest/enrich').EnrichLimiter = {
      enrich: vi.fn(async () => null),
      enrichResult: vi.fn(async () => ({ status: 'unavailable' as const })), // e.g. a network blip, not a confirmed 404
      exhausted: false,
    };
    await processDiscoveredLink('https://lu.ma/discovered-mixer', null, makeContext({ enrichLimiter }));
    expect(setCachedLumaApiIdMock).not.toHaveBeenCalled();
  });

  it('a CONFIRMED "not_found" result DOES write a negative cache entry', async () => {
    getCachedLumaApiIdEntryMock.mockResolvedValueOnce(undefined);
    getCandidateByKeyOrAltKeyMock.mockResolvedValueOnce(null);
    const enrichLimiter: import('../ingest/enrich').EnrichLimiter = {
      enrich: vi.fn(async () => null),
      enrichResult: vi.fn(async () => ({ status: 'not_found' as const })),
      exhausted: false,
    };
    await processDiscoveredLink('https://lu.ma/discovered-mixer', null, makeContext({ enrichLimiter }));
    expect(setCachedLumaApiIdMock).toHaveBeenCalledWith('luma:discovered-mixer', null);
  });

  it('re-resolves a cached negative older than STALE_NEGATIVE_CACHE_MS instead of trusting it forever', async () => {
    const { STALE_NEGATIVE_CACHE_MS } = await import('../ingest/dedupe');
    const staleResolvedAt = new Date(Date.now() - STALE_NEGATIVE_CACHE_MS - 1000).toISOString();
    getCachedLumaApiIdEntryMock.mockResolvedValueOnce({ apiId: null, resolvedAt: staleResolvedAt });
    getCandidateByKeyOrAltKeyMock.mockResolvedValueOnce(null);
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
    const enrichResult = vi.fn(async () => ({ status: 'ok' as const, payload: VALID_LUMA_PAYLOAD }));
    const enrichLimiter: import('../ingest/enrich').EnrichLimiter = {
      enrich: vi.fn(async () => null),
      enrichResult,
      exhausted: false,
    };
    const outcome = await processDiscoveredLink('https://lu.ma/discovered-mixer', null, makeContext({ enrichLimiter }));
    expect(enrichResult).toHaveBeenCalledWith({ slug: 'discovered-mixer' });
    expect(setCachedLumaApiIdMock).toHaveBeenCalledWith('luma:discovered-mixer', 'evt-ABC123');
    if (outcome.kind === 'row') expect(outcome.row.canonical_key).toBe('luma:evt-abc123');
  });

  it('does NOT re-resolve a cached negative that is still fresh (within STALE_NEGATIVE_CACHE_MS)', async () => {
    const { STALE_NEGATIVE_CACHE_MS } = await import('../ingest/dedupe');
    const freshResolvedAt = new Date(Date.now() - STALE_NEGATIVE_CACHE_MS + 60_000).toISOString();
    getCachedLumaApiIdEntryMock.mockResolvedValueOnce({ apiId: null, resolvedAt: freshResolvedAt });
    const enrichResult = vi.fn(async () => ({ status: 'ok' as const, payload: VALID_LUMA_PAYLOAD }));
    const enrichLimiter: import('../ingest/enrich').EnrichLimiter = {
      enrich: vi.fn(async () => null),
      enrichResult,
      exhausted: false,
    };
    await processDiscoveredLink('https://lu.ma/discovered-mixer', null, makeContext({ enrichLimiter }));
    expect(enrichResult).not.toHaveBeenCalled();
  });
});
