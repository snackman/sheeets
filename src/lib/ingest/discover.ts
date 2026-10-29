// Shared "process one discovered link" engine (Phase 3, plans/
// event-ingestion.md §3.2/§7/§10). A discovery source (Telegram, a host
// submission, later a curated event's own description) hands this a single
// allowlisted URL; this module enriches/extracts it, normalizes it, dedupes
// it against the sheet and other candidates, runs the same filter/signal/
// classify/route pipeline every other candidate goes through, and returns
// what to persist. It never publishes and never writes to the DB itself —
// callers (the Telegram pipeline step, the host-submissions API route) own
// persistence (so a dry run can preview without writing) and run-level
// bookkeeping (counts, budget totals).
//
// Every candidate this produces is `discovery` trust: `scoreCandidate`
// (`scoring.ts`) already caps a discovery-trust route at 'review' even if
// the model+signals would otherwise publish, and this module never calls a
// sheet publisher at all — so there is no path from here to the sheet
// without an admin's explicit Approve (§10 item 4).
import type OpenAI from 'openai';
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeEventLink, getValidLumaSlug, getLumaEventApiId, lumaApiIdFromUrl, LUMA_EVENT_API_ID_RE, type LumaEventPayload } from '../luma';

export { lumaApiIdFromUrl };
import { parseEventbrite, parsePartiful, parseMeetup, parsePosh, UserFacingError, type EventResult } from '../event-extractors';
import { SafeFetchError } from '../safe-fetch';
import type { TabConfig } from '../conferences';
import { allowlistedPlatformFor, type Platform } from './allowlist';
import { normalizeDiscoveredLumaEvent, normalizeExtractedEvent, computeContentHash, formatDateISOInTimezone } from './normalize';
import { matchAgainstSheetAndCandidates, STALE_NEGATIVE_CACHE_MS, type SheetLinkIndex, type DedupeSheetEvent, type DedupeCandidatePool } from './dedupe';
import { dateWindowFilter, geoFilter, geocodeAddressCached, isPreEvent, isVenueUnknown } from './filters';
import { getCachedLumaApiIdEntry, setCachedLumaApiId, getCandidateByKeyOrAltKey } from './db';
import type { EnrichLimiter, EnrichOutcome } from './enrich';
import { scoreCandidate } from './scoring';
import { checkCrossConferenceDuplicate, hasForceReviewMarker, type CrossConferenceDecision } from './cross-conference';
import { ClassifierError } from './classifier';
import { hostListMatches } from './hosts';
import { matchSponsorName } from './sponsors';
import { learnedHostSignalMatches, type LearnedHostSignals } from './learning';
import { estimateCostUsd } from './pricing';
import { RETRY_ON_UNCHANGED_STATUSES, isFinalCandidate } from './types';
import type {
  CandidateSourceRef,
  IngestCandidateRow,
  IngestProfileRow,
  NormalizedEvent,
  SourceKind,
  SourceTrust,
  ThemeProfile,
  FewShotExample,
  CandidateStatus,
} from './types';

/** Simple "at most N per run, at least `minIntervalMs` apart" pacer for the
 *  non-Luma extractor fetches (Partiful/Eventbrite/Meetup/Posh) a discovery
 *  source can trigger — Luma links already share `LumaEnrichmentLimiter`'s
 *  clock/budget (§5.2's "shared rate limiter"); this is the same idea for
 *  the other four platforms, so a single Telegram channel posting a burst
 *  of links can't fire off a dozen near-simultaneous outbound fetches. */
export class PacedLinkLimiter {
  private count = 0;
  private lastCallAt = 0;
  constructor(
    private readonly maxPerRun: number = 30,
    private readonly minIntervalMs: number = 500
  ) {}

  get exhausted(): boolean {
    return this.count >= this.maxPerRun;
  }

  async throttle(): Promise<boolean> {
    if (this.exhausted) return false;
    const wait = this.lastCallAt ? Math.max(0, this.lastCallAt + this.minIntervalMs - Date.now()) : 0;
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    this.lastCallAt = Date.now();
    this.count++;
    return true;
  }
}

async function extractByPlatform(platform: Platform, url: string): Promise<EventResult | null> {
  try {
    if (platform === 'eventbrite') return await parseEventbrite(url);
    if (platform === 'partiful') return await parsePartiful(url);
    if (platform === 'meetup') return await parseMeetup(url);
    if (platform === 'posh') return await parsePosh(url);
    return null;
  } catch (err) {
    if (err instanceof UserFacingError || err instanceof SafeFetchError) return null;
    throw err;
  }
}

export interface HostSignals {
  isTrustedHost: boolean;
  isBlockedHost: boolean;
  isLearnedBlockedHost?: boolean;
}

/**
 * Build the `computeHostSignals(normalized)` function every source
 * (curated Luma iCal, Phase 3 Telegram, a host submission) needs to pass
 * into `scoreCandidate` — same trusted/blocked-host logic the Luma iCal
 * loop in `pipeline.ts` has always used (admin-curated lists via
 * `hostListMatches`, a verified Luma host account, >= 2 prior sheet events
 * by the same organizer, and Phase 2's learned-from-label-history signals),
 * now shared so Phase 3's two new call sites don't re-derive it. Built once
 * per run/request from already-fetched lookups (`verifiedHostIds`,
 * `organizerCounts`, `learnedHosts`) — cheap to call per candidate.
 */
export function buildHostSignalComputer(opts: {
  profile: Pick<IngestProfileRow, 'trusted_hosts' | 'blocked_hosts'>;
  verifiedHostIds: Set<string>;
  organizerCounts: Map<string, number>;
  learnedHosts: LearnedHostSignals;
}): (event: NormalizedEvent) => HostSignals {
  return (event: NormalizedEvent): HostSignals => {
    const isTrustedHost =
      hostListMatches(opts.profile.trusted_hosts, event) ||
      event.hosts.some((h) => h.apiId && opts.verifiedHostIds.has(h.apiId)) ||
      (opts.organizerCounts.get(event.organizer.trim().toLowerCase()) ?? 0) >= 2 ||
      learnedHostSignalMatches(opts.learnedHosts, 'trusted', [event.organizer]);
    const isBlockedHost = hostListMatches(opts.profile.blocked_hosts, event);
    const isLearnedBlockedHost = learnedHostSignalMatches(opts.learnedHosts, 'blocked', [event.organizer]);
    return { isTrustedHost, isBlockedHost, isLearnedBlockedHost };
  };
}

export interface DiscoveredLinkContext {
  conference: string;
  tab: TabConfig;
  profile: IngestProfileRow;
  themeProfile: ThemeProfile;
  client: OpenAI;
  supabase: SupabaseClient;
  sourceId: string | null;
  sourceKind: SourceKind;
  /** Always 'discovery' for the sources that call this today (Telegram,
   *  host submissions) — kept as a field rather than hardcoded so a future
   *  trust level isn't a silent behavior change here. */
  sourceTrust: SourceTrust;
  /** Message permalink (Telegram) or null (a direct host submission has no
   *  separate "post" to link back to beyond the submitted URL itself). */
  sourceRef: string | null;
  enrichLimiter: EnrichLimiter;
  linkFetchLimiter: PacedLinkLimiter;
  linkIndex: SheetLinkIndex;
  sheetEvents: DedupeSheetEvent[];
  /** Mutable in-run/in-request dedupe pool — callers push each processed
   *  candidate onto this so a later link in the SAME batch can dedupe
   *  against it too (same pattern as `pipeline.ts`'s Luma loop). */
  otherCandidates: DedupeCandidatePool[];
  fewShot: FewShotExample[];
  sponsorNames: string[];
  computeHostSignals: (event: NormalizedEvent) => HostSignals;
  isVerifiedSubmitter?: boolean;
  /** True if there's LLM budget left for one more classification call —
   *  callers own the actual counters (run-level or ad-hoc). */
  canClassify: () => boolean;
}

export interface DiscoveredLinkRow {
  conference: string;
  canonical_key: string;
  alt_keys: string[];
  source_id: string | null;
  source_kind: SourceKind;
  sources: { source_id: string | null; kind: SourceKind; ref: string | null; seen_at: string }[];
  source_ref: string | null;
  event: NormalizedEvent;
  content_hash: string;
  status: CandidateStatus;
  [key: string]: unknown;
}

export type DiscoveredLinkOutcome =
  | { kind: 'invalid' }
  | { kind: 'skipped_final'; existingId: string; canonicalKey: string }
  | { kind: 'unchanged'; existingId: string }
  | { kind: 'protected'; existingId: string; sources: CandidateSourceRef[] }
  /** Enrichment was TRANSIENTLY unavailable (Luma 429/5xx/network, or the
   *  limiter's budget is used up) and there's no existing candidate. Nothing
   *  is written — the link stays "unseen" and a later run retries it. Never
   *  an `error` row: a transient failure is not a fact about the event. */
  | { kind: 'deferred'; reason: string }
  /** Out of window per the SOURCE's date, but no row was written: it's a
   *  short Luma link never resolved to its `evt-…` key, so a row keyed on
   *  the slug could fork a second candidate for an event that already has
   *  one. Cheap to re-check next run (no network). */
  | { kind: 'prefiltered'; reason: string }
  | {
      kind: 'row';
      row: DiscoveredLinkRow;
      classified: boolean;
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
      /** Set when this conference is the better home for an event that's
       *  also pending in another conference: callers apply it
       *  (`applyCrossConferenceDemotion`) only AFTER persisting a `queued`
       *  row, so the event is never left in neither queue. */
      crossConference?: CrossConferenceDecision | null;
    };

/** Optional per-link data the SOURCE already knows (e.g. a Mira series
 *  page lists each event's start/end date). Used to drop clearly
 *  out-of-window links BEFORE any Luma call — see
 *  `sourceDateWindowPrefilter`. */
export interface DiscoveredLinkHints {
  name?: string | null;
  /** ISO instant (`2026-11-13T09:00:00.000Z`) or a bare local date
   *  (`2026-11-13`), as the source gave it. */
  startDate?: string | null;
  endDate?: string | null;
}

/** Slack (days) added on BOTH sides of the conference window before a
 *  source-provided date is trusted to drop a link without enriching it —
 *  a source's date can disagree with Luma's by a timezone day. Anything
 *  inside the slack still gets enriched and judged on Luma's own date. */
export const SOURCE_DATE_PREFILTER_SLACK_DAYS = 1;

/** Local `YYYY-MM-DD` for a source date (bare date kept as-is; an ISO
 *  instant converted to the conference timezone), or null if unparseable. */
export function sourceDateToLocalISO(value: string | null | undefined, timezone: string): string | null {
  if (!value) return null;
  const v = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const t = new Date(v);
  if (isNaN(t.getTime())) return null;
  return formatDateISOInTimezone(t.toISOString(), timezone);
}

/**
 * Cheap, network-free date-window check on a SOURCE-provided start date.
 * Returns the (strict-window) filter reason if the link is clearly out of
 * window even with `SOURCE_DATE_PREFILTER_SLACK_DAYS` of slack, else null
 * (no date, unparseable, or in/near the window — enrich and decide on
 * Luma's own data as usual). Same start-date semantics as
 * `dateWindowFilter`, which the post-enrichment path uses.
 */
export function sourceDateWindowPrefilter(
  hints: DiscoveredLinkHints | undefined,
  ctx: Pick<DiscoveredLinkContext, 'tab' | 'profile'>
): { reason: string; dateISO: string } | null {
  const dateISO = sourceDateToLocalISO(hints?.startDate, ctx.tab.timezone);
  if (!dateISO || ctx.tab.dates.length === 0) return null;
  const window = { startDate: ctx.tab.dates[0], endDate: ctx.tab.dates[ctx.tab.dates.length - 1] };
  const slack = SOURCE_DATE_PREFILTER_SLACK_DAYS;
  const loose = dateWindowFilter({ dateISO }, window, {
    window_pre_days: Math.abs(ctx.profile.window_pre_days) + slack,
    window_post_days: Math.abs(ctx.profile.window_post_days) + slack,
  });
  if (loose.pass) return null;
  const strict = dateWindowFilter({ dateISO }, window, ctx.profile);
  return { reason: strict.pass ? loose.reason : strict.reason, dateISO };
}

/** Retry backoff for an `error` candidate: 2h after the 1st consecutive
 *  failure, doubling per failure, capped at 48h. The failure count and
 *  last-failure time live in `event.ingestError` (NOT `classify_attempts`,
 *  which also counts successful classifications). */
export const ERROR_RETRY_BASE_MS = 2 * 60 * 60 * 1000;
export const ERROR_RETRY_MAX_MS = 48 * 60 * 60 * 1000;

export function errorRetryBackoffMs(attempts: number): number {
  const n = Math.max(1, attempts);
  return Math.min(ERROR_RETRY_MAX_MS, ERROR_RETRY_BASE_MS * 2 ** Math.min(n - 1, 10));
}

/** True if an `error` candidate may be retried now. A legacy row with no
 *  recorded attempt time (pre-fix) is always due. */
export function isErrorRetryDue(row: Pick<IngestCandidateRow, 'status' | 'event'>, now: number = Date.now()): boolean {
  if (row.status !== 'error') return true;
  const info = row.event?.ingestError;
  if (!info?.lastFailedAt) return true;
  const last = new Date(info.lastFailedAt).getTime();
  if (isNaN(last)) return true;
  return now - last >= errorRetryBackoffMs(info.failures ?? 1);
}

/** `event` for an error row: the given snapshot plus an incremented
 *  CONSECUTIVE failure count (reset whenever the previous row wasn't an
 *  error — i.e. after any success). */
function withFailure(event: NormalizedEvent, existing: IngestCandidateRow | null, reason: string): NormalizedEvent {
  const prev = existing?.status === 'error' ? (existing.event?.ingestError?.failures ?? 0) : 0;
  return { ...event, ingestError: { failures: prev + 1, lastFailedAt: new Date().toISOString(), reason } };
}

function placeholderEvent(url: string, platform: Platform, hints?: DiscoveredLinkHints, dateISO = ''): NormalizedEvent {
  return {
    name: hints?.name?.trim() || url,
    startAt: hints?.startDate && !isNaN(new Date(hints.startDate).getTime()) ? new Date(hints.startDate).toISOString() : new Date().toISOString(),
    timezone: 'UTC',
    dateISO,
    sheetDate: '',
    startTime: '',
    endTime: '',
    address: '',
    isOnline: false,
    organizer: '',
    hosts: [],
    cost: '',
    link: url,
    descriptionText: '',
    platform,
  } as NormalizedEvent;
}

/** Baseline trust rank by `source_kind` — used ONLY to decide whether an
 *  incoming discovery-trust link may touch (reclassify, or worse,
 *  overwrite) an EXISTING candidate a DIFFERENT source already created
 *  (review finding, MEDIUM item 4). This is a heuristic, not the real
 *  per-source `trust` column (which lives on `ingest_sources`, can vary
 *  per row, and isn't stored on the candidate itself): `luma_ical` is
 *  ranked as POSSIBLY curated/host trust, since that's the overwhelmingly
 *  common case (a `luma_ical` source is only ever `discovery` trust when
 *  auto-publish was already on for the conference at the moment it was
 *  added — see the config route) — erring toward "protect" for an
 *  ambiguous case is the safe direction. Every kind that's ALWAYS
 *  discovery trust ranks the same as 'discovery' itself, so two discovery
 *  sources (e.g. two different Telegram channels, or a resubmission of the
 *  same host-submitted link) can still freely dedupe/update each other's
 *  candidates exactly as before. */
const SOURCE_KIND_TRUST_FLOOR: Partial<Record<SourceKind, SourceTrust>> = {
  luma_ical: 'curated',
};
const TRUST_RANK: Record<SourceTrust, number> = { discovery: 1, host: 2, curated: 3 };

function existingOutranksIncoming(existingSourceKind: SourceKind, incomingTrust: SourceTrust): boolean {
  const existingFloor = SOURCE_KIND_TRUST_FLOOR[existingSourceKind] ?? 'discovery';
  return TRUST_RANK[existingFloor] > TRUST_RANK[incomingTrust];
}

/** Append this run's source ref to an existing candidate's `sources` array,
 *  deduped by (source_id, ref) — used only for the `'protected'` outcome,
 *  where nothing else about the existing row may change. */
function mergeSourceRef(
  existingSources: CandidateSourceRef[],
  next: CandidateSourceRef
): CandidateSourceRef[] {
  const alreadyHas = existingSources.some((s) => s.source_id === next.source_id && s.ref === next.ref);
  return alreadyHas ? existingSources : [...existingSources, next];
}

/** Either of the two "an existing candidate must not be touched" outcomes
 *  for a given `existing` row, or `null` if processing may proceed. Run
 *  once against the caller-supplied `existing` and, for a short Luma link,
 *  a second time against whatever candidate the resolved `luma:evt-…` key
 *  (and its `alt_keys`) turns up — see `processDiscoveredLink`. */
function protectionOutcome(existing: IngestCandidateRow | null, ctx: DiscoveredLinkContext): DiscoveredLinkOutcome | null {
  if (!existing) return null;
  if (isFinalCandidate(existing)) {
    return { kind: 'skipped_final', existingId: existing.id, canonicalKey: existing.canonical_key };
  }
  // Review finding, MEDIUM item 4: a lower-trust discovery source (this
  // module only ever runs for `discovery`-trust sources today) must never
  // reclassify — let alone overwrite `event`/`source_kind`/`source_id`/
  // `status` on — a candidate a HIGHER-trust source already created and
  // decided on (most concretely: a public submission that happens to
  // resolve to the same canonical key as a curated calendar's
  // `auto_rejected` candidate must never "revive" it). Only append this
  // source's ref and bump `last_seen_at`; nothing else about the existing
  // row changes.
  if (existingOutranksIncoming(existing.source_kind, ctx.sourceTrust)) {
    return {
      kind: 'protected',
      existingId: existing.id,
      sources: mergeSourceRef(existing.sources, { source_id: ctx.sourceId, kind: ctx.sourceKind, ref: ctx.sourceRef, seen_at: new Date().toISOString() }),
    };
  }
  return null;
}

/**
 * Resolve a short `lu.ma/<slug>` canonical key (`luma:<slug>`, NOT already
 * an `evt-…` api id) to its stable `luma:evt-…` form (Bug: "short Luma
 * links bypass dedupe" — the curated iCal path has always keyed on the
 * event's api id via its VEVENT UID, so a short link discovered elsewhere
 * for the SAME event used to collapse to a different key and create a
 * second, never-deduped candidate — including resurfacing ones an admin
 * had already rejected).
 *
 * Resolution order:
 *  1. `ingest_link_cache` (shared with `buildSheetLinkIndex`'s sheet-link
 *     resolution — the same tri-state cache, keyed identically). A cached
 *     MISS older than `STALE_NEGATIVE_CACHE_MS` is treated as "never
 *     looked up" and re-resolved (#193's stale-negative-cache fix, applied
 *     here too — this is the other write path into the same cache).
 *  2. On a cold (or stale-miss) cache, one live lookup via the SAME
 *     rate-limited `ctx.enrichLimiter` the main enrichment call below uses
 *     — its full payload is returned too, so the caller can reuse it
 *     instead of enriching twice for the same event.
 *
 * Bug: "exhausting the Luma limiter poisons `ingest_link_cache`" — a
 * negative is only ever WRITTEN to the cache on `enrichResult`'s
 * `'not_found'` (a CONFIRMED "Luma says this doesn't exist"). When the
 * limiter is exhausted, or the lookup fails transiently (`'unavailable'`),
 * this returns `null` (no resolution, same as before) WITHOUT writing
 * anything — a stale/cold cache entry is left exactly as it was, so a
 * later run with budget gets a fair, un-poisoned shot at it.
 *
 * Returns `null` (no resolution) if the slug doesn't parse, or Luma has no
 * api id for it (a confirmed miss, cached or fresh) — the original slug
 * key is used as-is in that case, exactly as before this fix.
 */
async function resolveLumaShortLinkKey(
  slugCanonicalKey: string,
  url: string,
  ctx: DiscoveredLinkContext
): Promise<
  | { canonicalKey: string; altKeys: string[]; payload: LumaEventPayload | null; apiId: string }
  | { unavailable: string }
  | null
> {
  const slug = getValidLumaSlug(url);
  if (!slug) return null;

  const cachedEntry = await getCachedLumaApiIdEntry(slugCanonicalKey);
  let apiId: string | null | undefined;
  if (cachedEntry === undefined) {
    apiId = undefined;
  } else if (cachedEntry.apiId !== null) {
    apiId = cachedEntry.apiId;
  } else {
    const age = Date.now() - new Date(cachedEntry.resolvedAt).getTime();
    apiId = age > STALE_NEGATIVE_CACHE_MS ? undefined : null;
  }

  // Only non-null when THIS call actually fetched live (a cache miss or a
  // stale negative) — `apiId` is derived directly from it, so it's always
  // consistent with the returned `canonicalKey`, and callers can reuse it
  // instead of enriching the same event twice.
  let freshPayload: LumaEventPayload | null = null;
  if (apiId === undefined) {
    const result = await ctx.enrichLimiter.enrichResult({ slug });
    if (result.status === 'ok') {
      freshPayload = result.payload;
      apiId = getLumaEventApiId(result.payload);
      // A genuine Luma response that just has no parseable api id in it is
      // still a confirmed answer (apiId is legitimately null here) — cache it.
      await setCachedLumaApiId(slugCanonicalKey, apiId);
    } else if (result.status === 'not_found') {
      apiId = null;
      await setCachedLumaApiId(slugCanonicalKey, null);
    } else {
      // 'unavailable': limiter exhausted or a transient fetch error — we
      // genuinely don't know. Never write a false negative; the cache (if
      // any row exists at all) is left completely untouched, and the
      // caller defers this link instead of writing an error row.
      return { unavailable: result.reason ?? 'luma_unavailable' };
    }
  }
  if (!apiId) return null;

  // `apiId` keeps Luma's ORIGINAL case — only the canonical KEY is
  // lowercased. Fetching `event/get` with the lowercased id 404s.
  return { canonicalKey: `luma:${apiId.toLowerCase()}`, altKeys: [slugCanonicalKey], payload: freshPayload, apiId };
}

function prefilteredRow(
  ctx: DiscoveredLinkContext,
  key: { canonical_key: string; alt_keys: string[] },
  sources: DiscoveredLinkRow['sources'],
  event: NormalizedEvent,
  contentHash: string,
  filterReason: string
): DiscoveredLinkOutcome {
  return {
    kind: 'row',
    row: {
      conference: ctx.conference,
      canonical_key: key.canonical_key,
      alt_keys: key.alt_keys,
      source_id: ctx.sourceId,
      source_kind: ctx.sourceKind,
      sources,
      source_ref: ctx.sourceRef,
      event,
      content_hash: contentHash,
      status: 'filtered_out',
      filter_reason: filterReason,
      duplicate_of: null,
    },
    classified: false,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
  };
}

/** True if a candidate holds only a placeholder snapshot (an enrichment
 *  error row, or an earlier source-date prefilter) — never real event data
 *  from Luma/an extractor. */
function isPlaceholderCandidate(row: IngestCandidateRow): boolean {
  return !row.event?.dateISO || row.content_hash.startsWith('prefilter:');
}

/**
 * What a source-date prefilter hit (`sourceDateWindowPrefilter`) may do,
 * or null to carry on with normal processing (enrich + judge on Luma's
 * own date):
 *  - existing row with REAL data (e.g. a `classify_failed` error row):
 *    never overwritten with a placeholder. An `error` one is judged on its
 *    OWN stored date — filtered (keeping its event) if that is out of
 *    window; anything else carries on normally.
 *  - existing placeholder `error` row: converted in place (same key and
 *    alt_keys); an existing placeholder `filtered_out` row: unchanged.
 *  - no existing row: a non-Luma or already-`evt-` key gets a new
 *    `filtered_out` row. A short Luma slug key is first mapped through the
 *    link cache to its `evt-` key (and that candidate, if any) so it never
 *    forks a second row; if the slug was never resolved, nothing is
 *    written (`prefiltered`).
 */
async function prefilterOutcome(
  prefilter: { reason: string; dateISO: string },
  url: string,
  canonicalKey: string,
  platform: Platform,
  existing: IngestCandidateRow | null,
  ctx: DiscoveredLinkContext,
  sources: DiscoveredLinkRow['sources'],
  hints: DiscoveredLinkHints | undefined
): Promise<DiscoveredLinkOutcome | null> {
  const reason = `${prefilter.reason} [source date ${prefilter.dateISO}, not enriched]`;
  const placeholder = () => placeholderEvent(url, platform, hints, prefilter.dateISO);
  const hash = `prefilter:${prefilter.dateISO}`;

  const forExisting = (row: IngestCandidateRow): DiscoveredLinkOutcome | null => {
    if (!isPlaceholderCandidate(row)) {
      if (row.status !== 'error') return null;
      const window = { startDate: ctx.tab.dates[0], endDate: ctx.tab.dates[ctx.tab.dates.length - 1] };
      const own = dateWindowFilter(row.event, window, ctx.profile);
      if (own.pass) return null;
      const event = { ...row.event };
      delete event.ingestError;
      return prefilteredRow(ctx, row, sources, event, row.content_hash, `${own.reason} [own date ${row.event.dateISO}, not re-enriched]`);
    }
    if (row.status === 'filtered_out') return { kind: 'unchanged', existingId: row.id };
    if (row.status === 'error') return prefilteredRow(ctx, row, sources, placeholder(), hash, reason);
    return null;
  };

  if (existing) return forExisting(existing);

  if (canonicalKey.startsWith('luma:') && !LUMA_EVENT_API_ID_RE.test(canonicalKey.slice('luma:'.length))) {
    const cached = await getCachedLumaApiIdEntry(canonicalKey);
    if (cached === undefined) return { kind: 'prefiltered', reason };
    if (cached.apiId) {
      const evtKey = `luma:${cached.apiId.toLowerCase()}`;
      const evtExisting = await getCandidateByKeyOrAltKey(ctx.conference, evtKey);
      if (evtExisting) {
        const protectedOutcome = protectionOutcome(evtExisting, ctx);
        if (protectedOutcome) return protectedOutcome;
        return forExisting(evtExisting);
      }
      return prefilteredRow(ctx, { canonical_key: evtKey, alt_keys: [canonicalKey] }, sources, placeholder(), hash, reason);
    }
    // Confirmed "no api id": the slug IS this event's key, same as the
    // normal path would use.
  }
  return prefilteredRow(ctx, { canonical_key: canonicalKey, alt_keys: [] }, sources, placeholder(), hash, reason);
}

/**
 * Process one already-allowlisted URL end to end (enrich/extract ->
 * normalize -> dedupe -> filter -> classify -> route) and return what to
 * persist. Does NOT write to the DB and does NOT publish — see module
 * doc comment. `existing` should be the result of `getCandidateByKey`
 * looked up by the caller using `normalizeEventLink(url)` (this module uses
 * that same key consistently, see the file-level note in `normalize.ts`'s
 * discovered-link functions about not trying to unify Luma slug/evt-id keys
 * here the way the curated iCal path does — simpler, still idempotent per
 * literal URL). For a short Luma link, this function re-resolves and
 * re-checks against the canonical `luma:evt-…` candidate itself (see
 * `resolveLumaShortLinkKey`) — the caller's cheap `existing` lookup only
 * needs to be a best effort.
 */
export async function processDiscoveredLink(
  url: string,
  existing: IngestCandidateRow | null,
  ctx: DiscoveredLinkContext,
  hints?: DiscoveredLinkHints
): Promise<DiscoveredLinkOutcome> {
  let canonicalKey = normalizeEventLink(url);
  if (!canonicalKey) return { kind: 'invalid' };

  const earlyOutcome = protectionOutcome(existing, ctx);
  if (earlyOutcome) return earlyOutcome;

  const platform = allowlistedPlatformFor(url);
  if (!platform) return { kind: 'invalid' };

  const sources = [{ source_id: ctx.sourceId, kind: ctx.sourceKind, ref: ctx.sourceRef, seen_at: new Date().toISOString() }];

  // 2026-10-18 incident: a source-provided date (Mira lists every event's
  // start date) that is clearly outside this conference's window drops the
  // link HERE — before any Luma call — instead of after enrichment. See
  // `prefilterOutcome` for exactly which rows it may touch.
  const prefilter = sourceDateWindowPrefilter(hints, ctx);
  if (prefilter) {
    const pre = await prefilterOutcome(prefilter, url, canonicalKey, platform, existing, ctx, sources, hints);
    if (pre) return pre;
  }

  // An `error` candidate is retried on a backoff, not every run — each
  // retry costs a rate-limited Luma call.
  // A host (re)submitting their own link bypasses it: they're told it's
  // being looked at, so it must actually be looked at now.
  const backoffApplies = ctx.sourceKind !== 'host_submission';
  if (existing && backoffApplies && !isErrorRetryDue(existing)) return { kind: 'unchanged', existingId: existing.id };

  let altKeys: string[] = [];
  let prefetchedLumaPayload: LumaEventPayload | null = null;
  let resolvedApiId: string | null = null;

  if (canonicalKey.startsWith('luma:')) {
    const slugPart = canonicalKey.slice('luma:'.length);
    if (!LUMA_EVENT_API_ID_RE.test(slugPart)) {
      const resolved = await resolveLumaShortLinkKey(canonicalKey, url, ctx);
      if (resolved && 'unavailable' in resolved) {
        return existing ? { kind: 'unchanged', existingId: existing.id } : { kind: 'deferred', reason: resolved.unavailable };
      }
      if (resolved) {
        canonicalKey = resolved.canonicalKey;
        altKeys = resolved.altKeys;
        prefetchedLumaPayload = resolved.payload;
        resolvedApiId = resolved.apiId;
        const resolvedExisting = await getCandidateByKeyOrAltKey(ctx.conference, canonicalKey);
        if (resolvedExisting) {
          existing = resolvedExisting;
          const resolvedOutcome = protectionOutcome(existing, ctx);
          if (resolvedOutcome) return resolvedOutcome;
          if (backoffApplies && !isErrorRetryDue(existing)) return { kind: 'unchanged', existingId: existing.id };
        }
      }
    }
  }

  let normalized: NormalizedEvent | null = null;
  let failureReason = 'enrich_failed';

  if (platform === 'luma') {
    const slugKey = canonicalKey.startsWith('luma:') ? canonicalKey.slice('luma:'.length) : null;
    const keyIsApiId = !!slugKey && LUMA_EVENT_API_ID_RE.test(slugKey);
    // Original-case api id: from the resolver, else from the URL itself.
    // NEVER the lowercased canonical key (Luma 404s on it).
    const apiId = resolvedApiId ?? lumaApiIdFromUrl(url);
    const rawSlug = getValidLumaSlug(url);
    const slug = rawSlug && rawSlug.toLowerCase() !== 'event' ? rawSlug : null;
    const slugIsApiId = !!slug && LUMA_EVENT_API_ID_RE.test(slug);
    if (!apiId && !slug && !keyIsApiId) return { kind: 'invalid' };

    let result: EnrichOutcome | null = prefetchedLumaPayload ? { status: 'ok', payload: prefetchedLumaPayload } : null;
    if (!result && apiId) result = await ctx.enrichLimiter.enrichResult({ apiId });
    // By-id lookup failed for good (e.g. a stale/lowercased cached id), or
    // there was no id: fall back to the slug, which Luma resolves itself.
    if ((!result || result.status === 'not_found') && slug && !slugIsApiId) {
      result = await ctx.enrichLimiter.enrichResult({ slug });
    }
    if (!result) result = { status: 'not_found', reason: 'no usable Luma api id or slug' };

    if (result.status === 'unavailable') {
      // Transient (429/5xx/network/budget): never an `error` row. Leave an
      // existing candidate's last-good snapshot exactly as-is; otherwise
      // write nothing and let a later run retry.
      return existing ? { kind: 'unchanged', existingId: existing.id } : { kind: 'deferred', reason: result.reason ?? 'luma_unavailable' };
    }
    if (result.status === 'ok') {
      normalized = normalizeDiscoveredLumaEvent({ payload: result.payload, fallbackLink: url });
      if (!normalized) failureReason = 'luma_unparseable: Luma payload had no name/start_at';
    } else {
      failureReason = `luma_not_found: ${result.reason ?? 'Luma event not found.'}`;
    }
  } else {
    const paced = await ctx.linkFetchLimiter.throttle();
    if (!paced) {
      // Out of budget for non-Luma fetches this run — leave it for a later
      // run rather than silently dropping it.
      return existing
        ? { kind: 'unchanged', existingId: existing.id }
        : {
            kind: 'row',
            row: {
              conference: ctx.conference,
              canonical_key: canonicalKey,
              alt_keys: altKeys,
              source_id: ctx.sourceId,
              source_kind: ctx.sourceKind,
              sources: [{ source_id: ctx.sourceId, kind: ctx.sourceKind, ref: ctx.sourceRef, seen_at: new Date().toISOString() }],
              source_ref: ctx.sourceRef,
              event: { name: url, startAt: new Date().toISOString(), timezone: 'UTC', dateISO: '', sheetDate: '', startTime: '', endTime: '', address: '', isOnline: false, organizer: '', hosts: [], cost: '', link: url, descriptionText: '', platform } as NormalizedEvent,
              content_hash: 'pending',
              status: 'pending_classify',
            },
            classified: false,
            inputTokens: 0,
            outputTokens: 0,
            costUsd: 0,
          };
    }
    const result = await extractByPlatform(platform, url);
    if (result) normalized = normalizeExtractedEvent({ platform, result });
    else failureReason = `extract_failed: could not read the ${platform} page`;
  }

  if (!normalized) {
    // Review finding, MEDIUM item 3: a failed enrichment must never
    // overwrite an existing candidate's last-good snapshot with a blank
    // placeholder — unless the existing row IS already an error
    // placeholder, in which case record this attempt (reason + consecutive
    // failure count + time, in `event.ingestError`) so the backoff grows.
    if (existing && existing.status !== 'error') {
      return { kind: 'unchanged', existingId: existing.id };
    }
    // Every error row carries a reason (`filter_reason`, prefixed
    // "error:") and `event.ingestError` (see `isErrorRetryDue`) so it's
    // visible in the Log/Queue and retried on a backoff, not every run.
    return {
      kind: 'row',
      row: {
        conference: ctx.conference,
        canonical_key: existing?.canonical_key ?? canonicalKey,
        alt_keys: Array.from(new Set([...(existing?.alt_keys ?? []), ...altKeys])),
        source_id: ctx.sourceId,
        source_kind: ctx.sourceKind,
        sources,
        source_ref: ctx.sourceRef,
        event: withFailure(existing?.event ?? placeholderEvent(url, platform, hints), existing, failureReason),
        content_hash: existing?.content_hash ?? `error:${canonicalKey}`,
        status: 'error',
        filter_reason: `error: ${failureReason}`,
      },
      classified: false,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    };
  }

  if (normalized.lat == null && normalized.lng == null && normalized.address) {
    const geocoded = await geocodeAddressCached(ctx.supabase, normalized.address, ctx.tab.center, ctx.conference);
    if (geocoded) {
      normalized.lat = geocoded.lat;
      normalized.lng = geocoded.lng;
    }
  }

  const contentHash = computeContentHash(normalized);
  if (existing && existing.content_hash === contentHash && !RETRY_ON_UNCHANGED_STATUSES.includes(existing.status)) {
    return { kind: 'unchanged', existingId: existing.id };
  }

  const baseRow: DiscoveredLinkRow = {
    conference: ctx.conference,
    canonical_key: canonicalKey,
    alt_keys: altKeys,
    source_id: ctx.sourceId,
    source_kind: ctx.sourceKind,
    sources,
    source_ref: ctx.sourceRef,
    event: normalized,
    content_hash: contentHash,
    status: 'new',
    // Review finding, MEDIUM item 4 (second half): explicit nulls here,
    // not omitted, so every branch below that doesn't override them
    // CLEARS a stale value from a PREVIOUS run instead of silently
    // leaving it — `upsertCandidate`'s non-final update only sets the
    // columns present in the patch, so a key that's simply absent from
    // the object leaves whatever was already in that column untouched
    // (e.g. a candidate that was `duplicate_of: 'evt-123'` last run and is
    // `queued` this run must not still show `duplicate_of: 'evt-123'`).
    duplicate_of: null,
    filter_reason: null,
  };

  const startDate = ctx.tab.dates[0];
  const endDate = ctx.tab.dates[ctx.tab.dates.length - 1];

  const { duplicateOf, possibleDuplicateOf: sameConfPossibleDuplicateOf } = matchAgainstSheetAndCandidates(normalized, {
    linkIndex: ctx.linkIndex,
    sheetEvents: ctx.sheetEvents,
    otherCandidates: ctx.otherCandidates,
    conferenceName: ctx.conference,
    excludeCandidateId: existing?.id ?? null,
  });

  if (duplicateOf) {
    return { kind: 'row', row: { ...baseRow, status: 'duplicate', duplicate_of: duplicateOf }, classified: false, inputTokens: 0, outputTokens: 0, costUsd: 0 };
  }

  const windowCheck = dateWindowFilter(normalized, { startDate, endDate }, ctx.profile);
  let filterReason: string | null = windowCheck.pass ? null : windowCheck.reason;
  let noGeo = false;
  if (!filterReason) {
    const geoCheck = geoFilter(normalized, ctx.tab.center, { radius_km: ctx.profile.radius_km, allow_online: ctx.profile.allow_online });
    if (geoCheck.pass === 'no_geo') noGeo = true;
    else if (!geoCheck.pass) filterReason = geoCheck.reason;
  }

  let possibleDuplicateOf = sameConfPossibleDuplicateOf;
  if (filterReason) {
    return {
      kind: 'row',
      row: { ...baseRow, status: 'filtered_out', filter_reason: filterReason, possible_duplicate_of: possibleDuplicateOf },
      classified: false,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    };
  }

  // Cross-conference duplicate (same as the Luma iCal pipeline): keep the
  // event only in the best-matching overlapping conference.
  const crossConference = await checkCrossConferenceDuplicate({
    conference: ctx.conference,
    tab: ctx.tab,
    canonicalKey,
    altKeys,
    event: normalized,
    firstSeenAt: existing?.first_seen_at ?? null,
  });
  if (crossConference?.kind === 'self_duplicate') {
    return {
      kind: 'row',
      row: {
        ...baseRow,
        status: 'duplicate',
        duplicate_of: crossConference.other.id,
        possible_duplicate_of: possibleDuplicateOf,
        review_note: `Cross-conference duplicate: ${crossConference.note}`,
      },
      classified: false,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    };
  }
  if (crossConference?.kind === 'possible_duplicate' && !possibleDuplicateOf) possibleDuplicateOf = crossConference.other.id;

  if (!ctx.canClassify()) {
    return {
      kind: 'row',
      row: { ...baseRow, status: 'pending_classify', possible_duplicate_of: possibleDuplicateOf },
      classified: false,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    };
  }

  const hostSignals = ctx.computeHostSignals(normalized);
  const sponsorText = [normalized.organizer, ...normalized.hosts.map((h) => h.name)].join(' ');
  const sponsorMatch = matchSponsorName(sponsorText, ctx.sponsorNames);

  let scoreResult;
  try {
    scoreResult = await scoreCandidate({
      client: ctx.client,
      profile: ctx.themeProfile,
      conference: { name: ctx.conference, city: null, startDate, endDate },
      event: {
        name: normalized.name,
        hosts: normalized.hosts.map((h) => h.name),
        calendarName: normalized.calendar?.name ?? null,
        organizer: normalized.organizer,
        venue: normalized.address || null,
        dateISO: normalized.dateISO,
        startTime: normalized.startTime,
        cost: normalized.cost,
        platform: normalized.platform,
        descriptionText: normalized.descriptionText,
      },
      fewShot: ctx.fewShot,
      isTrustedCalendarSource: false,
      isTrustedHost: hostSignals.isTrustedHost,
      isBlockedHost: hostSignals.isBlockedHost,
      isLearnedBlockedHost: hostSignals.isLearnedBlockedHost,
      sponsorMatch,
      isVerifiedSubmitter: ctx.isVerifiedSubmitter,
      includeKeywords: ctx.profile.include_keywords,
      excludeKeywords: ctx.profile.exclude_keywords,
      possibleDuplicate: !!possibleDuplicateOf,
      noGeo,
      preEvent: isPreEvent(normalized, { startDate }),
      venueUnknown: isVenueUnknown(normalized),
      forceReview: hasForceReviewMarker(existing),
      sourceTrust: ctx.sourceTrust,
      publishThreshold: ctx.profile.publish_threshold,
      reviewThreshold: ctx.profile.review_threshold,
    });
  } catch (err) {
    // Same handling as the Luma iCal pipeline's classify catch: a
    // schema-validation failure still bills tokens (the model DID return a
    // completion), so bill it even though the call "failed".
    let costUsd = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    if (err instanceof ClassifierError && err.usage) {
      inputTokens = err.usage.inputTokens;
      outputTokens = err.usage.outputTokens;
      costUsd = estimateCostUsd(err.usage.model, inputTokens, outputTokens);
    }
    return {
      kind: 'row',
      row: {
        ...baseRow,
        status: 'error',
        event: withFailure(normalized, existing, 'classify_failed'),
        filter_reason: `error: classify_failed: ${err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300)}`,
        possible_duplicate_of: possibleDuplicateOf,
        classify_attempts: (existing?.classify_attempts ?? 0) + 1,
      },
      classified: false,
      inputTokens,
      outputTokens,
      costUsd,
    };
  }

  const costUsd = estimateCostUsd(scoreResult.classifier.model, scoreResult.classifier.inputTokens, scoreResult.classifier.outputTokens);

  // Never publish from a discovery source, full stop — even though
  // `scoreCandidate` already caps a discovery-trust route at 'review'
  // (§10 item 4), this module has no publisher wired up at all, so a
  // 'publish' route (which shouldn't occur for `sourceTrust: 'discovery'`,
  // but this function doesn't hardcode that assumption) is still only ever
  // treated as 'queued' here, never inserted into the sheet.
  const status: CandidateStatus = scoreResult.route === 'reject' ? 'auto_rejected' : 'queued';

  return {
    kind: 'row',
    row: {
      ...baseRow,
      status,
      llm_score: scoreResult.classifier.output.theme_score,
      llm_reason: scoreResult.classifier.output.reason,
      llm_tags: scoreResult.classifier.output.suggested_tags,
      llm_flags: scoreResult.classifier.output.flags,
      is_event: scoreResult.classifier.output.is_event,
      data_quality: scoreResult.classifier.output.data_quality,
      signal_breakdown: scoreResult.signals.breakdown,
      final_score: scoreResult.finalScore,
      route: scoreResult.route,
      shadow_route: scoreResult.shadowRoute,
      model: scoreResult.classifier.model,
      prompt_version: scoreResult.classifier.promptVersion,
      classified_at: new Date().toISOString(),
      classify_attempts: (existing?.classify_attempts ?? 0) + 1,
      possible_duplicate_of: possibleDuplicateOf,
      ...(crossConference?.kind === 'possible_duplicate' ? { review_note: `Possible cross-conference duplicate: ${crossConference.note}` } : {}),
    },
    classified: true,
    inputTokens: scoreResult.classifier.inputTokens,
    outputTokens: scoreResult.classifier.outputTokens,
    costUsd,
    crossConference: crossConference?.kind === 'demote_other' ? crossConference : null,
  };
}
