// Canonical keys + dedupe against the sheet and other candidates (§5.2).
import { normalizeEventLink, getValidLumaSlug, LUMA_EVENT_API_ID_RE } from '../luma';
import { fetchLumaEvent } from '../luma-server';
import { getCachedLumaApiId, setCachedLumaApiId } from './db';
import { haversineKm } from './geo';
import type { NormalizedEvent } from './types';

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
 * at most `maxResolutions` live lookups per run — §5.2 item 2).
 */
export async function buildSheetLinkIndex(
  sheetEvents: SheetLinkEntry[],
  opts: { maxResolutions?: number } = {}
): Promise<SheetLinkIndex> {
  const maxResolutions = opts.maxResolutions ?? 50;
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

    let apiId = await getCachedLumaApiId(key);
    if (apiId === null && resolutions < maxResolutions) {
      resolutions++;
      try {
        const payload = await fetchLumaEvent({ slug });
        apiId = payload.event?.api_id ?? payload.api_id ?? null;
      } catch {
        // Not found / upstream error: cache the miss so we don't retry every run.
        apiId = null;
      }
      await setCachedLumaApiId(key, apiId);
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
