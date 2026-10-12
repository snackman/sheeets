// Public host-submission endpoint (Phase 3, plans/event-ingestion.md §3.5).
// A host submits one event link for a conference. Unlike the existing
// anonymous `/api/submit-event` (which writes straight into the sheet's
// review section), everything here lands in `ingest_candidates` as
// `discovery` trust and goes through the exact same dedupe/filter/signals/
// classify pipeline every other discovered link does — never straight to
// the sheet, never auto-published (§10 item 4). The pre-existing
// `/api/submit-event` flow is unchanged.
//
// Anti-abuse (§Phase 3 constraints):
//  1. Rate limiting per IP (`ingest_submission_attempts`, hashed IPs).
//  2. URL validation: allowlisted event platforms only (Luma, Partiful,
//     Eventbrite, Meetup, Posh) — `isAllowlistedEventLink`.
//  3. Cloudflare Turnstile, BEST-EFFORT: only enforced when
//     `TURNSTILE_SECRET_KEY` is set. The repo has no existing captcha and
//     no Turnstile site/secret key provisioned yet (see the PR
//     description's env-var list) — rate limiting + the platform allowlist
//     are the two anti-abuse layers that are always on; Turnstile is
//     additive once Snax provisions a Cloudflare Turnstile widget.
import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import OpenAI from 'openai';
import { getConferenceTabs } from '@/lib/get-conferences';
import { parseBody, HostSubmissionSchema } from '@/lib/api-validation';
import { getBearerToken } from '@/lib/server-auth';
import { fetchEvents } from '@/lib/fetch-events';
import { normalizeEventLink } from '@/lib/luma';
import { isAllowlistedEventLink } from '@/lib/ingest/allowlist';
import {
  getProfile,
  profileRowToThemeProfile,
  getOrCreateHostSubmissionSource,
  getCandidateByKey,
  upsertCandidate,
  updateCandidate,
  listRecentCandidatesForDedupe,
  recordAdhocCost,
  recordSubmissionAttempt,
  countRecentSubmissionAttempts,
  getIngestSupabase,
} from '@/lib/ingest/db';
import { buildSheetLinkIndex, type DedupeCandidatePool } from '@/lib/ingest/dedupe';
import { getSponsorNamesForConference } from '@/lib/ingest/sponsors';
import { loadLearningContext } from '@/lib/ingest/learning';
import { LumaEnrichmentLimiter } from '@/lib/ingest/enrich';
import { processDiscoveredLink, PacedLinkLimiter, buildHostSignalComputer } from '@/lib/ingest/discover';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const NO_STORE = { 'Cache-Control': 'private, no-store' };

/** Two windows, same spirit as `CLAIM_LIMITS` (#177): a tight short window
 *  stops a fast script, a looser daily cap stops someone grinding it out
 *  by hand over a day. Deliberately conservative — the median legitimate
 *  host submits once, maybe twice if they typo the link. */
const RATE_LIMIT_SHORT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_SHORT_MAX = 5;
const RATE_LIMIT_DAY_WINDOW_MS = 24 * 60 * 60 * 1000;
const RATE_LIMIT_DAY_MAX = 15;

function hashIp(ip: string): string {
  return createHash('sha256').update(ip).digest('hex');
}

/** Best-effort client IP from the headers Vercel/most proxies set.
 *  `x-forwarded-for` can be a comma-separated chain; the first entry is
 *  the original client. Falls back to a constant so a request with no
 *  such header at all (e.g. local dev) still gets ITS OWN consistent
 *  rate-limit bucket rather than every such request sharing one. */
function getClientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) {
    const first = fwd.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get('x-real-ip');
  if (real) return real.trim();
  return 'unknown';
}

async function verifyTurnstile(token: string | undefined, ip: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true; // not configured — best-effort layer, see file doc comment
  if (!token) return false;
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token, remoteip: ip }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return false;
    const json = await res.json();
    return json?.success === true;
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const { data: body, error: parseError } = await parseBody(req, HostSubmissionSchema);
  if (parseError) return parseError;

  const ip = getClientIp(req);
  const ipHash = hashIp(ip);

  // Rate limit BEFORE any real work, and record the attempt regardless of
  // what happens next (valid or not) — a flood of deliberately-invalid
  // requests must count against the limit too, or the limit is trivially
  // bypassed by never sending a valid one.
  const [recentShort, recentDay] = await Promise.all([
    countRecentSubmissionAttempts(ipHash, RATE_LIMIT_SHORT_WINDOW_MS),
    countRecentSubmissionAttempts(ipHash, RATE_LIMIT_DAY_WINDOW_MS),
  ]);
  if (recentShort >= RATE_LIMIT_SHORT_MAX || recentDay >= RATE_LIMIT_DAY_MAX) {
    return NextResponse.json(
      { error: 'Too many submissions from this network. Please try again later.' },
      { status: 429, headers: NO_STORE }
    );
  }
  await recordSubmissionAttempt(ipHash, body.conference || null);

  if (!(await verifyTurnstile(body.turnstileToken, ip))) {
    return NextResponse.json({ error: 'Captcha verification failed. Please try again.' }, { status: 400, headers: NO_STORE });
  }

  if (!isAllowlistedEventLink(body.url)) {
    return NextResponse.json(
      { error: "That link isn't from a supported event platform (Luma, Partiful, Eventbrite, Meetup, or Posh)." },
      { status: 400, headers: NO_STORE }
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
  const existing = await getCandidateByKey(body.conference, canonicalKey);

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
    enrichLimiter: new LumaEnrichmentLimiter(5, 1000),
    linkFetchLimiter: new PacedLinkLimiter(5, 500),
    linkIndex,
    sheetEvents,
    otherCandidates,
    fewShot,
    sponsorNames,
    computeHostSignals,
    isVerifiedSubmitter,
    canClassify: () => true, // one submission, one classification — the monthly cap is a pipeline-run concern, not worth a DB round trip here
  });

  if (outcome.kind === 'invalid') {
    return NextResponse.json({ error: "Couldn't read that link as an event. Double-check the URL." }, { status: 400, headers: NO_STORE });
  }

  if (outcome.kind === 'skipped_final' || outcome.kind === 'unchanged') {
    // Already a finalized/decided candidate, or literally unchanged since
    // last time — nothing new to classify. Just bump `last_seen_at` and
    // give a friendly "already got this one" notice rather than silently
    // doing nothing.
    const existingId = outcome.kind === 'unchanged' ? outcome.existingId : existing?.id;
    if (existingId) await updateCandidate(existingId, { last_seen_at: new Date().toISOString() });
    return NextResponse.json(
      { success: true, status: 'duplicate', message: 'This event has already been submitted and is in review.' },
      { headers: NO_STORE }
    );
  }

  await upsertCandidate(outcome.row);
  if (outcome.classified) {
    await recordAdhocCost({
      conference: body.conference,
      trigger: 'manual',
      sourceId: source.id,
      inputTokens: outcome.inputTokens,
      outputTokens: outcome.outputTokens,
      costUsd: outcome.costUsd,
      counts: { classified: 1 },
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
