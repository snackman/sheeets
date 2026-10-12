// Deterministic, cheap scoring signals (§5.4). These run before/alongside the
// LLM call and nudge the final score without replacing the model's judgment.
// The candidate/DB-backed wiring (trusted-host lookups against Supabase,
// sponsor-name lookups against `event_sponsors`, ...) lands in Phase 1b; this
// module takes already-resolved booleans so it's usable standalone today (by
// the classifier caller and the eval harness) and by the real pipeline later.

export interface SignalInput {
  /** The source itself is the conference's official/curated calendar. */
  isTrustedCalendarSource?: boolean;
  /** A host/organizer is allowlisted, a verified Luma host, or has >=2 prior sheet events. */
  isTrustedHost?: boolean;
  /** A host/organizer is on the conference's EXPLICIT, admin-curated
   *  blocked-host list — a deliberate decision, so this hard-rejects. */
  isBlockedHost?: boolean;
  /** A host/organizer matches a host INFERRED as blocked from past label
   *  history (`learning.ts#deriveLearnedHostSignals`) — a statistical
   *  guess, not a deliberate admin decision, so it must never hard-reject
   *  on its own: a score penalty plus a review cap only (review finding,
   *  MEDIUM item 6). Ignored when `isBlockedHost` is also true (that's
   *  already the stronger, hard-reject signal). */
  isLearnedBlockedHost?: boolean;
  /** A known sponsor name (from `event_sponsors`) appears in the
   *  host/organizer identity fields. */
  sponsorMatch?: string | null;
  /** Phase 3 (§3.5/§7, host submission page): the person who SUBMITTED this
   *  link has previously proven control of a Luma host account
   *  (`verified_luma_hosts`) — weaker evidence than `isTrustedHost` (which
   *  requires THIS event's own hosts list to include a verified id: a
   *  verified host could submit someone else's event, or a non-Luma link
   *  with no host list at all), but still a real trust signal an anonymous
   *  submission doesn't have. Host-submission sources are always
   *  `discovery` trust, so this never lifts a candidate past the review
   *  cap — it only nudges `final_score` within the queue. */
  isVerifiedSubmitter?: boolean;
  /** Text to match include/exclude keywords against: name + hosts + description. */
  text: string;
  includeKeywords: string[];
  excludeKeywords: string[];
  /** Deterministic injection pre-scan (prompt.ts) hit. */
  injectionDetected?: boolean;
  /** Fuzzy-dedupe found a 0.6-0.85 match against the sheet or another candidate. */
  possibleDuplicate?: boolean;
  /** No lat/lng and geocoding failed. */
  noGeo?: boolean;
}

export interface SignalResult {
  /** Label -> point delta, for display/audit (`signal_breakdown` jsonb in 1b). */
  breakdown: Record<string, number>;
  /** Sum of `breakdown`. Can be negative. */
  total: number;
  /** is_event=false or a blocked host — never auto-publish, regardless of score. */
  hardReject: boolean;
  /** possible_duplicate, no_geo or an injection flag — route capped at review. */
  capRouteAtReview: boolean;
}

const INCLUDE_KEYWORD_POINTS = 5;
const INCLUDE_KEYWORD_CAP = 15;
const TRUSTED_CALENDAR_POINTS = 15;
const TRUSTED_HOST_POINTS = 20;
const SPONSOR_MATCH_POINTS = 10;
/** Phase 3 — see `SignalInput.isVerifiedSubmitter`. Same weight as a sponsor
 *  match: real evidence, but deliberately well short of `TRUSTED_HOST_POINTS`
 *  (which is about THIS event's hosts, not the submitter). */
const VERIFIED_SUBMITTER_POINTS = 10;
const EXCLUDE_KEYWORD_POINTS = -40;
const BLOCKED_HOST_POINTS = -40;
/** Softer than the explicit block's -40 (review finding, MEDIUM item 6) —
 *  a learned block is an inference, not a deliberate admin decision, and
 *  must never carry enough weight (combined with the review cap below) to
 *  function as a de facto hard reject on its own. */
const LEARNED_BLOCKED_HOST_POINTS = -25;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Case-insensitive, word-boundary keyword match (so "ai" doesn't match "said"). */
function matchesKeyword(text: string, keyword: string): boolean {
  const trimmed = keyword.trim();
  if (!trimmed) return false;
  const re = new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(trimmed)}(?![A-Za-z0-9])`, 'i');
  return re.test(text);
}

export function computeSignals(input: SignalInput): SignalResult {
  const breakdown: Record<string, number> = {};
  let hardReject = false;
  let capRouteAtReview = false;

  if (input.isTrustedCalendarSource) {
    breakdown['trusted_calendar'] = TRUSTED_CALENDAR_POINTS;
  }
  if (input.isTrustedHost) {
    breakdown['trusted_host'] = TRUSTED_HOST_POINTS;
  }
  if (input.sponsorMatch) {
    breakdown[`sponsor:${input.sponsorMatch}`] = SPONSOR_MATCH_POINTS;
  }
  if (input.isVerifiedSubmitter) {
    breakdown['verified_submitter'] = VERIFIED_SUBMITTER_POINTS;
  }

  const matchedIncludes = input.includeKeywords.filter((kw) => matchesKeyword(input.text, kw));
  if (matchedIncludes.length > 0) {
    const points = Math.min(matchedIncludes.length * INCLUDE_KEYWORD_POINTS, INCLUDE_KEYWORD_CAP);
    for (const kw of matchedIncludes) breakdown[`keyword:${kw}`] = INCLUDE_KEYWORD_POINTS;
    // Re-cap the recorded total via a correction entry so breakdown sums to `points`
    // when more than 3 keywords hit (3 * 5 = 15 = cap).
    const rawTotal = matchedIncludes.length * INCLUDE_KEYWORD_POINTS;
    if (rawTotal > INCLUDE_KEYWORD_CAP) {
      breakdown['keyword:cap'] = points - rawTotal;
    }
  }

  const matchedExcludes = input.excludeKeywords.filter((kw) => matchesKeyword(input.text, kw));
  if (matchedExcludes.length > 0) {
    breakdown[`exclude:${matchedExcludes[0]}`] = EXCLUDE_KEYWORD_POINTS;
  }

  if (input.isBlockedHost) {
    breakdown['blocked_host'] = BLOCKED_HOST_POINTS;
    hardReject = true;
  } else if (input.isLearnedBlockedHost) {
    // Never hard-reject on an inference alone (review finding, MEDIUM item
    // 6) — a penalty plus a review cap, same treatment as a possible
    // duplicate or missing geo.
    breakdown['learned_blocked_host'] = LEARNED_BLOCKED_HOST_POINTS;
    capRouteAtReview = true;
  }

  if (input.injectionDetected) {
    capRouteAtReview = true;
  }
  if (input.possibleDuplicate) {
    capRouteAtReview = true;
  }
  if (input.noGeo) {
    capRouteAtReview = true;
  }

  const total = Object.values(breakdown).reduce((sum, v) => sum + v, 0);

  return { breakdown, total, hardReject, capRouteAtReview };
}

/**
 * Combine the LLM score with cheap signals (§5.4):
 * `final = clamp(llm_score + sum(signals), 0, 100)`, except `is_event=false`
 * or a blocked host force a reject regardless of score.
 */
export function combineFinalScore(llmScore: number, signals: SignalResult): number {
  return Math.max(0, Math.min(100, llmScore + signals.total));
}

/**
 * Auto-publish additionally requires `llm_score >= publishThreshold - 15`, so
 * signals can lift a good event over the line but can't carry a weak one.
 */
export function meetsPublishFloor(llmScore: number, publishThreshold: number): boolean {
  return llmScore >= publishThreshold - 15;
}

export type Route = 'publish' | 'review' | 'reject';

/**
 * Route a classified+signaled candidate (§5.7, revised in the tuning round,
 * 2026-10-11, to separate theme fit from data quality). `isEvent=false` or a
 * hard-reject signal (blocked host) is a reject — "clearly not an event".
 * `final < reviewThreshold` is a reject — "clearly off-theme", independent of
 * data quality (a thin event that doesn't even look plausible on theme from
 * its name/hosts/calendar is still off-theme, not "needs review").
 * Otherwise, theme fit is at least plausible: `dataQuality === 'thin'` caps
 * the route at review — never auto-publish on sparse data, no matter how
 * high the score. With sufficient data, the original rule applies: final >=
 * publishThreshold (and the floor, and no other review-forcing flag) ->
 * publish; else review.
 */
export function routeCandidate(opts: {
  isEvent: boolean;
  llmScore: number;
  dataQuality: 'sufficient' | 'thin';
  signals: SignalResult;
  profile: { publishThreshold: number; reviewThreshold: number };
}): Route {
  const { isEvent, llmScore, dataQuality, signals, profile } = opts;
  if (!isEvent || signals.hardReject) return 'reject';

  const final = combineFinalScore(llmScore, signals);
  if (final < profile.reviewThreshold) return 'reject';

  if (dataQuality === 'thin') return 'review';

  if (
    final >= profile.publishThreshold &&
    !signals.capRouteAtReview &&
    meetsPublishFloor(llmScore, profile.publishThreshold)
  ) {
    return 'publish';
  }
  return 'review';
}
