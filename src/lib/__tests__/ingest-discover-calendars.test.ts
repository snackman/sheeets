// Orchestration-level tests for `discover-calendars.ts` (plan item 3's
// daily job), mocking `db.ts` and `sources/calendar-discovery.ts` so the
// WIRING between them (which calendars get skipped vs. evaluated vs.
// proposed, and that a decided calendar's `calendar/get-items` is never
// even called) is what's under test.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const listLumaCandidatesForConferenceMock = vi.fn();
const listKnownLumaCandidateKeysMock = vi.fn();
const listConfiguredLumaCalendarIdsMock = vi.fn();
const getSourceProposalMock = vi.fn();
const upsertSourceProposalMock = vi.fn();

vi.mock('../ingest/db', () => ({
  listLumaCandidatesForConference: (...a: unknown[]) => listLumaCandidatesForConferenceMock(...a),
  listKnownLumaCandidateKeys: (...a: unknown[]) => listKnownLumaCandidateKeysMock(...a),
  listConfiguredLumaCalendarIds: (...a: unknown[]) => listConfiguredLumaCalendarIdsMock(...a),
  getSourceProposal: (...a: unknown[]) => getSourceProposalMock(...a),
  upsertSourceProposal: (...a: unknown[]) => upsertSourceProposalMock(...a),
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
  LumaEnrichmentLimiter: class {
    exhausted = false;
    async enrich() {
      return null;
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

function candidate(canonicalKey: string) {
  return { id: canonicalKey, canonical_key: canonicalKey, event: { calendar: null } };
}

beforeEach(() => {
  vi.clearAllMocks();
  listKnownLumaCandidateKeysMock.mockResolvedValue(new Set());
  listConfiguredLumaCalendarIdsMock.mockResolvedValue(new Set());
  getSourceProposalMock.mockResolvedValue(null);
});

describe('discoverCalendarSources', () => {
  it('writes a proposal for a newly-discovered, eligible, non-personal, not-yet-configured calendar', async () => {
    listLumaCandidatesForConferenceMock.mockResolvedValue([candidate('luma:evt-a')]);
    resolveCandidateCalendarMock.mockResolvedValue({ apiId: 'cal-new', name: 'The Best Event', isPersonal: false });
    fetchLumaCalendarItemsMock.mockResolvedValue([{ apiId: 'evt-x', name: 'Afterdark', link: null, dateISO: '2026-11-05', lat: 51.5, lng: -0.1 }]);
    evaluateCalendarItemsMock.mockReturnValue({ eligible: true, inWindowCount: 2, newCount: 1, sample: [{ name: 'Afterdark', link: null }] });

    const result = await discoverCalendarSources('DAS London', tab, profile, { deadlineMs: 5000 });

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
    resolveCandidateCalendarMock.mockResolvedValue({ apiId: 'cal-personal', name: 'Jane', isPersonal: true });

    const result = await discoverCalendarSources('DAS London', tab, profile, { deadlineMs: 5000 });

    expect(result.calendarsSkippedPersonal).toBe(1);
    expect(fetchLumaCalendarItemsMock).not.toHaveBeenCalled();
    expect(upsertSourceProposalMock).not.toHaveBeenCalled();
  });

  it('skips a calendar that already has a configured ingest_sources row', async () => {
    listLumaCandidatesForConferenceMock.mockResolvedValue([candidate('luma:evt-a')]);
    listConfiguredLumaCalendarIdsMock.mockResolvedValue(new Set(['cal-already-configured']));
    resolveCandidateCalendarMock.mockResolvedValue({ apiId: 'cal-already-configured', name: 'ETHDenver', isPersonal: false });

    const result = await discoverCalendarSources('DAS London', tab, profile, { deadlineMs: 5000 });

    expect(result.calendarsSkippedAlreadyConfigured).toBe(1);
    expect(fetchLumaCalendarItemsMock).not.toHaveBeenCalled();
  });

  it('never calls calendar/get-items for a calendar that was already dismissed — "never re-propose a dismissed calendar"', async () => {
    listLumaCandidatesForConferenceMock.mockResolvedValue([candidate('luma:evt-a')]);
    resolveCandidateCalendarMock.mockResolvedValue({ apiId: 'cal-dismissed', name: 'Already decided', isPersonal: false });
    getSourceProposalMock.mockResolvedValue({ id: 'prop-1', status: 'dismissed', conference: 'DAS London', calendar_api_id: 'cal-dismissed' });

    const result = await discoverCalendarSources('DAS London', tab, profile, { deadlineMs: 5000 });

    expect(result.calendarsSkippedDecided).toBe(1);
    expect(fetchLumaCalendarItemsMock).not.toHaveBeenCalled();
    expect(upsertSourceProposalMock).not.toHaveBeenCalled();
  });

  it('never calls calendar/get-items for an already-accepted calendar either', async () => {
    listLumaCandidatesForConferenceMock.mockResolvedValue([candidate('luma:evt-a')]);
    resolveCandidateCalendarMock.mockResolvedValue({ apiId: 'cal-accepted', name: 'Already added', isPersonal: false });
    getSourceProposalMock.mockResolvedValue({ id: 'prop-1', status: 'accepted', conference: 'DAS London', calendar_api_id: 'cal-accepted' });

    const result = await discoverCalendarSources('DAS London', tab, profile, { deadlineMs: 5000 });

    expect(result.calendarsSkippedDecided).toBe(1);
    expect(fetchLumaCalendarItemsMock).not.toHaveBeenCalled();
  });

  it('does not write a proposal when the evaluation is not eligible', async () => {
    listLumaCandidatesForConferenceMock.mockResolvedValue([candidate('luma:evt-a')]);
    resolveCandidateCalendarMock.mockResolvedValue({ apiId: 'cal-thin', name: 'Barely anything', isPersonal: false });
    fetchLumaCalendarItemsMock.mockResolvedValue([]);
    evaluateCalendarItemsMock.mockReturnValue({ eligible: false, inWindowCount: 0, newCount: 0, sample: [] });

    const result = await discoverCalendarSources('DAS London', tab, profile, { deadlineMs: 5000 });

    expect(result.proposalsWritten).toHaveLength(0);
    expect(upsertSourceProposalMock).not.toHaveBeenCalled();
  });

  it('a dry run evaluates and reports eligibility but never writes a proposal', async () => {
    listLumaCandidatesForConferenceMock.mockResolvedValue([candidate('luma:evt-a')]);
    resolveCandidateCalendarMock.mockResolvedValue({ apiId: 'cal-new', name: 'The Best Event', isPersonal: false });
    fetchLumaCalendarItemsMock.mockResolvedValue([]);
    evaluateCalendarItemsMock.mockReturnValue({ eligible: true, inWindowCount: 2, newCount: 2, sample: [] });

    const result = await discoverCalendarSources('DAS London', tab, profile, { deadlineMs: 5000, dryRun: true });

    expect(result.proposalsWritten).toHaveLength(1);
    expect(upsertSourceProposalMock).not.toHaveBeenCalled();
  });

  it('de-dupes two candidates that resolve to the same calendar into one evaluation', async () => {
    listLumaCandidatesForConferenceMock.mockResolvedValue([candidate('luma:evt-a'), candidate('luma:evt-b')]);
    resolveCandidateCalendarMock.mockResolvedValue({ apiId: 'cal-shared', name: 'Shared Calendar', isPersonal: false });
    fetchLumaCalendarItemsMock.mockResolvedValue([]);
    evaluateCalendarItemsMock.mockReturnValue({ eligible: false, inWindowCount: 0, newCount: 0, sample: [] });

    const result = await discoverCalendarSources('DAS London', tab, profile, { deadlineMs: 5000 });

    expect(result.calendarsResolved).toBe(2);
    expect(result.calendarsEvaluated).toBe(1);
    expect(fetchLumaCalendarItemsMock).toHaveBeenCalledTimes(1);
  });
});
