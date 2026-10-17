// Calendar auto-discovery orchestration (daily job, plan item 3) — wires
// `sources/calendar-discovery.ts`'s pure functions to the DB and the
// conference's profile/tab, one conference per call. Called by
// `/api/cron/ingest-discover-sources` (once per day, one call per active
// conference) and directly by admin dry-run tooling.
//
// Two phases, each with its OWN wall-clock budget (review finding, HIGH
// item B — "the daily discovery job evaluates nothing"):
//   1. Resolve each not-yet-cached candidate's TRUE hosting calendar (one
//      rate-limited `/event/get` call each) and cache the result into
//      `event.hostCalendar` so it's never re-resolved. Previously this
//      phase alone could spend up to 60 calls at 1 req/s (~60s) — well
//      past the whole per-conference deadline — so phase 2 (the part that
//      actually decides whether to PROPOSE anything) never got to run at
//      all. Now capped at `phase1MaxCalendarResolutions` (20) calls OR
//      `phase1DeadlineMs` (20s), whichever hits first.
//   2. Evaluate every calendar phase 1 collected (freshly resolved THIS
//      run, or already cached from a PRIOR run) against the conference's
//      window/thresholds, calling `calendar/get-items` once per calendar.
//      Gets its own `phase2DeadlineMs` (20s), counted fresh starting when
//      phase 1 finishes — so it always gets real time regardless of how
//      much of phase 1's own budget was used.
import {
  listLumaCandidatesForConference,
  listKnownLumaCandidateKeys,
  listConfiguredLumaCalendarIds,
  getSourceProposal,
  upsertSourceProposal,
  updateCandidate,
} from './db';
import { LumaEnrichmentLimiter } from './enrich';
import {
  resolveCandidateCalendar,
  fetchLumaCalendarItems,
  evaluateCalendarItems,
  CalendarDiscoveryError,
  type ResolvedEventCalendar,
} from './sources/calendar-discovery';
import type { IngestCandidateRow, IngestProfileRow } from './types';
import type { TabConfig } from '../conferences';

export interface DiscoverSourcesOptions {
  /** Preview only — never writes a proposal row, and never writes the
   *  phase-1 `event.hostCalendar` cache either (so a dry run never has a
   *  side effect on a later REAL run's cache state). */
  dryRun?: boolean;
  /** Phase 1's own time budget (ms). Default 20s. */
  phase1DeadlineMs?: number;
  /** Phase 1's call cap, the other half of its budget (whichever hits
   *  first). Default 20 — down from an original 60, which alone could
   *  consume an entire per-conference deadline at 1 req/s. */
  phase1MaxCalendarResolutions?: number;
  /** Phase 2's own GUARANTEED time budget (ms), independent of phase 1's.
   *  Default 20s. */
  phase2DeadlineMs?: number;
  /** Max distinct calendars phase 2 will run `calendar/get-items`
   *  against in one call (plan: "call calendar/get-items once" — once PER
   *  CALENDAR; this caps how many calendars one run considers at all). */
  maxCalendarsEvaluated?: number;
  /** Max Luma candidates considered at all (newest-last_seen_at-first via
   *  `listLumaCandidatesForConference`'s own ordering). */
  maxCandidates?: number;
}

export interface DiscoveredCalendarResult {
  calendarApiId: string;
  calendarName: string | null;
  inWindowCount: number;
  newCount: number;
  sample: { name: string; link: string | null }[];
  wouldPropose: boolean;
}

export interface DiscoverSourcesResult {
  conference: string;
  candidatesConsidered: number;
  /** How many candidates phase 1 actually attempted a LIVE `/event/get`
   *  call for this run (excludes ones already cached from a prior run). */
  candidatesResolvedThisRun: number;
  /** Candidates still unresolved (`event.hostCalendar === undefined`)
   *  after phase 1 — left for a later run, oldest-looked-at-first. */
  candidatesLeftUnresolved: number;
  /** Distinct calendars collected into phase 2's evaluation pool this
   *  run — a mix of freshly-resolved (this run) and already-cached (prior
   *  runs) calendars. */
  calendarsResolved: number;
  calendarsSkippedPersonal: number;
  calendarsSkippedAlreadyConfigured: number;
  calendarsSkippedDecided: number;
  calendarsEvaluated: number;
  proposalsWritten: DiscoveredCalendarResult[];
  /** True if EITHER phase stopped early (its own deadline or call/count
   *  cap) with real work still left — not just a wall-clock deadline in
   *  the literal sense anymore, but the same "partial, try again later"
   *  signal. */
  hitDeadline: boolean;
  errors: string[];
}

const DEFAULT_PHASE1_DEADLINE_MS = 20_000;
const DEFAULT_PHASE1_MAX_CALENDAR_RESOLUTIONS = 20;
const DEFAULT_PHASE2_DEADLINE_MS = 20_000;
const DEFAULT_MAX_CALENDARS_EVALUATED = 25;
const DEFAULT_MAX_CANDIDATES = 300;

/** A candidate's cached calendar-resolution state — mirrors
 *  `NormalizedEvent.hostCalendar`'s tri-state doc comment. */
function hostCalendarCacheOf(candidate: IngestCandidateRow): { apiId: string; name: string | null; isPersonal: boolean } | null | undefined {
  return candidate.event?.hostCalendar;
}

/**
 * Run calendar auto-discovery for one conference. Fully sequential within
 * each phase (no concurrent Luma calls) so the 1 req/s budget both
 * `limiter.enrich`/`enrichResult` (event lookups) and the
 * `calendar/get-items` calls share stays real, not just nominal.
 */
export async function discoverCalendarSources(
  conference: string,
  tab: TabConfig,
  profile: IngestProfileRow,
  opts: DiscoverSourcesOptions = {}
): Promise<DiscoverSourcesResult> {
  const phase1Deadline = Date.now() + (opts.phase1DeadlineMs ?? DEFAULT_PHASE1_DEADLINE_MS);
  const phase1MaxCalendarResolutions = opts.phase1MaxCalendarResolutions ?? DEFAULT_PHASE1_MAX_CALENDAR_RESOLUTIONS;
  const phase2DeadlineMs = opts.phase2DeadlineMs ?? DEFAULT_PHASE2_DEADLINE_MS;
  const maxCalendarsEvaluated = opts.maxCalendarsEvaluated ?? DEFAULT_MAX_CALENDARS_EVALUATED;
  const maxCandidates = opts.maxCandidates ?? DEFAULT_MAX_CANDIDATES;

  const result: DiscoverSourcesResult = {
    conference,
    candidatesConsidered: 0,
    candidatesResolvedThisRun: 0,
    candidatesLeftUnresolved: 0,
    calendarsResolved: 0,
    calendarsSkippedPersonal: 0,
    calendarsSkippedAlreadyConfigured: 0,
    calendarsSkippedDecided: 0,
    calendarsEvaluated: 0,
    proposalsWritten: [],
    hitDeadline: false,
    errors: [],
  };

  const [candidates, existingKeys, configuredCalendarIds] = await Promise.all([
    listLumaCandidatesForConference(conference, maxCandidates),
    listKnownLumaCandidateKeys(conference),
    listConfiguredLumaCalendarIds(conference),
  ]);
  result.candidatesConsidered = candidates.length;

  const candidateCalendars = new Map<string, ResolvedEventCalendar>();

  /** Shared across both "already cached" and "freshly resolved this run"
   *  candidates — collects a non-personal, not-already-configured
   *  calendar into the phase-2 evaluation pool. */
  function collectCalendar(resolved: ResolvedEventCalendar | null) {
    if (!resolved) return;
    result.calendarsResolved++;
    if (resolved.isPersonal) {
      result.calendarsSkippedPersonal++;
      return;
    }
    if (configuredCalendarIds.has(resolved.apiId)) {
      result.calendarsSkippedAlreadyConfigured++;
      return;
    }
    if (!candidateCalendars.has(resolved.apiId)) candidateCalendars.set(resolved.apiId, resolved);
  }

  // Candidates ALREADY resolved on a prior run — no live call needed,
  // just feed the cache straight into phase 2's pool.
  const unresolved: IngestCandidateRow[] = [];
  for (const candidate of candidates) {
    const cached = hostCalendarCacheOf(candidate);
    if (cached === undefined) {
      unresolved.push(candidate);
      continue;
    }
    if (cached === null) continue; // confirmed, no usable calendar — nothing to do.
    collectCalendar(cached);
  }

  // Phase 1: resolve as many NOT-YET-cached candidates as the budget
  // allows, oldest-`last_seen_at`-first so a conference with more
  // unresolved candidates than one run can get through still rotates
  // through its whole backlog over successive days (review finding, HIGH
  // item B's "rotating through them").
  unresolved.sort((a, b) => a.last_seen_at.localeCompare(b.last_seen_at));

  const limiter = new LumaEnrichmentLimiter(phase1MaxCalendarResolutions, 1000);
  let phase1HitBudget = false;
  // How many candidates actually got a DEFINITIVE answer cached this run
  // — distinct from `result.candidatesResolvedThisRun` (every call
  // ATTEMPTED, including ones that came back 'unavailable' and were
  // correctly left uncached — see below). Used to compute how many are
  // still genuinely unresolved afterward.
  let cachedThisRun = 0;
  for (const candidate of unresolved) {
    if (Date.now() > phase1Deadline || limiter.exhausted || result.candidatesResolvedThisRun >= phase1MaxCalendarResolutions) {
      phase1HitBudget = true;
      break;
    }

    let resolveResult;
    try {
      resolveResult = await resolveCandidateCalendar(candidate, limiter);
    } catch (err) {
      result.errors.push(err instanceof Error ? err.message : String(err));
      continue; // one candidate's resolution failing shouldn't fail the whole job, and isn't cached either.
    }
    result.candidatesResolvedThisRun++;

    // 'unavailable' (limiter exhausted mid-call, or a transient fetch
    // error — NOT a confirmed Luma 404): never cache it, same
    // cache-poisoning guard as `discover.ts`/`ingest_link_cache`. Leave
    // `event.hostCalendar` unset for another attempt on a later run — it
    // was ATTEMPTED (counted above) but is still genuinely unresolved.
    if (resolveResult.status === 'unavailable') continue;

    // A confirmed answer (even "no calendar") — cache it so this
    // candidate is never live-resolved again. Dry runs never persist
    // this (or anything else), so every candidate stays "unresolved"
    // from the DB's point of view afterward — intentional, see
    // `DiscoverSourcesOptions.dryRun`'s doc comment.
    if (!opts.dryRun) {
      try {
        await updateCandidate(candidate.id, { event: { ...candidate.event, hostCalendar: resolveResult.calendar } });
        cachedThisRun++;
      } catch (err) {
        result.errors.push(err instanceof Error ? err.message : String(err));
      }
    }

    collectCalendar(resolveResult.calendar);
  }

  result.candidatesLeftUnresolved = unresolved.length - cachedThisRun;
  if (phase1HitBudget && result.candidatesLeftUnresolved > 0) result.hitDeadline = true;

  // Phase 2: ITS OWN fresh budget, starting now — regardless of how much
  // of phase 1's time was actually used. This is the fix for "the daily
  // discovery job evaluates nothing": before this split, phase 1 alone
  // could consume the entire shared deadline, so this loop never ran a
  // single iteration.
  const phase2Deadline = Date.now() + phase2DeadlineMs;

  const window = {
    startDate: tab.dates[0],
    endDate: tab.dates[tab.dates.length - 1],
    windowPreDays: profile.window_pre_days,
    windowPostDays: profile.window_post_days,
    center: tab.center,
    radiusKm: profile.radius_km,
  };

  for (const [calendarApiId, cal] of candidateCalendars) {
    if (Date.now() > phase2Deadline) {
      result.hitDeadline = true;
      break;
    }
    if (result.calendarsEvaluated >= maxCalendarsEvaluated) break;

    // Never re-propose (or even re-fetch) a calendar an admin already
    // decided on — the single most important guarantee of this feature.
    const existingProposal = await getSourceProposal(conference, calendarApiId);
    if (existingProposal && existingProposal.status !== 'proposed') {
      result.calendarsSkippedDecided++;
      continue;
    }

    result.calendarsEvaluated++;
    let items;
    try {
      items = await fetchLumaCalendarItems(calendarApiId);
    } catch (err) {
      result.errors.push(err instanceof CalendarDiscoveryError ? err.message : String(err));
      continue;
    }
    // Politeness pacing between get-items calls, same 1 req/s discipline
    // as every other Luma endpoint this pipeline calls.
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const evaluation = evaluateCalendarItems(items, window, existingKeys);
    if (!evaluation.eligible) continue;

    if (!opts.dryRun) {
      await upsertSourceProposal({
        conference,
        calendar_api_id: calendarApiId,
        calendar_name: cal.name,
        evidence: { inWindowCount: evaluation.inWindowCount, newCount: evaluation.newCount, sample: evaluation.sample },
      });
    }

    result.proposalsWritten.push({
      calendarApiId,
      calendarName: cal.name,
      inWindowCount: evaluation.inWindowCount,
      newCount: evaluation.newCount,
      sample: evaluation.sample,
      wouldPropose: true,
    });
  }

  return result;
}
