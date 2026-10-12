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
  recordRunXCost,
} from './db';
import { fetchLumaIcalFeed, toIcalCandidates } from './sources/luma-ical';
import { fetchTelegramChannelHtml, parseTelegramChannelHtml, isValidTelegramHandle } from './sources/telegram';
import { isXConfigured, fetchXUserPosts, X_POST_READ_COST_USD, MAX_RESULTS_PER_ACCOUNT_PER_RUN, X_MAX_PAGES_PER_RUN, type XPostsPage } from './sources/x';
import { isMeetupConfigured, searchMeetupEvents } from './sources/meetup';
import { resolveSponsorPageUrls, fetchSponsorPageLinks, createRobotsCache, SPONSOR_PAGE_WORST_CASE_MS } from './sources/sponsor-pages';
import { isAllowlistedEventLink } from './allowlist';
import { normalizeLumaEvent, computeContentHash } from './normalize';
import { buildSheetLinkIndex, findSheetMatchByLink, fuzzyMatch, type DedupeCandidatePool } from './dedupe';
import { dateWindowFilter, geoFilter, isPastEvent, geocodeAddressCached } from './filters';
import { LumaEnrichmentLimiter } from './enrich';
import { scoreCandidate } from './scoring';
import { processDiscoveredLink, PacedLinkLimiter, buildHostSignalComputer } from './discover';
import { checkMonthlyBudget, checkMonthlyXBudget } from './budget';
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
  type SourceKind,
} from './types';

function bump(counts: RunCounts, key: keyof RunCounts, by = 1) {
  counts[key] = (counts[key] ?? 0) + by;
}

/** Re-review (this round): a shared, mutable LLM cost/token accumulator,
 *  owned by `runSource` and passed into every process*Source function
 *  (including Telegram and Luma, which predate this and had their own
 *  equivalent local variables). Every classify call's cost/tokens are
 *  added here IMMEDIATELY, in the same statement that currently also adds
 *  them to a function-local running total — so if the function throws
 *  later (a dedupe/network/DB call failing on a LATER candidate), this
 *  object still reflects every classify call that already succeeded, and
 *  `runSource`'s `catch` block can read it directly instead of losing
 *  that cost entirely. */
interface CostAccumulator {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
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
  // Re-review (this round): a SHARED, mutable accumulator — not separate
  // `let`s only ever assigned from a successful process*Source return —
  // so that cost/tokens a source accumulated BEFORE throwing partway
  // through (e.g. it classified and billed 5 candidates, then the 6th's
  // dedupe call threw) are still visible in the `catch` block below,
  // instead of being silently lost because the assignment from `result.*`
  // never happened. Every process*Source function (incl. Telegram, which
  // predates the X/Meetup/sponsor-pages helpers but has the exact same
  // "accumulate locally, only surface it in the return value" shape) now
  // mutates THIS object in place as it goes, via `commonArgs.costAcc`.
  const costAcc: CostAccumulator = { inputTokens: 0, outputTokens: 0, costUsd: 0 };

  try {
    // `host_submission` sources are passive — created lazily by `POST
    // /api/host/submissions`, never polled. An admin clicking "Run now" on
    // one (it shows up in the Config tab's Sources list like any other
    // source, so it can be disabled there) has nothing to actually run.
    if (source.kind === 'host_submission') {
      if (!opts.dryRun) await updateSource(sourceId, { last_run_at: new Date().toISOString(), last_status: 'skipped' });
      await finishRun(run.id, {
        status: 'skipped',
        counts,
        error: 'host_submission sources are passive (fed by POST /api/host/submissions) — nothing to run.',
      });
      return { runId: run.id, status: 'skipped', counts };
    }
    const IMPLEMENTED_KINDS = ['luma_ical', 'telegram_channel', 'x_account', 'meetup_search', 'sponsor_pages'] as const;
    if (!(IMPLEMENTED_KINDS as readonly string[]).includes(source.kind)) {
      throw new Error(`Source kind "${source.kind}" is not implemented until a later phase.`);
    }

    // Phase 4 (§Phase 4 items 1/3): X and Meetup are OFF unless their
    // credentials are configured — skip cleanly (not an error) so the
    // admin Log/Config UI shows "not configured"/"requires Meetup Pro"
    // rather than a scary red error on every due run. Sponsor pages needs
    // no credentials, so it's never skipped here.
    if (source.kind === 'x_account' && !isXConfigured()) {
      if (!opts.dryRun) await updateSource(sourceId, { last_run_at: new Date().toISOString(), last_status: 'skipped' });
      await finishRun(run.id, { status: 'skipped', counts, error: 'X is not configured (X_BEARER_TOKEN is not set).' });
      return { runId: run.id, status: 'skipped', counts };
    }
    if (source.kind === 'meetup_search' && !isMeetupConfigured()) {
      if (!opts.dryRun) await updateSource(sourceId, { last_run_at: new Date().toISOString(), last_status: 'skipped' });
      await finishRun(run.id, { status: 'skipped', counts, error: 'Meetup is not configured — requires Meetup Pro OAuth credentials.' });
      return { runId: run.id, status: 'skipped', counts };
    }

    const profile = await getProfile(source.conference);
    if (!profile || !profile.enabled) {
      if (!opts.dryRun) await updateSource(sourceId, { last_run_at: new Date().toISOString(), last_status: 'skipped' });
      await finishRun(run.id, { status: 'skipped', counts, error: 'No enabled ingest profile for this conference.' });
      return { runId: run.id, status: 'skipped', counts };
    }

    // Phase 2 kill switch (`gate.ts`): re-checked just before each actual
    // auto-publish attempt inside `processLumaIcalSource`, not only once
    // here at the top of the run (review finding, LOW item 10) — a
    // conference that goes bad mid-run stops publishing partway through,
    // not only on the next run. (Telegram/host-submission sources never
    // publish at all, so this doesn't apply to them — §10 item 4.)

    const allTabs = await getAllConferenceTabs();
    const tab = allTabs.find((t) => t.name === source.conference);
    if (!tab) throw new Error(`No conference tab found for "${source.conference}".`);

    const commonArgs = { source, profile, tab, deadlineMs: opts.deadlineMs, counts, dryRun: opts.dryRun, costAcc };
    const result =
      source.kind === 'luma_ical'
        ? await processLumaIcalSource(commonArgs)
        : source.kind === 'telegram_channel'
          ? await processTelegramSource(commonArgs)
          : source.kind === 'x_account'
            // `runId` is threaded through so `processXSource` can record X
            // spend itself, in a `finally`, right after the paid read(s) —
            // see its doc comment (re-review item 2) — rather than this
            // function recording it only after the WHOLE source finished
            // without throwing, which would lose track of money already
            // spent on a run that errors partway through processing.
            ? await processXSource({ ...commonArgs, runId: run.id })
            : source.kind === 'meetup_search'
              ? await processMeetupSource(commonArgs)
              : await processSponsorPagesSource(commonArgs);

    if (!opts.dryRun) await updateSource(sourceId, { last_run_at: new Date().toISOString(), last_status: 'ok', last_error: null });
    await finishRun(run.id, {
      status: result.hitDeadline ? 'partial' : 'ok',
      counts,
      llm_input_tokens: costAcc.inputTokens,
      llm_output_tokens: costAcc.outputTokens,
      est_cost_usd: costAcc.costUsd,
    });
    return { runId: run.id, status: result.hitDeadline ? 'partial' : 'ok', counts, previews: result.previews };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!opts.dryRun) await updateSource(sourceId, { last_run_at: new Date().toISOString(), last_status: 'error', last_error: message });
    // Re-review (this round, HIGH-adjacent fix): read `costAcc` here too —
    // whatever classification cost the source accumulated BEFORE it threw
    // is still in there (every process*Source function mutates it in
    // place as it goes, not only on a successful return), so a run that
    // errors out partway through no longer reports $0/0 tokens for work
    // it genuinely already paid for.
    await finishRun(run.id, {
      status: 'error',
      counts,
      llm_input_tokens: costAcc.inputTokens,
      llm_output_tokens: costAcc.outputTokens,
      est_cost_usd: costAcc.costUsd,
      error: message,
    });
    return { runId: run.id, status: 'error', counts, error: message };
  }
}

async function processLumaIcalSource(args: {
  source: Awaited<ReturnType<typeof getSource>>;
  profile: IngestProfileRow;
  tab: TabConfig;
  deadlineMs?: number;
  counts: RunCounts;
  dryRun?: boolean;
  costAcc: CostAccumulator;
}): Promise<{ llmInputTokens: number; llmOutputTokens: number; costUsd: number; hitDeadline: boolean; previews?: CandidatePreview[] }> {
  const { profile, tab, counts, dryRun, costAcc } = args;
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
        const failedCallCostUsd = estimateCostUsd(err.usage.model, err.usage.inputTokens, err.usage.outputTokens);
        runningCostUsd += failedCallCostUsd;
        // Re-review (this round): mirrored into the shared accumulator
        // immediately, not just the local — see `CostAccumulator`'s doc
        // comment (`runSource`'s `catch` block reads this directly).
        costAcc.inputTokens += err.usage.inputTokens;
        costAcc.outputTokens += err.usage.outputTokens;
        costAcc.costUsd += failedCallCostUsd;
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
    const callCostUsd = estimateCostUsd(scoreResult.classifier.model, callInputTokens, callOutputTokens);
    totalInputTokens += callInputTokens;
    totalOutputTokens += callOutputTokens;
    runningCostUsd += callCostUsd;
    // Re-review (this round): mirrored into the shared accumulator
    // immediately — see `CostAccumulator`'s doc comment.
    costAcc.inputTokens += callInputTokens;
    costAcc.outputTokens += callOutputTokens;
    costAcc.costUsd += callCostUsd;

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

/**
 * Phase 3 Telegram source (plans/event-ingestion.md §3.4/§7): poll
 * `https://t.me/s/<handle>` once, extract links from the latest posts, and
 * run every ALLOWLISTED link (Luma/Partiful/Eventbrite/Meetup/Posh — §10)
 * through the shared discovered-link engine (`discover.ts`). Telegram is
 * always `discovery` trust (enforced when the source is created — the
 * admin Config API never lets a `telegram_channel` source be anything
 * else), so nothing this produces can ever auto-publish (§10 item 4,
 * enforced independently inside `discover.ts` too — belt and suspenders).
 */
async function processTelegramSource(args: {
  source: Awaited<ReturnType<typeof getSource>>;
  profile: IngestProfileRow;
  tab: TabConfig;
  deadlineMs?: number;
  counts: RunCounts;
  dryRun?: boolean;
  costAcc: CostAccumulator;
}): Promise<{ llmInputTokens: number; llmOutputTokens: number; costUsd: number; hitDeadline: boolean; previews?: CandidatePreview[] }> {
  const { profile, tab, counts, dryRun, costAcc } = args;
  const source = args.source!;
  const deadline = Date.now() + (args.deadlineMs ?? 240_000);
  const previews: CandidatePreview[] = [];

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

  const handle = (source.config as { handle?: string }).handle;
  if (!handle || !isValidTelegramHandle(handle)) throw new Error('Source is missing a valid Telegram handle.');

  const html = await fetchTelegramChannelHtml(handle);
  const messages = parseTelegramChannelHtml(html);
  bump(counts, 'fetched', messages.length);

  const budgetStatus = await checkMonthlyBudget();
  let runningCostUsd = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let llmCallsThisRun = 0;

  // Same shared-clock rationale as the Luma iCal path (review finding,
  // MEDIUM item 7): one enrichment limiter for both event enrichment AND
  // sheet-link slug resolution.
  const enrichLimiter = new LumaEnrichmentLimiter(100, 1000);
  const linkFetchLimiter = new PacedLinkLimiter(30, 500);
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
  const otherCandidates: DedupeCandidatePool[] = (await listRecentCandidatesForDedupe(source.conference)).map((c) => ({
    id: c.id,
    canonical_key: c.canonical_key,
    event: c.event,
  }));

  const organizerCounts = new Map<string, number>();
  for (const e of sheetEvents) {
    const key = e.organizer.trim().toLowerCase();
    if (!key) continue;
    organizerCounts.set(key, (organizerCounts.get(key) ?? 0) + 1);
  }
  const { data: verifiedHosts } = await supabase.from('verified_luma_hosts').select('host_api_id').is('revoked_at', null);
  const verifiedHostIds = new Set((verifiedHosts ?? []).map((h: { host_api_id: string }) => h.host_api_id));

  const { fewShot, learnedHosts } = await loadLearningContext({ conference: source.conference, themeKey: profile.theme_key });
  const sponsorNames = await getSponsorNamesForConference(source.conference);

  const computeHostSignals = buildHostSignalComputer({ profile, verifiedHostIds, organizerCounts, learnedHosts });

  // Reads the current (mutable) counters at CALL time, not a frozen
  // snapshot — correct as a closure since it's only ever invoked, never
  // itself reassigned, while the loop below updates `runningCostUsd`/
  // `llmCallsThisRun` in place.
  const canClassify = () => budgetStatus.spentUsd + runningCostUsd < budgetStatus.capUsd && llmCallsThisRun < profile.max_llm_calls_per_run;

  let hitDeadline = false;

  outer: for (const message of messages) {
    if (Date.now() > deadline) {
      hitDeadline = true;
      break;
    }
    const links = Array.from(new Set(message.links)).filter(isAllowlistedEventLink);
    for (const url of links) {
      if (Date.now() > deadline) {
        hitDeadline = true;
        break outer;
      }

      const cheapKey = normalizeEventLink(url);
      const existing = cheapKey ? await getCandidateByKey(source.conference, cheapKey) : null;

      const outcome = await processDiscoveredLink(url, existing, {
        conference: source.conference,
        tab,
        profile,
        themeProfile,
        client,
        supabase,
        sourceId: source.id,
        sourceKind: 'telegram_channel',
        sourceTrust: source.trust,
        sourceRef: message.url,
        enrichLimiter,
        linkFetchLimiter,
        linkIndex,
        sheetEvents,
        otherCandidates,
        fewShot,
        sponsorNames,
        computeHostSignals,
        canClassify,
      });

      if (outcome.kind === 'invalid') {
        bump(counts, 'errors');
        continue;
      }
      if (outcome.kind === 'skipped_final') {
        bump(counts, 'skipped_final');
        if (!dryRun && existing) {
          await upsertCandidate({
            conference: source.conference,
            canonical_key: existing.canonical_key,
            sources: [{ source_id: source.id, kind: 'telegram_channel' as const, ref: message.url, seen_at: new Date().toISOString() }],
          });
        }
        continue;
      }
      if (outcome.kind === 'unchanged') {
        bump(counts, 'unchanged');
        if (!dryRun) await updateCandidate(outcome.existingId, { last_seen_at: new Date().toISOString() });
        continue;
      }
      if (outcome.kind === 'protected') {
        // Review finding, MEDIUM item 4: a higher-trust candidate (most
        // likely a curated Luma-calendar candidate this Telegram link
        // also happens to resolve to) — append our source ref, bump
        // `last_seen_at`, and touch nothing else.
        bump(counts, 'skipped_final');
        if (!dryRun) await updateCandidate(outcome.existingId, { sources: outcome.sources, last_seen_at: new Date().toISOString() });
        continue;
      }

      // outcome.kind === 'row'
      bump(counts, 'new');
      totalInputTokens += outcome.inputTokens;
      totalOutputTokens += outcome.outputTokens;
      runningCostUsd += outcome.costUsd;
      // Re-review (this round): mirrored into the shared accumulator
      // immediately — see `CostAccumulator`'s doc comment.
      costAcc.inputTokens += outcome.inputTokens;
      costAcc.outputTokens += outcome.outputTokens;
      costAcc.costUsd += outcome.costUsd;
      if (outcome.classified) {
        llmCallsThisRun++;
        bump(counts, 'classified');
      }
      if (outcome.row.status === 'duplicate') bump(counts, 'duplicates');
      else if (outcome.row.status === 'filtered_out') bump(counts, 'filtered');
      else if (outcome.row.status === 'auto_rejected') bump(counts, 'rejected');
      else if (outcome.row.status === 'queued') bump(counts, 'queued');
      else if (outcome.row.status === 'error') bump(counts, 'errors');

      await persist(outcome.row as Record<string, unknown> & { conference: string; canonical_key: string; status: CandidateStatus; event: NormalizedEvent });
      // Same in-run dedupe pool growth as the Luma iCal loop (review
      // finding, LOW "dedupe within a single run") — a later link in the
      // SAME (or a later message in this same) run can still match against
      // it.
      otherCandidates.push({
        id: existing?.id ?? outcome.row.canonical_key,
        canonical_key: outcome.row.canonical_key,
        event: outcome.row.event,
      });
    }
  }

  return { llmInputTokens: totalInputTokens, llmOutputTokens: totalOutputTokens, costUsd: runningCostUsd, hitDeadline };
}

/* ------------------------------------------------------------------ */
/* Phase 4 (plan §Phase 4): X, Meetup and sponsor-page sources. All three */
/* are ALWAYS discovery trust (never auto-publish — enforced again here */
/* even though `source.trust` is already forced to 'discovery' when the  */
/* admin config route creates one of these, same belt-and-suspenders    */
/* posture `discover.ts`/`scoring.ts` already apply) and all three just  */
/* turn "a batch of raw items" into a list of candidate URLs, then hand   */
/* every allowlisted one to the SAME shared engine Telegram uses          */
/* (`processDiscoveredLink`) — so only the setup/fetch step below is new; */
/* dedupe, filters, classification and routing are unchanged.            */
/* ------------------------------------------------------------------ */

interface DiscoverySourceRunContext {
  enrichLimiter: LumaEnrichmentLimiter;
  linkFetchLimiter: PacedLinkLimiter;
  themeProfile: ReturnType<typeof profileRowToThemeProfile>;
  client: OpenAI;
  supabase: ReturnType<typeof getIngestSupabase>;
  sheetEvents: Awaited<ReturnType<typeof fetchEvents>>;
  linkIndex: Awaited<ReturnType<typeof buildSheetLinkIndex>>;
  otherCandidates: DedupeCandidatePool[];
  fewShot: Awaited<ReturnType<typeof loadLearningContext>>['fewShot'];
  sponsorNames: string[];
  computeHostSignals: ReturnType<typeof buildHostSignalComputer>;
}

/** Shared per-run setup every discovery source (Telegram inline above;
 *  X/Meetup/sponsor-pages here) needs before it can call
 *  `processDiscoveredLink` — one Luma enrichment limiter + sheet link
 *  index + dedupe pool + learning context + sponsor names + host-signal
 *  computer, built ONCE per run and reused for every item the source's own
 *  fetch step produces. */
async function buildDiscoverySourceContext(
  source: Awaited<ReturnType<typeof getSource>>,
  profile: IngestProfileRow,
  tab: TabConfig
): Promise<DiscoverySourceRunContext> {
  const src = source!;
  const enrichLimiter = new LumaEnrichmentLimiter(100, 1000);
  const linkFetchLimiter = new PacedLinkLimiter(30, 500);
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
  const otherCandidates: DedupeCandidatePool[] = (await listRecentCandidatesForDedupe(src.conference)).map((c) => ({
    id: c.id,
    canonical_key: c.canonical_key,
    event: c.event,
  }));

  const organizerCounts = new Map<string, number>();
  for (const e of sheetEvents) {
    const key = e.organizer.trim().toLowerCase();
    if (!key) continue;
    organizerCounts.set(key, (organizerCounts.get(key) ?? 0) + 1);
  }
  const { data: verifiedHosts } = await supabase.from('verified_luma_hosts').select('host_api_id').is('revoked_at', null);
  const verifiedHostIds = new Set((verifiedHosts ?? []).map((h: { host_api_id: string }) => h.host_api_id));

  const { fewShot, learnedHosts } = await loadLearningContext({ conference: src.conference, themeKey: profile.theme_key });
  const sponsorNames = await getSponsorNamesForConference(src.conference);
  const computeHostSignals = buildHostSignalComputer({ profile, verifiedHostIds, organizerCounts, learnedHosts });

  return { enrichLimiter, linkFetchLimiter, themeProfile, client, supabase, sheetEvents, linkIndex, otherCandidates, fewShot, sponsorNames, computeHostSignals };
}

interface DiscoverySourceLoopResult {
  llmInputTokens: number;
  llmOutputTokens: number;
  costUsd: number;
  hitDeadline: boolean;
  previews?: CandidatePreview[];
}

/** Re-review item (cleanup): the three Phase 4 source processors below each
 *  had their own byte-for-byte copy of this closure — pulled into one
 *  helper. (`processLumaIcalSource`/`processTelegramSource` above predate
 *  this helper and keep their own inline versions, unchanged, to minimize
 *  the diff on already-shipped, already-reviewed code.) */
function makeDiscoveryPersist(
  dryRun: boolean | undefined,
  previews: CandidatePreview[]
): (row: Record<string, unknown> & { conference: string; canonical_key: string; status: CandidateStatus; event: NormalizedEvent }) => Promise<void> {
  return async (row) => {
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
  };
}

/** True if at least one URL in `urls` is on an allowlisted event platform —
 *  used to skip `buildDiscoverySourceContext` entirely (re-review item 4)
 *  when a source's raw fetch step found nothing worth processing this run,
 *  since that context build does several DB/network round trips (sheet
 *  events, link index, verified hosts, learning context, sponsor names)
 *  that are wasted work when there's nothing to run them for. */
function hasAnyAllowlistedLink(urls: string[]): boolean {
  return urls.some((u) => isAllowlistedEventLink(u));
}

/**
 * Feed a batch of already-extracted, not-yet-allowlist-filtered URLs
 * through `processDiscoveredLink`, one at a time, honoring the deadline and
 * budget — the common tail every Phase 4 discovery source (and Telegram,
 * inlined above instead of calling this, since it predates this helper)
 * shares. `sourceRef(url)` lets a caller attach per-URL provenance (a tweet
 * id, a Meetup node id, the sponsor page it came from).
 *
 * Re-review item 1 (HIGH, previous round) / re-review (this round, "persist
 * LLM cost on a thrown batch"): callers pass in `args.costAcc` — the SAME
 * shared `CostAccumulator` `runSource` holds — and MUST surface its final
 * `.inputTokens`/`.outputTokens`/`.costUsd` as the source's own
 * `llmInputTokens`/`llmOutputTokens`/`costUsd` on a normal return. This
 * function mutates `costAcc` in place per candidate rather than returning
 * a value itself, specifically so a LATER candidate throwing still leaves
 * every EARLIER candidate's already-billed cost visible to `runSource`'s
 * `catch` block, which reads the same object directly.
 */
async function runDiscoveredLinksBatch(
  urls: string[],
  args: {
    source: Awaited<ReturnType<typeof getSource>>;
    profile: IngestProfileRow;
    tab: TabConfig;
    sourceKind: SourceKind;
    sourceRef: (url: string) => string | null;
    ctx: DiscoverySourceRunContext;
    counts: RunCounts;
    dryRun?: boolean;
    deadline: number;
    persist: (row: Record<string, unknown> & { conference: string; canonical_key: string; status: CandidateStatus; event: NormalizedEvent }) => Promise<void>;
    budgetStatus: { spentUsd: number; capUsd: number };
    /** Re-review (this round): the SAME shared accumulator `runSource`
     *  holds a reference to — mutated here immediately per candidate, not
     *  just via a local-to-the-caller ref, so cost already spent before a
     *  later candidate's processing throws is never lost. Also the single
     *  source of truth `canClassify` reads for the running total, so the
     *  cap calculation and the externally-visible recorded cost can never
     *  drift apart. */
    costAcc: CostAccumulator;
    llmCallsThisRunRef: { value: number };
  }
): Promise<{ hitDeadline: boolean }> {
  const src = args.source!;
  const canClassify = () =>
    args.budgetStatus.spentUsd + args.costAcc.costUsd < args.budgetStatus.capUsd &&
    args.llmCallsThisRunRef.value < args.profile.max_llm_calls_per_run;

  const allowlisted = Array.from(new Set(urls)).filter(isAllowlistedEventLink);
  for (const url of allowlisted) {
    if (Date.now() > args.deadline) return { hitDeadline: true };

    const cheapKey = normalizeEventLink(url);
    const existing = cheapKey ? await getCandidateByKey(src.conference, cheapKey) : null;

    const outcome = await processDiscoveredLink(url, existing, {
      conference: src.conference,
      tab: args.tab,
      profile: args.profile,
      themeProfile: args.ctx.themeProfile,
      client: args.ctx.client,
      supabase: args.ctx.supabase,
      sourceId: src.id,
      sourceKind: args.sourceKind,
      sourceTrust: 'discovery', // Phase 4 item 1/2/3: X/Meetup/sponsor pages never auto-publish.
      sourceRef: args.sourceRef(url),
      enrichLimiter: args.ctx.enrichLimiter,
      linkFetchLimiter: args.ctx.linkFetchLimiter,
      linkIndex: args.ctx.linkIndex,
      sheetEvents: args.ctx.sheetEvents,
      otherCandidates: args.ctx.otherCandidates,
      fewShot: args.ctx.fewShot,
      sponsorNames: args.ctx.sponsorNames,
      computeHostSignals: args.ctx.computeHostSignals,
      canClassify,
    });

    if (outcome.kind === 'invalid') {
      bump(args.counts, 'errors');
      continue;
    }
    if (outcome.kind === 'skipped_final') {
      bump(args.counts, 'skipped_final');
      if (!args.dryRun && existing) {
        await upsertCandidate({
          conference: src.conference,
          canonical_key: existing.canonical_key,
          sources: [{ source_id: src.id, kind: args.sourceKind, ref: args.sourceRef(url), seen_at: new Date().toISOString() }],
        });
      }
      continue;
    }
    if (outcome.kind === 'unchanged') {
      bump(args.counts, 'unchanged');
      if (!args.dryRun) await updateCandidate(outcome.existingId, { last_seen_at: new Date().toISOString() });
      continue;
    }
    if (outcome.kind === 'protected') {
      bump(args.counts, 'skipped_final');
      if (!args.dryRun) await updateCandidate(outcome.existingId, { sources: outcome.sources, last_seen_at: new Date().toISOString() });
      continue;
    }

    // outcome.kind === 'row'
    bump(args.counts, 'new');
    args.costAcc.inputTokens += outcome.inputTokens;
    args.costAcc.outputTokens += outcome.outputTokens;
    args.costAcc.costUsd += outcome.costUsd;
    if (outcome.classified) {
      args.llmCallsThisRunRef.value++;
      bump(args.counts, 'classified');
    }
    if (outcome.row.status === 'duplicate') bump(args.counts, 'duplicates');
    else if (outcome.row.status === 'filtered_out') bump(args.counts, 'filtered');
    else if (outcome.row.status === 'auto_rejected') bump(args.counts, 'rejected');
    else if (outcome.row.status === 'queued') bump(args.counts, 'queued');
    else if (outcome.row.status === 'error') bump(args.counts, 'errors');

    await args.persist(outcome.row as Record<string, unknown> & { conference: string; canonical_key: string; status: CandidateStatus; event: NormalizedEvent });
    args.ctx.otherCandidates.push({
      id: existing?.id ?? outcome.row.canonical_key,
      canonical_key: outcome.row.canonical_key,
      event: outcome.row.event,
    });
  }
  return { hitDeadline: false };
}

/**
 * Phase 4 item 1 (§3.7/§7): one curated X account per run, paginated via
 * `GET /2/users/:id/tweets` with a `since_id` cursor (so a post is read
 * only once — item 1's requirement) and, within this run, a
 * `pagination_token` (re-review item 5) up to `X_MAX_PAGES_PER_RUN` pages,
 * extracting outbound links and feeding every allowlisted one through the
 * shared discovery engine. The monthly X-spend cap (`checkMonthlyXBudget`)
 * is checked BEFORE any API call, not after — once exceeded, the run makes
 * no further X calls at all this month (not even a cheap one), same
 * fail-closed posture as the LLM budget.
 */
async function processXSource(args: {
  source: Awaited<ReturnType<typeof getSource>>;
  profile: IngestProfileRow;
  tab: TabConfig;
  deadlineMs?: number;
  counts: RunCounts;
  dryRun?: boolean;
  /** Re-review item 2: threaded through so X spend can be recorded right
   *  after the paid read(s), in a `finally`, rather than only after this
   *  whole function returns successfully. */
  runId: string;
  costAcc: CostAccumulator;
}): Promise<DiscoverySourceLoopResult> {
  const { profile, tab, counts, dryRun, runId, costAcc } = args;
  const source = args.source!;
  const deadline = Date.now() + (args.deadlineMs ?? 240_000);
  const previews: CandidatePreview[] = [];
  const persist = makeDiscoveryPersist(dryRun, previews);

  const config = source.config as { handle?: string; userId?: string };
  if (!config.userId) throw new Error('X source is missing a resolved userId (re-add the account).');
  const cursor = (source.cursor as { since_id?: string } | null) ?? {};

  const xBudget = await checkMonthlyXBudget();
  if (xBudget.exceeded) {
    return { llmInputTokens: 0, llmOutputTokens: 0, costUsd: 0, hitDeadline: false, previews: dryRun ? previews : undefined };
  }

  // Re-review item 5: paginate up to X_MAX_PAGES_PER_RUN pages of
  // MAX_RESULTS_PER_ACCOUNT_PER_RUN posts each — EXCEPT on this source's
  // very first run (no `since_id` cursor yet at all), where we read only
  // ONE page and never backfill through an account's whole history
  // (re-review item "first run with no cursor: read one page and set the
  // cursor, no backfill"). A source that's run before always gets the
  // full per-run page budget.
  const isFirstRunEver = !cursor.since_id;
  const pageLimit = isFirstRunEver ? 1 : X_MAX_PAGES_PER_RUN;
  const pages: XPostsPage[] = [];
  let paginationToken: string | undefined;
  let totalPostsRead = 0;
  try {
    for (let i = 0; i < pageLimit; i++) {
      const page = await fetchXUserPosts(config.userId, {
        sinceId: cursor.since_id ?? null,
        maxResults: MAX_RESULTS_PER_ACCOUNT_PER_RUN,
        paginationToken,
      });
      pages.push(page);
      totalPostsRead += page.resultCount;
      const exhausted = page.resultCount < MAX_RESULTS_PER_ACCOUNT_PER_RUN || !page.nextToken;
      if (exhausted) break;
      paginationToken = page.nextToken ?? undefined;
    }
  } finally {
    // Re-review item 2 (MEDIUM): recorded here, in a `finally`, right
    // after the paid read(s) complete (successfully or not) — so a
    // failure anywhere in the dedupe/classify/persist processing below
    // never loses track of money ALREADY spent on page reads that DID
    // succeed before it. `recordRunXCost` itself degrades gracefully if
    // the Phase 4 migration hasn't landed yet, and is a no-op for
    // `totalPostsRead === 0` (e.g. the very first page threw before
    // reading anything).
    if (totalPostsRead > 0) {
      await recordRunXCost(runId, { xPostsRead: totalPostsRead, xCostUsd: totalPostsRead * X_POST_READ_COST_USD });
    }
  }
  bump(counts, 'fetched', totalPostsRead);

  const linksByUrl = new Map<string, string>(); // url -> tweet permalink, for sourceRef
  for (const page of pages) {
    for (const post of page.posts) {
      for (const link of post.links) {
        if (!linksByUrl.has(link)) linksByUrl.set(link, `https://x.com/i/status/${post.id}`);
      }
    }
  }
  const candidateUrls = Array.from(linksByUrl.keys());
  // Pages are newest-first, so the FIRST page's `newestId` is the true
  // overall newest post this query saw, regardless of how many pages we
  // went on to read.
  const newestIdThisRun = pages[0]?.newestId ?? null;

  /** Re-review (HIGH, this round — "the X cursor can get stuck"): advance
   *  `since_id` to `newestIdThisRun`, unless `dryRun` or there's nothing
   *  to advance to. Called from every non-deadline exit path below so an
   *  account whose recent posts simply have no allowlisted links (the
   *  common case — most posts aren't event links) still makes forward
   *  progress every run, instead of re-reading (and re-billing) the exact
   *  same window forever. Also covers a per-run page cap: we now advance
   *  all the way to the newest post and ACCEPT the gap (any older, still
   *  unread posts within this query are simply never revisited) rather
   *  than freezing the cursor — simpler, and the gap is bounded by
   *  X_MAX_PAGES_PER_RUN's own page budget, not unbounded. The ONLY case
   *  that must still leave the cursor untouched is a run the DEADLINE cut
   *  short (checked by callers, not here) — there, posts were read and
   *  their links may genuinely still be sitting unprocessed, so the next
   *  run needs the SAME `since_id` to pick them back up. */
  async function advanceCursor(): Promise<void> {
    if (dryRun || !newestIdThisRun) return;
    await updateSource(source.id, { cursor: { since_id: newestIdThisRun } });
  }

  // Re-review item 4 (deadline already passed before we even started
  // processing links): advance the cursor is NOT safe here — we read
  // posts and found links, but never attempted to process any of them,
  // so the next run must retry from the SAME since_id (the one case that
  // may leave the cursor unadvanced).
  if (Date.now() > deadline) {
    return { llmInputTokens: 0, llmOutputTokens: 0, costUsd: 0, hitDeadline: true, previews: dryRun ? previews : undefined };
  }

  // Re-review item 4: skip the (expensive) discovery-context build when
  // there's nothing allowlisted to process — but STILL advance the
  // cursor (this round's HIGH fix): no links to process means nothing
  // was left unprocessed, so there's no risk in moving forward.
  if (!hasAnyAllowlistedLink(candidateUrls)) {
    await advanceCursor();
    return { llmInputTokens: 0, llmOutputTokens: 0, costUsd: 0, hitDeadline: false, previews: dryRun ? previews : undefined };
  }

  const budgetStatus = await checkMonthlyBudget();
  const ctx = await buildDiscoverySourceContext(source, profile, tab);

  // Re-review item 1 (HIGH, previous round) / re-review (this round,
  // "persist LLM cost on a thrown batch"): `costAcc` is the SAME object
  // `runSource` holds — mutated per-candidate inside
  // `runDiscoveredLinksBatch`, so it reflects every classify call that
  // succeeded even if a LATER candidate's processing throws and this
  // function never reaches its own `return` below.
  const llmCallsThisRunRef = { value: 0 };
  const { hitDeadline } = await runDiscoveredLinksBatch(candidateUrls, {
    source,
    profile,
    tab,
    sourceKind: 'x_account',
    sourceRef: (url) => linksByUrl.get(url) ?? null,
    ctx,
    counts,
    dryRun,
    deadline,
    persist,
    budgetStatus,
    costAcc,
    llmCallsThisRunRef,
  });

  // Only a deadline hit DURING batch processing still withholds the
  // advance (see `advanceCursor`'s doc comment) — a capped page read is
  // no longer one of those cases.
  if (!hitDeadline) await advanceCursor();

  return {
    llmInputTokens: costAcc.inputTokens,
    llmOutputTokens: costAcc.outputTokens,
    costUsd: costAcc.costUsd,
    hitDeadline,
    previews: dryRun ? previews : undefined,
  };
}

/**
 * Phase 4 item 3 (§3.3/§7): Meetup `eventSearch` by keyword, centered on
 * the conference's own location and date window, mapped through the
 * EXISTING `parseMeetup` extractor (via `processDiscoveredLink`'s
 * allowlist — meetup.com is already allowlisted) rather than a second
 * Meetup normalizer, per the plan.
 */
async function processMeetupSource(args: {
  source: Awaited<ReturnType<typeof getSource>>;
  profile: IngestProfileRow;
  tab: TabConfig;
  deadlineMs?: number;
  counts: RunCounts;
  dryRun?: boolean;
  costAcc: CostAccumulator;
}): Promise<DiscoverySourceLoopResult> {
  const { profile, tab, counts, dryRun, costAcc } = args;
  const source = args.source!;
  const deadline = Date.now() + (args.deadlineMs ?? 240_000);
  const previews: CandidatePreview[] = [];
  const persist = makeDiscoveryPersist(dryRun, previews);

  const config = source.config as { query?: string; radius_mi?: number };
  if (!config.query) throw new Error('Meetup source is missing a search query.');
  const radiusMi = config.radius_mi ?? Math.max(1, Math.round(profile.radius_km * 0.621371));

  // Re-review item 6: a GraphQL `errors` array or invalid JSON now THROWS
  // out of `searchMeetupEvents` (instead of silently returning []), so a
  // schema-drift run surfaces as a real `ingest_runs.error`, via the same
  // catch-and-record path `runSource` already has for every other kind.
  const results = await searchMeetupEvents({
    query: config.query,
    lat: tab.center.lat,
    lon: tab.center.lng,
    radiusMi,
    startDateISO: tab.dates[0],
    endDateISO: tab.dates[tab.dates.length - 1],
  });
  bump(counts, 'fetched', results.length);

  const candidateUrls = results.map((r) => r.eventUrl);
  // Re-review item 4: skip the discovery-context build when there's
  // nothing allowlisted to process, or the deadline has already passed.
  if (Date.now() > deadline || !hasAnyAllowlistedLink(candidateUrls)) {
    return { llmInputTokens: 0, llmOutputTokens: 0, costUsd: 0, hitDeadline: Date.now() > deadline, previews: dryRun ? previews : undefined };
  }

  const budgetStatus = await checkMonthlyBudget();
  const ctx = await buildDiscoverySourceContext(source, profile, tab);
  const refByUrl = new Map(results.map((r) => [r.eventUrl, r.id] as const));

  // Re-review item 1 (HIGH, previous round) / re-review (this round): read
  // back out below — `costAcc` is the SAME object `runSource` holds, so
  // it's never lost even if a later candidate throws.
  const llmCallsThisRunRef = { value: 0 };
  const { hitDeadline } = await runDiscoveredLinksBatch(candidateUrls, {
    source,
    profile,
    tab,
    sourceKind: 'meetup_search',
    sourceRef: (url) => refByUrl.get(url) ?? null,
    ctx,
    counts,
    dryRun,
    deadline,
    persist,
    budgetStatus,
    costAcc,
    llmCallsThisRunRef,
  });

  return { llmInputTokens: costAcc.inputTokens, llmOutputTokens: costAcc.outputTokens, costUsd: costAcc.costUsd, hitDeadline, previews: dryRun ? previews : undefined };
}

/**
 * Phase 4 item 2 (§3.6/§7): sponsor event pages — admin-entered known URLs,
 * or discovered from this conference's sponsors' own websites
 * (`event_sponsors.sponsor_url`). Robots.txt-respecting, rate-limited, and
 * capped at `MAX_PAGES_PER_RUN` pages total (`sources/sponsor-pages.ts`).
 */
async function processSponsorPagesSource(args: {
  source: Awaited<ReturnType<typeof getSource>>;
  profile: IngestProfileRow;
  tab: TabConfig;
  deadlineMs?: number;
  counts: RunCounts;
  dryRun?: boolean;
  costAcc: CostAccumulator;
}): Promise<DiscoverySourceLoopResult> {
  const { profile, tab, counts, dryRun, costAcc } = args;
  const source = args.source!;
  const deadline = Date.now() + (args.deadlineMs ?? 240_000);
  const previews: CandidatePreview[] = [];
  const persist = makeDiscoveryPersist(dryRun, previews);

  const config = source.config as { urls?: string[] };
  const supabase = getIngestSupabase();
  const cursor = (source.cursor as { sponsor_offset?: number } | null) ?? {};
  const { urls: pageUrls, nextOffset } = await resolveSponsorPageUrls(supabase, source.conference, config.urls ?? [], {
    offset: cursor.sponsor_offset ?? 0,
  });
  bump(counts, 'fetched', pageUrls.length);

  const robotsCache = createRobotsCache();
  const linksBySourceUrl = new Map<string, string>(); // discovered link -> the sponsor page it came from
  let sponsorPagesHitDeadline = false;
  for (const pageUrl of pageUrls) {
    // Re-review item 4: check the deadline with enough margin for the
    // WORST-CASE time one more page could take (robots.txt timeout + page
    // timeout + pacing sleep, ~17s — `SPONSOR_PAGE_WORST_CASE_MS`), not
    // just whether the deadline has already passed — a page fetch started
    // a moment before the deadline could otherwise still run past the
    // cron's own hard cutoff.
    if (Date.now() + SPONSOR_PAGE_WORST_CASE_MS > deadline) {
      sponsorPagesHitDeadline = true;
      break;
    }
    const links = await fetchSponsorPageLinks(pageUrl, robotsCache);
    for (const link of links) {
      if (!linksBySourceUrl.has(link)) linksBySourceUrl.set(link, pageUrl);
    }
    // Rate-limit: one page per 500ms, politer than the Telegram/Luma 1/sec
    // link-fetch pacing isn't needed here since each page fetch already
    // costs a full HTTP round trip.
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  // Re-review item 8: persist the rotation cursor so the NEXT run starts
  // from a different sponsor, regardless of whether this run finished
  // early on the deadline — only when rotation applies at all (admin-
  // entered URLs and "no sponsors found" both return `nextOffset: null`).
  if (!dryRun && nextOffset !== null) {
    await updateSource(source.id, { cursor: { sponsor_offset: nextOffset } });
  }

  const candidateUrls = Array.from(linksBySourceUrl.keys());
  // Re-review item 4: skip the discovery-context build when there's
  // nothing allowlisted to process, or the page-fetch loop above already
  // ran out of deadline margin.
  if (sponsorPagesHitDeadline || !hasAnyAllowlistedLink(candidateUrls)) {
    return { llmInputTokens: 0, llmOutputTokens: 0, costUsd: 0, hitDeadline: sponsorPagesHitDeadline, previews: dryRun ? previews : undefined };
  }

  const budgetStatus = await checkMonthlyBudget();
  const ctx = await buildDiscoverySourceContext(source, profile, tab);

  // Re-review item 1 (HIGH, previous round) / re-review (this round): read
  // back out below — `costAcc` is the SAME object `runSource` holds, so
  // it's never lost even if a later candidate throws.
  const llmCallsThisRunRef = { value: 0 };
  const { hitDeadline } = await runDiscoveredLinksBatch(candidateUrls, {
    source,
    profile,
    tab,
    sourceKind: 'sponsor_pages',
    sourceRef: (url) => linksBySourceUrl.get(url) ?? null,
    ctx,
    counts,
    dryRun,
    deadline,
    persist,
    budgetStatus,
    costAcc,
    llmCallsThisRunRef,
  });

  return {
    llmInputTokens: costAcc.inputTokens,
    llmOutputTokens: costAcc.outputTokens,
    costUsd: costAcc.costUsd,
    hitDeadline: sponsorPagesHitDeadline || hitDeadline,
    previews: dryRun ? previews : undefined,
  };
}
