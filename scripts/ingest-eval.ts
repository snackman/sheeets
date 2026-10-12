/**
 * Theme-classifier eval harness (plan §13.2, Phase 1a).
 *
 * Three modes:
 *
 *   npx tsx scripts/ingest-eval.ts build-fixture [--sample-out <path>]
 *     Assembles the labeled set from the live sheet tabs (+ a local
 *     hard-negative seed) and writes it to `scripts/fixtures/ingest-eval.json`
 *     (gitignored — regenerate locally, don't commit the full set). Also
 *     writes a small stratified sample (<=50 rows) to
 *     `scripts/fixtures/ingest-eval-sample.json`, which IS committed, for
 *     unit tests. Needs no OpenAI key — only network access to the sheet
 *     (and optionally Supabase, for more conference tabs / rejected
 *     submissions; both degrade gracefully to what's reachable). A cheap
 *     keyword pre-check drops cross-theme "negatives" that actually match
 *     the target theme's include keywords (mixed calendars, e.g. a crypto
 *     event on a general tech-week tab) — see DROPPED_NOISY_XNEG_LOG below.
 *
 *   npx tsx scripts/ingest-eval.ts [--fixture <path>] [--limit N]
 *       [--profile <themeKey>] [--model <id>] [--effort <level>]
 *     Classifies the labeled set (a stratified `--limit` sample across
 *     label x source, so negatives are never crowded out by the positives
 *     that get built first) and reports precision/recall at the publish
 *     (85) and review (40) thresholds, a confusion summary, and the 5
 *     worst misclassifications. Requires OPENAI_API_KEY (checked, never
 *     printed). Without it the script exits without making any API calls.
 *
 *   npx tsx scripts/ingest-eval.ts compare [--limit N] [--fixture <path>]
 *     Runs the SAME stratified sample through a fixed set of model/effort
 *     configs (gpt-5-nano at 'minimal' and 'low', gpt-5-mini at 'minimal')
 *     and prints a side-by-side precision/recall/cost-per-1000 table, plus
 *     the worst 5 misclassifications for whichever config has the best
 *     precision@85 (ties broken by recall@40).
 *
 * Positives: each conference's own sheet tab, labeled on_theme for that
 * conference's theme profile.
 * Negatives: (a) cross-theme — other conferences' tabs scored against a
 * different theme, when more than one theme is reachable, with the
 * keyword pre-check above dropping ones that look genuinely on-theme;
 * (b) a small hand-picked hard-negative seed (non-crypto generic city
 * events); (c) rejected `event_submissions` rows with off-theme reasons,
 * when Supabase credentials are available.
 *
 * No --batch mode: unlike Anthropic's Batch API (same request shape, just
 * async), OpenAI's Batch API needs a separate file-based workflow — upload a
 * JSONL file of requests, create a batch against that file id, poll (most
 * batches finish within an hour, but OpenAI's SLA is up to 24h), then
 * download and parse a JSONL output file. That's a lot of extra surface for
 * an eval harness whose point is a quick iteration loop, and at these
 * models' prices the batch 50% discount is fractions of a cent at our
 * volumes. Dropped per go-ahead to do so if simpler — sync calls are fast
 * enough at `--limit 200`.
 *
 * Env vars:
 *   OPENAI_API_KEY             required to classify (build-fixture doesn't need it)
 *   INGEST_MODEL                optional — overrides the classifier model (src/lib/ingest/classifier.ts)
 *   NEXT_PUBLIC_SUPABASE_URL,
 *   SUPABASE_SERVICE_ROLE_KEY  optional — more conference tabs + rejected-submission negatives
 */
import * as fs from 'fs';
import * as path from 'path';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

import { fetchEvents } from '../src/lib/fetch-events';
import { FALLBACK_TABS } from '../src/lib/conferences';
import type { TabConfig } from '../src/lib/conferences';
import type { ETHDenverEvent } from '../src/lib/types';
import { detectPlatform } from '../src/lib/event-extractors';
import { getValidLumaSlug, extractMirrorText, snapshotHosts } from '../src/lib/luma';
import { fetchLumaEvent } from '../src/lib/luma-server';
import {
  type ClassifierEventInput,
  type ClassifierOutput,
  type ThemeKey,
} from '../src/lib/ingest/types';
import { DEFAULT_THEME_PROFILES } from '../src/lib/ingest/profiles';
import { computeSignals, combineFinalScore, routeCandidate, type Route } from '../src/lib/ingest/signals';
import { INGEST_MODEL, PROMPT_VERSION, classifyEvent, type ReasoningEffort } from '../src/lib/ingest/classifier';
import { priceForModel } from '../src/lib/ingest/pricing';

/** $/MTok by model, for cost estimates — shared with `src/lib/ingest/
 *  pricing.ts` (Phase 2 follow-up; this used to be its own duplicate
 *  table). The eval harness's default sweep model is the cheaper
 *  `gpt-5-nano`, unlike the production default (`gpt-5-mini`), so it keeps
 *  its own fallback by passing it explicitly. */
function priceFor(model: string) {
  return priceForModel(model, 'gpt-5-nano');
}

/** `String(err)` on a `ClassifierError` loses its `.cause` (the real reason,
 *  e.g. an OpenAI API error) — surface it so eval error logs are actionable. */
function describeError(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    const causeStr = cause instanceof Error ? cause.message : cause ? String(cause) : undefined;
    return causeStr ? `${err.message} (${causeStr})` : err.message;
  }
  return String(err);
}

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const FULL_FIXTURE_PATH = path.join(FIXTURES_DIR, 'ingest-eval.json');
const SAMPLE_FIXTURE_PATH = path.join(FIXTURES_DIR, 'ingest-eval-sample.json');
const HARD_NEGATIVES_PATH = path.join(FIXTURES_DIR, 'ingest-hard-negatives.json');
const LUMA_CACHE_PATH = path.join(FIXTURES_DIR, '.ingest-eval-luma-cache.json');

const SAMPLE_SIZE = 50;
const LUMA_RATE_LIMIT_MS = 1000;
/** Raised from 300 (tuning round): the fetch is free and rate-limited, only
 *  script runtime is the cost, and thin-description events were the single
 *  biggest source of recall loss in the first eval run. Still capped so a
 *  bad run can't loop forever; the cache makes repeat runs incremental. */
const MAX_LUMA_ENRICHMENTS = 3000;

type ExampleSource = 'sheet_own_tab' | 'sheet_cross_theme' | 'hard_negative' | 'rejected_submission';

interface EvalExample {
  id: string;
  /** Conference whose theme profile this example is scored against. */
  conference: string;
  themeKey: ThemeKey;
  label: 'on_theme' | 'off_theme';
  source: ExampleSource;
  event: ClassifierEventInput;
}

interface HardNegativeSeed {
  themeKey: ThemeKey;
  name: string;
  organizer?: string;
  venue?: string;
  descriptionText?: string;
  platform?: string;
  cost?: string;
}

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]) {
  const args = {
    command: 'run' as 'run' | 'build-fixture' | 'compare',
    limit: undefined as number | undefined,
    profile: undefined as ThemeKey | undefined,
    batch: false,
    fixture: undefined as string | undefined,
    sampleOut: undefined as string | undefined,
    model: undefined as string | undefined,
    effort: undefined as ReasoningEffort | undefined,
  };
  const rest = [...argv];
  if (rest[0] === 'build-fixture' || rest[0] === 'compare') {
    args.command = rest[0];
    rest.shift();
  }
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--limit') args.limit = parseInt(rest[++i], 10);
    else if (a === '--profile') args.profile = rest[++i] as ThemeKey;
    else if (a === '--batch') args.batch = true;
    else if (a === '--fixture') args.fixture = rest[++i];
    else if (a === '--sample-out') args.sampleOut = rest[++i];
    else if (a === '--model') args.model = rest[++i];
    else if (a === '--effort') args.effort = rest[++i] as ReasoningEffort;
  }
  return args;
}

// ---------------------------------------------------------------------------
// Theme assignment — which theme profile a sheet tab is scored against.
// Phase 1b moves this into `ingest_profiles` (one row per conference, admin
// editable); for the eval harness today we infer it from the conference
// name, with explicit overrides for conferences we know about.
// ---------------------------------------------------------------------------

const THEME_OVERRIDES: Record<string, ThemeKey> = {
  'Paris Blockchain Week 2026': 'crypto',
  'Bitcoin Vegas': 'crypto',
  'Consensus Miami': 'crypto',
  'GDC': 'gaming',
  'SXSW': 'tech',
};

function inferThemeKey(conferenceName: string): ThemeKey {
  if (THEME_OVERRIDES[conferenceName]) return THEME_OVERRIDES[conferenceName];
  const n = conferenceName.toLowerCase();
  if (/(gdc|game dev|gaming)/.test(n)) return 'gaming';
  if (/(sxsw|south by)/.test(n)) return 'tech';
  if (/(art basel|art week|frieze)/.test(n)) return 'art';
  if (/(music|sxsw music|festival)/.test(n)) return 'music';
  if (/(ai\b|artificial intelligence)/.test(n)) return 'ai';
  // Added nft/coin/webx (tuning round): "NFT NYC" and "Coinfest Asia" were
  // falling through to the generic 'tech' bucket and then getting used as
  // cross-theme-negative TARGETS for genuinely crypto events sourced from
  // other crypto tabs — a labeling bug, not model error. "WebX" (Tokyo) is
  // also a crypto/Web3 conference.
  if (/(crypto|blockchain|bitcoin|eth|web3|webx|consensus|token|defi|nft|coin)/.test(n)) return 'crypto';
  return 'tech';
}

// ---------------------------------------------------------------------------
// Noisy cross-theme negative pre-check (tuning round)
// ---------------------------------------------------------------------------

function countKeywordHits(text: string, includeKeywords: string[]): number {
  const signals = computeSignals({ text, includeKeywords, excludeKeywords: [] });
  return Object.keys(signals.breakdown).filter((k) => k.startsWith('keyword:') && k !== 'keyword:cap').length;
}

/**
 * A cheap keyword check (reuses the same word-boundary matcher as
 * `signals.ts`) for whether an event's own text clearly matches the target
 * theme — used to drop cross-theme "negatives" drawn from mixed calendars
 * (e.g. a crypto-focused event that happens to be listed on a general
 * tech-week tab, such as "Solana Career Night Toronto" — a single hit, but
 * it's in the title). "Clearly matches" is one include-keyword hit in the
 * event's own NAME (a title built from the theme's own vocabulary is a
 * deliberate, strong signal), or two-or-more hits anywhere across
 * name/hosts/organizer/description (the same bar `computeSignals` uses for
 * its own +15 cap) when the title alone doesn't give it away. This is
 * intentionally cheap, not precise — a generic name that happens to contain
 * a common keyword (e.g. "exchange") can still get dropped; see the PR
 * description for the count of examples this removed.
 */
function looksOnTheme(event: ClassifierEventInput, includeKeywords: string[]): boolean {
  if (includeKeywords.length === 0) return false;
  if (countKeywordHits(event.name, includeKeywords) >= 1) return true;
  const fullText = `${event.name} ${(event.hosts ?? []).join(' ')} ${event.organizer ?? ''} ${event.descriptionText ?? ''}`;
  return countKeywordHits(fullText, includeKeywords) >= 2;
}

// ---------------------------------------------------------------------------
// Sheet event -> classifier input
// ---------------------------------------------------------------------------

function stableId(parts: (string | undefined)[]): string {
  const input = parts.filter(Boolean).join('|');
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

function toClassifierInput(e: ETHDenverEvent, descriptionText?: string, hosts?: string[]): ClassifierEventInput {
  return {
    name: e.name,
    hosts: hosts && hosts.length ? hosts : e.organizer ? [e.organizer] : [],
    // The sheet tab an event was sourced from is our proxy for "calendar"
    // until Phase 1b's real per-calendar ingestion — it's extra topical
    // context the model can use when there's no description (tuning round).
    calendarName: e.conference || null,
    organizer: e.organizer || null,
    venue: e.address || null,
    dateISO: e.dateISO || null,
    startTime: e.startTime || null,
    cost: e.cost || null,
    platform: e.link ? (detectPlatform(e.link) ?? 'generic') : null,
    descriptionText: descriptionText ?? e.note ?? null,
  };
}

// ---------------------------------------------------------------------------
// Luma enrichment (optional, cached, rate-limited — §3.1 policy)
// ---------------------------------------------------------------------------

type LumaCache = Record<string, { descriptionText: string; hosts: string[] } | null>;

function loadLumaCache(): LumaCache {
  try {
    return JSON.parse(fs.readFileSync(LUMA_CACHE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveLumaCache(cache: LumaCache) {
  fs.writeFileSync(LUMA_CACHE_PATH, JSON.stringify(cache, null, 2));
}

async function enrichLumaLinks(events: ETHDenverEvent[]): Promise<Map<string, { descriptionText: string; hosts: string[] }>> {
  const cache = loadLumaCache();
  const out = new Map<string, { descriptionText: string; hosts: string[] }>();
  let fetched = 0;

  for (const e of events) {
    const slug = getValidLumaSlug(e.link);
    if (!slug) continue;
    if (cache[slug]) {
      out.set(e.link, cache[slug]!);
      continue;
    }
    if (cache[slug] === null) continue; // previously failed, don't retry every run
    if (fetched >= MAX_LUMA_ENRICHMENTS) continue;

    try {
      await new Promise((r) => setTimeout(r, LUMA_RATE_LIMIT_MS));
      const payload = await fetchLumaEvent({ slug });
      const descriptionText = extractMirrorText(payload.description_mirror);
      const hosts = snapshotHosts(payload)
        .map((h) => h.name)
        .filter((n): n is string => !!n);
      cache[slug] = { descriptionText, hosts };
      out.set(e.link, cache[slug]!);
      fetched++;
    } catch {
      cache[slug] = null;
    }
  }

  saveLumaCache(cache);
  return out;
}

// ---------------------------------------------------------------------------
// build-fixture
// ---------------------------------------------------------------------------

async function getTabsForFixture(): Promise<TabConfig[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return FALLBACK_TABS;
  try {
    const supabase = createClient(url, key);
    const { data, error } = await supabase.from('admin_config').select('value').eq('key', 'conferences').single();
    if (error || !data?.value) return FALLBACK_TABS;
    const { conferenceToTab } = await import('../src/lib/conferences');
    const confs = data.value as { gid: number; name: string; slug: string; timezone: string; startDate: string; endDate: string; center: { lat: number; lng: number } }[];
    const tabs = confs.map(conferenceToTab);
    return tabs.length > 0 ? tabs : FALLBACK_TABS;
  } catch {
    return FALLBACK_TABS;
  }
}

async function fetchRejectedSubmissionNegatives(): Promise<EvalExample[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return [];
  try {
    const supabase = createClient(url, key);
    const { data, error } = await supabase
      .from('event_submissions')
      .select('*')
      .eq('status', 'rejected')
      .ilike('reject_reason', '%off%theme%')
      .limit(500);
    if (error || !data) return [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data as any[]).map((row) => {
      const conference = row.conference || 'Unknown';
      const themeKey = inferThemeKey(conference);
      return {
        id: `sub-${row.id}`,
        conference,
        themeKey,
        label: 'off_theme' as const,
        source: 'rejected_submission' as const,
        event: {
          name: row.name || '',
          organizer: row.organizer || null,
          venue: row.address || null,
          dateISO: row.date_iso || null,
          startTime: row.start_time || null,
          cost: row.cost || null,
          platform: row.link ? detectPlatform(row.link) ?? 'generic' : null,
          descriptionText: row.note || null,
        },
      };
    });
  } catch {
    return [];
  }
}

async function buildFixture(sampleOutOverride?: string) {
  console.log('Fetching conference tabs...');
  const tabs = await getTabsForFixture();
  console.log(`  ${tabs.length} tab(s): ${tabs.map((t) => t.name).join(', ')}`);

  console.log('Fetching sheet events for all tabs...');
  const events = await fetchEvents(undefined, tabs);
  console.log(`  ${events.length} sheet event(s)`);

  console.log(`Enriching Luma links (rate-limited, cached, cap ${MAX_LUMA_ENRICHMENTS})...`);
  const enrichment = await enrichLumaLinks(events);
  console.log(`  enriched ${enrichment.size} link(s) (cache: ${LUMA_CACHE_PATH})`);

  const eventsByTheme = new Map<ThemeKey, ETHDenverEvent[]>();
  for (const e of events) {
    const theme = inferThemeKey(e.conference);
    eventsByTheme.set(theme, [...(eventsByTheme.get(theme) ?? []), e]);
  }

  const examples: EvalExample[] = [];

  // Positives: each conference's own tab, scored against its own theme.
  for (const e of events) {
    const themeKey = inferThemeKey(e.conference);
    const enriched = enrichment.get(e.link);
    examples.push({
      id: `pos-${stableId([e.conference, e.dateISO, e.startTime, e.name])}`,
      conference: e.conference,
      themeKey,
      label: 'on_theme',
      source: 'sheet_own_tab',
      event: toClassifierInput(e, enriched?.descriptionText, enriched?.hosts),
    });
  }

  // Cross-theme negatives: events from a *different* theme's tab, scored
  // against each conference whose tab theme differs. Reported separately
  // because it's an easy negative (§13.2 (a)) — but mixed calendars mean
  // it isn't always clean (a crypto-focused event can live on a general
  // tech-week tab), so a cheap keyword pre-check drops ones that clearly
  // match the TARGET theme's own include keywords (tuning round).
  const conferencesSeen = Array.from(new Set(events.map((e) => e.conference)));
  let droppedNoisyCrossTheme = 0;
  for (const conference of conferencesSeen) {
    const targetTheme = inferThemeKey(conference);
    const targetProfile = DEFAULT_THEME_PROFILES[targetTheme as Exclude<ThemeKey, 'custom'>] ?? DEFAULT_THEME_PROFILES.tech;
    for (const [theme, themeEvents] of eventsByTheme) {
      if (theme === targetTheme) continue;
      for (const e of themeEvents) {
        const enriched = enrichment.get(e.link);
        const classifierEvent = toClassifierInput(e, enriched?.descriptionText, enriched?.hosts);
        if (looksOnTheme(classifierEvent, targetProfile.includeKeywords)) {
          droppedNoisyCrossTheme++;
          continue;
        }
        examples.push({
          id: `xneg-${stableId([conference, e.conference, e.dateISO, e.startTime, e.name])}`,
          conference,
          themeKey: targetTheme,
          label: 'off_theme',
          source: 'sheet_cross_theme',
          event: classifierEvent,
        });
      }
    }
  }
  console.log(
    `  dropped ${droppedNoisyCrossTheme} cross-theme "negative(s)" that matched >=2 of the target ` +
      'theme\'s include keywords (noisy mixed-calendar labels — tuning round).'
  );
  if (eventsByTheme.size <= 1) {
    console.log(
      '  only one theme reachable from current tabs — cross-theme negatives are empty. ' +
        'Set NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY to pull additional ' +
        'non-crypto conference tabs (e.g. GDC, SXSW) for a stronger cross-theme set.'
    );
  }

  // Hard negatives: hand-picked seed, applied to every conference sharing that theme.
  const hardNegatives: HardNegativeSeed[] = JSON.parse(fs.readFileSync(HARD_NEGATIVES_PATH, 'utf8'));
  for (const conference of conferencesSeen) {
    const targetTheme = inferThemeKey(conference);
    for (const hn of hardNegatives.filter((h) => h.themeKey === targetTheme)) {
      examples.push({
        id: `hneg-${stableId([conference, hn.name])}`,
        conference,
        themeKey: targetTheme,
        label: 'off_theme',
        source: 'hard_negative',
        event: {
          name: hn.name,
          organizer: hn.organizer ?? null,
          venue: hn.venue ?? null,
          cost: hn.cost ?? null,
          platform: hn.platform ?? null,
          descriptionText: hn.descriptionText ?? null,
        },
      });
    }
  }

  // Rejected submissions (needs Supabase; empty otherwise).
  const rejected = await fetchRejectedSubmissionNegatives();
  examples.push(...rejected);

  fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  fs.writeFileSync(FULL_FIXTURE_PATH, JSON.stringify(examples, null, 2));
  console.log(`Wrote ${examples.length} example(s) to ${FULL_FIXTURE_PATH} (gitignored).`);

  const bySource = new Map<ExampleSource, number>();
  for (const ex of examples) bySource.set(ex.source, (bySource.get(ex.source) ?? 0) + 1);
  console.log('  by source:', Object.fromEntries(bySource));

  const sample = stratifiedSample(examples, SAMPLE_SIZE);
  const sampleOut = sampleOutOverride ?? SAMPLE_FIXTURE_PATH;
  fs.writeFileSync(sampleOut, JSON.stringify(sample, null, 2));
  console.log(`Wrote a ${sample.length}-row sample to ${sampleOut} (commit this one).`);
}

/** Deterministic stratified sample across label x source, capped at `size`. */
function stratifiedSample(examples: EvalExample[], size: number): EvalExample[] {
  const groups = new Map<string, EvalExample[]>();
  for (const ex of examples) {
    const key = `${ex.label}:${ex.source}`;
    groups.set(key, [...(groups.get(key) ?? []), ex]);
  }
  const keys = Array.from(groups.keys()).sort();
  const perGroup = Math.max(1, Math.floor(size / Math.max(1, keys.length)));
  const out: EvalExample[] = [];
  for (const key of keys) {
    const items = groups.get(key)!.slice().sort((a, b) => a.id.localeCompare(b.id));
    out.push(...items.slice(0, perGroup));
    if (out.length >= size) break;
  }
  return out.slice(0, size);
}

// ---------------------------------------------------------------------------
// Classify + report
// ---------------------------------------------------------------------------

interface ScoredExample {
  example: EvalExample;
  output: ClassifierOutput | null;
  finalScore: number | null;
  route: Route | null;
  error?: string;
  inputTokens: number;
  outputTokens: number;
}

function profileFor(themeKey: ThemeKey) {
  if (themeKey === 'custom') return DEFAULT_THEME_PROFILES.tech;
  return DEFAULT_THEME_PROFILES[themeKey];
}

async function classifySync(
  client: OpenAI,
  examples: EvalExample[],
  modelOverride?: string,
  effortOverride?: ReasoningEffort
): Promise<ScoredExample[]> {
  const out: ScoredExample[] = [];
  for (const example of examples) {
    const profile = profileFor(example.themeKey);
    try {
      const result = await classifyEvent({
        client,
        profile,
        conference: { name: example.conference },
        event: example.event,
        model: modelOverride,
        reasoningEffort: effortOverride,
      });
      const signals = computeSignals({
        text: `${example.event.name} ${(example.event.hosts ?? []).join(' ')} ${example.event.organizer ?? ''} ${example.event.descriptionText ?? ''}`,
        includeKeywords: profile.includeKeywords,
        excludeKeywords: profile.excludeKeywords,
        injectionDetected: result.injectionDetected,
      });
      const finalScore = combineFinalScore(result.output.theme_score, signals);
      const route = routeCandidate({
        isEvent: result.output.is_event,
        llmScore: result.output.theme_score,
        dataQuality: result.output.data_quality,
        signals,
        profile,
      });
      out.push({ example, output: result.output, finalScore, route, inputTokens: result.inputTokens, outputTokens: result.outputTokens });
    } catch (err) {
      out.push({ example, output: null, finalScore: null, route: null, error: describeError(err), inputTokens: 0, outputTokens: 0 });
    }
  }
  return out;
}

function metricsAtThreshold(scored: ScoredExample[], threshold: number) {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const s of scored) {
    if (s.finalScore == null) continue;
    const predictedOnTheme = s.finalScore >= threshold;
    const actualOnTheme = s.example.label === 'on_theme';
    if (predictedOnTheme && actualOnTheme) tp++;
    else if (predictedOnTheme && !actualOnTheme) fp++;
    else if (!predictedOnTheme && actualOnTheme) fn++;
    else tn++;
  }
  const precision = tp + fp > 0 ? tp / (tp + fp) : null;
  const recall = tp + fn > 0 ? tp / (tp + fn) : null;
  return { tp, fp, fn, tn, precision, recall };
}

function costFor(scored: ScoredExample[], model: string) {
  const ok = scored.filter((s) => !s.error);
  const inputTokens = ok.reduce((sum, s) => sum + s.inputTokens, 0);
  const outputTokens = ok.reduce((sum, s) => sum + s.outputTokens, 0);
  const price = priceFor(model);
  const cost = (inputTokens / 1e6) * price.in + (outputTokens / 1e6) * price.out;
  return { inputTokens, outputTokens, cost };
}

function printReport(scored: ScoredExample[], model: string) {
  const errors = scored.filter((s) => s.error);
  const ok = scored.filter((s) => !s.error);

  console.log('\n=== Theme classifier eval report ===');
  console.log(`examples: ${scored.length}  classified: ${ok.length}  errors: ${errors.length}`);

  for (const threshold of [85, 40]) {
    const m = metricsAtThreshold(ok, threshold);
    console.log(
      `\nThreshold ${threshold}: precision=${fmtPct(m.precision)} recall=${fmtPct(m.recall)} ` +
        `(tp=${m.tp} fp=${m.fp} fn=${m.fn} tn=${m.tn})`
    );
  }

  console.log('\nConfusion by route x label:');
  const routes: Route[] = ['publish', 'review', 'reject'];
  const labels: ('on_theme' | 'off_theme')[] = ['on_theme', 'off_theme'];
  for (const route of routes) {
    const row = labels.map((label) => ok.filter((s) => s.route === route && s.example.label === label).length);
    console.log(`  ${route.padEnd(8)} on_theme=${row[0]}  off_theme=${row[1]}`);
  }

  printWorstMisclassifications(ok, 5);

  const { inputTokens, outputTokens, cost } = costFor(scored, model);
  const price = priceFor(model);
  console.log(
    `\nTokens: ${inputTokens} in / ${outputTokens} out. Estimated cost: $${cost.toFixed(4)} ` +
      `(${model} sync pricing, $${price.in}/$${price.out} per MTok).`
  );

  if (errors.length > 0) {
    console.log(`\n${errors.length} error(s), e.g.:`);
    for (const e of errors.slice(0, 5)) console.log(`  [${e.example.id}] ${e.error}`);
  }
}

/**
 * The N examples where the final score was furthest from where the label
 * says it should land — i.e. a confident wrong answer, not a borderline
 * call near a threshold. For an off_theme example, "worst" means the
 * highest final score (should be near 0); for on_theme, the lowest
 * (should be near 100).
 */
function printWorstMisclassifications(ok: ScoredExample[], n: number) {
  const withError = ok
    .filter((s) => s.finalScore != null && s.output != null)
    .map((s) => {
      const idealScore = s.example.label === 'on_theme' ? 100 : 0;
      const errorMagnitude = Math.abs(s.finalScore! - idealScore);
      return { s, errorMagnitude };
    })
    .sort((a, b) => b.errorMagnitude - a.errorMagnitude)
    .slice(0, n);

  console.log(`\nWorst ${withError.length} misclassification(s) (by |final score - ideal for label|):`);
  for (const { s, errorMagnitude } of withError) {
    console.log(
      `  [${s.example.id}] label=${s.example.label} final=${s.finalScore} ` +
        `(theme_score=${s.output!.theme_score}, data_quality=${s.output!.data_quality}, err=${errorMagnitude}) ` +
        `route=${s.route} "${s.example.event.name}" (${s.example.conference}) — reason: ${s.output!.reason}`
    );
  }
}

function fmtPct(v: number | null): string {
  return v == null ? 'n/a' : `${(v * 100).toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// compare: run the same sample through several model/effort configs
// ---------------------------------------------------------------------------

interface CompareConfig {
  label: string;
  model: string;
  effort: ReasoningEffort;
}

const COMPARE_CONFIGS: CompareConfig[] = [
  { label: 'gpt-5-nano (minimal)', model: 'gpt-5-nano', effort: 'minimal' },
  { label: 'gpt-5-nano (low)', model: 'gpt-5-nano', effort: 'low' },
  { label: 'gpt-5-mini (minimal)', model: 'gpt-5-mini', effort: 'minimal' },
];

async function runCompare(client: OpenAI, examples: EvalExample[]) {
  const results: { config: CompareConfig; scored: ScoredExample[] }[] = [];

  for (const config of COMPARE_CONFIGS) {
    console.log(`\n--- Running ${config.label} on ${examples.length} example(s) ---`);
    const scored = await classifySync(client, examples, config.model, config.effort);
    results.push({ config, scored });
    const { cost } = costFor(scored, config.model);
    console.log(`  done. cost so far this config: $${cost.toFixed(4)}`);
  }

  console.log('\n=== Comparison (same stratified sample for every row) ===');
  console.log(
    'config                     precision@85  recall@85  precision@40  recall@40  cost/1000  errors'
  );
  let totalCost = 0;
  const rows: { config: CompareConfig; p85: number | null; r85: number | null; p40: number | null; r40: number | null; costPer1000: number }[] = [];
  for (const { config, scored } of results) {
    const ok = scored.filter((s) => !s.error);
    const m85 = metricsAtThreshold(ok, 85);
    const m40 = metricsAtThreshold(ok, 40);
    const { cost } = costFor(scored, config.model);
    totalCost += cost;
    const costPer1000 = ok.length > 0 ? (cost / ok.length) * 1000 : 0;
    const errCount = scored.length - ok.length;
    rows.push({ config, p85: m85.precision, r85: m85.recall, p40: m40.precision, r40: m40.recall, costPer1000 });
    console.log(
      `${config.label.padEnd(27)} ${fmtPct(m85.precision).padStart(11)}  ${fmtPct(m85.recall).padStart(9)}  ` +
        `${fmtPct(m40.precision).padStart(12)}  ${fmtPct(m40.recall).padStart(9)}  $${costPer1000.toFixed(3).padStart(8)}  ${errCount}`
    );
  }
  console.log(`\nTotal spend across all ${COMPARE_CONFIGS.length} configs: $${totalCost.toFixed(4)}`);

  // Best = highest precision@85 (the harder, more consequential threshold),
  // ties broken by recall@40.
  let best = results[0];
  let bestRow = rows[0];
  for (let i = 1; i < results.length; i++) {
    const row = rows[i];
    const better =
      (row.p85 ?? -1) > (bestRow.p85 ?? -1) ||
      ((row.p85 ?? -1) === (bestRow.p85 ?? -1) && (row.r40 ?? -1) > (bestRow.r40 ?? -1));
    if (better) {
      best = results[i];
      bestRow = row;
    }
  }
  console.log(`\nBest config by precision@85 (tie-break recall@40): ${best.config.label}`);
  printWorstMisclassifications(best.scored.filter((s) => !s.error), 5);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === 'build-fixture') {
    await buildFixture(args.sampleOut);
    return;
  }

  if (args.batch) {
    console.log(
      '--batch is not supported: the OpenAI Batch API needs a separate file-upload workflow ' +
        '(JSONL in, JSONL out, up to a 24h SLA) that is not worth it for this harness — see the ' +
        'comment at the top of this file. Run without --batch.'
    );
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.log(
      'OPENAI_API_KEY is not set (checked process.env; also check .env.local if you use one). ' +
        'Not making any API calls. Set the key and re-run to classify and get a precision/recall report.'
    );
    return;
  }

  const fixturePath = args.fixture ?? (fs.existsSync(FULL_FIXTURE_PATH) ? FULL_FIXTURE_PATH : SAMPLE_FIXTURE_PATH);
  if (!fs.existsSync(fixturePath)) {
    console.log(
      `No fixture found at ${fixturePath}. Run "npx tsx scripts/ingest-eval.ts build-fixture" first.`
    );
    return;
  }
  console.log(`Loading examples from ${fixturePath}${fixturePath === SAMPLE_FIXTURE_PATH ? ' (committed sample — run build-fixture for the full set)' : ''}...`);
  let examples: EvalExample[] = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

  if (args.profile) examples = examples.filter((e) => e.themeKey === args.profile);
  // Stratified, not a prefix slice — `build-fixture` writes all positives
  // before any negatives, so slicing the first N would skew heavily
  // positive at small limits. Deterministic (sorted by id, no RNG), so the
  // same `--limit N` always picks the same rows for a given fixture.
  if (args.limit) examples = stratifiedSample(examples, args.limit);

  const client = new OpenAI({ apiKey });

  if (args.command === 'compare') {
    await runCompare(client, examples);
    return;
  }

  const model = args.model ?? INGEST_MODEL;
  console.log(`Classifying ${examples.length} example(s) with prompt_version=${PROMPT_VERSION}, model=${model}...`);
  const scored = await classifySync(client, examples, args.model, args.effort);
  printReport(scored, model);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
