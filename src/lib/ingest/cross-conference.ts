// Cross-conference duplicates. Candidates are unique per (conference,
// canonical_key), so when two conferences overlap in place and time (DAS
// London and Solana Breakpoint: both London, DAS's whole window inside
// Breakpoint's), the SAME Luma event lands in BOTH review queues. Before
// classify/route, look the event's keys up across other conferences and
// keep it only in the best-matching one; the other is routed `duplicate`
// with a note "also in <conf>". Never touches the sheet.
//
// Conservative by construction: this can only turn a candidate INTO a
// duplicate (or cap it at review) — it never publishes anything, and a
// candidate another conference already published/approved is never
// demoted.
import type { TabConfig } from '../conferences';
import type { CandidateStatus, IngestCandidateRow, NormalizedEvent } from './types';
import { isSweptDuplicate } from './types';
import { claimCandidateStatus, listOtherConferenceCandidatesByKeys } from './db';
import { getAllConferenceTabs } from '../get-conferences';

export type OtherConferenceCandidate = Pick<
  IngestCandidateRow,
  'id' | 'conference' | 'canonical_key' | 'alt_keys' | 'status' | 'published_at' | 'event' | 'first_seen_at'
> &
  Partial<Pick<IngestCandidateRow, 'review_note' | 'llm_score' | 'edits'>>;

/** Statuses where the other conference still "has" the event. Rejected/
 *  filtered/auto-rejected/duplicate twins don't count — e.g. a twin that
 *  was filtered out of the other conference's date window isn't really
 *  in that conference. */
const PENDING_STATUSES: readonly CandidateStatus[] = ['queued', 'pending_classify'];
const PUBLISHED_STATUSES: readonly CandidateStatus[] = ['approved', 'auto_published'];

function isPublishedTwin(c: Pick<OtherConferenceCandidate, 'status' | 'published_at'>): boolean {
  return PUBLISHED_STATUSES.includes(c.status) || isSweptDuplicate(c);
}

function isActiveTwin(c: Pick<OtherConferenceCandidate, 'status' | 'published_at'>): boolean {
  return PENDING_STATUSES.includes(c.status) || isPublishedTwin(c);
}

/** Words that never identify a specific conference. */
const GENERIC_TOKENS = new Set([
  'the', 'of', 'and', 'week', 'weeks', 'conference', 'conf', 'summit', 'side', 'event', 'events', 'festival',
  'blockchain', 'crypto', 'web3', 'tech', 'technology', 'ai', 'nft', 'nfts', 'art', 'music', 'gaming', 'expo',
  'global', 'international', 'official', 'community', 'annual',
]);

/** Extra phrases that identify a conference whose tab name is only an
 *  acronym (keyed by the lowercased token). */
const CONFERENCE_ALIASES: Record<string, string[]> = {
  das: ['digital asset summit'],
  pbw: ['paris blockchain week'],
  kbw: ['korea blockchain week'],
  token2049: ['token 2049'],
  ethcc: ['eth cc'],
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Distinctive identifying phrases for a conference tab, e.g.
 *  "DAS London 2026" -> ["das", "digital asset summit"],
 *  "Solana Breakpoint" -> ["solana", "breakpoint"]. Years, the city and
 *  generic words are dropped. */
export function conferenceIdentityPhrases(tab: Pick<TabConfig, 'name' | 'city'>): string[] {
  const cityTokens = new Set((tab.city ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const tokens = tab.name
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !/^\d+$/.test(t) && !GENERIC_TOKENS.has(t) && !cityTokens.has(t));
  const phrases = new Set<string>();
  for (const t of tokens) {
    phrases.add(t);
    for (const alias of CONFERENCE_ALIASES[t] ?? []) phrases.add(alias);
  }
  return Array.from(phrases);
}

/** How well `event` belongs to `tab`: +2 when its date is inside the
 *  tab's CORE dates (not just the pre/post window), +2 for each of the
 *  conference's identity phrases in the event's name / hosts / organizer /
 *  calendar name. Pure; exported for tests. */
export function conferenceMatchScore(
  event: Pick<NormalizedEvent, 'name' | 'dateISO' | 'organizer' | 'hosts' | 'calendar'>,
  tab: Pick<TabConfig, 'name' | 'city' | 'dates'>
): number {
  let score = 0;
  const start = tab.dates[0];
  const end = tab.dates[tab.dates.length - 1];
  if (event.dateISO && start && end && event.dateISO >= start && event.dateISO <= end) score += 2;
  const text = [event.name, event.organizer, ...(event.hosts ?? []).map((h) => h.name), event.calendar?.name ?? ''].join(' | ');
  for (const phrase of conferenceIdentityPhrases(tab)) {
    const re = new RegExp(`(?<![a-z0-9])${escapeRegExp(phrase).replace(/ /g, '\\s+')}(?![a-z0-9])`, 'i');
    if (re.test(text)) score += 2;
  }
  return score;
}

export type CrossConferenceDecision =
  /** Keep it elsewhere: route THIS candidate as a duplicate. */
  | { kind: 'self_duplicate'; other: OtherConferenceCandidate; note: string }
  /** This conference is the better home; the other conference's PENDING
   *  twin should become a duplicate (after this one is persisted). */
  | { kind: 'demote_other'; other: OtherConferenceCandidate; note: string }
  /** This conference matches better, but the other already published/
   *  approved it — don't touch theirs; just cap this one at review. */
  | { kind: 'possible_duplicate'; other: OtherConferenceCandidate; note: string };

/**
 * Decide what to do about twins of `event` in other conferences. Ties keep
 * the OLDER candidate (by first_seen_at; a brand-new candidate loses), so
 * the outcome is stable across runs. Pure; exported for tests.
 */
export function decideCrossConference(
  current: { conference: string; tab: Pick<TabConfig, 'name' | 'city' | 'dates'>; event: NormalizedEvent; firstSeenAt?: string | null },
  others: OtherConferenceCandidate[],
  tabsByName: Map<string, Pick<TabConfig, 'name' | 'city' | 'dates'>>
): CrossConferenceDecision | null {
  const active = others.filter((o) => o.conference !== current.conference && isActiveTwin(o));
  if (active.length === 0) return null;

  const mine = conferenceMatchScore(current.event, current.tab);
  // Strongest twin first; published twins win ties against pending ones.
  // A twin whose conference tab no longer exists is ignored.
  const scored = active
    .flatMap((o) => {
      const tab = tabsByName.get(o.conference);
      return tab ? [{ o, score: conferenceMatchScore(o.event ?? current.event, tab) }] : [];
    })
    .sort((a, b) => b.score - a.score || Number(isPublishedTwin(b.o)) - Number(isPublishedTwin(a.o)));
  if (scored.length === 0) return null;
  const best = scored[0];

  // Tie: the older candidate keeps the event (stable across runs).
  const currentIsOlder =
    mine === best.score && !!current.firstSeenAt && !!best.o.first_seen_at && current.firstSeenAt < best.o.first_seen_at;
  if (mine > best.score || (currentIsOlder && !isPublishedTwin(best.o))) {
    if (isPublishedTwin(best.o)) {
      return { kind: 'possible_duplicate', other: best.o, note: `also in ${best.o.conference} (already published there)` };
    }
    return { kind: 'demote_other', other: best.o, note: `also in ${current.conference}` };
  }
  return { kind: 'self_duplicate', other: best.o, note: `also in ${best.o.conference}` };
}

export interface CrossConferenceDeps {
  listOtherConferenceCandidatesByKeys: (conference: string, keys: string[]) => Promise<OtherConferenceCandidate[]>;
  getAllConferenceTabs: () => Promise<TabConfig[]>;
}

const defaultDeps: CrossConferenceDeps = {
  listOtherConferenceCandidatesByKeys: (conference, keys) => listOtherConferenceCandidatesByKeys(conference, keys),
  getAllConferenceTabs: () => getAllConferenceTabs(),
};

/**
 * Look up and decide. Never throws: any lookup failure returns null (the
 * candidate proceeds exactly as before this check existed).
 */
export async function checkCrossConferenceDuplicate(
  args: { conference: string; tab: TabConfig; canonicalKey: string; altKeys: string[]; event: NormalizedEvent; firstSeenAt?: string | null },
  deps?: CrossConferenceDeps
): Promise<CrossConferenceDecision | null> {
  try {
    const d = deps ?? defaultDeps;
    const others = await d.listOtherConferenceCandidatesByKeys(args.conference, [args.canonicalKey, ...args.altKeys]);
    if (others.length === 0) return null;
    const tabs = await d.getAllConferenceTabs();
    const tabsByName = new Map(tabs.map((t) => [t.name, t]));
    return decideCrossConference({ conference: args.conference, tab: args.tab, event: args.event, firstSeenAt: args.firstSeenAt }, others, tabsByName);
  } catch (err) {
    console.warn(`[ingest cross-conference] lookup failed for ${args.canonicalKey}: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

/** Persisted force-review marker: `ingest_candidates.edits.force_review`.
 *  The pipeline never writes `edits` (only an admin approve does, after
 *  which it no longer matters), so the marker survives every re-ingest and
 *  re-classification; scoring.ts turns it into a review cap. */
export const FORCE_REVIEW_KEY = 'force_review';

/** True if a human-driven re-queue marked this candidate review-only. */
export function hasForceReviewMarker(c: { edits?: Record<string, unknown> | null } | null | undefined): boolean {
  return !!c?.edits && typeof c.edits === 'object' && !!(c.edits as Record<string, unknown>)[FORCE_REVIEW_KEY];
}

/** Only CONFERENCE-SPECIFIC rejections say anything good about the twin in
 *  the other conference ("right event, wrong tab"). A rejection of the
 *  event itself (spam, off_theme, online, lodging, residency, sales_1on1,
 *  private_or_invite_only, other) must never revive its twin. */
export const REQUEUE_TWIN_REJECT_REASONS: readonly string[] = ['wrong_city', 'wrong_dates', 'pre_event'];

/** Review-note prefix written on every cross-conference duplicate; the
 *  conference named after it is the one that KEPT the event. */
export const CROSS_CONFERENCE_NOTE_PREFIX = 'Cross-conference duplicate: also in ';

/** Apply a `demote_other` decision AFTER this conference's candidate has
 *  been persisted: atomically flip the other conference's twin to
 *  `duplicate` only if it's still pending (never a published one).
 *  `duplicate_of` is this candidate's id when known; otherwise null, with
 *  this candidate's key in the note instead. */
export async function applyCrossConferenceDemotion(
  decision: CrossConferenceDecision | null | undefined,
  current: { id: string | null; conference: string; canonicalKey: string },
  deps?: { claimCandidateStatus: (id: string, from: readonly CandidateStatus[], to: CandidateStatus, extra: Record<string, unknown>) => Promise<unknown> }
): Promise<boolean> {
  if (!decision || decision.kind !== 'demote_other') return false;
  try {
    const claim = deps?.claimCandidateStatus ?? claimCandidateStatus;
    const res = await claim(decision.other.id, PENDING_STATUSES, 'duplicate', {
      duplicate_of: current.id,
      review_note: `${CROSS_CONFERENCE_NOTE_PREFIX}${current.conference}${current.id ? '' : ` (${current.canonicalKey})`}`,
    });
    return !!res;
  } catch (err) {
    console.warn(`[ingest cross-conference] demotion of ${decision.other.id} failed: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

/**
 * Revisit demotions when the conference that KEPT an event rejects it for a
 * conference-specific reason (`REQUEUE_TWIN_REJECT_REASONS`): every
 * other-conference twin routed duplicate "also in <conference>" goes back
 * to the queue — `queued` if already scored, else `pending_classify` so the
 * next run classifies it. Either way it gets the persisted force-review
 * marker, so it can only ever reach review, never auto-publish, on every
 * later run. Published (swept) duplicates are never touched. Never throws;
 * returns the ids re-queued.
 */
export async function requeueCrossConferenceTwins(
  rejected: { conference: string; canonical_key: string; alt_keys?: string[] | null },
  rejectReason: string,
  deps?: {
    listOtherConferenceCandidatesByKeys?: CrossConferenceDeps['listOtherConferenceCandidatesByKeys'];
    claimCandidateStatus?: (id: string, from: readonly CandidateStatus[], to: CandidateStatus, extra: Record<string, unknown>) => Promise<unknown>;
  }
): Promise<string[]> {
  if (!REQUEUE_TWIN_REJECT_REASONS.includes(rejectReason)) return [];
  const requeued: string[] = [];
  try {
    const list = deps?.listOtherConferenceCandidatesByKeys ?? listOtherConferenceCandidatesByKeys;
    const claim = deps?.claimCandidateStatus ?? claimCandidateStatus;
    const twins = await list(rejected.conference, [rejected.canonical_key, ...(rejected.alt_keys ?? [])]);
    const note = `${CROSS_CONFERENCE_NOTE_PREFIX}${rejected.conference}`;
    for (const t of twins) {
      if (t.status !== 'duplicate' || t.published_at) continue;
      if (!t.review_note || !(t.review_note === note || t.review_note.startsWith(`${note} (`))) continue;
      const to: CandidateStatus = t.llm_score == null ? 'pending_classify' : 'queued';
      const res = await claim(t.id, ['duplicate'], to, {
        duplicate_of: null,
        review_note: `Re-queued for review: the ${rejected.conference} copy was rejected as ${rejectReason}. Review only (never auto-published).`,
        edits: { ...(t.edits ?? {}), [FORCE_REVIEW_KEY]: `cross_conference_requeue:${rejectReason}` },
      });
      if (res) requeued.push(t.id);
    }
  } catch (err) {
    console.warn(`[ingest cross-conference] re-queue after reject of ${rejected.canonical_key} failed: ${err instanceof Error ? err.message : err}`);
  }
  return requeued;
}
