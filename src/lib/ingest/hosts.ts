// Host/organizer matching for a profile's trusted/blocked lists (§5.4) and
// the Phase 2 learned-host-signal derivation (`learning.ts`).
//
// Extracted out of `pipeline.ts` (it was a private, untested helper there)
// and made fuzzier — a Phase 1b follow-up listed for Phase 2
// (plans/event-ingestion.md): exact lowercase-equality missed trivial
// variants like "The DeFi Collective" vs "DeFi Collective" or a trailing
// "Inc."/"DAO"/emoji.
//
// Revised again per review (MEDIUM item 5), which found the first fuzzy
// version too permissive: symmetric Jaccard similarity on `dedupe.ts`'s
// EVENT-NAME tokenizer (which strips "party"/"happy"/"hour"/etc. as noise
// for event-title dedup) returned a vacuous 1.0 "match" for two names that
// both tokenize to the EMPTY set (e.g. two different pure-emoji names), and
// reused a stopword list tuned for a different problem. This version:
//   - uses its OWN tokenizer (`hostNameTokens`), not `dedupe.ts`'s
//     event-name one, and does NOT strip ordinary English words like
//     "party"/"hour" — those are real signal in a host/org name, not noise;
//   - supports non-Latin scripts (Unicode `\p{L}`/`\p{N}` properties, not
//     `[a-z0-9]`) so e.g. Chinese or Cyrillic org names tokenize sensibly;
//   - requires BOTH token sets to be non-empty before comparing them, so
//     two blank/symbols-only names never match by vacuous equality;
//   - uses token CONTAINMENT (is the shorter name's meaningful tokens a
//     subset of the longer's?) instead of symmetric similarity, and only
//     counts a token as "meaningful" if it's long enough to carry signal
//     (>=3 Latin-ish chars) or contains a non-Latin-ish character (where a
//     single character is often a complete word) — so a short, generic
//     token like "ai" or "co" can never single-handedly satisfy the match.
import type { NormalizedEvent, TrustedHostEntry } from './types';

/** Trimmed, lowercased — used for exact-equality and as the match key in
 *  `learning.ts`'s learned trusted/blocked sets. */
export function normalizeHostName(name: string): string {
  return name.trim().toLowerCase();
}

/** A token needs to carry real signal to count toward containment (see
 *  module doc) — plain length for Latin-ish text, but a single non-Latin
 *  character (CJK, Cyrillic, Arabic, ...) is often a whole word on its
 *  own, so any character outside the Latin-1/Latin Extended range makes a
 *  token meaningful regardless of its (code-point) length. */
const MIN_MEANINGFUL_LATIN_TOKEN_LENGTH = 3;
const NON_LATIN_CHAR_RE = /[^\u0000-ɏ]/;

function isMeaningfulToken(token: string): boolean {
  if (token.length >= MIN_MEANINGFUL_LATIN_TOKEN_LENGTH) return true;
  return NON_LATIN_CHAR_RE.test(token);
}

/**
 * Host/org-name tokenizer. Lowercases, strips emoji and punctuation (kept:
 * Unicode letters and numbers, via `\p{L}`/`\p{N}` so non-Latin scripts
 * tokenize correctly), splits on whitespace, and drops only a small set of
 * generic organization-name filler words ("the", "inc", ...) — NOT
 * `dedupe.ts`'s event-name stopwords ("party"/"happy"/"hour"/...), which
 * would make an unrelated event's host/org name match too easily just
 * because both strings happen to contain common event-type words.
 */
const GENERIC_ORG_FILLER_WORDS = new Set(['the', 'a', 'an', 'inc', 'llc', 'ltd', 'co', 'official']);

export function hostNameTokens(name: string): Set<string> {
  const cleaned = name
    .toLowerCase()
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}]/gu, ' ') // emoji
    .replace(/[^\p{L}\p{N}\s]/gu, ' '); // keep unicode letters/digits/space
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  return new Set(tokens.filter((t) => !GENERIC_ORG_FILLER_WORDS.has(t)));
}

/**
 * Exact (post-normalization) match, OR token containment: the SHORTER
 * name's MEANINGFUL tokens must all appear in the longer name's tokens.
 * Both token sets must be non-empty, and the shorter set must contain at
 * least one meaningful token, before containment is even attempted — so
 * two names that both strip down to nothing (blank, pure emoji/punctuation)
 * never match, and a short/generic token can never single-handedly satisfy
 * the match (review finding, MEDIUM item 5).
 */
export function hostNamesMatch(a: string, b: string): boolean {
  const an = normalizeHostName(a);
  const bn = normalizeHostName(b);
  if (!an || !bn) return false;
  if (an === bn) return true;

  const tokensA = hostNameTokens(a);
  const tokensB = hostNameTokens(b);
  if (tokensA.size === 0 || tokensB.size === 0) return false;

  const [shorter, longer] = tokensA.size <= tokensB.size ? [tokensA, tokensB] : [tokensB, tokensA];
  const meaningfulShorter = [...shorter].filter(isMeaningfulToken);
  if (meaningfulShorter.length === 0) return false;
  return meaningfulShorter.every((t) => longer.has(t));
}

/** True if a host/organizer on `event` is in a profile's trusted/blocked
 *  list, by id (exact) or name (exact-or-containment, `hostNamesMatch`). */
export function hostListMatches(
  entries: TrustedHostEntry[],
  event: Pick<NormalizedEvent, 'hosts' | 'organizer'>
): boolean {
  if (entries.length === 0) return false;
  const names = [event.organizer, ...event.hosts.map((h) => h.name)].filter(
    (n): n is string => !!n && n.trim().length > 0
  );
  const ids = new Set(event.hosts.map((h) => h.apiId).filter((id): id is string => !!id));
  return entries.some((e) => (e.id && ids.has(e.id)) || names.some((n) => hostNamesMatch(n, e.name)));
}
