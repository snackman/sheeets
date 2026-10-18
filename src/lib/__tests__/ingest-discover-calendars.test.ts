// Orchestration-level tests for `discover-calendars.ts` (plan item 3's
// daily job), mocking `db.ts` and `sources/calendar-discovery.ts` so the
// WIRING between them (which calendars get skipped vs. evaluated vs.
// proposed, and — review finding, HIGH item B — that phase 1 (resolve
// candidates' calendars) and phase 2 (evaluate them) each get their OWN
// time budget, so phase 2 isn't starved just because phase 1 used all of
// its) is what's under test.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const listLumaCandidatesForConferenceMock = vi.fn();
const listKnownLumaCandidateKeysMock = vi.fn();
const listConfiguredLumaCalendarIdsMock = vi.fn();
const getSourceProposalMock = vi.fn();
const upsertSourceProposalMock = vi.fn();
const updateCandidateMock = vi.fn(async (..._args: unknown[]) => {});

vi.mock('../ingest/db', () => ({
  listLumaCandidatesForConference: (...a: unknown[]) => listLumaCandidatesForConferenceMock(...a),
  listKnownLumaCandidateKeys: (...a: unknown[]) => listKnownLumaCandidateKeysMock(...a),
  listConfiguredLumaCalendarIds: (...a: unknown[]) => listConfiguredLumaCalendarIdsMock(...a),
  getSourceProposal: (...a: unknown[]) => getSourceProposalMock(...a),
  upsertSourceProposal: (...a: unknown[]) => upsertSourceProposalMock(...a),
  updateCandidate: (...a: unknown[]) => updateCandidateMock(...a),
}));

const resolveCandidateCalendarMock = vi.fn();
const fetchLumaCalendarItemsMock = vi.fn();
const evaluateCalendarItemsMock = vi.fn();
vi.mock('../ingest/sources/calendar-discovery', () => ({
  resolveCandidateCalendar: (...a: unknown[]) => resolveCandidateCalendarMock(...a),
  fetchLumaCalendarItems: (...a: unknown[]) => fetchLumaCalendarItemsMock(...a),
  evaluateCalendarItems: (...a: unknown[]) => evaluateCalendarItemsMock(...a),
  CalendarDiscoveryError: class CalendarDiscoveryError extends Error {},
}));

vi.mock('../ingest/enrich', () => ({
  makeSlugResolver: () => async () => undefined,
  LumaEnrichmentLimiter: class {
    exhausted = false;
    async enrich() {
      return null;
    }
    async enrichResult() {
      return { status: 'unavailable' as const };
    }
  },
}));

import { discoverCalendarSources } from '../ingest/discover-calendars';

const tab = { gid: 1, name: 'DAS London', slug: 'das-london', timezone: 'Europe/London', dates: ['2026-11-05', '2026-11-07'], center: { lat: 51.5072, lng: -0.1276 } };
const profile = {
  conference: 'DAS London',
  theme_key: 'crypto' as const,
  theme_description: '',
  include_keywords: [],
  exclude_keywords: [],
  trusted_hosts: [],
  blocked_hosts: [],
  publish_threshold: 85,
  review_threshold: 40,
  auto_publish_enabled: false,
  radius_km: 40,
  window_pre_days: 1,
  window_post_days: 1,
  allow_online: false,
  max_llm_calls_per_run: 150,
  max_publish_per_run: 25,
  enabled: true,
  auto_publish_killed_at: null,
  auto_publish_kill_reason: null,
  auto_publish_enabled_at: null,
  updated_at: '',
};

/** Production-shaped candidate: a real Luma candidate in this codebase is
 *  always keyed `luma:evt-…` with `event.hostCalendar` as the tri-state
 *  calendar-resolution cache (`undefined` = never resolved). `lastSeenAt`
 *  controls phase 1's oldest-first resolution order. */
function candidate(canonicalKey: string, opts: { hostCalendar?: { apiId: string; name: string | null; isPersonal: boolean } | null; lastSeenAt?: string } = {}) {
  return {
    id: canonicalKey,
    canonical_key: canonicalKey,
    last_seen_at: opts.lastSeenAt ?? '2026-10-01T00:00:00.000Z',
    event: { calendar: null, ...(('hostCalendar' in opts) ? { hostCalendar: opts.hostCalendar } : {}) },
  };
}

const DEFAULT_OPTS = { phase1DeadlineMs: 30_000, phase2DeadlineMs: 30_000 };

beforeEach(() => {
  vi.clearAllMocks();
  listKnownLumaCandidateKeysMock.mockResolvedValue(new Set());
  listConfiguredLumaCalendarIdsMock.mockResolvedValue(new Set());
  getSourceProposalMock.mockResolvedValue(null);
  updateCandidateMock.mockReset().mockResolvedValue(undefined);
});

describe('discoverCalendarSources: proposal wiring (unchanged behavior, new result shape)', () => {
  it('writes a proposal for a newly-discovered, eligible, non-personal, not-yet-configured calendar', async () => {
    listLumaCandidatesForConferenceMock.mockResolvedValue([candidate('luma:evt-a')]);
    resolveCandidateCalendarMock.mockResolvedValue({ status: 'resolved', calendar: { apiId: 'cal-new', name: 'The Best Event', isPersonal: false } });
    fetchLumaCalendarItemsMock.mockResolvedValue([{ apiId: 'evt-x', name: 'Afterdark', link: null, dateISO: '2026-11-05', lat: 51.5, lng: -0.1 }]);
    evaluateCalendarItemsMock.mockReturnValue({ eligible: true, inWindowCount: 2, newCount: 1, sample: [{ name: 'Afterdark', link: null }] });

    const result = await discoverCalendarSources('DAS London', tab, profile, DEFAULT_OPTS);

    expect(result.calendarsEvaluated).toBe(1);
    expect(result.proposalsWritten).toHaveLength(1);
    expect(upsertSourceProposalMock).toHaveBeenCalledWith({
      conference: 'DAS London',
      calendar_api_id: 'cal-new',
      calendar_name: 'The Best Event',
      evidence: { inWindowCount: 2, newCount: 1, sample: [{ name: 'Afterdark', link: null }] },
    });
  });

  it('skips a personal calendar without ever calling calendar/get-items', async () => {
    listLumaCandidatesForConferenceMock.mockResolvedValue([candidate('luma:evt-a')]);
    resolveCandidateCalendarMock.mockResolvedValue({ status: 'resolved', calendar: { apiId: 'cal-personal', name: 'Jane', isPersonal: true } });

    const result = await discoverCalendarSources('DAS London', tab, profile, DEFAULT_OPTS);

    expect(result.calendarsSkippedPersonal).toBe(1);
    expect(fetchLumaCalendarItemsMock).not.toHaveBeenCalled();
    expect(upsertSourceProposalMock).not.toHaveBeenCalled();
  });

  it('skips a calendar that already has a configured ingest_sources row', async () => {
    listLumaCandidatesForConferenceMock.mockResolvedValue([candidate('luma:evt-a')]);
    listConfiguredLumaCalendarIdsMock.mockResolvedValue(new Set(['cal-already-configured']));
    resolveCandidateCalendarMock.mockResolvedValue({ status: 'resolved', calendar: { apiId: 'cal-already-configured', name: 'ETHDenver', isPersonal: false } });

    const result = await discoverCalendarSources('DAS London', tab, profile, DEFAULT_OPTS);

    expect(result.calendarsSkippedAlreadyConfigured).toBe(1);
    expect(fetchLumaCalendarItemsMock).not.toHaveBeenCalled();
  });

  it('never calls calendar/get-items for a calendar that was already dismissed — "never re-propose a dismissed calendar"', async () => {
    listLumaCandidatesForConferenceMock.mockResolvedValue([candidate('luma:evt-a')]);
    resolveCandidateCalendarMock.mockResolvedValue({ status: 'resolved', calendar: { apiId: 'cal-dismissed', name: 'Already decided', isPersonal: false } });
    getSourceProposalMock.mockResolvedValue({ id: 'prop-1', status: 'dismissed', conference: 'DAS London', calendar_api_id: 'cal-dismissed' });

    const result = await discoverCalendarSources('DAS London', tab, profile, DEFAULT_OPTS);

    expect(result.calendarsSkippedDecided).toBe(1);
    expect(fetchLumaCalendarItemsMock).not.toHaveBeenCalled();
    expect(upsertSourceProposalMock).not.toHaveBeenCalled();
  });

  it('never calls calendar/get-items for an already-accepted calendar either', async () => {
    listLumaCandidatesForConferenceMock.mockResolvedValue([candidate('luma:evt-a')]);
    resolveCandidateCalendarMock.mockResolvedValue({ status: 'resolved', calendar: { apiId: 'cal-accepted', name: 'Already added', isPersonal: false } });
    getSourceProposalMock.mockResolvedValue({ id: 'prop-1', status: 'accepted', conference: 'DAS London', calendar_api_id: 'cal-accepted' });

    const result = await discoverCalendarSources('DAS London', tab, profile, DEFAULT_OPTS);

    expect(result.calendarsSkippedDecided).toBe(1);
    expect(fetchLumaCalendarItemsMock).not.toHaveBeenCalled();
  });

  it('does not write a proposal when the evaluation is not eligible', async () => {
    listLumaCandidatesForConferenceMock.mockResolvedValue([candidate('luma:evt-a')]);
    resolveCandidateCalendarMock.mockResolvedValue({ status: 'resolved', calendar: { apiId: 'cal-thin', name: 'Barely anything', isPersonal: false } });
    fetchLumaCalendarItemsMock.mockResolvedValue([]);
    evaluateCalendarItemsMock.mockReturnValue({ eligible: false, inWindowCount: 0, newCount: 0, sample: [] });

    const result = await discoverCalendarSources('DAS London', tab, profile, DEFAULT_OPTS);

    expect(result.proposalsWritten).toHaveLength(0);
    expect(upsertSourceProposalMock).not.toHaveBeenCalled();
  });

  it('a dry run evaluates and reports eligibility but never writes a proposal, and never writes the resolution cache either', async () => {
    listLumaCandidatesForConferenceMock.mockResolvedValue([candidate('luma:evt-a')]);
    resolveCandidateCalendarMock.mockResolvedValue({ status: 'resolved', calendar: { apiId: 'cal-new', name: 'The Best Event', isPersonal: false } });
    fetchLumaCalendarItemsMock.mockResolvedValue([]);
    evaluateCalendarItemsMock.mockReturnValue({ eligible: true, inWindowCount: 2, newCount: 2, sample: [] });

    const result = await discoverCalendarSources('DAS London', tab, profile, { ...DEFAULT_OPTS, dryRun: true });

    expect(result.proposalsWritten).toHaveLength(1);
    expect(upsertSourceProposalMock).not.toHaveBeenCalled();
    expect(updateCandidateMock).not.toHaveBeenCalled();
  });

  it('de-dupes two candidates that resolve to the same calendar into one evaluation', async () => {
    listLumaCandidatesForConferenceMock.mockResolvedValue([candidate('luma:evt-a'), candidate('luma:evt-b')]);
    resolveCandidateCalendarMock.mockResolvedValue({ status: 'resolved', calendar: { apiId: 'cal-shared', name: 'Shared Calendar', isPersonal: false } });
    fetchLumaCalendarItemsMock.mockResolvedValue([]);
    evaluateCalendarItemsMock.mockReturnValue({ eligible: false, inWindowCount: 0, newCount: 0, sample: [] });

    const result = await discoverCalendarSources('DAS London', tab, profile, DEFAULT_OPTS);

    expect(result.calendarsResolved).toBe(2);
    expect(result.calendarsEvaluated).toBe(1);
    expect(fetchLumaCalendarItemsMock).toHaveBeenCalledTimes(1);
  });
});

// Review finding, HIGH item B ("the daily discovery job evaluates
// nothing"): caching a resolved calendar into `event.hostCalendar`.
describe('discoverCalendarSources: candidate->calendar caching', () => {
  it('a candidate already cached with a resolved calendar skips the live call entirely, feeding straight into phase 2', async () => {
    listLumaCandidatesForConferenceMock.mockResolvedValue([
      candidate('luma:evt-a', { hostCalendar: { apiId: 'cal-cached', name: 'Cached Calendar', isPersonal: false } }),
    ]);
    fetchLumaCalendarItemsMock.mockResolvedValue([]);
    evaluateCalendarItemsMock.mockReturnValue({ eligible: false, inWindowCount: 0, newCount: 0, sample: [] });

    const result = await discoverCalendarSources('DAS London', tab, profile, DEFAULT_OPTS);

    expect(resolveCandidateCalendarMock).not.toHaveBeenCalled();
    expect(result.candidatesResolvedThisRun).toBe(0);
    expect(result.calendarsResolved).toBe(1);
    expect(result.calendarsEvaluated).toBe(1);
  });

  it('a candidate cached as `null` (confirmed no calendar) also skips the live call, and is never fed to phase 2', async () => {
    listLumaCandidatesForConferenceMock.mockResolvedValue([candidate('luma:evt-a', { hostCalendar: null })]);

    const result = await discoverCalendarSources('DAS London', tab, profile, DEFAULT_OPTS);

    expect(resolveCandidateCalendarMock).not.toHaveBeenCalled();
    expect(result.candidatesResolvedThisRun).toBe(0);
    expect(result.calendarsResolved).toBe(0);
    expect(result.calendarsEvaluated).toBe(0);
  });

  it('a freshly-resolved calendar is written into event.hostCalendar (merged, not replacing the rest of the event)', async () => {
    const cand = candidate('luma:evt-a');
    (cand.event as Record<string, unknown>).name = 'Original Name';
    listLumaCandidatesForConferenceMock.mockResolvedValue([cand]);
    resolveCandidateCalendarMock.mockResolvedValue({ status: 'resolved', calendar: { apiId: 'cal-new', name: 'The Best Event', isPersonal: false } });

    await discoverCalendarSources('DAS London', tab, profile, DEFAULT_OPTS);

    expect(updateCandidateMock).toHaveBeenCalledWith('luma:evt-a', {
      event: expect.objectContaining({ name: 'Original Name', hostCalendar: { apiId: 'cal-new', name: 'The Best Event', isPersonal: false } }),
    });
  });

  it('a "resolved" outcome with a null calendar is STILL cached (as null) so it is never re-resolved', async () => {
    listLumaCandidatesForConferenceMock.mockResolvedValue([candidate('luma:evt-a')]);
    resolveCandidateCalendarMock.mockResolvedValue({ status: 'resolved', calendar: null });

    await discoverCalendarSources('DAS London', tab, profile, DEFAULT_OPTS);

    expect(updateCandidateMock).toHaveBeenCalledWith('luma:evt-a', { event: expect.objectContaining({ hostCalendar: null }) });
  });

  // Same cache-poisoning class of bug `discover.ts`/`ingest_link_cache`
  // already guards against — an exhausted limiter or a transient error
  // must NEVER be written to the cache.
  it('an "unavailable" outcome (limiter exhausted or transient error) is NEVER cached', async () => {
    listLumaCandidatesForConferenceMock.mockResolvedValue([candidate('luma:evt-a')]);
    resolveCandidateCalendarMock.mockResolvedValue({ status: 'unavailable', calendar: null });

    const result = await discoverCalendarSources('DAS London', tab, profile, DEFAULT_OPTS);

    expect(updateCandidateMock).not.toHaveBeenCalled();
    expect(result.candidatesResolvedThisRun).toBe(1); // attempted...
    expect(result.candidatesLeftUnresolved).toBe(1); // ...but still unresolved.
  });

  it('"not_applicable" (not a resolvable Luma id) is cached as null too — it can never change', async () => {
    listLumaCandidatesForConferenceMock.mockResolvedValue([candidate('eventbrite:12345')]);
    resolveCandidateCalendarMock.mockResolvedValue({ status: 'not_applicable', calendar: null });

    await discoverCalendarSources('DAS London', tab, profile, DEFAULT_OPTS);

    expect(updateCandidateMock).toHaveBeenCalledWith('eventbrite:12345', { event: expect.objectContaining({ hostCalendar: null }) });
  });
});

// Review finding, HIGH item B: phase 1 (resolve) and phase 2 (evaluate)
// each get their OWN time/count budget — this is the core of the fix.
// "Test: a conference with 100 candidates still reaches phase 2 and
// evaluates calendars on the first run."
describe('discoverCalendarSources: phase 1 / phase 2 time-budget split', () => {
  it('a conference with 100 never-resolved candidates still reaches phase 2 and evaluates a calendar, on the FIRST run', async () => {
    // Production-shaped: 100 distinct, never-before-resolved candidates
    // (event.hostCalendar undefined), each resolving to the SAME calendar
    // so phase 2 has exactly one calendar to evaluate once phase 1 (capped
    // at phase1MaxCalendarResolutions, default 20) gets through its slice.
    const candidates = Array.from({ length: 100 }, (_, i) => candidate(`luma:evt-${i}`, { lastSeenAt: `2026-09-${(i % 28) + 1}T00:00:00.000Z` }));
    listLumaCandidatesForConferenceMock.mockResolvedValue(candidates);
    resolveCandidateCalendarMock.mockResolvedValue({ status: 'resolved', calendar: { apiId: 'cal-shared', name: 'Shared Calendar', isPersonal: false } });
    fetchLumaCalendarItemsMock.mockResolvedValue([{ apiId: 'evt-in-window', name: 'Afterdark', link: null, dateISO: '2026-11-05', lat: 51.5072, lng: -0.1276 }]);
    evaluateCalendarItemsMock.mockReturnValue({ eligible: true, inWindowCount: 3, newCount: 2, sample: [] });

    const result = await discoverCalendarSources('DAS London', tab, profile, DEFAULT_OPTS);

    // Phase 1 only resolved a bounded slice (its own default cap, 20) —
    // NOT all 100 — yet phase 2 still ran and evaluated the one calendar
    // that slice turned up.
    expect(result.candidatesResolvedThisRun).toBeGreaterThan(0);
    expect(result.candidatesResolvedThisRun).toBeLessThan(100);
    expect(result.calendarsEvaluated).toBe(1);
    expect(result.proposalsWritten).toHaveLength(1);
    expect(fetchLumaCalendarItemsMock).toHaveBeenCalled();
  });

  it('phase 1 resolves oldest-last_seen_at-first (rotates through an unresolved backlog over successive days)', async () => {
    const candidates = [
      candidate('luma:evt-newest', { lastSeenAt: '2026-10-10T00:00:00.000Z' }),
      candidate('luma:evt-oldest', { lastSeenAt: '2026-09-01T00:00:00.000Z' }),
      candidate('luma:evt-middle', { lastSeenAt: '2026-09-15T00:00:00.000Z' }),
    ];
    listLumaCandidatesForConferenceMock.mockResolvedValue(candidates);
    resolveCandidateCalendarMock.mockImplementation(async (c: { canonical_key: string }) => ({
      status: 'resolved',
      calendar: { apiId: `cal-for-${c.canonical_key}`, name: null, isPersonal: false },
    }));

    await discoverCalendarSources('DAS London', tab, profile, { ...DEFAULT_OPTS, phase1MaxCalendarResolutions: 2 });

    const resolvedOrder = resolveCandidateCalendarMock.mock.calls.map((call) => call[0].canonical_key);
    expect(resolvedOrder).toEqual(['luma:evt-oldest', 'luma:evt-middle']); // newest left for a later run.
  });

  it('phase 1 stops at its own call cap (phase1MaxCalendarResolutions) even with time to spare', async () => {
    const candidates = Array.from({ length: 10 }, (_, i) => candidate(`luma:evt-${i}`));
    listLumaCandidatesForConferenceMock.mockResolvedValue(candidates);
    resolveCandidateCalendarMock.mockResolvedValue({ status: 'resolved', calendar: null });

    const result = await discoverCalendarSources('DAS London', tab, profile, { ...DEFAULT_OPTS, phase1MaxCalendarResolutions: 3 });

    expect(result.candidatesResolvedThisRun).toBe(3);
    expect(result.candidatesLeftUnresolved).toBe(7);
    expect(result.hitDeadline).toBe(true);
  });

  it('phase 2 gets its OWN fresh deadline, even when phase 1 used its entire time budget', async () => {
    listLumaCandidatesForConferenceMock.mockResolvedValue([candidate('luma:evt-a')]);
    // Simulate phase 1 taking a while (e.g. real 1 req/s pacing over
    // several candidates) by having the resolve call itself sleep past a
    // SHORT phase1Deadline.
    resolveCandidateCalendarMock.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { status: 'resolved', calendar: { apiId: 'cal-new', name: 'The Best Event', isPersonal: false } };
    });
    fetchLumaCalendarItemsMock.mockResolvedValue([]);
    evaluateCalendarItemsMock.mockReturnValue({ eligible: false, inWindowCount: 0, newCount: 0, sample: [] });

    // Phase 1's deadline is already exhausted the moment phase 1 starts
    // iterating its SECOND candidate (irrelevant here, only one candidate)
    // — the point is phase 2's deadline is computed AFTER phase 1
    // finishes, so it always gets a fresh `phase2DeadlineMs`.
    const result = await discoverCalendarSources('DAS London', tab, profile, { phase1DeadlineMs: 10, phase2DeadlineMs: 30_000 });

    expect(result.calendarsEvaluated).toBe(1); // phase 2 still ran.
  });

  it('phase 2 itself stops at its own deadline, marking the run partial', async () => {
    listLumaCandidatesForConferenceMock.mockResolvedValue([
      candidate('luma:evt-a', { hostCalendar: { apiId: 'cal-1', name: null, isPersonal: false } }),
      candidate('luma:evt-b', { hostCalendar: { apiId: 'cal-2', name: null, isPersonal: false } }),
    ]);
    fetchLumaCalendarItemsMock.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return [];
    });
    evaluateCalendarItemsMock.mockReturnValue({ eligible: false, inWindowCount: 0, newCount: 0, sample: [] });

    const result = await discoverCalendarSources('DAS London', tab, profile, { phase1DeadlineMs: 30_000, phase2DeadlineMs: 10 });

    expect(result.hitDeadline).toBe(true);
    expect(result.calendarsEvaluated).toBeLessThan(2);
  });
});
