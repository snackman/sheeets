// Calendar auto-discovery orchestration (daily job, plan item 3) — wires
// `sources/calendar-discovery.ts`'s pure functions to the DB and the
// conference's profile/tab, one conference per call. Called by
// `/api/cron/ingest-discover-sources` (once per day, one call per active
// conference) and directly by admin dry-run tooling.
import {
  listLumaCandidatesForConference,
  listKnownLumaCandidateKeys,
  listConfiguredLumaCalendarIds,
  getSourceProposal,
  upsertSourceProposal,
} from './db';
import { LumaEnrichmentLimiter } from './enrich';
import {
  resolveCandidateCalendar,
  fetchLumaCalendarItems,
  evaluateCalendarItems,
  CalendarDiscoveryError,
  type ResolvedEventCalendar,
} from './sources/calendar-discovery';
import type { IngestProfileRow } from './types';
import type { TabConfig } from '../conferences';

export interface DiscoverSourcesOptions {
  /** Preview only — never writes a proposal row. */
  dryRun?: boolean;
  /** Wall-clock budget for this one conference (ms). */
  deadlineMs?: number;
  /** Max `/event/get` calls (resolving a candidate's calendar) this call
   *  will make — also the shared Luma rate limiter's per-call cap. */
  maxCalendarResolutions?: number;
  /** Max distinct calendars this call will run `calendar/get-items`
   *  against (plan: "call calendar/get-items once" — once PER CALENDAR,
   *  this caps how many calendars one run considers at all). */
  maxCalendarsEvaluated?: number;
  /** Max Luma candidates considered at all (oldest-dropped-first via
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
  calendarsResolved: number;
  calendarsSkippedPersonal: number;
  calendarsSkippedAlreadyConfigured: number;
  calendarsSkippedDecided: number;
  calendarsEvaluated: number;
  proposalsWritten: DiscoveredCalendarResult[];
  hitDeadline: boolean;
  errors: string[];
}

const DEFAULT_MAX_CALENDAR_RESOLUTIONS = 60;
const DEFAULT_MAX_CALENDARS_EVALUATED = 25;
const DEFAULT_MAX_CANDIDATES = 300;

/**
 * Run calendar auto-discovery for one conference. Fully sequential (no
 * concurrent Luma calls) so the 1 req/s budget both `limiter.enrich` (event
 * lookups) and the `calendar/get-items` calls share stays real, not just
 * nominal.
 */
export async function discoverCalendarSources(
  conference: string,
  tab: TabConfig,
  profile: IngestProfileRow,
  opts: DiscoverSourcesOptions = {}
): Promise<DiscoverSourcesResult> {
  const deadline = Date.now() + (opts.deadlineMs ?? 60_000);
  const maxCalendarResolutions = opts.maxCalendarResolutions ?? DEFAULT_MAX_CALENDAR_RESOLUTIONS;
  const maxCalendarsEvaluated = opts.maxCalendarsEvaluated ?? DEFAULT_MAX_CALENDARS_EVALUATED;
  const maxCandidates = opts.maxCandidates ?? DEFAULT_MAX_CANDIDATES;

  const result: DiscoverSourcesResult = {
    conference,
    candidatesConsidered: 0,
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

  const limiter = new LumaEnrichmentLimiter(maxCalendarResolutions, 1000);
  const candidateCalendars = new Map<string, ResolvedEventCalendar>();

  for (const candidate of candidates) {
    if (Date.now() > deadline) {
      result.hitDeadline = true;
      break;
    }
    if (limiter.exhausted) break;
    let resolved: ResolvedEventCalendar | null;
    try {
      resolved = await resolveCandidateCalendar(candidate, limiter);
    } catch {
      continue; // one candidate's resolution failing shouldn't fail the whole job.
    }
    if (!resolved) continue;
    result.calendarsResolved++;
    if (resolved.isPersonal) {
      result.calendarsSkippedPersonal++;
      continue;
    }
    if (configuredCalendarIds.has(resolved.apiId)) {
      result.calendarsSkippedAlreadyConfigured++;
      continue;
    }
    if (!candidateCalendars.has(resolved.apiId)) candidateCalendars.set(resolved.apiId, resolved);
  }

  const window = {
    startDate: tab.dates[0],
    endDate: tab.dates[tab.dates.length - 1],
    windowPreDays: profile.window_pre_days,
    windowPostDays: profile.window_post_days,
    center: tab.center,
    radiusKm: profile.radius_km,
  };

  for (const [calendarApiId, cal] of candidateCalendars) {
    if (Date.now() > deadline) {
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
