// Triage automation: online detection, LLM-flag routing, built-in
// lodging/residency/1:1 heuristics, pre_event, venue_unknown,
// cross-conference duplicates, new reject reasons, publisher lease — plus a
// regression set synthesized from real human triage decisions.
import { describe, it, expect, vi } from 'vitest';
import { isMeetingOrStreamLocation, looksLikeRealAddress, normalizeLumaEvent, normalizeExtractedEvent } from '../ingest/normalize';
import { geoFilter, isPreEvent, isVenueUnknown, dateWindowFilter } from '../ingest/filters';
import { computeSignals, routeCandidate, matchBuiltinHeuristics, type SignalInput } from '../ingest/signals';
import {
  conferenceIdentityPhrases,
  conferenceMatchScore,
  decideCrossConference,
  checkCrossConferenceDuplicate,
  applyCrossConferenceDemotion,
  requeueCrossConferenceTwins,
  hasForceReviewMarker,
  type OtherConferenceCandidate,
} from '../ingest/cross-conference';
import { withPublisherLease, PublisherLeaseBusyError, __resetLeaseWarningForTests, type LeaseBackend } from '../ingest/publisher-lease';
import { REJECT_REASONS, THEME_REJECT_REASONS, type NormalizedEvent } from '../ingest/types';
import { IngestRejectReasonSchema } from '../api-validation';
import { REJECT_REASON_OPTIONS } from '../../components/admin/ingest/types';
import type { VEvent } from '../ingest/ical';
import type { TabConfig } from '../conferences';

const PROFILE = { publishThreshold: 85, reviewThreshold: 40 };

function vevent(over: Partial<VEvent> = {}): VEvent {
  return {
    uid: 'evt-ABC123DEF456@events.lu.ma',
    summary: 'Some Event',
    description: '',
    dtstart: '2026-11-10T18:00:00.000Z',
    dtstartIsDateOnly: false,
    dtend: '2026-11-10T21:00:00.000Z',
    location: 'https://luma.com/event/evt-ABC123DEF456',
    geo: null,
    sequence: 0,
    status: 'CONFIRMED',
    dtstamp: null,
    organizerName: null,
    ...over,
  };
}

/** Signals + route for a candidate, the way scoring.ts combines them. */
function route(opts: {
  name: string;
  description?: string;
  llmScore: number;
  flags?: string[];
  dataQuality?: 'sufficient' | 'thin';
  extra?: Partial<SignalInput>;
}) {
  const text = [opts.name, opts.description ?? ''].join(' ');
  const signals = computeSignals({
    text,
    nameText: opts.name,
    includeKeywords: [],
    excludeKeywords: [],
    llmFlags: opts.flags ?? [],
    isTrustedCalendarSource: true, // the strongest case: curated calendar (+15)
    ...opts.extra,
  });
  return {
    signals,
    route: routeCandidate({ isEvent: true, llmScore: opts.llmScore, dataQuality: opts.dataQuality ?? 'sufficient', signals, profile: PROFILE }),
  };
}

/* ------------------------------------------------------------------ */
describe('item 1: online detection from LOCATION URLs', () => {
  it.each([
    'https://us02web.zoom.us/j/123456789',
    'https://zoom.us/j/1',
    'https://meet.google.com/abc-defg-hij',
    'https://www.youtube.com/live/abc123',
    'https://youtu.be/abc123',
    'https://teams.microsoft.com/l/meetup-join/xyz',
    'https://www.twitch.tv/somechannel',
    'https://x.com/i/spaces/1AbCdEf',
    'https://twitter.com/i/spaces/1AbCdEf',
    'https://streamyard.com/watch/abc',
    'Online',
    'Zoom',
  ])('%s is a meeting/stream location', (loc) => {
    expect(isMeetingOrStreamLocation(loc)).toBe(true);
  });

  it.each([
    'https://luma.com/event/evt-ABC123DEF456',
    'https://lu.ma/ethcc-mixer',
    'https://x.com/someuser/status/1',
    'https://www.notzoom.us.example.com/x',
    '123 Main St, London',
    '',
    null,
  ])('%s is NOT a meeting/stream location', (loc) => {
    expect(isMeetingOrStreamLocation(loc as string | null)).toBe(false);
  });

  it('a Zoom/YouTube LOCATION with no GEO normalizes as online, with no address', () => {
    for (const location of ['https://us02web.zoom.us/j/1', 'https://www.youtube.com/live/x']) {
      const e = normalizeLumaEvent({ vevent: vevent({ location }), timezone: 'UTC' });
      expect(e.isOnline).toBe(true);
      expect(e.address).toBe('');
      expect(geoFilter(e, { lat: 0, lng: 0 }, { radius_km: 50, allow_online: false })).toEqual({ pass: false, reason: 'online_not_allowed' });
    }
  });

  it('a plain Luma event-page LOCATION (venue hidden) is NOT online -> no_geo (review)', () => {
    const e = normalizeLumaEvent({ vevent: vevent(), timezone: 'UTC' });
    expect(e.isOnline).toBe(false);
    expect(geoFilter(e, { lat: 0, lng: 0 }, { radius_km: 50, allow_online: false })).toEqual({ pass: 'no_geo' });
    expect(isVenueUnknown(e)).toBe(true);
  });

  it('GEO always wins: a Zoom LOCATION with real coordinates stays in-person', () => {
    const e = normalizeLumaEvent({ vevent: vevent({ location: 'https://zoom.us/j/1', geo: { lat: 51.5, lng: -0.1 } }), timezone: 'UTC' });
    expect(e.isOnline).toBe(false);
  });

  it('no LOCATION and no GEO stays online (unchanged behavior)', () => {
    expect(normalizeLumaEvent({ vevent: vevent({ location: null }), timezone: 'UTC' }).isOnline).toBe(true);
  });

  it('an enriched Luma payload with location_type=online and no address is online', () => {
    const e = normalizeLumaEvent({
      vevent: vevent(),
      timezone: 'UTC',
      enrichment: { event: { api_id: 'evt-ABC123DEF456', name: 'X', location_type: 'online' } as never, hosts: [] },
    });
    expect(e.isOnline).toBe(true);
  });

  it('"Online" as LOCATION text is not treated as a venue address', () => {
    expect(looksLikeRealAddress('Online')).toBe(false);
    expect(looksLikeRealAddress('Shoreditch, London')).toBe(true);
  });

  it('extracted (non-Luma) events with a Zoom address are online with a blank address', () => {
    const e = normalizeExtractedEvent({
      platform: 'eventbrite',
      result: { name: 'Webinar', dateISO: '2026-11-10', address: 'https://zoom.us/j/9', link: 'https://www.eventbrite.com/e/1' } as never,
    });
    expect(e?.isOnline).toBe(true);
    expect(e?.address).toBe('');
  });

  it('venue_unknown caps at review; an address or coordinates clear it', () => {
    expect(isVenueUnknown({ lat: null, lng: null, address: '' })).toBe(true);
    expect(isVenueUnknown({ lat: null, lng: null, address: 'Shoreditch' })).toBe(false);
    expect(isVenueUnknown({ lat: 51.5, lng: -0.1, address: '' })).toBe(false);
    const r = route({ name: 'Great Mixer', llmScore: 95, extra: { venueUnknown: true } });
    expect(r.signals.breakdown.venue_unknown).toBe(0);
    expect(r.route).toBe('review');
  });
});

/* ------------------------------------------------------------------ */
describe('item 2: LLM flags in routing', () => {
  it('no flags: a strong curated event still auto-publishes (baseline)', () => {
    expect(route({ name: 'Great Mixer', llmScore: 90 }).route).toBe('publish');
  });

  it.each(['online_only', 'spam_or_promo', 'private_or_invite_only', 'sold_out'])('%s never auto-publishes', (flag) => {
    expect(route({ name: 'Great Mixer', llmScore: 95, flags: [flag] }).route).toBe('review');
  });

  it('online_only / spam_or_promo auto-reject only when the score is already below the review threshold', () => {
    for (const flag of ['online_only', 'spam_or_promo']) {
      expect(route({ name: 'X', llmScore: 20, flags: [flag] }).route).toBe('reject'); // 20 + 15 < 40
      expect(route({ name: 'X', llmScore: 30, flags: [flag] }).route).toBe('review'); // 30 + 15 >= 40
    }
  });

  it('online_only with no geo is recorded as such', () => {
    expect(route({ name: 'X', llmScore: 60, flags: ['online_only'], extra: { noGeo: true } }).signals.breakdown).toHaveProperty('flag:online_only_no_geo', 0);
  });

  it('private_or_invite_only / sold_out: penalty, but the penalty alone never causes an auto-reject', () => {
    for (const flag of ['private_or_invite_only', 'sold_out']) {
      const r = route({ name: 'Dinner', llmScore: 30, flags: [flag] }); // 30 + 15 - 10 = 35 < 40, but 45 without the penalty
      expect(r.signals.breakdown[`flag:${flag}`]).toBe(-10);
      expect(r.signals.total).toBe(5);
      expect(r.route).toBe('review');
    }
    // Genuinely low score still rejects (as it would with no flag).
    expect(route({ name: 'Dinner', llmScore: 10, flags: ['private_or_invite_only'] }).route).toBe('reject');
  });

  it('a real hard reject (exclude keyword) still works alongside a private flag', () => {
    const signals = computeSignals({ text: 'forex signals dinner', includeKeywords: [], excludeKeywords: ['forex signals'], llmFlags: ['private_or_invite_only'] });
    expect(routeCandidate({ isEvent: true, llmScore: 60, dataQuality: 'sufficient', signals, profile: PROFILE })).toBe('reject');
  });
});

/* ------------------------------------------------------------------ */
describe('item 4: reject reasons + built-in heuristics', () => {
  it('REJECT_REASONS has the new non-theme reasons, and the API schema + UI chips stay in sync', () => {
    for (const r of ['online', 'lodging', 'sales_1on1', 'residency', 'pre_event']) {
      expect(REJECT_REASONS).toContain(r);
      expect(THEME_REJECT_REASONS).not.toContain(r);
    }
    expect([...IngestRejectReasonSchema.options].sort()).toEqual([...REJECT_REASONS].sort());
    expect(REJECT_REASON_OPTIONS.map((o) => o.value).sort()).toEqual([...REJECT_REASONS].sort());
  });

  it.each([
    ['Hotel Room Block for Breakpoint Week', '', 'lodging'],
    ['Breakpoint Co-Living House', '', 'lodging'],
    ['Builders Brunch', 'Grab our exclusive stay package and book your room today', 'lodging'],
    ['Forma Residency Ship & Show', '', 'residency'],
    ['Solana Fellowship Info Session', '', 'residency'],
    ['Builders Brunch', 'Our 6-week residency program for founders', 'residency'],
    ['Glamsterdam Readiness Clinic: 1:1s with ChainSecurity Engineers', '', 'sales_1on1'],
    ['YC Application Office Hours', '', 'sales_1on1'],
    ['Security Clinic', 'Book a call with our team to review your protocol', 'sales_1on1'],
    ['Partner Lounge', 'Private 1:1 sessions with our BD team', 'sales_1on1'],
  ])('"%s" / "%s" -> %s', (name, desc, key) => {
    expect(matchBuiltinHeuristics(name, `${name} ${desc}`)).toContain(key);
  });

  it.each([
    ['Smoking Summit', 'An open meetup for builders. Everyone welcome.'],
    ['Afterparty', 'Join us at the Hoxton Hotel rooftop'], // venue hotel in the description only
    ['Hotel Rooftop Party', 'Drinks at the hotel bar'],
    ['Airbnb Hosts x Web3 Meetup', ''],
    ['Solidity Bootcamp Demo Day', ''],
    ['Cohort 3 Demo Day', ''],
    ['Founder Office Hours: Open Q&A', 'Ask us anything about building on Solana'],
    ['Founder Dinner', 'Curated guest list — apply to attend. Registration is open to all.'],
    ['DeFi Day 11:15 Keynote', ''],
    ['ZK Summit Side Event', 'Talks and panels'],
  ])('no heuristic false positive: "%s"', (name, desc) => {
    expect(matchBuiltinHeuristics(name, `${name} ${desc}`)).toEqual([]);
  });

  it('a heuristic hit caps at review (no penalty); it only rejects when the score is already below threshold', () => {
    const high = route({ name: 'Forma Residency Ship & Show', llmScore: 95 });
    expect(high.signals.breakdown['heuristic:residency']).toBe(0);
    expect(high.signals.total).toBe(15); // only the curated-calendar points
    expect(high.route).toBe('review');
    expect(route({ name: 'Forma Residency Ship & Show', llmScore: 20 }).route).toBe('reject');
  });
});

/* ------------------------------------------------------------------ */
describe('item 5: pre_event', () => {
  it('before the core start date (but inside the pre-window) is pre_event', () => {
    const devcon = { startDate: '2026-10-31', endDate: '2026-11-08' };
    expect(dateWindowFilter({ dateISO: '2026-10-30' }, devcon, { window_pre_days: 3, window_post_days: 1 })).toEqual({ pass: true });
    expect(isPreEvent({ dateISO: '2026-10-30' }, devcon)).toBe(true);
    expect(isPreEvent({ dateISO: '2026-10-31' }, devcon)).toBe(false);
    expect(isPreEvent({ dateISO: '2026-11-08' }, devcon)).toBe(false);
    expect(isPreEvent({ dateISO: '' }, devcon)).toBe(false);
  });
  it('caps at review', () => {
    const r = route({ name: 'Great Mixer', llmScore: 95, extra: { preEvent: true } });
    expect(r.signals.breakdown.pre_event).toBe(0);
    expect(r.route).toBe('review');
  });
});

/* ------------------------------------------------------------------ */
const DAS: TabConfig = { gid: 1, name: 'DAS London 2026', slug: 'daslondon2026', timezone: 'Europe/London', dates: ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12'], center: { lat: 51.5, lng: -0.12 }, city: 'London' };
const BREAKPOINT: TabConfig = {
  gid: 2,
  name: 'Solana Breakpoint',
  slug: 'breakpoint2026',
  timezone: 'Europe/London',
  dates: ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18'],
  center: { lat: 51.5, lng: -0.12 },
  city: 'London',
};
const TABS = new Map([DAS, BREAKPOINT].map((t) => [t.name, t]));

function ev(name: string, dateISO = '2026-11-10', over: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    name,
    startAt: `${dateISO}T10:00:00.000Z`,
    timezone: 'Europe/London',
    dateISO,
    sheetDate: '',
    startTime: '10:00a',
    endTime: '',
    address: '',
    isOnline: false,
    organizer: '',
    hosts: [],
    calendar: null,
    cost: 'Free',
    link: 'https://luma.com/event/evt-PADEL0000001',
    descriptionText: '',
    platform: 'luma',
    ...over,
  };
}

function twin(conference: string, event: NormalizedEvent, over: Partial<OtherConferenceCandidate> = {}): OtherConferenceCandidate {
  return { id: `${conference}-id`, conference, canonical_key: 'luma:evt-padel0000001', alt_keys: [], status: 'queued', published_at: null, event, first_seen_at: '2026-10-20T00:00:00.000Z', ...over };
}

describe('item 3: cross-conference duplicates', () => {
  it('identity phrases drop years, the city and generic words, and expand acronyms', () => {
    expect(conferenceIdentityPhrases(DAS)).toEqual(['das', 'digital asset summit']);
    expect(conferenceIdentityPhrases(BREAKPOINT)).toEqual(['solana', 'breakpoint']);
  });

  it('scores core-window dates and name/host/calendar tokens', () => {
    expect(conferenceMatchScore(ev('DAS Padel Social'), DAS)).toBe(4);
    expect(conferenceMatchScore(ev('DAS Padel Social'), BREAKPOINT)).toBe(2);
    expect(conferenceMatchScore(ev('Padel', '2026-11-15'), DAS)).toBe(0); // outside DAS core dates
    expect(conferenceMatchScore(ev('Padel', '2026-11-15', { calendar: { apiId: 'c', name: 'Digital Asset Summit Side Events' } }), DAS)).toBe(2);
    expect(conferenceMatchScore(ev('Breakpoint Afterparty'), BREAKPOINT)).toBe(4);
  });

  it('"DAS Padel Social" seen from Breakpoint while DAS has it -> Breakpoint copy is the duplicate', () => {
    const e = ev('DAS Padel Social', '2026-11-10', { descriptionText: 'By invitation. Registration subject to host approval.' });
    const d = decideCrossConference({ conference: BREAKPOINT.name, tab: BREAKPOINT, event: e }, [twin(DAS.name, e)], TABS);
    expect(d).toMatchObject({ kind: 'self_duplicate', note: 'also in DAS London 2026', other: { id: 'DAS London 2026-id' } });
  });

  it('"DAS Padel Social" seen from DAS while Breakpoint has it pending -> demote the Breakpoint copy', () => {
    const e = ev('DAS Padel Social');
    const d = decideCrossConference({ conference: DAS.name, tab: DAS, event: e }, [twin(BREAKPOINT.name, e)], TABS);
    expect(d).toMatchObject({ kind: 'demote_other', note: 'also in DAS London 2026', other: { conference: 'Solana Breakpoint' } });
  });

  it('never demotes a twin the other conference already approved/published — caps this one instead', () => {
    const e = ev('DAS Padel Social');
    const d = decideCrossConference({ conference: DAS.name, tab: DAS, event: e }, [twin(BREAKPOINT.name, e, { status: 'approved' })], TABS);
    expect(d?.kind).toBe('possible_duplicate');
  });

  it('ties keep the older candidate (a brand-new one becomes the duplicate)', () => {
    const e = ev('London Padel Social');
    expect(decideCrossConference({ conference: DAS.name, tab: DAS, event: e }, [twin(BREAKPOINT.name, e)], TABS)?.kind).toBe('self_duplicate');
    expect(
      decideCrossConference({ conference: DAS.name, tab: DAS, event: e, firstSeenAt: '2026-10-01T00:00:00.000Z' }, [twin(BREAKPOINT.name, e)], TABS)?.kind
    ).toBe('demote_other');
  });

  it('ignores rejected / filtered / auto-rejected twins and twins of unknown conferences', () => {
    const e = ev('DAS Padel Social');
    for (const status of ['rejected', 'filtered_out', 'auto_rejected', 'duplicate', 'unpublished'] as const) {
      expect(decideCrossConference({ conference: BREAKPOINT.name, tab: BREAKPOINT, event: e }, [twin(DAS.name, e, { status })], TABS)).toBeNull();
    }
    expect(decideCrossConference({ conference: BREAKPOINT.name, tab: BREAKPOINT, event: e }, [twin('Gone Conf', e)], TABS)).toBeNull();
  });

  it('checkCrossConferenceDuplicate queries canonical + alt keys and never throws', async () => {
    const list = vi.fn(async () => [twin(DAS.name, ev('DAS Padel Social'))]);
    const d = await checkCrossConferenceDuplicate(
      { conference: BREAKPOINT.name, tab: BREAKPOINT, canonicalKey: 'luma:evt-padel0000001', altKeys: ['luma:das-padel'], event: ev('DAS Padel Social') },
      { listOtherConferenceCandidatesByKeys: list, getAllConferenceTabs: async () => [DAS, BREAKPOINT] }
    );
    expect(list).toHaveBeenCalledWith('Solana Breakpoint', ['luma:evt-padel0000001', 'luma:das-padel']);
    expect(d?.kind).toBe('self_duplicate');
    const failing = await checkCrossConferenceDuplicate(
      { conference: BREAKPOINT.name, tab: BREAKPOINT, canonicalKey: 'k', altKeys: [], event: ev('x') },
      { listOtherConferenceCandidatesByKeys: async () => { throw new Error('db down'); }, getAllConferenceTabs: async () => [] }
    );
    expect(failing).toBeNull();
  });

  it('applyCrossConferenceDemotion claims only from pending statuses, with duplicate_of = the keeping candidate id', async () => {
    const claim = vi.fn(async () => ({}));
    const e = ev('DAS Padel Social');
    const d = decideCrossConference({ conference: DAS.name, tab: DAS, event: e }, [twin(BREAKPOINT.name, e)], TABS);
    const cur = { id: 'cand-das', conference: DAS.name, canonicalKey: 'luma:evt-padel0000001' };
    expect(await applyCrossConferenceDemotion(d, cur, { claimCandidateStatus: claim })).toBe(true);
    expect(claim).toHaveBeenCalledWith('Solana Breakpoint-id', ['queued', 'pending_classify'], 'duplicate', {
      duplicate_of: 'cand-das',
      review_note: 'Cross-conference duplicate: also in DAS London 2026',
    });
    expect(await applyCrossConferenceDemotion({ kind: 'self_duplicate', other: twin(DAS.name, e), note: '' }, cur, { claimCandidateStatus: claim })).toBe(false);
    expect(await applyCrossConferenceDemotion(null, cur, { claimCandidateStatus: claim })).toBe(false);
  });

  it('without a known id, duplicate_of is null and the key goes in the note', async () => {
    const claim = vi.fn(async () => ({}));
    const e = ev('DAS Padel Social');
    const d = decideCrossConference({ conference: DAS.name, tab: DAS, event: e }, [twin(BREAKPOINT.name, e)], TABS);
    await applyCrossConferenceDemotion(d, { id: null, conference: DAS.name, canonicalKey: 'luma:evt-padel0000001' }, { claimCandidateStatus: claim });
    expect(claim).toHaveBeenCalledWith('Solana Breakpoint-id', ['queued', 'pending_classify'], 'duplicate', {
      duplicate_of: null,
      review_note: 'Cross-conference duplicate: also in DAS London 2026 (luma:evt-padel0000001)',
    });
  });

  describe('requeueCrossConferenceTwins (admin rejects the copy that was kept)', () => {
    const rejected = { conference: DAS.name, canonical_key: 'luma:evt-padel0000001', alt_keys: ['luma:das-padel'] };
    const demoted = (over: Partial<OtherConferenceCandidate> = {}) =>
      twin(BREAKPOINT.name, ev('DAS Padel Social'), { status: 'duplicate', review_note: 'Cross-conference duplicate: also in DAS London 2026', llm_score: 70, ...over });

    it('re-queues demoted twins (queued if scored, pending_classify if never classified)', async () => {
      const claim = vi.fn(async () => ({}));
      const list = vi.fn(async () => [demoted(), demoted({ id: 'unscored', llm_score: null, review_note: 'Cross-conference duplicate: also in DAS London 2026 (luma:x)' })]);
      const ids = await requeueCrossConferenceTwins(rejected, 'wrong_city', { listOtherConferenceCandidatesByKeys: list, claimCandidateStatus: claim });
      expect(list).toHaveBeenCalledWith('DAS London 2026', ['luma:evt-padel0000001', 'luma:das-padel']);
      expect(ids).toEqual(['Solana Breakpoint-id', 'unscored']);
      const extra = expect.objectContaining({
        duplicate_of: null,
        review_note: expect.stringMatching(/rejected as wrong_city\. Review only/),
        edits: { force_review: 'cross_conference_requeue:wrong_city' },
      });
      expect(claim).toHaveBeenCalledWith('Solana Breakpoint-id', ['duplicate'], 'queued', extra);
      expect(claim).toHaveBeenCalledWith('unscored', ['duplicate'], 'pending_classify', extra);
    });

    it.each(['wrong_dates', 'pre_event'])('re-queues on the conference-specific reason %s', async (reason) => {
      const claim = vi.fn(async () => ({}));
      const ids = await requeueCrossConferenceTwins(rejected, reason, { listOtherConferenceCandidatesByKeys: async () => [demoted()], claimCandidateStatus: claim });
      expect(ids).toEqual(['Solana Breakpoint-id']);
    });

    it.each(['spam', 'off_theme', 'online', 'lodging', 'residency', 'sales_1on1', 'private_or_invite_only', 'other', 'duplicate'])(
      'a %s reject never revives the twin (the event itself was bad)',
      async (reason) => {
        const claim = vi.fn(async () => ({}));
        const list = vi.fn(async () => [demoted()]);
        expect(await requeueCrossConferenceTwins(rejected, reason, { listOtherConferenceCandidatesByKeys: list, claimCandidateStatus: claim })).toEqual([]);
        expect(list).not.toHaveBeenCalled();
        expect(claim).not.toHaveBeenCalled();
      }
    );

    it('a wrong_city re-queued twin can only ever reach review, even with a top score from a trusted calendar + trusted host', async () => {
      let saved: Record<string, unknown> = {};
      const claim = vi.fn(async (_id: string, _from: readonly string[], _to: string, extra: Record<string, unknown>) => {
        saved = extra;
        return {};
      });
      await requeueCrossConferenceTwins(rejected, 'wrong_city', { listOtherConferenceCandidatesByKeys: async () => [demoted({ llm_score: null })], claimCandidateStatus: claim });
      const persisted = { edits: saved.edits as Record<string, unknown> };
      expect(hasForceReviewMarker(persisted)).toBe(true);
      const signals = computeSignals({
        text: 'DAS Padel Social',
        includeKeywords: [],
        excludeKeywords: [],
        isTrustedCalendarSource: true,
        isTrustedHost: true,
        forceReview: hasForceReviewMarker(persisted),
      });
      expect(signals.breakdown.force_review).toBe(0);
      expect(routeCandidate({ isEvent: true, llmScore: 100, dataQuality: 'sufficient', signals, profile: PROFILE })).toBe('review');
      // Without the marker the same candidate would auto-publish.
      const unmarked = computeSignals({ text: 'DAS Padel Social', includeKeywords: [], excludeKeywords: [], isTrustedCalendarSource: true, isTrustedHost: true });
      expect(routeCandidate({ isEvent: true, llmScore: 100, dataQuality: 'sufficient', signals: unmarked, profile: PROFILE })).toBe('publish');
    });

    it('keeps any existing edits alongside the marker', async () => {
      const claim = vi.fn(async () => ({}));
      await requeueCrossConferenceTwins(rejected, 'wrong_city', { listOtherConferenceCandidatesByKeys: async () => [demoted({ edits: { name: 'X' } })], claimCandidateStatus: claim });
      expect(claim).toHaveBeenCalledWith(expect.any(String), ['duplicate'], 'queued', expect.objectContaining({ edits: { name: 'X', force_review: 'cross_conference_requeue:wrong_city' } }));
    });

    it('does nothing for a duplicate reject, for published (swept) duplicates, or for twins demoted in favour of ANOTHER conference', async () => {
      const claim = vi.fn(async () => ({}));
      const list = vi.fn(async () => [
        demoted({ id: 'swept', published_at: '2026-11-01T00:00:00Z' }),
        demoted({ id: 'other-conf', review_note: 'Cross-conference duplicate: also in Devcon 8' }),
        demoted({ id: 'plain-dup', review_note: 'Fallback name+date dedupe: ...' }),
        demoted({ id: 'queued', status: 'queued' }),
      ]);
      expect(await requeueCrossConferenceTwins(rejected, 'duplicate', { listOtherConferenceCandidatesByKeys: list, claimCandidateStatus: claim })).toEqual([]);
      expect(list).not.toHaveBeenCalled();
      expect(await requeueCrossConferenceTwins(rejected, 'wrong_city', { listOtherConferenceCandidatesByKeys: list, claimCandidateStatus: claim })).toEqual([]);
      expect(claim).not.toHaveBeenCalled();
    });

    it('never throws', async () => {
      const list = vi.fn(async () => {
        throw new Error('db down');
      });
      expect(await requeueCrossConferenceTwins(rejected, 'wrong_city', { listOtherConferenceCandidatesByKeys: list })).toEqual([]);
    });
  });
});

/* ------------------------------------------------------------------ */
describe('item 7: publisher lease', () => {
  function backend(results: ('acquired' | 'busy' | 'unavailable')[]): LeaseBackend & { released: string[] } {
    const released: string[] = [];
    let i = 0;
    return {
      released,
      tryAcquire: vi.fn(async () => results[Math.min(i++, results.length - 1)]),
      release: vi.fn(async (key: string) => {
        released.push(key);
      }),
    };
  }
  const instant = { sleep: async () => {}, pollMs: 1 };

  it('runs fn under the lease and releases it, even when fn throws', async () => {
    const b = backend(['acquired']);
    expect(await withPublisherLease('sheet:1', async () => 42, { backend: b, ...instant })).toBe(42);
    expect(b.released).toEqual(['sheet:1']);
    const b2 = backend(['acquired']);
    await expect(withPublisherLease('sheet:1', async () => { throw new Error('boom'); }, { backend: b2, ...instant })).rejects.toThrow('boom');
    expect(b2.released).toEqual(['sheet:1']);
  });

  it('waits while busy, then proceeds', async () => {
    const b = backend(['busy', 'busy', 'acquired']);
    const fn = vi.fn(async () => 'ok');
    expect(await withPublisherLease('sheet:1', fn, { backend: b, ...instant })).toBe('ok');
    expect(b.tryAcquire).toHaveBeenCalledTimes(3);
  });

  it('gives up with PublisherLeaseBusyError after waitMs, never running fn', async () => {
    let t = 0;
    const b = backend(['busy']);
    const fn = vi.fn(async () => 'ok');
    await expect(withPublisherLease('sheet:1', fn, { backend: b, waitMs: 100, sleep: async () => { t += 60; }, now: () => t })).rejects.toBeInstanceOf(PublisherLeaseBusyError);
    expect(fn).not.toHaveBeenCalled();
  });

  it('degrades gracefully (runs unlocked, warns) when the migration is not applied', async () => {
    __resetLeaseWarningForTests();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const b = backend(['unavailable']);
    expect(await withPublisherLease('sheet:1', async () => 'ran', { backend: b, ...instant })).toBe('ran');
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/WITHOUT the publisher lock/));
    expect(b.released).toEqual([]);
    warn.mockRestore();
  });
});

/* ------------------------------------------------------------------ */
/* Regression set: synthesized from real human triage decisions.        */
/* ------------------------------------------------------------------ */
describe('regression: real rejected cases are never auto-published (and clear ones auto-reject)', () => {
  it('online Spanish-language Zcash livestream labelled "Mumbai (venue on event page)" -> online, filtered', () => {
    const e = normalizeLumaEvent({
      vevent: vevent({ summary: 'Zcash en Español: Transmisión en vivo', location: 'https://www.youtube.com/live/zcashES', dtstart: '2026-11-02T14:00:00.000Z' }),
      timezone: 'Asia/Kolkata',
    });
    expect(e.isOnline).toBe(true);
    expect(e.address).toBe('');
    expect(geoFilter(e, { lat: 19.07, lng: 72.87 }, { radius_km: 50, allow_online: false })).toMatchObject({ pass: false, reason: 'online_not_allowed' });
    // Even if it got past the filter, the LLM's online_only flag blocks publish.
    expect(route({ name: e.name, llmScore: 90, flags: ['online_only'], extra: { noGeo: true } }).route).toBe('review');
  });

  it('"Glamsterdam Readiness Clinic: 1:1s with ChainSecurity Engineers" -> sales 1:1 heuristic', () => {
    const name = 'Glamsterdam Readiness Clinic: 1:1s with ChainSecurity Engineers';
    expect(route({ name, llmScore: 92 }).route).toBe('review');
    expect(route({ name, llmScore: 92 }).signals.breakdown).toHaveProperty('heuristic:sales_1on1');
    expect(route({ name, llmScore: 20 }).route).toBe('reject');
  });

  it('Superteam UK YC application office hours on Oct 30, before Devcon -> pre_event + 1:1 heuristic', () => {
    const name = 'Superteam UK x YC: Application Office Hours';
    const pre = isPreEvent({ dateISO: '2026-10-30' }, { startDate: '2026-10-31' });
    expect(pre).toBe(true);
    const r = route({ name, llmScore: 90, extra: { preEvent: pre } });
    expect(r.route).toBe('review');
    expect(r.signals.breakdown).toMatchObject({ pre_event: 0, 'heuristic:sales_1on1': 0 });
  });

  it('"DAS Padel Social … By invitation … subject to host approval" in BOTH DAS and Breakpoint queues -> one becomes a duplicate; the invite flag never auto-rejects it', () => {
    const e = ev('DAS Padel Social', '2026-11-11', { descriptionText: 'By invitation only. Registration is subject to host approval.' });
    expect(decideCrossConference({ conference: BREAKPOINT.name, tab: BREAKPOINT, event: e }, [twin(DAS.name, e)], TABS)?.kind).toBe('self_duplicate');
    expect(decideCrossConference({ conference: DAS.name, tab: DAS, event: e }, [twin(BREAKPOINT.name, e)], TABS)?.kind).toBe('demote_other');
    expect(route({ name: e.name, description: e.descriptionText, llmScore: 30, flags: ['private_or_invite_only'] }).route).toBe('review');
    expect(route({ name: e.name, description: e.descriptionText, llmScore: 95, flags: ['private_or_invite_only'] }).route).toBe('review');
  });

  it('"Forma Residency Ship & Show" -> residency heuristic', () => {
    expect(route({ name: 'Forma Residency Ship & Show', llmScore: 88 }).route).toBe('review');
    expect(route({ name: 'Forma Residency Ship & Show', llmScore: 15 }).route).toBe('reject');
  });
});

describe('regression: real approved cases are NOT auto-rejected', () => {
  it('"Smoking Summit" (open meetup): no heuristic, no cap', () => {
    const r = route({ name: 'Smoking Summit', description: 'Open meetup, all welcome. RSVP on Luma.', llmScore: 60 });
    expect(r.signals.capRouteAtReview).toBe(false);
    expect(r.route).toBe('review');
    expect(route({ name: 'Smoking Summit', description: 'Open meetup, all welcome.', llmScore: 90 }).route).toBe('publish');
  });

  it('"curated guest list, apply to attend" dinner with open registration: even with the private flag it is reviewed, not rejected', () => {
    const name = 'Founders & Funders Dinner';
    const description = 'Curated guest list — apply to attend. Registration is open to everyone; we confirm by email.';
    expect(matchBuiltinHeuristics(name, `${name} ${description}`)).toEqual([]);
    expect(route({ name, description, llmScore: 60 }).route).toBe('review');
    expect(route({ name, description, llmScore: 30, flags: ['private_or_invite_only'] }).route).toBe('review');
  });
});
