// The pipeline orchestrator (§5, §7 `pipeline.ts`): fetch -> normalize ->
// dedupe -> filter -> enrich -> classify -> route -> publish/queue/reject,
// one source per call, deadline-aware so a cron run that's running long
// exits cleanly and the next run picks up where it stopped.
import OpenAI from 'openai';
import { normalizeEventLink } from '../luma';
import { fetchEvents } from '../fetch-events';
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
import type { CandidateStatus, IngestProfileRow, NormalizedEvent, RunCounts, RunTrigger, TrustedHostEntry } from './types';

function bump(counts: RunCounts, key: keyof RunCounts, by = 1) {
  counts[key] = (counts[key] ?? 0) + by;
}

/** True if a host/organizer is in a profile's trusted/blocked list, by id or name. */
function hostListMatches(entries: TrustedHostEntry[], event: Pick<NormalizedEvent, 'hosts' | 'organizer'>): boolean {
  if (entries.length === 0) return false;
  const names = new Set([event.organizer.toLowerCase(), ...event.hosts.map((h) => h.name.toLowerCase())].filter(Boolean));
  const ids = new Set(event.hosts.map((h) => h.apiId).filter((id): id is string => !!id));
  return entries.some((e) => (e.id && ids.has(e.id)) || names.has(e.name.toLowerCase()));
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

  if (!opts.dryRun && (await hasRecentRunningRun(sourceId))) {
    const run = await createRun({ source_id: sourceId, conference: source.conference, trigger: opts.trigger });
    await finishRun(run.id, { status: 'skipped', counts: {} });
    return { runId: run.id, status: 'skipped', counts: {} };
  }

  const run = opts.dryRun ? null : await createRun({ source_id: sourceId, conference: source.conference, trigger: opts.trigger });
  const counts: RunCounts = {
    fetched: 0, past: 0, new: 0, unchanged: 0, enriched: 0, duplicates: 0,
    filtered: 0, classified: 0, published: 0, queued: 0, rejected: 0, errors: 0,
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
      if (run) {
        await updateSource(sourceId, { last_run_at: new Date().toISOString(), last_status: 'skipped' });
        await finishRun(run.id, { status: 'skipped', counts, error: 'No enabled ingest profile for this conference.' });
      }
      return { runId: run?.id ?? null, status: 'skipped', counts };
    }

    const allTabs = await getAllConferenceTabs();
    const tab = allTabs.find((t) => t.name === source.conference);
    if (!tab) throw new Error(`No conference tab found for "${source.conference}".`);

    const result = await processSource({ source, profile, tab, deadlineMs: opts.deadlineMs, counts, dryRun: opts.dryRun });
    llmInputTokens = result.llmInputTokens;
    llmOutputTokens = result.llmOutputTokens;
    costUsd = result.costUsd;

    if (run) {
      await updateSource(sourceId, { last_run_at: new Date().toISOString(), last_status: 'ok', last_error: null });
      await finishRun(run.id, {
        status: result.hitDeadline ? 'partial' : 'ok',
        counts,
        llm_input_tokens: llmInputTokens,
        llm_output_tokens: llmOutputTokens,
        est_cost_usd: costUsd,
      });
    }
    return { runId: run?.id ?? null, status: result.hitDeadline ? 'partial' : 'ok', counts, previews: result.previews };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (run) {
      await updateSource(sourceId, { last_run_at: new Date().toISOString(), last_status: 'error', last_error: message });
      await finishRun(run.id, {
        status: 'error',
        counts,
        llm_input_tokens: llmInputTokens,
        llm_output_tokens: llmOutputTokens,
        est_cost_usd: costUsd,
        error: message,
      });
    }
    return { runId: run?.id ?? null, status: 'error', counts, error: message };
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

  const enrichLimiter = new LumaEnrichmentLimiter(100, 1000);
  const themeProfile = profileRowToThemeProfile(profile);
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const supabase = getIngestSupabase();

  const sheetEvents = await fetchEvents(undefined, [tab]);
  const linkIndex = await buildSheetLinkIndex(
    sheetEvents.map((e) => ({ id: e.id, link: e.link })),
    { maxResolutions: 50 }
  );
  const otherCandidates = await listRecentCandidatesForDedupe(source.conference);

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

  const sheetTitle = await getSheetTitle(tab.gid);
  const publisher = new ThrottledSheetPublisher(sheetTitle, tab.gid, { maxPerRun: profile.max_publish_per_run });
  let sheetChanged = false;
  let llmCallsThisRun = 0;

  const startDate = tab.dates[0];
  const endDate = tab.dates[tab.dates.length - 1];

  for (const { vevent, apiId, slug } of icalCandidates) {
    if (Date.now() > deadline) {
      return { llmInputTokens: totalInputTokens, llmOutputTokens: totalOutputTokens, costUsd: runningCostUsd, hitDeadline: true };
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

    // Change detection BEFORE enrichment (§5 "unchanged? touch last_seen_at,
    // stop"): a stub NormalizedEvent built from iCal fields alone (no
    // network call) is hashed and compared to the stored hash. Luma's
    // DESCRIPTION stub includes the host list as text, so a host or
    // name/date change is caught; a change to only the long-form Luma
    // description (not reflected in the iCal stub) is not — a known
    // limitation of iCal-only change detection, acceptable at this volume.
    const stub = normalizeLumaEvent({ vevent, timezone: tab.timezone, enrichment: null, calendar: calendarRef, fallbackSlug: slug });
    const stubHash = computeContentHash(stub);

    if (existing && existing.content_hash === stubHash && existing.status !== 'error') {
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

    const isTrustedHost =
      hostListMatches(profile.trusted_hosts, normalized) ||
      normalized.hosts.some((h) => h.apiId && verifiedHostIds.has(h.apiId)) ||
      (organizerCounts.get(normalized.organizer.trim().toLowerCase()) ?? 0) >= 2;
    const isBlockedHost = hostListMatches(profile.blocked_hosts, normalized);

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
        isTrustedCalendarSource: source.trust === 'curated',
        isTrustedHost,
        isBlockedHost,
        sponsorMatch: null, // event_sponsors lookup is keyed on already-published events; not wired for pre-publish candidates in 1b.
        includeKeywords: profile.include_keywords,
        excludeKeywords: profile.exclude_keywords,
        possibleDuplicate: !!possibleDuplicateOf,
        noGeo,
        sourceTrust: source.trust,
        publishThreshold: profile.publish_threshold,
        reviewThreshold: profile.review_threshold,
      });
    } catch {
      bump(counts, 'errors');
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

    if (scoreResult.route === 'reject') {
      status = 'auto_rejected';
      bump(counts, 'rejected');
    } else if (!dryRun && scoreResult.route === 'publish' && profile.auto_publish_enabled && !publisher.capReached) {
      try {
        const row = toEventRow(normalized, scoreResult.classifier.output.suggested_tags);
        sheetRow = await publisher.publish(row);
        status = 'auto_published';
        publishedAt = new Date().toISOString();
        sheetChanged = true;
        bump(counts, 'published');
      } catch {
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
      sheet_row: sheetRow,
      possible_duplicate_of: possibleDuplicateOf,
    });
  }

  if (sheetChanged) invalidateEventsCache();
  if (!dryRun) await reconcileConference(tab, profile.theme_key);

  return {
    llmInputTokens: totalInputTokens,
    llmOutputTokens: totalOutputTokens,
    costUsd: runningCostUsd,
    hitDeadline: false,
    previews: dryRun ? previews : undefined,
  };
}
