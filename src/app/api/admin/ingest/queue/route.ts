// Admin Ingest review queue (§9.2). Modeled on /api/admin/claims: password
// auth, zod-validated body, service-role Supabase access.
import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { requireAdmin } from '@/lib/admin-guard';
import { parseBody, IngestQueueActionSchema } from '@/lib/api-validation';
import { getAllConferenceTabs } from '@/lib/get-conferences';
import type { TabConfig } from '@/lib/conferences';
import { fetchEvents } from '@/lib/fetch-events';
import { getSheetTitle, deleteSheetRow, readRange } from '@/lib/google-sheets';
import { normalizeEventLink } from '@/lib/luma';
import { generateEventId } from '@/lib/fetch-events';
import { invalidateEventsCache } from '@/lib/fetch-events-cached';
import {
  listCandidates,
  getCandidate,
  updateCandidate,
  claimCandidateStatus,
  recordAdhocCost,
  insertLabel,
  getProfile,
  upsertProfile,
  profileRowToThemeProfile,
  getIngestSupabase,
  QUEUE_LIST_COLUMNS,
} from '@/lib/ingest/db';
import { toEventRow, ThrottledSheetPublisher } from '@/lib/ingest/publish';
import { upsertGeocodedAddress } from '@/lib/ingest/filters';
import { scoreCandidate } from '@/lib/ingest/scoring';
import { ClassifierError } from '@/lib/ingest/classifier';
import { checkMonthlyBudget } from '@/lib/ingest/budget';
import { estimateCostUsd } from '@/lib/ingest/pricing';
import { getSponsorNamesForConference, matchSponsorName } from '@/lib/ingest/sponsors';
import { loadLearningContext } from '@/lib/ingest/learning';
import { requeueCrossConferenceTwins, hasForceReviewMarker } from '@/lib/ingest/cross-conference';
import {
  buildSheetLinkIndex,
  findSheetMatchByLink,
  findDuplicateByNameAndDate,
  canonicalKeyForEvent,
  type SheetLinkIndex,
} from '@/lib/ingest/dedupe';
import {
  THEME_REJECT_REASONS,
  FINAL_CANDIDATE_STATUSES,
  APPROVABLE_CANDIDATE_STATUSES,
} from '@/lib/ingest/types';
import type { CandidateStatus, NormalizedEvent, TrustedHostEntry } from '@/lib/ingest/types';

export const runtime = 'nodejs';
// Bulk approve is throttled (see publish.ts for the quota math);
// MAX_BULK_APPROVE below plus the deferred_timeout deadline in POST keep a
// request inside this.
export const maxDuration = 300;

/** A bulk "Approve selected" is throttled (~15 inserts/min, publish.ts);
 *  40 items is ~2.7 minutes, inside `maxDuration` (and anything slower is
 *  returned as `deferred_timeout` rather than killed). Approving more than
 *  this in one request would risk timing out mid-batch with some
 *  candidates left claimed but unpublished — reject it upfront instead
 *  (review finding, HIGH item 3). Reject/restore/trust/block aren't
 *  throttled the same way, so only `approve` is capped here. */
const MAX_BULK_APPROVE = 40;

/** Stop STARTING new work once a request has run this long (Vercel kills the
 *  function at maxDuration=300s); remaining ids come back as
 *  `deferred_timeout` so the caller can simply retry them. Env override is
 *  for tests/ops. */
function requestDeadlineMs(): number {
  const v = Number(process.env.INGEST_QUEUE_DEADLINE_MS);
  return Number.isFinite(v) && v > 0 ? v : 240_000;
}

const DEFAULT_LIST_LIMIT = 300;
const MAX_LIST_LIMIT = 500;

export async function GET(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const params = req.nextUrl.searchParams;
  const status = params.get('status');
  const conference = params.get('conference') || undefined;
  const source = params.get('source') || undefined;
  const minScoreRaw = params.get('minScore');
  const minScore = minScoreRaw ? Number(minScoreRaw) : undefined;

  // `limit` defaults to the historical 300. `cursor` is an opaque offset
  // token returned as `nextCursor` (only present when more rows exist), so
  // existing callers that ignore it see exactly the old response shape.
  const limitRaw = Number(params.get('limit'));
  const limit = Number.isFinite(limitRaw) && limitRaw >= 1 ? Math.min(Math.floor(limitRaw), MAX_LIST_LIMIT) : DEFAULT_LIST_LIMIT;
  const cursorRaw = params.get('cursor');
  let offset = 0;
  if (cursorRaw) {
    const text = Buffer.from(cursorRaw, 'base64url').toString('utf8');
    const decoded = Number(text);
    if (!/^\d+$/.test(text) || !Number.isSafeInteger(decoded)) {
      return NextResponse.json({ error: 'Invalid cursor' }, { status: 400 });
    }
    offset = decoded;
  }

  const statuses: CandidateStatus[] | undefined = status && status !== 'all' ? [status as CandidateStatus] : undefined;

  try {
    // Fetch one extra row to know whether another page exists.
    const rows = await listCandidates({
      conference,
      status: statuses,
      sourceId: source,
      minScore,
      limit: limit + 1,
      offset,
      // Only the columns the admin UI + operator scripts read; `?full=1`
      // restores the whole row.
      columns: params.get('full') === '1' ? undefined : QUEUE_LIST_COLUMNS,
    });
    const hasMore = rows.length > limit;
    const candidates = hasMore ? rows.slice(0, limit) : rows;
    return NextResponse.json({
      candidates,
      ...(hasMore ? { nextCursor: Buffer.from(String(offset + limit), 'utf8').toString('base64url') } : {}),
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to load queue' }, { status: 500 });
  }
}

function hostEntries(event: NormalizedEvent): TrustedHostEntry[] {
  const entries: TrustedHostEntry[] = event.hosts.map((h) => ({
    kind: 'luma_host' as const,
    id: h.apiId,
    name: h.name,
  }));
  if (event.organizer && !entries.some((e) => e.name.toLowerCase() === event.organizer.toLowerCase())) {
    entries.push({ kind: 'organizer', name: event.organizer });
  }
  return entries;
}

/**
 * Phase 2: the `ingest_labels.example` snapshot used to feed few-shot
 * selection (`learning.ts`) — originally just `{name, hosts}`, which was
 * enough for the row to exist but too thin to build a useful "name | hosts
 * | summary" few-shot line (§5.6) or a learned host signal. Adding
 * organizer/calendar/the model's own reason here is additive (jsonb, no
 * migration) and every `learning.ts` reader already tolerates the older,
 * thinner shape (missing fields are just skipped).
 */
function labelExample(event: NormalizedEvent, llmReason: string | null): Record<string, unknown> {
  return {
    name: event.name,
    hosts: event.hosts.map((h) => h.name),
    organizer: event.organizer || null,
    calendar: event.calendar?.name ?? null,
    llmReason: llmReason ?? null,
  };
}

function mergeHostLists(existing: TrustedHostEntry[], toAdd: TrustedHostEntry[]): TrustedHostEntry[] {
  const seen = new Set(existing.map((e) => `${e.kind}:${(e.id || e.name).toLowerCase()}`));
  const merged = [...existing];
  for (const entry of toAdd) {
    const key = `${entry.kind}:${(entry.id || entry.name).toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(entry);
    }
  }
  return merged;
}

export async function POST(req: NextRequest) {
  const { data, error: parseError } = await parseBody(req, IngestQueueActionSchema);
  if (parseError) return parseError;

  const { password, action, ids, reason, note, edits } = data;
  const denied = await requireAdmin(req, password);
  if (denied) return denied;

  if (action === 'approve' && ids.length > MAX_BULK_APPROVE) {
    return NextResponse.json(
      { error: `Approve at most ${MAX_BULK_APPROVE} at a time (requested ${ids.length}). Approve in smaller batches.` },
      { status: 400 }
    );
  }

  const results: { id: string; ok: boolean; error?: string }[] = [];
  let sheetChanged = false;
  // One throttled publisher per conference for this request, so a bulk
  // "Approve selected" on several candidates in the same sheet is still
  // rate-limited (<=10/min, §4), not just a single approve.
  const publishers = new Map<string, ThrottledSheetPublisher>();
  // One sheet-link index per conference for this request, built lazily and
  // reused/updated across ids in the same bulk batch — checked before every
  // insert so a race (or a retried request) can never double-publish the
  // same event (review finding, HIGH item 3).
  const linkIndexes = new Map<string, SheetLinkIndex>();
  // Name+date fallback pool per conference (Part A item 2) — kept in sync
  // with `linkIndexes` so a bulk approve's own in-run inserts are visible
  // to later ids in the same batch, same as the link index above.
  const nameDatePools = new Map<string, { id: string; name: string; dateISO: string }[]>();

  // Per-request lookups, hoisted out of the per-id loop: the conference tab
  // list (one Supabase read), each conference's profile, and each tab's
  // sheet title were previously re-fetched for every id.
  let tabsPromise: Promise<TabConfig[]> | null = null;
  const getTabs = () => (tabsPromise ??= getAllConferenceTabs());
  const profileCache = new Map<string, Promise<Awaited<ReturnType<typeof getProfile>>>>();
  const getProfileOnce = (conference: string) => {
    let p = profileCache.get(conference);
    if (!p) {
      p = getProfile(conference);
      profileCache.set(conference, p);
    }
    return p;
  };
  const sheetTitles = new Map<number, Promise<string>>();
  const getSheetTitleOnce = (gid: number) => {
    let p = sheetTitles.get(gid);
    if (!p) {
      p = getSheetTitle(gid);
      sheetTitles.set(gid, p);
    }
    return p;
  };

  const startedAt = Date.now();
  const deadlineMs = requestDeadlineMs();

  async function getLinkIndex(tab: TabConfig): Promise<SheetLinkIndex> {
    const cached = linkIndexes.get(tab.name);
    if (cached) return cached;
    const sheetEvents = await fetchEvents(undefined, [tab]);
    nameDatePools.set(tab.name, sheetEvents.map((e) => ({ id: e.id, name: e.name, dateISO: e.dateISO })));
    // maxResolutions: 0 — this is a hot admin-action path, not a bulk
    // ingestion run; an exact link match is enough here, so skip spending
    // rate-limited Luma calls resolving vanity slugs.
    const index = await buildSheetLinkIndex(sheetEvents.map((e) => ({ id: e.id, link: e.link })), { maxResolutions: 0 });
    linkIndexes.set(tab.name, index);
    return index;
  }

  try {
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      // Stop STARTING new work near the function limit: the rest come back
      // as `deferred_timeout` (nothing claimed or touched) for the caller
      // to retry, instead of the whole request dying mid-batch.
      if (Date.now() - startedAt > deadlineMs) {
        for (const rest of ids.slice(i)) results.push({ id: rest, ok: false, error: 'deferred_timeout' });
        break;
      }
      try {
        const candidate = await getCandidate(id);
        if (!candidate) {
          results.push({ id, ok: false, error: 'Not found' });
          continue;
        }

        if (action === 'approve') {
          // Atomic lock: only one request can move this candidate out of an
          // approvable status. A concurrent duplicate (double-click, a
          // retried request) gets `null` back and never touches the sheet
          // (review finding, HIGH item 3).
          const claimed = await claimCandidateStatus(id, APPROVABLE_CANDIDATE_STATUSES, 'approved', {
            review_note: note ?? null,
            reviewed_at: new Date().toISOString(),
            reviewed_by: 'admin',
          });
          if (!claimed) {
            results.push({ id, ok: false, error: `Candidate is ${candidate.status}, not approvable (already handled).` });
            continue;
          }

          try {
            const tabs = await getTabs();
            const tab = tabs.find((t) => t.name === candidate.conference);
            if (!tab) throw new Error(`No conference tab for "${candidate.conference}".`);

            const event: NormalizedEvent =
              ids.length === 1 && edits
                ? {
                    ...candidate.event,
                    name: edits.name ?? candidate.event.name,
                    sheetDate: edits.date ?? candidate.event.sheetDate,
                    startTime: edits.startTime ?? candidate.event.startTime,
                    endTime: edits.endTime ?? candidate.event.endTime,
                    organizer: edits.organizer ?? candidate.event.organizer,
                    address: edits.address ?? candidate.event.address,
                    cost: edits.cost ?? candidate.event.cost,
                  }
                : candidate.event;
            const tags = ids.length === 1 && edits?.tags ? edits.tags : candidate.llm_tags ?? [];

            // Check the sheet link index before inserting — if this event
            // is already in the sheet (a previous partial failure, a race
            // that slipped past the claim some other way), reuse that row
            // instead of inserting a duplicate (review finding, HIGH item 3).
            const linkIndex = await getLinkIndex(tab);
            const existingMatch = findSheetMatchByLink(linkIndex, event);

            // Fallback duplicate check (Part A item 2): normalized name +
            // same date in the target tab, independent of the link index.
            // Exists specifically so a bad/stale `ingest_link_cache` miss
            // (2026-10-16 incident) can't let a duplicate through just
            // because the short-link resolution it relied on was wrong —
            // this check doesn't touch that cache at all. Refuse the
            // publish outright rather than inserting.
            if (!existingMatch) {
              const nameDateMatch = findDuplicateByNameAndDate(event, nameDatePools.get(tab.name) ?? []);
              if (nameDateMatch) {
                await updateCandidate(id, {
                  status: 'duplicate',
                  duplicate_of: nameDateMatch.id,
                  review_note: `Fallback name+date dedupe: matches sheet row "${nameDateMatch.name}" on ${nameDateMatch.dateISO} (event id ${nameDateMatch.id}). Refused to publish a likely duplicate.`,
                });
                results.push({
                  id,
                  ok: false,
                  error: `Duplicate: matches existing sheet event "${nameDateMatch.name}" on ${nameDateMatch.dateISO}. Marked as duplicate of ${nameDateMatch.id}, not published.`,
                });
                continue;
              }
            }

            let sheetRow: number | null = null;
            let publishedEventId: string;
            if (existingMatch) {
              publishedEventId = existingMatch.id;
            } else {
              let publisher = publishers.get(candidate.conference);
              if (!publisher) {
                const sheetTitle = await getSheetTitleOnce(tab.gid);
                publisher = new ThrottledSheetPublisher(sheetTitle, tab.gid, { maxPerRun: ids.length });
                publishers.set(candidate.conference, publisher);
              }
              sheetRow = await publisher.publish(toEventRow(event, tags));
              sheetChanged = true;
              publishedEventId = generateEventId(candidate.conference, event.sheetDate, event.startTime, event.name);

              // Reflect the new row immediately so a later id in this SAME
              // bulk batch that resolves to the same link doesn't also get
              // published (review finding, LOW "dedupe within a single run").
              const key = canonicalKeyForEvent(event);
              if (key) linkIndex.byKey.set(key, { id: publishedEventId, link: event.link });
              nameDatePools.get(tab.name)?.push({ id: publishedEventId, name: event.name, dateISO: event.dateISO });

              // Bug: "addresses are always empty" — same as the pipeline's
              // own auto-publish path: when this candidate has both an
              // address and real coordinates, cache them in
              // `geocoded_addresses` right away so the map pin uses the
              // exact coordinates instead of waiting on the geocode cron.
              if (event.address && event.lat != null && event.lng != null) {
                await upsertGeocodedAddress(getIngestSupabase(), event.address, event.lat, event.lng, candidate.conference);
              }
            }

            await updateCandidate(id, {
              event,
              sheet_row: sheetRow,
              published_event_id: publishedEventId,
              published_at: new Date().toISOString(),
              edits: ids.length === 1 && edits ? edits : null,
            });

            const profile = await getProfileOnce(candidate.conference);
            await insertLabel({
              candidate_id: id,
              conference: candidate.conference,
              theme_key: profile?.theme_key ?? 'custom',
              label: 'on_theme',
              label_kind: 'theme',
              source: 'admin_review',
              reason: note ?? null,
              example: labelExample(event, candidate.llm_reason),
              model_score: candidate.llm_score,
              model_route: candidate.route,
            });
          } catch (err) {
            // Roll back the claim so a failed publish doesn't leave the
            // candidate stuck "approved" with nothing actually published.
            await updateCandidate(id, {
              status: candidate.status,
              review_note: candidate.review_note,
              reviewed_at: candidate.reviewed_at,
              reviewed_by: candidate.reviewed_by,
            }).catch(() => {});
            throw err;
          }
        } else if (action === 'reject') {
          if (!reason) throw new Error('reason is required to reject');
          // Only from a non-final status (review finding, MEDIUM item 2) —
          // a published event (approved/auto_published) must go through
          // `unpublish` first, and the other final statuses have nothing
          // left to reject. Also acts as a lock against a concurrent
          // duplicate request, same as approve.
          const claimedReject = await claimCandidateStatus(id, APPROVABLE_CANDIDATE_STATUSES, 'rejected', {
            reject_reason: reason,
            review_note: note ?? null,
            reviewed_at: new Date().toISOString(),
            reviewed_by: 'admin',
          });
          if (!claimedReject) {
            results.push({ id, ok: false, error: `Candidate is ${candidate.status}, not rejectable (already handled, or published — unpublish it instead).` });
            continue;
          }

          const profile = await getProfileOnce(candidate.conference);
          await insertLabel({
            candidate_id: id,
            conference: candidate.conference,
            theme_key: profile?.theme_key ?? 'custom',
            label: 'off_theme',
            label_kind: THEME_REJECT_REASONS.includes(reason) ? 'theme' : 'non_theme',
            source: 'admin_review',
            reason,
            example: labelExample(candidate.event, candidate.llm_reason),
            model_score: candidate.llm_score,
            model_route: candidate.route,
          });
          // This conference kept the event over an overlapping conference
          // (cross-conference.ts); a non-duplicate reject here means the
          // other conference's demoted twin deserves its own review again.
          await requeueCrossConferenceTwins(candidate, reason);
        } else if (action === 'restore') {
          // Only from rejected/auto_rejected — never from a final,
          // published status (review finding, MEDIUM item 2).
          const claimedRestore = await claimCandidateStatus(id, ['rejected', 'auto_rejected'], 'queued', {
            reject_reason: null,
            reviewed_at: null,
            reviewed_by: null,
          });
          if (!claimedRestore) {
            results.push({ id, ok: false, error: `Candidate is ${candidate.status}, not restorable.` });
            continue;
          }
        } else if (action === 'rescore') {
          // Never rescore something already finalized — a rescore that
          // somehow routed differently must not resurrect a decision an
          // admin (or auto-publish) already made (review finding, HIGH item 4).
          if (FINAL_CANDIDATE_STATUSES.includes(candidate.status)) {
            throw new Error(`Candidate is ${candidate.status}; cannot rescore a finalized candidate.`);
          }

          const budget = await checkMonthlyBudget();
          if (budget.exceeded) {
            throw new Error(`Monthly LLM budget ($${budget.capUsd}) already reached ($${budget.spentUsd.toFixed(2)} spent).`);
          }

          const profile = await getProfileOnce(candidate.conference);
          if (!profile) throw new Error('No ingest profile for this conference.');
          const themeProfile = profileRowToThemeProfile(profile);
          const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
          const tabs = await getTabs();
          const tab = tabs.find((t) => t.name === candidate.conference);
          const startDate = tab?.dates?.[0] ?? candidate.event.dateISO;
          const endDate = tab?.dates?.[tab.dates.length - 1] ?? candidate.event.dateISO;

          // Phase 2: a manual "Re-score" benefits from the same learning-loop
          // signals a real pipeline run gets — few-shot from past decisions
          // for this theme, and the sponsor-name text match (the fuzzier
          // trusted-host match / learned-host nudge from `learning.ts` is
          // pipeline-only: this single-candidate path has no reason to fetch
          // and derive a whole conference's host-signal map for one rescore).
          const [{ fewShot }, sponsorNames] = await Promise.all([
            loadLearningContext({ conference: candidate.conference, themeKey: profile.theme_key, excludeCandidateId: id }),
            getSponsorNamesForConference(candidate.conference),
          ]);
          // Host/organizer identity fields only — not the event name or
          // description (review finding, MEDIUM item 8), same scoping as
          // the pipeline's own sponsor match.
          const sponsorText = [candidate.event.organizer, ...candidate.event.hosts.map((h) => h.name)].join(' ');
          const sponsorMatch = matchSponsorName(sponsorText, sponsorNames);

          let scoreResult;
          try {
            scoreResult = await scoreCandidate({
              client,
              profile: themeProfile,
              conference: { name: candidate.conference, startDate, endDate },
              event: {
                name: candidate.event.name,
                hosts: candidate.event.hosts.map((h) => h.name),
                calendarName: candidate.event.calendar?.name ?? null,
                organizer: candidate.event.organizer,
                venue: candidate.event.address || null,
                dateISO: candidate.event.dateISO,
                startTime: candidate.event.startTime,
                cost: candidate.event.cost,
                platform: candidate.event.platform,
                descriptionText: candidate.event.descriptionText,
              },
              fewShot,
              isTrustedCalendarSource: false,
              isTrustedHost: false,
              isBlockedHost: false,
              sponsorMatch,
              includeKeywords: profile.include_keywords,
              excludeKeywords: profile.exclude_keywords,
              possibleDuplicate: !!candidate.possible_duplicate_of,
              noGeo: candidate.event.lat == null,
              forceReview: hasForceReviewMarker(candidate),
              sourceTrust: 'curated',
              publishThreshold: profile.publish_threshold,
              reviewThreshold: profile.review_threshold,
            });
          } catch (err) {
            // A schema-validation failure still bills tokens — record that
            // cost even though the rescore itself failed (review finding,
            // LOW item 5, same as the pipeline's classify catch).
            if (err instanceof ClassifierError && err.usage) {
              await recordAdhocCost({
                conference: candidate.conference,
                trigger: 'manual',
                inputTokens: err.usage.inputTokens,
                outputTokens: err.usage.outputTokens,
                costUsd: estimateCostUsd(err.usage.model, err.usage.inputTokens, err.usage.outputTokens),
                counts: { errors: 1 },
                status: 'error',
                error: err.message,
              });
            }
            throw err;
          }

          // Record the cost so it counts toward the monthly cap, same as a
          // pipeline run (review finding, HIGH item 4).
          await recordAdhocCost({
            conference: candidate.conference,
            trigger: 'manual',
            inputTokens: scoreResult.classifier.inputTokens,
            outputTokens: scoreResult.classifier.outputTokens,
            costUsd: estimateCostUsd(scoreResult.classifier.model, scoreResult.classifier.inputTokens, scoreResult.classifier.outputTokens),
            counts: { classified: 1 },
          });

          await updateCandidate(id, {
            status: scoreResult.route === 'reject' ? 'auto_rejected' : 'queued',
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
            classify_attempts: candidate.classify_attempts + 1,
          });
        } else if (action === 'unpublish') {
          // Only a candidate that's actually published may be unpublished
          // (review finding, HIGH item 9 — the old guard let a stray
          // published_event_id on a non-published-status row through).
          if (!['approved', 'auto_published'].includes(candidate.status)) {
            throw new Error(`Candidate is ${candidate.status}, not published.`);
          }
          const linkKey = normalizeEventLink(candidate.event.link);
          if (!linkKey) {
            throw new Error('Candidate has no resolvable link; refusing to unpublish (would have to guess which sheet row to remove).');
          }

          const claimed = await claimCandidateStatus(id, ['approved', 'auto_published'], 'unpublished', {
            reviewed_at: new Date().toISOString(),
            reviewed_by: 'admin',
          });
          if (!claimed) {
            results.push({ id, ok: false, error: 'Candidate is no longer published (handled concurrently).' });
            continue;
          }

          try {
            const tabs = await getTabs();
            const tab = tabs.find((t) => t.name === candidate.conference);
            if (!tab) throw new Error(`No conference tab for "${candidate.conference}".`);
            const sheetTitle = await getSheetTitleOnce(tab.gid);
            const rows = await readRange(sheetTitle, 'A1:L');
            // Match by link key ONLY (a blank link cell normalizes to null
            // and can never match a real key, so blank rows are already
            // excluded). Require EXACTLY one match — zero means we can't
            // find it to delete, more than one means we can't safely tell
            // which row is the real one; either way, refuse rather than
            // guess (review finding, MEDIUM item 1). The outer catch below
            // rolls the claimed status back on any thrown error here, so
            // this never returns ok:true or writes a label without an
            // actual deletion.
            const matchingRowIndexes = rows.reduce<number[]>((acc, r, idx) => {
              const rowLink = (r[8] || '').trim();
              if (rowLink && normalizeEventLink(rowLink) === linkKey) acc.push(idx);
              return acc;
            }, []);

            if (matchingRowIndexes.length !== 1) {
              throw new Error(
                matchingRowIndexes.length === 0
                  ? 'Could not find this event in the sheet by link; not unpublishing.'
                  : `Found ${matchingRowIndexes.length} sheet rows with this link; refusing to guess which to delete.`
              );
            }

            await deleteSheetRow(tab.gid, matchingRowIndexes[0]);
            sheetChanged = true;

            const profile = await getProfileOnce(candidate.conference);
            await insertLabel({
              candidate_id: id,
              conference: candidate.conference,
              theme_key: profile?.theme_key ?? 'custom',
              label: 'off_theme',
              label_kind: 'theme',
              source: 'admin_unpublish',
              reason: note ?? null,
              example: labelExample(candidate.event, candidate.llm_reason),
              model_score: candidate.llm_score,
              model_route: candidate.route,
            });
          } catch (err) {
            await updateCandidate(id, { status: candidate.status }).catch(() => {});
            throw err;
          }
        } else if (action === 'trust_host' || action === 'block_host') {
          const profile = await getProfileOnce(candidate.conference);
          // Review finding, MEDIUM item 2c: "trust host" ADDS to
          // `trusted_hosts`, which only ever RAISES scores (+20) — the
          // same reason the config PUT handler blocks adding trusted
          // hosts while auto-publish is on. "Block host" is NOT guarded:
          // it only adds to `blocked_hosts`, which only lowers scores, so
          // it stays allowed (same as removing from either list).
          if (action === 'trust_host' && profile?.auto_publish_enabled) {
            throw new Error('Cannot trust a new host while auto-publish is enabled for this conference. Turn auto-publish off first.');
          }
          const entries = hostEntries(candidate.event);
          if (action === 'trust_host') {
            await upsertProfile({ conference: candidate.conference, trusted_hosts: mergeHostLists(profile?.trusted_hosts ?? [], entries) });
            profileCache.delete(candidate.conference);
          } else {
            await upsertProfile({ conference: candidate.conference, blocked_hosts: mergeHostLists(profile?.blocked_hosts ?? [], entries) });
            profileCache.delete(candidate.conference);
          }
        }

        results.push({ id, ok: true });
      } catch (err) {
        results.push({ id, ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
      }
    }
  } finally {
    if (sheetChanged) invalidateEventsCache();
  }

  const allOk = results.every((r) => r.ok);
  return NextResponse.json({ success: allOk, results });
}
