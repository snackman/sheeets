// 2026-10-18 incident: ~38 discovered-link candidates landed in
// `status: 'error'` with no reason. Production-shaped fixtures below are
// taken from the real rows / Mira series / Luma responses:
//   - Mira series `Breakpoint2026SideEvents2026` feeds BOTH "DAS London
//     2026" (Nov 10–11) and "Solana Breakpoint" (Nov 15–17), London.
//   - Candidates are keyed `luma:evt-…` (lowercased) with the short slug in
//     `alt_keys`; Luma's `event/get` is case-sensitive, so enriching with
//     the lowercased id 404'd and wrote an error row every time.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { scoreCandidateMock } = vi.hoisted(() => ({ scoreCandidateMock: vi.fn() }));
vi.mock('../ingest/scoring', () => ({ scoreCandidate: scoreCandidateMock }));

const { getCachedLumaApiIdEntryMock, setCachedLumaApiIdMock, getCandidateByKeyOrAltKeyMock } = vi.hoisted(() => ({
  getCachedLumaApiIdEntryMock: vi.fn(async (): Promise<{ apiId: string | null; resolvedAt: string } | undefined> => undefined),
  setCachedLumaApiIdMock: vi.fn(async (): Promise<void> => undefined),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getCandidateByKeyOrAltKeyMock: vi.fn(async (): Promise<any> => null),
}));
vi.mock('../ingest/db', () => ({
  getCachedLumaApiIdEntry: getCachedLumaApiIdEntryMock,
  setCachedLumaApiId: setCachedLumaApiIdMock,
  getCandidateByKeyOrAltKey: getCandidateByKeyOrAltKeyMock,
}));

const { fetchLumaEventMock } = vi.hoisted(() => ({ fetchLumaEventMock: vi.fn() }));
vi.mock('../luma-server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../luma-server')>();
  return { ...actual, fetchLumaEvent: fetchLumaEventMock };
});

import {
  processDiscoveredLink,
  PacedLinkLimiter,
  sourceDateWindowPrefilter,
  isErrorRetryDue,
  errorRetryBackoffMs,
  lumaApiIdFromUrl,
  type DiscoveredLinkContext,
  type DiscoveredLinkOutcome,
} from '../ingest/discover';
import { LumaEnrichmentLimiter } from '../ingest/enrich';
import { buildMiraHintsByUrl, type MiraEvent } from '../ingest/sources/mira';
import { LumaFetchError, lumaRedirectSlug } from '../luma-server';
import type { IngestCandidateRow, IngestProfileRow } from '../ingest/types';
import type { TabConfig } from '../conferences';

const LONDON = { lat: 51.5074, lng: -0.1278 };
const DAS_TAB: TabConfig = { gid: 1, name: 'DAS London 2026', slug: 'das-london-2026', timezone: 'Europe/London', dates: ['2026-11-10', '2026-11-11'], center: LONDON };
const BREAKPOINT_TAB: TabConfig = { gid: 2, name: 'Solana Breakpoint', slug: 'solana-breakpoint', timezone: 'Europe/London', dates: ['2026-11-15', '2026-11-16', '2026-11-17'], center: LONDON };

// Real rows from the shared Mira series page (trimmed to the fields used).
const MIRA_EVENTS: MiraEvent[] = [
  { id: 'm1', name: 'CodeCup: AI x Solana Builder Arena', startDate: '2026-11-08T10:00:00.000Z', endDate: '2026-11-17T15:00:00.000Z', city: 'London', website: 'https://lu.ma/ol25ta77', tags: null, seriesSlug: 'Breakpoint2026SideEvents2026' },
  { id: 'm2', name: 'Poker Night @ DAS London', startDate: '2026-11-09T18:00:00.000Z', endDate: '2026-11-10T00:00:00.000Z', city: 'London', website: 'https://luma.com/z7g0eoa3', tags: null, seriesSlug: 'Breakpoint2026SideEvents2026' },
  { id: 'm3', name: '200ms', startDate: '2026-11-13T09:00:00.000Z', endDate: '2026-11-13T18:00:00.000Z', city: 'London', website: 'https://lu.ma/6xip72je', tags: null, seriesSlug: 'Breakpoint2026SideEvents2026' },
  { id: 'm4', name: 'Scale or Die', startDate: '2026-11-14T09:30:00.000Z', endDate: '2026-11-14T18:30:00.000Z', city: 'London', website: 'https://lu.ma/scale-or-die-26', tags: null, seriesSlug: 'Breakpoint2026SideEvents2026' },
  { id: 'm5', name: 'Breakpoint main event', startDate: '2026-11-15', endDate: '2026-11-17', city: 'London', website: null, tags: null, seriesSlug: 'Breakpoint2026SideEvents2026' },
];

function lumaPayload(apiId: string, name: string, startAt: string) {
  return {
    api_id: apiId,
    event: { api_id: apiId, name, start_at: startAt, end_at: null, timezone: 'Europe/London', ticket_price_cents: 0 },
    hosts: [],
  };
}

// Luma's real ids are mixed-case; `event/get` 404s on any other casing.
const LUMA = {
  ol25ta77: lumaPayload('evt-VgWXB5QEzoxeUvs', 'CodeCup: AI x Solana Builder Arena', '2026-11-08T10:00:00.000Z'),
  z7g0eoa3: lumaPayload('evt-MgdhYr9RORaw5d6', 'Poker Night @ DAS London', '2026-11-09T18:00:00.000Z'),
  '6xip72je': lumaPayload('evt-UqUVnzhZE8gFPkd', '200ms', '2026-11-13T09:00:00.000Z'),
  'scale-or-die-26': lumaPayload('evt-saiU3xVXKv6HsFC', 'Scale or Die', '2026-11-14T09:30:00.000Z'),
} as const;

/** Behaves like Luma: slug lookups are case-insensitive, api-id lookups
 *  are EXACT-case, anything unknown is a 404. */
function fakeLuma(ref: { slug: string } | { apiId: string }) {
  if ('slug' in ref) {
    const hit = (LUMA as Record<string, unknown>)[ref.slug.toLowerCase()];
    if (hit) return Promise.resolve(hit);
  } else {
    const hit = Object.values(LUMA).find((p) => p.api_id === ref.apiId);
    if (hit) return Promise.resolve(hit);
  }
  return Promise.reject(new LumaFetchError('Luma event not found.', 'not_found'));
}

function makeProfile(conference: string): IngestProfileRow {
  return {
    conference,
    theme_key: 'crypto',
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
    updated_at: new Date().toISOString(),
  };
}

function makeContext(tab: TabConfig, overrides: Partial<DiscoveredLinkContext> = {}): DiscoveredLinkContext {
  return {
    conference: tab.name,
    tab,
    profile: makeProfile(tab.name),
    themeProfile: { themeKey: 'crypto', themeName: 'Crypto', themeDescription: '', includeKeywords: [], excludeKeywords: [], publishThreshold: 85, reviewThreshold: 40 },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: {} as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: {} as any,
    sourceId: 'src-mira',
    sourceKind: 'mira_series',
    sourceTrust: 'discovery',
    sourceRef: 'https://miragather.com/Breakpoint2026SideEvents2026',
    enrichLimiter: new LumaEnrichmentLimiter(200, 0),
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

/** The real DAS error row shape: evt- key (lowercased), slug in alt_keys,
 *  placeholder event, no reason. */
function prodErrorRow(overrides: Partial<IngestCandidateRow> = {}): IngestCandidateRow {
  return {
    id: 'cand-err',
    conference: 'DAS London 2026',
    canonical_key: 'luma:evt-saiu3xvxkv6hsfc',
    alt_keys: ['luma:scale-or-die-26'],
    source_id: 'src-mira',
    source_kind: 'mira_series',
    sources: [],
    source_ref: 'https://miragather.com/Breakpoint2026SideEvents2026',
    event: {
      name: 'https://lu.ma/scale-or-die-26',
      startAt: '2026-10-17T19:46:08.000Z',
      timezone: 'UTC',
      dateISO: '',
      sheetDate: '',
      startTime: '',
      endTime: '',
      address: '',
      isOnline: false,
      organizer: '',
      hosts: [],
      cost: '',
      link: 'https://lu.ma/scale-or-die-26',
      descriptionText: '',
      platform: 'luma',
    },
    content_hash: 'error:luma:evt-saiu3xvxkv6hsfc',
    ical_hash: null,
    status: 'error',
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
    classify_attempts: 1,
    published_event_id: null,
    sheet_row: null,
    published_at: null,
    auto_published_at: null,
    review_note: null,
    reject_reason: null,
    edits: null,
    reviewed_at: null,
    reviewed_by: null,
    first_seen_at: '2026-10-17T19:46:08.000Z',
    last_seen_at: '2026-10-18T12:03:14.000Z',
    updated_at: '2026-10-18T12:03:14.000Z',
    ...overrides,
  };
}

function rowOf(outcome: DiscoveredLinkOutcome) {
  if (outcome.kind !== 'row') throw new Error(`expected a row outcome, got ${outcome.kind}`);
  return outcome.row;
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchLumaEventMock.mockImplementation(fakeLuma);
  getCachedLumaApiIdEntryMock.mockImplementation(async () => undefined);
  getCandidateByKeyOrAltKeyMock.mockImplementation(async () => null);
  scoreCandidateMock.mockResolvedValue({
    classifier: {
      output: { is_event: true, theme_score: 70, reason: 'On theme', suggested_tags: [], flags: [], data_quality: 'sufficient' },
      injectionDetected: false,
      inputTokens: 10,
      outputTokens: 5,
      model: 'gpt-5-mini',
      promptVersion: 'v1',
    },
    signals: { breakdown: {}, total: 0, hardReject: false, capRouteAtReview: true },
    finalScore: 70,
    route: 'review',
    shadowRoute: 'review',
  });
});

describe('one Mira series feeding two conferences (DAS London + Solana Breakpoint)', () => {
  const hints = buildMiraHintsByUrl(MIRA_EVENTS);

  async function runAll(tab: TabConfig) {
    const ctx = makeContext(tab);
    const out: Record<string, { status: string; filter_reason: unknown; fetches: number }> = {};
    for (const url of hints.keys()) {
      const before = fetchLumaEventMock.mock.calls.length;
      const row = rowOf(await processDiscoveredLink(url, null, ctx, hints.get(url)));
      out[url] = { status: row.status, filter_reason: row.filter_reason, fetches: fetchLumaEventMock.mock.calls.length - before };
    }
    return out;
  }

  it('DAS: Breakpoint-week events are filtered_out (never error); clearly-out-of-window ones without any Luma call', async () => {
    const r = await runAll(DAS_TAB);
    // Nov 14: outside DAS's Nov 7..12 window even with 1 day of slack -> dropped pre-enrichment.
    expect(r['https://lu.ma/scale-or-die-26']).toMatchObject({ status: 'filtered_out', fetches: 0 });
    expect(r['https://lu.ma/scale-or-die-26'].filter_reason).toMatch(/^outside_date_window\(2026-11-07\.\.2026-11-12\).*source date 2026-11-14/);
    // Nov 13: inside the slack, so it IS enriched — and then filtered on Luma's own date.
    expect(r['https://lu.ma/6xip72je']).toMatchObject({ status: 'filtered_out', filter_reason: 'outside_date_window(2026-11-07..2026-11-12)', fetches: 1 });
    // Real in-window DAS events still go through to classification.
    expect(r['https://luma.com/z7g0eoa3']).toMatchObject({ status: 'queued', fetches: 1 });
    expect(r['https://lu.ma/ol25ta77']).toMatchObject({ status: 'queued', fetches: 1 });
    expect(Object.values(r).some((x) => x.status === 'error')).toBe(false);
  });

  it('Breakpoint: the DAS-week events from the same series are dropped pre-enrichment; Breakpoint ones are classified', async () => {
    const r = await runAll(BREAKPOINT_TAB);
    expect(r['https://luma.com/z7g0eoa3']).toMatchObject({ status: 'filtered_out', fetches: 0 });
    expect(r['https://lu.ma/ol25ta77']).toMatchObject({ status: 'filtered_out', fetches: 0 });
    expect(r['https://lu.ma/scale-or-die-26']).toMatchObject({ status: 'queued', fetches: 1 });
    expect(r['https://lu.ma/6xip72je']).toMatchObject({ status: 'queued', fetches: 1 });
  });

  it('a link Mira lists twice with different dates gets no hint (never dropped on ambiguous data)', () => {
    const dup = buildMiraHintsByUrl([
      ...MIRA_EVENTS,
      { ...MIRA_EVENTS[3], id: 'm4b', startDate: '2026-11-10T09:00:00.000Z' },
    ]);
    expect(dup.has('https://lu.ma/scale-or-die-26')).toBe(false);
    expect(dup.get('https://lu.ma/6xip72je')?.startDate).toBe('2026-11-13T09:00:00.000Z');
  });
});

describe('existing candidates keyed luma:evt-… with the slug in alt_keys', () => {
  it('an out-of-window prod error row is converted in place to filtered_out (same evt- key, alt_keys kept), with no Luma call', async () => {
    const existing = prodErrorRow();
    const hints = buildMiraHintsByUrl(MIRA_EVENTS);
    const row = rowOf(await processDiscoveredLink('https://lu.ma/scale-or-die-26', existing, makeContext(DAS_TAB), hints.get('https://lu.ma/scale-or-die-26')));
    expect(row.status).toBe('filtered_out');
    expect(row.canonical_key).toBe('luma:evt-saiu3xvxkv6hsfc');
    expect(row.alt_keys).toEqual(['luma:scale-or-die-26']);
    expect(row.filter_reason).toContain('outside_date_window');
    expect(fetchLumaEventMock).not.toHaveBeenCalled();
  });

  it('ROOT CAUSE: with a warm link cache, enrichment uses the ORIGINAL-case api id (the lowercased key 404s)', async () => {
    getCachedLumaApiIdEntryMock.mockImplementation(async () => ({ apiId: 'evt-saiU3xVXKv6HsFC', resolvedAt: new Date().toISOString() }));
    getCandidateByKeyOrAltKeyMock.mockImplementation(async () => prodErrorRow({ conference: 'Solana Breakpoint' }));
    const row = rowOf(await processDiscoveredLink('https://lu.ma/scale-or-die-26', null, makeContext(BREAKPOINT_TAB)));
    expect(fetchLumaEventMock).toHaveBeenCalledTimes(1);
    expect(fetchLumaEventMock).toHaveBeenCalledWith({ apiId: 'evt-saiU3xVXKv6HsFC' });
    expect(row.status).toBe('queued');
    expect(row.canonical_key).toBe('luma:evt-saiu3xvxkv6hsfc');
    expect(row.alt_keys).toEqual(['luma:scale-or-die-26']);
  });

  it('a cache row holding a stale/lowercased id falls back to the slug instead of writing an error row', async () => {
    getCachedLumaApiIdEntryMock.mockImplementation(async () => ({ apiId: 'evt-saiu3xvxkv6hsfc', resolvedAt: new Date().toISOString() }));
    const row = rowOf(await processDiscoveredLink('https://lu.ma/scale-or-die-26', null, makeContext(BREAKPOINT_TAB)));
    expect(fetchLumaEventMock.mock.calls.map((c) => c[0])).toEqual([{ apiId: 'evt-saiu3xvxkv6hsfc' }, { slug: 'scale-or-die-26' }]);
    expect(row.status).toBe('queued');
  });

  it('a luma.com/event/evt-… link is fetched with the case from the URL, not the lowercased key', async () => {
    expect(lumaApiIdFromUrl('https://luma.com/event/evt-saiU3xVXKv6HsFC')).toBe('evt-saiU3xVXKv6HsFC');
    expect(lumaApiIdFromUrl('https://lu.ma/scale-or-die-26')).toBeNull();
    const row = rowOf(await processDiscoveredLink('https://luma.com/event/evt-saiU3xVXKv6HsFC', null, makeContext(BREAKPOINT_TAB)));
    expect(fetchLumaEventMock).toHaveBeenCalledWith({ apiId: 'evt-saiU3xVXKv6HsFC' });
    expect(row.canonical_key).toBe('luma:evt-saiu3xvxkv6hsfc');
    expect(row.status).toBe('queued');
  });
});

describe('Luma 429 (transient) never creates an error row', () => {
  beforeEach(() => {
    fetchLumaEventMock.mockImplementation(() => Promise.reject(new LumaFetchError('Luma returned 429.')));
  });

  it('no existing candidate: deferred, nothing written, nothing cached', async () => {
    const outcome = await processDiscoveredLink('https://lu.ma/6xip72je', null, makeContext(BREAKPOINT_TAB));
    expect(outcome).toEqual({ kind: 'deferred', reason: 'Luma returned 429.' });
    expect(setCachedLumaApiIdMock).not.toHaveBeenCalled();
  });

  it('warm cache (by-id enrichment hits the 429): still deferred, not an error row', async () => {
    getCachedLumaApiIdEntryMock.mockImplementation(async () => ({ apiId: 'evt-UqUVnzhZE8gFPkd', resolvedAt: new Date().toISOString() }));
    const outcome = await processDiscoveredLink('https://lu.ma/6xip72je', null, makeContext(BREAKPOINT_TAB));
    expect(outcome.kind).toBe('deferred');
  });

  it('existing error row: left unchanged (no attempt recorded for a transient failure)', async () => {
    const existing = prodErrorRow({ conference: 'Solana Breakpoint', canonical_key: 'luma:evt-uquvnzhze8gfpkd', alt_keys: ['luma:6xip72je'] });
    const outcome = await processDiscoveredLink('https://lu.ma/6xip72je', existing, makeContext(BREAKPOINT_TAB));
    expect(outcome).toEqual({ kind: 'unchanged', existingId: 'cand-err' });
  });

  it('an out-of-window link is still filtered while Luma is rate-limiting (no call needed)', async () => {
    const hints = buildMiraHintsByUrl(MIRA_EVENTS);
    const row = rowOf(await processDiscoveredLink('https://lu.ma/scale-or-die-26', null, makeContext(DAS_TAB), hints.get('https://lu.ma/scale-or-die-26')));
    expect(row.status).toBe('filtered_out');
    expect(fetchLumaEventMock).not.toHaveBeenCalled();
  });
});

describe('error rows always carry a reason and back off', () => {
  it('a confirmed Luma 404 records an error row WITH a reason, attempt count and attempt time', async () => {
    const outcome = await processDiscoveredLink('https://luma.com/188n1ye7', null, makeContext(BREAKPOINT_TAB));
    const row = rowOf(outcome);
    expect(row.status).toBe('error');
    expect(row.filter_reason).toMatch(/^error: luma_not_found: /);
    expect(row.classify_attempts).toBe(1);
    expect(typeof row.classified_at).toBe('string');
  });

  it('an error row attempted 10 minutes ago is NOT retried (no Luma call)', async () => {
    const existing = prodErrorRow({ canonical_key: 'luma:188n1ye7', alt_keys: [], classify_attempts: 1, classified_at: new Date(Date.now() - 10 * 60_000).toISOString() });
    const outcome = await processDiscoveredLink('https://luma.com/188n1ye7', existing, makeContext(BREAKPOINT_TAB));
    expect(outcome).toEqual({ kind: 'unchanged', existingId: 'cand-err' });
    expect(fetchLumaEventMock).not.toHaveBeenCalled();
  });

  it('once the backoff has elapsed it is retried; a repeat failure bumps attempts and keeps the same row', async () => {
    const existing = prodErrorRow({ canonical_key: 'luma:188n1ye7', alt_keys: [], classify_attempts: 1, classified_at: new Date(Date.now() - 3 * 3600_000).toISOString() });
    const row = rowOf(await processDiscoveredLink('https://luma.com/188n1ye7', existing, makeContext(BREAKPOINT_TAB)));
    expect(row.status).toBe('error');
    expect(row.canonical_key).toBe('luma:188n1ye7');
    expect(row.classify_attempts).toBe(2);
    expect(row.filter_reason).toMatch(/^error: luma_not_found/);
  });

  it('legacy error rows (no attempt time) are due immediately; backoff doubles and caps at 48h', () => {
    expect(isErrorRetryDue(prodErrorRow())).toBe(true);
    expect(errorRetryBackoffMs(1)).toBe(2 * 3600_000);
    expect(errorRetryBackoffMs(2)).toBe(4 * 3600_000);
    expect(errorRetryBackoffMs(20)).toBe(48 * 3600_000);
  });
});

describe('sourceDateWindowPrefilter', () => {
  const ctx = { tab: DAS_TAB, profile: makeProfile('DAS London 2026') };
  it('accepts bare dates and ISO instants (converted to the conference timezone)', () => {
    expect(sourceDateWindowPrefilter({ startDate: '2026-11-18' }, ctx)?.dateISO).toBe('2026-11-18');
    expect(sourceDateWindowPrefilter({ startDate: '2026-11-13' }, ctx)).toBeNull(); // within the 1-day slack
    expect(sourceDateWindowPrefilter({ startDate: '2026-11-06' }, ctx)).toBeNull(); // within the 1-day slack (window from Nov 7)
    expect(sourceDateWindowPrefilter({ startDate: '2026-11-04T12:00:00.000Z' }, ctx)?.reason).toBe('outside_date_window(2026-11-07..2026-11-12)');
  });
  it('never filters on a missing or unparseable date', () => {
    expect(sourceDateWindowPrefilter(undefined, ctx)).toBeNull();
    expect(sourceDateWindowPrefilter({ startDate: null }, ctx)).toBeNull();
    expect(sourceDateWindowPrefilter({ startDate: 'TBA' }, ctx)).toBeNull();
  });
});

describe('Luma slug-rename redirect', () => {
  it('parses the new slug out of Luma\'s 301 body (no Location header)', () => {
    expect(lumaRedirectSlug('{"message":"Redirecting","code":"/frontier-traders-grand-final-london"}')).toBe('frontier-traders-grand-final-london');
    expect(lumaRedirectSlug('{"message":"Sorry","code":null}')).toBeNull();
    expect(lumaRedirectSlug('not json')).toBeNull();
    expect(lumaRedirectSlug('{"code":"/../../etc"}')).toBeNull();
  });
});
