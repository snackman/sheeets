// Public host-submission endpoint (Phase 3, plans/event-ingestion.md §3.5).
// A host submits one event link for a conference. Unlike the existing
// anonymous `/api/submit-event` (which writes straight into the sheet's
// review section), everything here lands in `ingest_candidates` as
// `discovery` trust and goes through the exact same dedupe/filter/signals/
// classify pipeline every other discovered link does — never straight to
// the sheet, never auto-published (§10 item 4). The pre-existing
// `/api/submit-event` flow is unchanged.
//
// Anti-abuse (§Phase 3 constraints, hardened per PR #181 review and
// re-review):
//  0. Cloudflare Turnstile is verified FIRST, before anything else touches
//     the database — enforced only when BOTH `TURNSTILE_SECRET_KEY`
//     (server) and `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (client, read by
//     `SubmitSourceForm.tsx`, which renders the real widget) are set; if
//     either is missing, Turnstile is skipped entirely (a half-configured
//     pair would otherwise be a silent total outage, since the client
//     could never produce a token with no site key to render against). A
//     captcha failure never creates an `ingest_submission_attempts` row.
//  1. Rate limiting, several layers, all against `ingest_submission_attempts`:
//     per-IP (two windows), then — ONLY if the per-IP check passes — a
//     GLOBAL hourly ceiling and a per-conference daily ceiling. The
//     attempt row is inserted BEFORE counting (not after), closing most
//     of the count-then-insert race a concurrent request would otherwise
//     have. A request rejected by the per-IP check is marked `rejected`
//     and EXCLUDED from the global/per-conference counts (re-review
//     finding A), so one IP flooding past its own limit can't also 429
//     every other IP/conference.
//  2. URL validation: allowlisted event platforms only (Luma, Partiful,
//     Eventbrite, Meetup, Posh) — `isAllowlistedEventLink`.
//  3. A shared, hourly-capped Luma enrichment budget (`HourlyWindowLumaLimiter`)
//     — if it's exhausted and the link is a Luma one, this says so
//     honestly (429) rather than silently falling through to a generic
//     "thanks, we'll review this."
//  4. The monthly LLM budget cap (`checkMonthlyBudget`) is checked before
//     classifying, same as every other candidate source.
import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import OpenAI from 'openai';
import { getConferenceTabs } from '@/lib/get-conferences';
import { parseBody, HostSubmissionSchema } from '@/lib/api-validation';
import { bucketIp } from '@/lib/ip-bucket';
import { verifyTurnstile } from '@/lib/turnstile';
import { getBearerToken } from '@/lib/server-auth';
import { fetchEvents } from '@/lib/fetch-events';
import { normalizeEventLink } from '@/lib/luma';
import { isAllowlistedEventLink, allowlistedPlatformFor } from '@/lib/ingest/allowlist';
import { checkMonthlyBudget } from '@/lib/ingest/budget';
import {
  getProfile,
  profileRowToThemeProfile,
  getOrCreateHostSubmissionSource,
  getCandidateByKeyOrAltKey,
  upsertCandidate,
  updateCandidate,
  listRecentCandidatesForDedupe,
  recordSubmissionAttempt,
  recordSubmissionAttemptCost,
  markSubmissionAttemptRejected,
  countRecentSubmissionAttempts,
  countGlobalRecentSubmissionAttempts,
  countConferenceRecentSubmissionAttempts,
  getIngestSupabase,
} from '@/lib/ingest/db';
import { buildSheetLinkIndex, type DedupeCandidatePool } from '@/lib/ingest/dedupe';
import { getSponsorNamesForConference } from '@/lib/ingest/sponsors';
import { loadLearningContext } from '@/lib/ingest/learning';
import { HourlyWindowLumaLimiter } from '@/lib/ingest/enrich';
import { processDiscoveredLink, PacedLinkLimiter, buildHostSignalComputer } from '@/lib/ingest/discover';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const NO_STORE = { 'Cache-Control': 'private, no-store' };

/** Two per-IP windows, same spirit as `CLAIM_LIMITS` (#177): a tight short
 *  window stops a fast script, a looser daily cap stops someone grinding
 *  it out by hand over a day. Deliberately conservative — the median
 *  legitimate host submits once, maybe twice if they typo the link. */
const RATE_LIMIT_SHORT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_SHORT_MAX = 5;
const RATE_LIMIT_DAY_WINDOW_MS = 24 * 60 * 60 * 1000;
const RATE_LIMIT_DAY_MAX = 15;

/** Global (every IP combined) and per-conference ceilings (review finding,
 *  HIGH item 2) — the per-IP limits above don't stop a botnet spreading
 *  one attempt per IP, or many different people hammering one
 *  conference's form. Both are deliberately generous relative to real
 *  traffic (a conference's whole run of side events is low hundreds at
 *  most) so they only bite during an actual abuse burst. */
const GLOBAL_HOURLY_WINDOW_MS = 60 * 60 * 1000;
const GLOBAL_HOURLY_MAX = 60;
const CONFERENCE_DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;
const CONFERENCE_DAILY_MAX = 100;

/**
 * Shared, module-level (review finding, HIGH item 2 "share a module-level
 * Luma limiter") — one `HourlyWindowLumaLimiter` instance for every
 * request this server instance handles, so N concurrent submissions can't
 * each get their own fresh Luma enrichment budget. Capped to roughly match
 * `GLOBAL_HOURLY_MAX` (at most one Luma enrichment per submission).
 */
const sharedSubmissionLumaLimiter = new HourlyWindowLumaLimiter(GLOBAL_HOURLY_MAX, 1000);

function hashBucket(bucket: string): string {
  return createHash('sha256').update(bucket).digest('hex');
}

/**
 * Best-effort client IP (review finding, HIGH item 2: "prefer request.ip /
 * x-real-ip / Vercel's header over the first XFF entry"). Priority:
 *  1. `x-real-ip` — Vercel's edge sets this to the real client IP itself
 *     (not client-suppliable: Vercel overwrites it), so it's trustworthy.
 *  2. `x-vercel-forwarded-for` — Vercel's own forwarded-for header, same
 *     trust level as `x-real-ip`.
 *  3. The FIRST entry of the generic `x-forwarded-for` chain — kept only
 *     as a last-resort fallback for non-Vercel environments (e.g. local
 *     dev behind a bare reverse proxy). This is the LEAST trustworthy
 *     option: unless something in front of this function is known to
 *     always APPEND to (never pass through) this header, a client can
 *     simply send its own `X-Forwarded-For: 1.2.3.4` and have it end up
 *     first. Only used when none of the above are present.
 *
 * (Re-review finding E: dropped the `request.ip` check this previously
 * had first — `NextRequest` in this Next.js version never actually
 * populates that property, including on Vercel, so it was dead code that
 * could never fire; `x-real-ip` is the real equivalent Vercel provides.)
 */
function getClientIp(req: NextRequest): string {
  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  const vercelFwd = req.headers.get('x-vercel-forwarded-for');
  if (vercelFwd) {
    const first = vercelFwd.split(',')[0]?.trim();
    if (first) return first;
  }
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) {
    const first = fwd.split(',')[0]?.trim();
    if (first) return first;
  }
  return 'unknown';
}

export async function POST(req: NextRequest) {
  const { data: body, error: parseError } = await parseBody(req, HostSubmissionSchema);
  if (parseError) return parseError;

  const ip = getClientIp(req);
  const ipHash = hashBucket(bucketIp(ip));

  // Re-review finding A: verify Turnstile BEFORE inserting an attempt row
  // at all — a captcha-failing flood should never even create a ledger
  // row, let alone one that could inflate the global/per-conference
  // counts below. (When Turnstile isn't configured, `verifyTurnstile`
  // always returns true, so this is a no-op in that case.)
  if (!(await verifyTurnstile(body.turnstileToken, ip))) {
    return NextResponse.json({ error: 'Captcha verification failed. Please try again.' }, { status: 400, headers: NO_STORE });
  }

  // The attempt is recorded BEFORE counting, so every count below (which
  // includes this just-inserted row) is compared with `>` rather than
  // `>=` (review finding, HIGH item 2 — insert-then-count instead of
  // count-then-insert closes most of the race two concurrent requests
  // from the same IP would otherwise have, and also means a flood of
  // deliberately-invalid requests still counts against the PER-IP limit,
  // not just valid ones).
  const attemptId = await recordSubmissionAttempt(ipHash, body.conference || null);

  // Per-IP check FIRST, and on its own — separate from the global/
  // per-conference check below (re-review finding A). If THIS IP is over
  // its own limit, mark the attempt rejected and stop here: never even
  // query (let alone let this attempt count toward) the global/per-
  // conference ceilings, which exist to protect OTHER IPs/conferences
  // from someone else's flood, not to also punish everyone else for THIS
  // IP's own violation.
  const [recentShort, recentDay] = await Promise.all([
    countRecentSubmissionAttempts(ipHash, RATE_LIMIT_SHORT_WINDOW_MS),
    countRecentSubmissionAttempts(ipHash, RATE_LIMIT_DAY_WINDOW_MS),
  ]);
  if (recentShort > RATE_LIMIT_SHORT_MAX || recentDay > RATE_LIMIT_DAY_MAX) {
    await markSubmissionAttemptRejected(attemptId);
    return NextResponse.json(
      { error: 'Too many submissions from this network. Please try again later.' },
      { status: 429, headers: NO_STORE }
    );
  }

  // Global and per-conference ceilings — these queries filter out rows
  // already marked `rejected` (db.ts), so a different IP's rejected flood
  // can't 429 this request.
  const [recentGlobal, recentConference] = await Promise.all([
    countGlobalRecentSubmissionAttempts(GLOBAL_HOURLY_WINDOW_MS),
    body.conference ? countConferenceRecentSubmissionAttempts(body.conference, CONFERENCE_DAILY_WINDOW_MS) : Promise.resolve(0),
  ]);
  if (recentGlobal > GLOBAL_HOURLY_MAX || recentConference > CONFERENCE_DAILY_MAX) {
    await markSubmissionAttemptRejected(attemptId);
    return NextResponse.json(
      { error: 'Too many submissions right now. Please try again later.' },
      { status: 429, headers: NO_STORE }
    );
  }

  if (!isAllowlistedEventLink(body.url)) {
    return NextResponse.json(
      { error: "That link isn't from a supported event platform (Luma, Partiful, Eventbrite, Meetup, or Posh)." },
      { status: 400, headers: NO_STORE }
    );
  }

  // Re-review finding E: if this is a Luma link and the shared enrichment
  // budget for this hour is already used up, say so honestly — falling
  // through to `processDiscoveredLink` would just surface as an
  // enrichment failure (an `error`/`unchanged` outcome) that the success
  // path below would otherwise report back as a cheerful "thanks, we'll
  // review this," which isn't true if we never even looked.
  if (allowlistedPlatformFor(body.url) === 'luma' && sharedSubmissionLumaLimiter.exhausted) {
    return NextResponse.json(
      { error: "We're rate-limited on Luma lookups right now — please try again in a few minutes." },
      { status: 429, headers: NO_STORE }
    );
  }

  let tabs;
  try {
    tabs = await getConferenceTabs();
  } catch {
    return NextResponse.json({ error: 'Could not load conferences' }, { status: 503, headers: NO_STORE });
  }
  const tab = tabs.find((t) => t.name === body.conference);
  if (!tab) {
    return NextResponse.json({ error: `Unknown conference: ${body.conference}` }, { status: 400, headers: NO_STORE });
  }

  const profile = await getProfile(body.conference);
  if (!profile || !profile.enabled) {
    return NextResponse.json(
      { error: "This conference isn't accepting link submissions yet — try the main submit form instead." },
      { status: 400, headers: NO_STORE }
    );
  }

  const source = await getOrCreateHostSubmissionSource(body.conference);
  if (!source.enabled) {
    return NextResponse.json(
      { error: 'Link submissions are temporarily closed for this conference.' },
      { status: 400, headers: NO_STORE }
    );
  }

  // Optional: a signed-in, previously-verified Luma host gets a trust
  // signal (§3.5 — "mark it and give a trust signal, but still don't
  // auto-publish"). Best-effort: an absent/invalid token just means an
  // anonymous submission, never an error.
  const supabase = getIngestSupabase();
  let isVerifiedSubmitter = false;
  const token = getBearerToken(req);
  if (token) {
    try {
      const { data: userData } = await supabase.auth.getUser(token);
      if (userData?.user) {
        const { count } = await supabase
          .from('verified_luma_hosts')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userData.user.id)
          .is('revoked_at', null);
        isVerifiedSubmitter = (count ?? 0) > 0;
      }
    } catch {
      // Treat as anonymous.
    }
  }

  const canonicalKey = normalizeEventLink(body.url);
  if (!canonicalKey) {
    return NextResponse.json({ error: 'Invalid URL.' }, { status: 400, headers: NO_STORE });
  }
  const existing = await getCandidateByKeyOrAltKey(body.conference, canonicalKey);

  const themeProfile = profileRowToThemeProfile(profile);
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  let sheetEvents;
  try {
    sheetEvents = await fetchEvents(undefined, [tab]);
  } catch {
    return NextResponse.json({ error: 'Could not load this conference\'s events right now. Please try again shortly.' }, { status: 503, headers: NO_STORE });
  }
  // maxResolutions: 0 — a single public submission shouldn't spend this
  // conference's shared Luma rate-limit budget resolving OTHER events'
  // vanity slugs (same rationale as the admin queue route's approve path).
  const linkIndex = await buildSheetLinkIndex(sheetEvents.map((e) => ({ id: e.id, link: e.link })), { maxResolutions: 0 });
  const otherCandidates: DedupeCandidatePool[] = (await listRecentCandidatesForDedupe(body.conference)).map((c) => ({
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
  const { fewShot, learnedHosts } = await loadLearningContext({ conference: body.conference, themeKey: profile.theme_key });
  const sponsorNames = await getSponsorNamesForConference(body.conference);
  const computeHostSignals = buildHostSignalComputer({ profile, verifiedHostIds, organizerCounts, learnedHosts });

  // Review finding, HIGH item 2: the monthly LLM budget cap applies here
  // too, same as every other candidate source — a flood of submissions
  // (even within the rate limits above) must not blow through the cap
  // silently.
  const budget = await checkMonthlyBudget();

  const outcome = await processDiscoveredLink(body.url, existing, {
    conference: body.conference,
    tab,
    profile,
    themeProfile,
    client,
    supabase,
    sourceId: source.id,
    sourceKind: 'host_submission',
    sourceTrust: 'discovery',
    sourceRef: null,
    enrichLimiter: sharedSubmissionLumaLimiter,
    linkFetchLimiter: new PacedLinkLimiter(5, 500),
    linkIndex,
    sheetEvents,
    otherCandidates,
    fewShot,
    sponsorNames,
    computeHostSignals,
    isVerifiedSubmitter,
    canClassify: () => !budget.exceeded,
  });

  if (outcome.kind === 'invalid') {
    return NextResponse.json({ error: "Couldn't read that link as an event. Double-check the URL." }, { status: 400, headers: NO_STORE });
  }

  if (outcome.kind === 'skipped_final' || outcome.kind === 'unchanged') {
    // Already a finalized/decided candidate, or literally unchanged since
    // last time — nothing new to classify. Just bump `last_seen_at` and
    // give a friendly "already got this one" notice rather than silently
    // doing nothing.
    // Both carry `existingId` directly now — `skipped_final` may be keyed
    // off a candidate `processDiscoveredLink` resolved internally (a short
    // Luma link re-keyed onto its `evt-…` candidate), which can differ from
    // this route's own cheap `existing` lookup above.
    await updateCandidate(outcome.existingId, { last_seen_at: new Date().toISOString() });
    return NextResponse.json(
      { success: true, status: 'duplicate', message: 'This event has already been submitted and is in review.' },
      { headers: NO_STORE }
    );
  }

  if (outcome.kind === 'protected') {
    // Review finding, MEDIUM item 4: this URL resolves to a candidate a
    // higher-trust source (most likely a curated Luma calendar) already
    // created — a public submission must never reclassify it, let alone
    // revive an `auto_rejected` one. Append our source ref and move on.
    await updateCandidate(outcome.existingId, { sources: outcome.sources, last_seen_at: new Date().toISOString() });
    return NextResponse.json(
      { success: true, status: 'duplicate', message: 'This event has already been submitted and is in review.' },
      { headers: NO_STORE }
    );
  }

  if (outcome.kind === 'deferred') {
    // Luma was transiently unavailable (rate limit / upstream error) —
    // nothing was recorded; ask the submitter to retry rather than
    // claiming we'll review something we never looked at.
    return NextResponse.json(
      { error: "We couldn't reach Luma to read that event just now. Please try again in a few minutes." },
      { status: 503, headers: NO_STORE }
    );
  }

  if (outcome.kind === 'prefiltered') {
    // Only reachable with source-provided dates, which submissions never
    // pass today — handled for exhaustiveness.
    return NextResponse.json(
      { success: true, status: 'rejected', message: "Thanks — this didn't look like a fit for this conference, so it won't be added." },
      { status: 201, headers: NO_STORE }
    );
  }

  await upsertCandidate(outcome.row);
  // Review finding, HIGH item 2: record cost whenever there IS cost, not
  // only when classification succeeded — a `ClassifierError` with usage
  // (the model returned a completion that just failed schema validation)
  // still bills tokens and must still count toward the monthly cap.
  if (outcome.inputTokens > 0 || outcome.outputTokens > 0) {
    await recordSubmissionAttemptCost(attemptId, {
      costUsd: outcome.costUsd,
      inputTokens: outcome.inputTokens,
      outputTokens: outcome.outputTokens,
    });
  }

  // Keep the public response minimal — no score/reason, no internal ids.
  const publicStatus =
    outcome.row.status === 'duplicate'
      ? 'duplicate'
      : outcome.row.status === 'auto_rejected'
        ? 'rejected'
        : 'queued';
  const message =
    publicStatus === 'duplicate'
      ? 'This looks like an event we already have — thanks anyway!'
      : publicStatus === 'rejected'
        ? "Thanks — this didn't look like a fit for this conference, so it won't be added."
        : "Thanks! We'll review this and add it if it's a good fit.";

  return NextResponse.json({ success: true, status: publicStatus, message }, { status: 201, headers: NO_STORE });
}
