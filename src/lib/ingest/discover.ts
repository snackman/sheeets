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
import { normalizeEventLink, getValidLumaSlug, getLumaEventApiId, LUMA_EVENT_API_ID_RE, type LumaEventPayload } from '../luma';
import { parseEventbrite, parsePartiful, parseMeetup, parsePosh, UserFacingError, type EventResult } from '../event-extractors';
import { SafeFetchError } from '../safe-fetch';
import type { TabConfig } from '../conferences';
import { allowlistedPlatformFor, type Platform } from './allowlist';
import { normalizeDiscoveredLumaEvent, normalizeExtractedEvent, computeContentHash } from './normalize';
import { matchAgainstSheetAndCandidates, type SheetLinkIndex, type DedupeSheetEvent, type DedupeCandidatePool } from './dedupe';
import { dateWindowFilter, geoFilter, geocodeAddressCached } from './filters';
import { getCachedLumaApiId, setCachedLumaApiId, getCandidateByKeyOrAltKey } from './db';
import type { EnrichLimiter } from './enrich';
import { scoreCandidate } from './scoring';
import { ClassifierError } from './classifier';
import { hostListMatches } from './hosts';
import { matchSponsorName } from './sponsors';
import { learnedHostSignalMatches, type LearnedHostSignals } from './learning';
import { estimateCostUsd } from './pricing';
import { RETRY_ON_UNCHANGED_STATUSES, FINAL_CANDIDATE_STATUSES } from './types';
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
  | { kind: 'row'; row: DiscoveredLinkRow; classified: boolean; inputTokens: number; outputTokens: number; costUsd: number };

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
  if (FINAL_CANDIDATE_STATUSES.includes(existing.status)) {
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
 *     resolution — the same tri-state cache, keyed identically).
 *  2. On a cold cache, one live lookup via the SAME rate-limited
 *     `ctx.enrichLimiter` the main enrichment call below uses (`through
 *     the shared rate limiter`) — its full payload is returned too, so the
 *     caller can reuse it instead of enriching twice for the same event.
 *
 * Returns `null` (no resolution) if the slug doesn't parse, or Luma has no
 * api id for it (cached miss, or the live lookup came back empty) — the
 * original slug key is used as-is in that case, exactly as before this fix.
 */
async function resolveLumaShortLinkKey(
  slugCanonicalKey: string,
  url: string,
  ctx: DiscoveredLinkContext
): Promise<{ canonicalKey: string; altKeys: string[]; payload: LumaEventPayload | null } | null> {
  const slug = getValidLumaSlug(url);
  if (!slug) return null;

  let apiId = await getCachedLumaApiId(slugCanonicalKey);
  // Only non-null when THIS call actually fetched live (a cache miss) —
  // `apiId` is derived directly from it, so it's always consistent with
  // the returned `canonicalKey`, and callers can reuse it instead of
  // enriching the same event twice.
  let freshPayload: LumaEventPayload | null = null;
  if (apiId === undefined) {
    freshPayload = await ctx.enrichLimiter.enrich({ slug });
    apiId = freshPayload ? getLumaEventApiId(freshPayload) : null;
    await setCachedLumaApiId(slugCanonicalKey, apiId);
  }
  if (!apiId) return null;

  return { canonicalKey: `luma:${apiId.toLowerCase()}`, altKeys: [slugCanonicalKey], payload: freshPayload };
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
  ctx: DiscoveredLinkContext
): Promise<DiscoveredLinkOutcome> {
  let canonicalKey = normalizeEventLink(url);
  if (!canonicalKey) return { kind: 'invalid' };

  const earlyOutcome = protectionOutcome(existing, ctx);
  if (earlyOutcome) return earlyOutcome;

  let altKeys: string[] = [];
  let prefetchedLumaPayload: LumaEventPayload | null = null;

  if (canonicalKey.startsWith('luma:')) {
    const slugPart = canonicalKey.slice('luma:'.length);
    if (!LUMA_EVENT_API_ID_RE.test(slugPart)) {
      const resolved = await resolveLumaShortLinkKey(canonicalKey, url, ctx);
      if (resolved) {
        canonicalKey = resolved.canonicalKey;
        altKeys = resolved.altKeys;
        prefetchedLumaPayload = resolved.payload;
        const resolvedExisting = await getCandidateByKeyOrAltKey(ctx.conference, canonicalKey);
        if (resolvedExisting) {
          existing = resolvedExisting;
          const resolvedOutcome = protectionOutcome(existing, ctx);
          if (resolvedOutcome) return resolvedOutcome;
        }
      }
    }
  }

  const platform = allowlistedPlatformFor(url);
  if (!platform) return { kind: 'invalid' };

  let normalized: NormalizedEvent | null = null;

  if (platform === 'luma') {
    const slugKey = canonicalKey.startsWith('luma:') ? canonicalKey.slice('luma:'.length) : null;
    const apiId = slugKey && LUMA_EVENT_API_ID_RE.test(slugKey) ? slugKey : null;
    const slug = !apiId ? getValidLumaSlug(url) : null;
    if (!apiId && !slug) return { kind: 'invalid' };
    const payload = prefetchedLumaPayload ?? (await ctx.enrichLimiter.enrich(apiId ? { apiId } : { slug: slug as string }));
    if (payload) normalized = normalizeDiscoveredLumaEvent({ payload, fallbackLink: url });
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
  }

  const sources = [{ source_id: ctx.sourceId, kind: ctx.sourceKind, ref: ctx.sourceRef, seen_at: new Date().toISOString() }];

  if (!normalized) {
    // Review finding, MEDIUM item 3: enrichment/extraction failing (rate-
    // limited, 404, unparseable page — all likely TRANSIENT) must never
    // overwrite an existing candidate's last-good snapshot with a blank
    // "error" placeholder. Same guard as the non-Luma budget-exhausted
    // branch above: if there's an existing (non-final, non-protected —
    // already ruled out above) candidate, just leave it exactly as-is.
    if (existing) {
      return { kind: 'unchanged', existingId: existing.id };
    }
    // No existing candidate at all — nothing to protect. Record the
    // failure as a fresh `error` row so an admin can see it tried in the
    // Log/Queue rather than it silently vanishing, same as the Luma iCal
    // path's classify failure handling.
    return {
      kind: 'row',
      row: {
        conference: ctx.conference,
        canonical_key: canonicalKey,
        alt_keys: altKeys,
        source_id: ctx.sourceId,
        source_kind: ctx.sourceKind,
        sources,
        source_ref: ctx.sourceRef,
        event: {
          name: url,
          startAt: new Date().toISOString(),
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
          link: url,
          descriptionText: '',
          platform,
        } as NormalizedEvent,
        content_hash: `error:${canonicalKey}`,
        status: 'error',
        classify_attempts: 1,
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

  const { duplicateOf, possibleDuplicateOf } = matchAgainstSheetAndCandidates(normalized, {
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
      row: { ...baseRow, status: 'error', possible_duplicate_of: possibleDuplicateOf, classify_attempts: (existing?.classify_attempts ?? 0) + 1 },
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
    },
    classified: true,
    inputTokens: scoreResult.classifier.inputTokens,
    outputTokens: scoreResult.classifier.outputTokens,
    costUsd,
  };
}
