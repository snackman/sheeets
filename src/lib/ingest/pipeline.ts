// The pipeline orchestrator (§5, §7 `pipeline.ts`): fetch -> normalize ->
// dedupe -> filter -> enrich -> classify -> route -> publish/queue/reject,
// one source per call, deadline-aware so a cron run that's running long
// exits cleanly and the next run picks up where it stopped.
import OpenAI from 'openai';
import { normalizeEventLink } from '../luma';
import { fetchEvents, generateEventId } from '../fetch-events';
import { getSheetTitle } from '../google-sheets';
import { invalidateEventsCache } from '../fetch-events-cached';
import { getAllConferenceTabs } from '../get-conferences';
import type { TabConfig } from '../conferences';
import {
  getSource,
  getProfile,
  getCandidateByKey,
  upsertCandidate,
  updateCandidate,
  listRecentCandidatesForDedupe,
  createRun,
  finishRun,
  hasRecentRunningRun,
  updateSource,
  profileRowToThemeProfile,
  getIngestSupabase,
} from './db';
import { fetchLumaIcalFeed, toIcalCandidates } from './sources/luma-ical';
import { normalizeLumaEvent, computeContentHash } from './normalize';
import { buildSheetLinkIndex, findSheetMatchByLink, fuzzyMatch } from './dedupe';
import { dateWindowFilter, geoFilter, isPastEvent, geocodeAddressCached } from './filters';
import { LumaEnrichmentLimiter } from './enrich';
import { scoreCandidate } from './scoring';
import { checkMonthlyBudget } from './budget';
import { estimateCostUsd } from './pricing';
import { toEventRow, ThrottledSheetPublisher } from './publish';
import { reconcileConference } from './reconcile';
import { ClassifierError } from './classifier';
import { hostListMatches } from './hosts';
import { getSponsorNamesForConference, matchSponsorName } from './sponsors';
import { loadLearningContext, learnedHostSignalMatches } from './learning';
import { checkAutoPublishKillSwitch } from './gate';
import {
  FINAL_CANDIDATE_STATUSES,
  RETRY_ON_UNCHANGED_STATUSES,
  type CandidateStatus,
  type IngestProfileRow,
  type NormalizedEvent,
  type RunCounts,
  type RunTrigger,
} from './types';

function bump(counts: RunCounts, key: keyof RunCounts, by = 1) {
  counts[key] = (counts[key] ?? 0) + by;
}

/** Lightweight in-run representative of a candidate, for intra-run dedupe
 *  (review finding, LOW "dedupe within a single run"). Real candidates get
 *  their DB id; dry-run previews (which never get one) use the canonical
 *  key as a stand-in — fine, since this is only compared by identity/key,
 *  never persisted. */
interface InRunCandidate {
  id: string;
  canonical_key: string;
  event: NormalizedEvent;
}

export interface RunSourceOptions {
  trigger: RunTrigger;
  /** Wall-clock budget for this run; defaults to 240s (Vercel's 300s function cap, §8). */
  deadlineMs?: number;
  /** Classify but never write candidates/runs or publish to the sheet — the
   *  admin "Run now" dry-run mode (§7). `previews` on the result holds what
   *  *would* have been written. Classification still happens (real $), so
   *  dry runs still count against the budget cap. */
  dryRun?: boolean;
}

export interface CandidatePreview {
  canonical_key: string;
  status: CandidateStatus;
  final_score: number | null;
  route: string | null;
  llm_reason: string | null;
  filter_reason: string | null;
  event: NormalizedEvent;
}

export interface RunSourceResult {
  runId: string | null;
  status: 'ok' | 'partial' | 'error' | 'skipped';
  counts: RunCounts;
  error?: string;
  previews?: CandidatePreview[];
}

export async function runSource(sourceId: string, opts: RunSourceOptions): Promise<RunSourceResult> {
  const source = await getSource(sourceId);
  if (!source) throw new Error(`Ingest source ${sourceId} not found.`);

  // The overlap guard applies to dry runs too (review finding, MEDIUM item
  // 5) — a dry run still does real, rate-limited Luma calls and real LLM
  // calls, so it must not race a concurrent real (or dry) run on the same
  // source.
  if (await hasRecentRunningRun(sourceId)) {
    const run = await createRun({ source_id: sourceId, conference: source.conference, trigger: opts.trigger });
    await finishRun(run.id, { status: 'skipped', counts: opts.dryRun ? { dry_run: 1 } : {} });
    return { runId: run.id, status: 'skipped', counts: {} };
  }

  // Always create a real `ingest_runs` row, including for dry runs, so its
  // cost counts toward the monthly budget cap (which just sums
  // `est_cost_usd` across the month) and so the overlap guard above has a
  // `running` row to find (review finding, MEDIUM item 5). `last_run_at`/
  // `last_status` on the SOURCE are intentionally left untouched for dry
  // runs — those drive cron scheduling order and shouldn't reflect a
  // preview that wrote nothing to the ledger.
  const run = await createRun({ source_id: sourceId, conference: source.conference, trigger: opts.trigger });
  const counts: RunCounts = {
    fetched: 0, past: 0, new: 0, unchanged: 0, enriched: 0, duplicates: 0,
    filtered: 0, classified: 0, published: 0, queued: 0, rejected: 0, errors: 0,
    ...(opts.dryRun ? { dry_run: 1 } : {}),
  };
  let llmInputTokens = 0;
  let llmOutputTokens = 0;
  let costUsd = 0;

  try {
    if (source.kind !== 'luma_ical') {
      throw new Error(`Source kind "${source.kind}" is not implemented until a later phase.`);
    }

    const profile = await getProfile(source.conference);
    if (!profile || !profile.enabled) {
      if (!opts.dryRun) await updateSource(sourceId, { last_run_at: new Date().toISOString(), last_status: 'skipped' });
      await finishRun(run.id, { status: 'skipped', counts, error: 'No enabled ingest profile for this conference.' });
      return { runId: run.id, status: 'skipped', counts };
    }

    // Phase 2 kill switch (`gate.ts`): re-checked just before each actual
    // auto-publish attempt inside `processSource`, not only once here at
    // the top of the run (review finding, LOW item 10) — a conference that
    // goes bad mid-run stops publishing partway through, not only on the
    // next run.

    const allTabs = await getAllConferenceTabs();
    const tab = allTabs.find((t) => t.name === source.conference);
    if (!tab) throw new Error(`No conference tab found for "${source.conference}".`);

    const result = await processSource({ source, profile, tab, deadlineMs: opts.deadlineMs, counts, dryRun: opts.dryRun });
    llmInputTokens = result.llmInputTokens;
    llmOutputTokens = result.llmOutputTokens;
    costUsd = result.costUsd;

    if (!opts.dryRun) await updateSource(sourceId, { last_run_at: new Date().toISOString(), last_status: 'ok', last_error: null });
    await finishRun(run.id, {
      status: result.hitDeadline ? 'partial' : 'ok',
      counts,
      llm_input_tokens: llmInputTokens,
      llm_output_tokens: llmOutputTokens,
      est_cost_usd: costUsd,
    });
    return { runId: run.id, status: result.hitDeadline ? 'partial' : 'ok', counts, previews: result.previews };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!opts.dryRun) await updateSource(sourceId, { last_run_at: new Date().toISOString(), last_status: 'error', last_error: message });
    await finishRun(run.id, {
      status: 'error',
      counts,
      llm_input_tokens: llmInputTokens,
      llm_output_tokens: llmOutputTokens,
      est_cost_usd: costUsd,
      error: message,
    });
    return { runId: run.id, status: 'error', counts, error: message };
  }
}

async function processSource(args: {
  source: Awaited<ReturnType<typeof getSource>>;
  profile: IngestProfileRow;
  tab: TabConfig;
  deadlineMs?: number;
  counts: RunCounts;
  dryRun?: boolean;
}): Promise<{ llmInputTokens: number; llmOutputTokens: number; costUsd: number; hitDeadline: boolean; previews?: CandidatePreview[] }> {
  const { profile, tab, counts, dryRun } = args;
  const source = args.source!;
  const deadline = Date.now() + (args.deadlineMs ?? 240_000);
  const previews: CandidatePreview[] = [];

  /** Write a candidate, or (dry run) just record a preview of what would
   *  have been written. */
  async function persist(row: Record<string, unknown> & { conference: string; canonical_key: string; status: CandidateStatus; event: NormalizedEvent }): Promise<void> {
    if (dryRun) {
      previews.push({
        canonical_key: row.canonical_key,
        status: row.status,
        final_score: (row.final_score as number | undefined) ?? null,
        route: (row.route as string | undefined) ?? null,
        llm_reason: (row.llm_reason as string | undefined) ?? null,
        filter_reason: (row.filter_reason as string | undefined) ?? null,
        event: row.event,
      });
      return;
    }
    await upsertCandidate(row);
  }

  const calendarApiId = (source.config as { calendar_api_id?: string }).calendar_api_id;
  if (!calendarApiId) throw new Error('Source is missing calendar_api_id.');

  const vevents = await fetchLumaIcalFeed(calendarApiId);
  bump(counts, 'fetched', vevents.length);
  const icalCandidates = toIcalCandidates(vevents);

  const budgetStatus = await checkMonthlyBudget();
  let runningCostUsd = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  // One limiter for BOTH event enrichment and Luma slug->api-id resolution
  // (used by buildSheetLinkIndex below) — every Luma lookup this run goes
  // through it, so they share one 1-request/sec clock and one per-run
  // budget rather than two independent limiters racing each other (review
  // finding, MEDIUM item 7).
  const enrichLimiter = new LumaEnrichmentLimiter(100, 1000);
  const resolveSlugViaLimiter = async (slug: string): Promise<string | null> => {
    const payload = await enrichLimiter.enrich({ slug });
    return payload?.event?.api_id ?? payload?.api_id ?? null;
  };
  const themeProfile = profileRowToThemeProfile(profile);
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const supabase = getIngestSupabase();

  const sheetEvents = await fetchEvents(undefined, [tab]);
  const linkIndex = await buildSheetLinkIndex(
    sheetEvents.map((e) => ({ id: e.id, link: e.link })),
    { maxResolutions: 50, resolveSlug: resolveSlugViaLimiter }
  );
  // Mutable: appended to as this run processes its own candidates, so two
  // near-duplicate events later in the SAME feed still dedupe against each
  // other, not just against candidates from before this run started
  // (review finding, LOW "dedupe within a single run").
  const otherCandidates: InRunCandidate[] = (await listRecentCandidatesForDedupe(source.conference)).map((c) => ({
    id: c.id,
    canonical_key: c.canonical_key,
    event: c.event,
  }));

  // "Trusted host" signal includes hosts with >= 2 prior events already in
  // this conference's sheet (§5.4), approximated by organizer name frequency.
  const organizerCounts = new Map<string, number>();
  for (const e of sheetEvents) {
    const key = e.organizer.trim().toLowerCase();
    if (!key) continue;
    organizerCounts.set(key, (organizerCounts.get(key) ?? 0) + 1);
  }

  const { data: verifiedHosts } = await supabase.from('verified_luma_hosts').select('host_api_id').is('revoked_at', null);
  const verifiedHostIds = new Set((verifiedHosts ?? []).map((h: { host_api_id: string }) => h.host_api_id));

  // Phase 2 learning loop (`learning.ts`): few-shot examples from past admin
  // decisions, plus an optional learned trusted/blocked host nudge from
  // this conference's own label history. Fetched once per run — same
  // conference/theme for every candidate below, so there's no reason to
  // re-query per candidate (and it keeps the prompt deterministic/cacheable
  // across a run, per §5.6).
  const { fewShot, learnedHosts } = await loadLearningContext({ conference: source.conference, themeKey: profile.theme_key });
  // Phase 2 sponsor-name signal wiring (`sponsors.ts`): the conference's
  // already-known sponsor names (from any published event), matched as
  // plain text against each candidate below.
  const sponsorNames = await getSponsorNamesForConference(source.conference);

  const sheetTitle = await getSheetTitle(tab.gid);
  const publisher = new ThrottledSheetPublisher(sheetTitle, tab.gid, { maxPerRun: profile.max_publish_per_run });
  let sheetChanged = false;
  let llmCallsThisRun = 0;

  const startDate = tab.dates[0];
  const endDate = tab.dates[tab.dates.length - 1];

  let hitDeadline = false;

  try {
  for (const { vevent, apiId, slug } of icalCandidates) {
    if (Date.now() > deadline) {
      hitDeadline = true;
      break;
    }

    const startAt = vevent.dtstartIsDateOnly ? `${vevent.dtstart}T00:00:00.000Z` : vevent.dtstart;
    if (isPastEvent({ startAt })) {
      bump(counts, 'past');
      continue;
    }

    const fallbackLink = vevent.location || (slug ? `https://luma.com/${slug}` : '');
    const canonicalKey = apiId ? `luma:${apiId.toLowerCase()}` : normalizeEventLink(fallbackLink);
    if (!canonicalKey) {
      bump(counts, 'errors');
      continue;
    }

    const calendarRef = { apiId: calendarApiId, name: source.label || source.conference };
    const existing = await getCandidateByKey(source.conference, canonicalKey);

    // The iCal-only stub (no network call) is used BOTH for change
    // detection below AND as the "refresh" payload for a final-status
    // candidate (next block) — computing it up front keeps both paths
    // cheap and consistent.
    const stub = normalizeLumaEvent({ vevent, timezone: tab.timezone, enrichment: null, calendar: calendarRef, fallbackSlug: slug });
    const stubHash = computeContentHash(stub);

    // A candidate already in a final/admin-owned state (approved,
    // auto_published, rejected, unpublished, unpublished_external) is
    // never re-processed: no dedupe, no filters, no (re-)classification,
    // no (re-)publish. Only its raw snapshot is refreshed. This is what
    // stops a re-ingest from re-marking a published candidate as a
    // "duplicate" of its own now-live sheet row, or from ever re-publishing
    // something an admin unpublished (review finding, CRITICAL item 2).
    if (existing && FINAL_CANDIDATE_STATUSES.includes(existing.status)) {
      if (!dryRun) {
        // Only the fields `upsertCandidate` actually allows through for a
        // final candidate: `ical_hash`, `last_seen_at` (added by
        // `upsertCandidate` itself) and `sources`. Never `event`/
        // `content_hash` — this previously replaced an enriched (or
        // admin-edited) snapshot with the bare, un-enriched iCal stub on
        // every re-ingest (review finding, MEDIUM item 1).
        await upsertCandidate({
          conference: source.conference,
          canonical_key: canonicalKey,
          sources: [{ source_id: source.id, kind: source.kind, ref: vevent.uid, seen_at: new Date().toISOString() }],
          ical_hash: stubHash,
        });
      }
      bump(counts, 'skipped_final');
      continue;
    }

    // Change detection BEFORE enrichment (§5 "unchanged? touch last_seen_at,
    // stop"): the iCal-stub hash (computed above) is compared against the
    // SAME kind of hash stored from the last run (`ical_hash`) — not
    // against `content_hash` (the full, possibly-enriched hash), which can
    // never match a pre-enrichment stub and would make every run reprocess
    // every candidate from scratch (review finding, CRITICAL item 1).
    // Luma's DESCRIPTION stub includes the host list as text, so a host or
    // name/date change is caught; a change to only the long-form Luma
    // description (not reflected in the iCal stub) is not — a known
    // limitation of iCal-only change detection, acceptable at this volume.
    // `error`/`pending_classify` are excluded even on a hash match — they
    // need to be retried, not treated as settled (review finding, MEDIUM
    // item 6).
    if (existing && existing.ical_hash === stubHash && !RETRY_ON_UNCHANGED_STATUSES.includes(existing.status)) {
      if (!dryRun) await updateCandidate(existing.id, { last_seen_at: new Date().toISOString() });
      bump(counts, 'unchanged');
      continue;
    }
    bump(counts, 'new');

    let enrichment = null;
    if (apiId || slug) {
      enrichment = await enrichLimiter.enrich(apiId ? { apiId } : { slug: slug as string });
      if (enrichment) bump(counts, 'enriched');
    }

    const normalized = normalizeLumaEvent({ vevent, timezone: tab.timezone, enrichment, calendar: calendarRef, fallbackSlug: slug });
    const contentHash = computeContentHash(normalized);

    if (normalized.lat == null && normalized.lng == null && normalized.address) {
      const geocoded = await geocodeAddressCached(supabase, normalized.address, tab.center, source.conference);
      if (geocoded) {
        normalized.lat = geocoded.lat;
        normalized.lng = geocoded.lng;
      }
    }

    const baseRow = {
      conference: source.conference,
      canonical_key: canonicalKey,
      alt_keys: slug ? [`luma:${slug.toLowerCase()}`] : [],
      source_id: source.id,
      source_kind: source.kind,
      sources: [{ source_id: source.id, kind: source.kind, ref: vevent.uid, seen_at: new Date().toISOString() }],
      source_ref: vevent.uid,
      event: normalized,
      content_hash: contentHash,
      ical_hash: stubHash,
    };

    // 1. Dedupe against the sheet (link, then fuzzy) and other candidates.
    const sheetMatch = findSheetMatchByLink(linkIndex, normalized);
    let duplicateOf: string | null = sheetMatch?.id ?? null;
    let possibleDuplicateOf: string | null = null;

    if (!duplicateOf) {
      for (const se of sheetEvents) {
        if (se.dateISO !== normalized.dateISO) continue;
        const fm = fuzzyMatch(normalized, { name: se.name, dateISO: se.dateISO, startTime: se.startTime, address: se.address, lat: se.lat, lng: se.lng }, source.conference);
        if (fm?.kind === 'duplicate') {
          duplicateOf = se.id;
          break;
        }
        if (fm?.kind === 'possible_duplicate') possibleDuplicateOf = se.id;
      }
    }
    if (!duplicateOf) {
      for (const oc of otherCandidates) {
        if (oc.id === existing?.id || oc.canonical_key === canonicalKey) continue;
        if (oc.event.dateISO !== normalized.dateISO) continue;
        const fm = fuzzyMatch(normalized, oc.event, source.conference);
        if (fm?.kind === 'duplicate') {
          duplicateOf = oc.id;
          break;
        }
        if (fm?.kind === 'possible_duplicate' && !possibleDuplicateOf) possibleDuplicateOf = oc.id;
      }
    }

    // Added to the in-run dedupe pool now that we've checked this candidate
    // against everything added so far — so a LATER event in the same feed
    // can still match against it, without this candidate matching itself
    // (review finding, LOW "dedupe within a single run").
    otherCandidates.push({ id: existing?.id ?? canonicalKey, canonical_key: canonicalKey, event: normalized });

    if (duplicateOf) {
      bump(counts, 'duplicates');
      await persist({ ...baseRow, status: 'duplicate' as CandidateStatus, duplicate_of: duplicateOf });
      continue;
    }

    // 2. Date-window + geo filters (no LLM call for filtered-out candidates).
    const windowCheck = dateWindowFilter(normalized, { startDate, endDate }, profile);
    let filterReason: string | null = windowCheck.pass ? null : windowCheck.reason;
    let noGeo = false;
    if (!filterReason) {
      const geoCheck = geoFilter(normalized, tab.center, { radius_km: profile.radius_km, allow_online: profile.allow_online });
      if (geoCheck.pass === 'no_geo') noGeo = true;
      else if (!geoCheck.pass) filterReason = geoCheck.reason;
    }

    if (filterReason) {
      bump(counts, 'filtered');
      await persist({ ...baseRow, status: 'filtered_out' as CandidateStatus, filter_reason: filterReason, possible_duplicate_of: possibleDuplicateOf });
      continue;
    }

    // 3. Budget guard (§5.5): stop classifying once the run/monthly cap hits;
    // remaining candidates wait as `pending_classify`, picked up next run.
    const budgetExceeded = budgetStatus.spentUsd + runningCostUsd >= budgetStatus.capUsd;
    if (budgetExceeded || llmCallsThisRun >= profile.max_llm_calls_per_run) {
      await persist({ ...baseRow, status: 'pending_classify' as CandidateStatus, possible_duplicate_of: possibleDuplicateOf });
      continue;
    }

    // Learned signals (from label history) are matched on the PRIMARY
    // ORGANIZER only, never co-hosts (review finding, MEDIUM item 6) — a
    // popular event's co-host list can include someone who only ever
    // appears once, and attributing a whole-conference trust/block
    // judgment to them from a single outcome is the wrong unit of
    // attribution. The explicit, admin-curated `profile.trusted_hosts`/
    // `blocked_hosts` lists (via `hostListMatches`) are unaffected — those
    // are deliberately entered per host/co-host by an admin.
    const isTrustedHost =
      hostListMatches(profile.trusted_hosts, normalized) ||
      normalized.hosts.some((h) => h.apiId && verifiedHostIds.has(h.apiId)) ||
      (organizerCounts.get(normalized.organizer.trim().toLowerCase()) ?? 0) >= 2 ||
      learnedHostSignalMatches(learnedHosts, 'trusted', [normalized.organizer]);
    // Explicit (admin-curated) vs. learned (inferred) blocked-host are kept
    // SEPARATE signals — only the explicit list hard-rejects. A learned
    // block is a statistical inference from past outcomes, not a deliberate
    // admin decision, so it must never outright kill a candidate on its
    // own; `signals.ts` instead applies a score penalty and caps the route
    // at review (review finding, MEDIUM item 6).
    const isBlockedHost = hostListMatches(profile.blocked_hosts, normalized);
    const isLearnedBlockedHost = learnedHostSignalMatches(learnedHosts, 'blocked', [normalized.organizer]);

    // Sponsor-name matching is scoped to host/organizer identity fields
    // only — NOT the event name or free-text description (review finding,
    // MEDIUM item 8): a sponsor's name merely being MENTIONED in a title or
    // description is far weaker evidence than it being the actual
    // host/organizer, and was the main source of false-positive risk for
    // short/common sponsor names.
    const sponsorText = [normalized.organizer, ...normalized.hosts.map((h) => h.name)].join(' ');
    const sponsorMatch = matchSponsorName(sponsorText, sponsorNames);

    let scoreResult;
    try {
      scoreResult = await scoreCandidate({
        client,
        profile: themeProfile,
        conference: { name: source.conference, city: null, startDate, endDate },
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
        fewShot,
        isTrustedCalendarSource: source.trust === 'curated',
        isTrustedHost,
        isBlockedHost,
        isLearnedBlockedHost,
        sponsorMatch,
        includeKeywords: profile.include_keywords,
        excludeKeywords: profile.exclude_keywords,
        possibleDuplicate: !!possibleDuplicateOf,
        noGeo,
        sourceTrust: source.trust,
        publishThreshold: profile.publish_threshold,
        reviewThreshold: profile.review_threshold,
      });
    } catch (err) {
      bump(counts, 'errors');
      // A schema-validation failure still bills tokens (OpenAI returned a
      // completion, it just didn't parse) — count that cost even though
      // the call "failed" (review finding, MEDIUM item 5). A request-level
      // failure (network/5xx) never got a completion, so there's nothing
      // to add there, and ClassifierError.usage is undefined.
      if (err instanceof ClassifierError && err.usage) {
        totalInputTokens += err.usage.inputTokens;
        totalOutputTokens += err.usage.outputTokens;
        runningCostUsd += estimateCostUsd(err.usage.model, err.usage.inputTokens, err.usage.outputTokens);
      }
      await persist({
        ...baseRow,
        status: 'error' as CandidateStatus,
        classify_attempts: (existing?.classify_attempts ?? 0) + 1,
        possible_duplicate_of: possibleDuplicateOf,
      });
      continue;
    }

    llmCallsThisRun++;
    bump(counts, 'classified');
    const callInputTokens = scoreResult.classifier.inputTokens;
    const callOutputTokens = scoreResult.classifier.outputTokens;
    totalInputTokens += callInputTokens;
    totalOutputTokens += callOutputTokens;
    runningCostUsd += estimateCostUsd(scoreResult.classifier.model, callInputTokens, callOutputTokens);

    let status: CandidateStatus;
    let sheetRow: number | null = null;
    let publishedAt: string | null = null;
    let autoPublishedAt: string | null = null;
    let publishedEventId: string | null = null;

    if (scoreResult.route === 'reject') {
      status = 'auto_rejected';
      bump(counts, 'rejected');
    } else if (!dryRun && scoreResult.route === 'publish' && profile.auto_publish_enabled && !publisher.capReached) {
      // Kill-switch re-check RIGHT BEFORE this specific publish attempt
      // (review finding, LOW item 10), not only once at the top of the
      // run — `profile` is the same object the whole loop reads, so
      // flipping it here immediately stops every later candidate in this
      // run too, not just this one. Gated behind `!publisher.capReached`
      // (review finding, LOW item "skip the kill-switch query when the
      // publish cap is already reached") — once the per-run publish cap
      // is hit, nothing more will publish this run regardless of what the
      // kill switch says, so there's no reason to spend a DB round trip
      // checking it.
      const kill = await checkAutoPublishKillSwitch(source.conference, { enabledAt: profile.auto_publish_enabled_at });
      if (kill.killed) profile.auto_publish_enabled = false;

      if (profile.auto_publish_enabled) {
        try {
          const row = toEventRow(normalized, scoreResult.classifier.output.suggested_tags);
          sheetRow = await publisher.publish(row);
          status = 'auto_published';
          publishedAt = new Date().toISOString();
          autoPublishedAt = publishedAt;
          sheetChanged = true;
          bump(counts, 'published');
          // Same id scheme the sheet (and the admin approve route) use —
          // not the internal canonical_key, which is an ingestion-only
          // identifier never seen by gviz/the sheet reader (review finding,
          // LOW item 3).
          publishedEventId = generateEventId(source.conference, normalized.sheetDate, normalized.startTime, normalized.name);
          // Reflect the new row in the link index immediately, so a later
          // event in this same feed that duplicates it (by link) is caught
          // by the sheet-match dedupe check, not re-published too (review
          // finding, LOW "dedupe within a single run").
          linkIndex.byKey.set(canonicalKey, { id: publishedEventId, link: normalized.link });
        } catch {
          status = 'queued';
          bump(counts, 'queued');
        }
      } else {
        status = 'queued';
        bump(counts, 'queued');
      }
    } else {
      status = 'queued';
      bump(counts, 'queued');
    }

    await persist({
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
      published_at: publishedAt,
      auto_published_at: autoPublishedAt,
      published_event_id: publishedEventId,
      sheet_row: sheetRow,
      possible_duplicate_of: possibleDuplicateOf,
    });
  }
  } finally {
    // Always runs, even if something above threw uncaught — a publish
    // that already happened must not leave the public read path (cached
    // `fetchEventsCached`) stale just because a later candidate in the
    // same run blew up (review finding, LOW "invalidateEventsCache in a
    // finally block").
    if (sheetChanged) invalidateEventsCache();
  }

  if (hitDeadline) {
    return { llmInputTokens: totalInputTokens, llmOutputTokens: totalOutputTokens, costUsd: runningCostUsd, hitDeadline: true };
  }

  if (!dryRun) await reconcileConference(tab, profile.theme_key, sheetEvents, linkIndex);

  return {
    llmInputTokens: totalInputTokens,
    llmOutputTokens: totalOutputTokens,
    costUsd: runningCostUsd,
    hitDeadline: false,
    previews: dryRun ? previews : undefined,
  };
}
