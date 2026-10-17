// Canonical keys + dedupe against the sheet and other candidates (§5.2).
import { normalizeEventLink, getValidLumaSlug, LUMA_EVENT_API_ID_RE } from '../luma';
import { fetchLumaEvent } from '../luma-server';
import { getCachedLumaApiIdEntry, setCachedLumaApiId } from './db';
import { haversineKm } from './geo';
import type { NormalizedEvent } from './types';

/**
 * How long a cached "no api id" miss for a short Luma link is trusted
 * before `buildSheetLinkIndex` re-resolves it instead (2026-10-16 incident:
 * a buggy script wrote 63 false misses into `ingest_link_cache`, which hid
 * real sheet duplicates — Devcon 8 / Breakpoint — from the publish/approve
 * dedupe guard for as long as those rows existed, because a cached miss was
 * trusted forever). A resolved HIT (a string api id) is never re-checked —
 * only misses go stale, since a confirmed id can't un-resolve.
 */
export const STALE_NEGATIVE_CACHE_MS = 6 * 60 * 60 * 1000; // ~6h

export type SlugResolver = (slug: string) => Promise<string | null>;

/**
 * Default slug->api-id resolver, used when the caller doesn't inject one
 * (standalone scripts, tests). Paced at 1 request/sec — the SAME policy as
 * event enrichment (§3.1), because every Luma lookup must respect it, not
 * only the ones that happen to go through a particular caller's limiter
 * (review finding, MEDIUM item 7). `pipeline.ts` instead injects a
 * `resolveSlug` backed by its own `LumaEnrichmentLimiter` instance, so
 * slug resolution and event enrichment share one limiter's clock and
 * per-run budget rather than racing two independent 1/sec limiters.
 */
let lastDefaultResolveAt = 0;
async function defaultResolveSlug(slug: string): Promise<string | null> {
  const wait = lastDefaultResolveAt ? Math.max(0, lastDefaultResolveAt + 1000 - Date.now()) : 0;
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastDefaultResolveAt = Date.now();
  try {
    const payload = await fetchLumaEvent({ slug });
    return payload.event?.api_id ?? payload.api_id ?? null;
  } catch {
    return null;
  }
}

/** Canonical key for a normalized event (§5.2 item 1). Luma links already
 *  collapse to `luma:<slug-or-evt-id>` via `normalizeEventLink`'s #177 fix;
 *  everything else is host+path. */
export function canonicalKeyForEvent(event: Pick<NormalizedEvent, 'link'>): string | null {
  return normalizeEventLink(event.link);
}

export interface SheetLinkEntry {
  id: string;
  link: string;
}

export interface SheetLinkIndex {
  /** link_key -> sheet event. Includes both the raw key and, for Luma vanity
   *  slugs we could resolve, the `luma:<evt-id>` alt key (§5.2 item 2). */
  byKey: Map<string, SheetLinkEntry>;
}

/**
 * Build a lookup from normalized link key to sheet event, resolving Luma
 * vanity-slug links to their stable api id (cached in `ingest_link_cache`,
 * at most `maxResolutions` live lookups per run — §5.2 item 2). Pass
 * `resolveSlug` to share a caller's own rate limiter/budget (pipeline.ts
 * does, for its enrichment limiter); otherwise a self-paced 1/sec default
 * is used so this is never un-rate-limited (review finding, MEDIUM item 7).
 */
export async function buildSheetLinkIndex(
  sheetEvents: SheetLinkEntry[],
  opts: { maxResolutions?: number; resolveSlug?: SlugResolver } = {}
): Promise<SheetLinkIndex> {
  const maxResolutions = opts.maxResolutions ?? 50;
  const resolveSlug = opts.resolveSlug ?? defaultResolveSlug;
  const byKey = new Map<string, SheetLinkEntry>();
  let resolutions = 0;

  for (const ev of sheetEvents) {
    const key = normalizeEventLink(ev.link);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, ev);

    if (!key.startsWith('luma:')) continue;
    const slugPart = key.slice('luma:'.length);
    if (LUMA_EVENT_API_ID_RE.test(slugPart)) continue; // already an evt- id key

    const slug = getValidLumaSlug(ev.link);
    if (!slug) continue;

    // Tri-state: `undefined` = never looked up (go resolve it); `null` =
    // looked up before, confirmed no api id (a cached miss — don't retry
    // it every run); a string = resolved. Collapsing these (as the
    // original version did) meant a confirmed miss burned a rate-limited
    // request on every single run forever (review finding, MEDIUM item 7).
    //
    // A cached miss is only trusted for `STALE_NEGATIVE_CACHE_MS` — past
    // that, treat it the same as `undefined` (never looked up) so a bad
    // write to `ingest_link_cache` can't hide a duplicate forever. A
    // resolved hit (a string) is always trusted; there's no "resolved_at"
    // for it to go stale against.
    const cached = await getCachedLumaApiIdEntry(key);
    let apiId: string | null | undefined;
    if (cached === undefined) {
      apiId = undefined;
    } else if (cached.apiId !== null) {
      apiId = cached.apiId;
    } else {
      const age = Date.now() - new Date(cached.resolvedAt).getTime();
      apiId = age > STALE_NEGATIVE_CACHE_MS ? undefined : null;
    }
    if (apiId === undefined) {
      if (resolutions < maxResolutions) {
        resolutions++;
        apiId = await resolveSlug(slug);
        await setCachedLumaApiId(key, apiId);
      } else {
        // Out of this run's resolution budget — leave uncached so a later
        // run (which may have more budget) retries it, rather than caching
        // a miss we never actually looked up.
        apiId = null;
      }
    }
    if (apiId) {
      const altKey = `luma:${apiId.toLowerCase()}`;
      if (!byKey.has(altKey)) byKey.set(altKey, ev);
    }
  }

  return { byKey };
}

export function findSheetMatchByLink(index: SheetLinkIndex, event: Pick<NormalizedEvent, 'link'>): SheetLinkEntry | null {
  const key = canonicalKeyForEvent(event);
  if (!key) return null;
  return index.byKey.get(key) ?? null;
}

/** Lowercase, strip emoji/punctuation, collapse whitespace. Deliberately
 *  simpler than `nameTokens` below (no stopword/conference-name/year
 *  stripping, no tokenization) — this feeds the name+date fallback
 *  duplicate check, a conservative last line of defense before every
 *  insert, not a judgment call about look-alike events. */
export function normalizeNameForDuplicateCheck(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}]/gu, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fallback duplicate check (Part A item 2 — stale-negative-cache
 * mitigation): same normalized name AND same date in the target tab,
 * independent of any link match. Run this right before every insert
 * (approve, auto-publish), in ADDITION to the link-index check — it exists
 * to catch the exact same event that link matching missed (e.g. because a
 * bad write to `ingest_link_cache` hid a short link's resolution), so it's
 * a hard refusal, not a `possible_duplicate` flag like `fuzzyMatch`'s
 * looser venue/time scoring.
 */
export function findDuplicateByNameAndDate<T extends { name: string; dateISO: string }>(
  event: Pick<NormalizedEvent, 'name' | 'dateISO'>,
  sheetEvents: T[]
): T | null {
  const targetName = normalizeNameForDuplicateCheck(event.name);
  if (!targetName) return null;
  for (const se of sheetEvents) {
    if (se.dateISO !== event.dateISO) continue;
    if (normalizeNameForDuplicateCheck(se.name) === targetName) return se;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Fuzzy name matching (§5.2 item 3)                                   */
/* ------------------------------------------------------------------ */

const STOPWORDS = new Set([
  'party', 'happy', 'hour', 'night', 'the', 'a', 'an', 'at', 'with', 'presents', 'presented', 'by',
]);

/** Strip punctuation/emoji, lowercase, drop stopwords/year/conference name, tokenize. */
export function nameTokens(name: string, conferenceName?: string): Set<string> {
  const conferenceWords = new Set(
    (conferenceName || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
  );
  const cleaned = name
    .toLowerCase()
    // Strip emoji and other non-ASCII symbol ranges, keep letters/digits/spaces/punct.
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}]/gu, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(19|20)\d{2}\b/g, ' '); // years
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  return new Set(tokens.filter((t) => !STOPWORDS.has(t) && !conferenceWords.has(t)));
}

export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function parseMinutes(time12: string): number | null {
  const m = time12.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (m[3].toUpperCase() === 'PM' && h !== 12) h += 12;
  if (m[3].toUpperCase() === 'AM' && h === 12) h = 0;
  return h * 60 + min;
}

export interface FuzzyMatchable {
  name: string;
  dateISO: string;
  startTime: string;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
}

export type FuzzyMatchResult = { kind: 'duplicate' | 'possible_duplicate'; score: number } | null;

/**
 * Fuzzy-match two events on the same date (§5.2 item 3):
 * - name similarity >= 0.85 -> duplicate
 * - name >= 0.6 AND (same normalized venue OR geo within 150m) AND start
 *   time within 60 min -> duplicate
 * - name similarity in [0.6, 0.85) alone -> possible_duplicate (forces review)
 */
export function fuzzyMatch(a: FuzzyMatchable, b: FuzzyMatchable, conferenceName?: string): FuzzyMatchResult {
  if (a.dateISO !== b.dateISO) return null;

  const sim = jaccardSimilarity(nameTokens(a.name, conferenceName), nameTokens(b.name, conferenceName));
  if (sim >= 0.85) return { kind: 'duplicate', score: sim };
  if (sim < 0.6) return null;

  const sameVenue =
    !!a.address && !!b.address && a.address.trim().toLowerCase() === b.address.trim().toLowerCase();
  const closeGeo =
    a.lat != null && a.lng != null && b.lat != null && b.lng != null
      ? haversineKm({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng }) * 1000 <= 150
      : false;

  const tA = parseMinutes(a.startTime);
  const tB = parseMinutes(b.startTime);
  const closeTime = tA !== null && tB !== null && Math.abs(tA - tB) <= 60;

  if ((sameVenue || closeGeo) && closeTime) {
    return { kind: 'duplicate', score: sim };
  }
  return { kind: 'possible_duplicate', score: sim };
}

/* ------------------------------------------------------------------ */
/* Phase 3: shared dedupe-against-sheet-and-candidates (§5.2)           */
/* ------------------------------------------------------------------ */

export interface DedupeCandidatePool {
  id: string;
  canonical_key: string;
  event: FuzzyMatchable & { link: string };
}

export interface DedupeSheetEvent extends FuzzyMatchable {
  id: string;
  link: string;
}

/**
 * Link match (exact), then fuzzy match, against the sheet and against other
 * in-flight candidates — the same two-step dedupe `pipeline.ts`'s Luma iCal
 * loop runs inline, factored out so Phase 3's discovery sources (Telegram,
 * host submissions) can reuse it without duplicating the logic a third
 * time. `excludeCandidateId` keeps a candidate from matching itself when
 * re-processing an existing row.
 */
export function matchAgainstSheetAndCandidates(
  event: Pick<NormalizedEvent, 'link' | 'dateISO' | 'startTime' | 'address' | 'lat' | 'lng' | 'name'>,
  opts: {
    linkIndex: SheetLinkIndex;
    sheetEvents: DedupeSheetEvent[];
    otherCandidates: DedupeCandidatePool[];
    conferenceName?: string;
    excludeCandidateId?: string | null;
  }
): { duplicateOf: string | null; possibleDuplicateOf: string | null } {
  const sheetMatch = findSheetMatchByLink(opts.linkIndex, event);
  let duplicateOf: string | null = sheetMatch?.id ?? null;
  let possibleDuplicateOf: string | null = null;

  if (!duplicateOf) {
    for (const se of opts.sheetEvents) {
      if (se.dateISO !== event.dateISO) continue;
      const fm = fuzzyMatch(event, se, opts.conferenceName);
      if (fm?.kind === 'duplicate') {
        duplicateOf = se.id;
        break;
      }
      if (fm?.kind === 'possible_duplicate') possibleDuplicateOf = se.id;
    }
  }

  if (!duplicateOf) {
    for (const oc of opts.otherCandidates) {
      if (opts.excludeCandidateId && oc.id === opts.excludeCandidateId) continue;
      if (oc.event.dateISO !== event.dateISO) continue;
      const fm = fuzzyMatch(event, oc.event, opts.conferenceName);
      if (fm?.kind === 'duplicate') {
        duplicateOf = oc.id;
        break;
      }
      if (fm?.kind === 'possible_duplicate' && !possibleDuplicateOf) possibleDuplicateOf = oc.id;
    }
  }

  return { duplicateOf, possibleDuplicateOf };
}
