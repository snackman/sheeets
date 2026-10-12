// Host/organizer matching for a profile's trusted/blocked lists (§5.4) and
// the Phase 2 learned-host-signal derivation (`learning.ts`).
//
// Extracted out of `pipeline.ts` (it was a private, untested helper there)
// and made fuzzier — a Phase 1b follow-up listed for Phase 2
// (plans/event-ingestion.md): exact lowercase-equality missed trivial
// variants like "The DeFi Collective" vs "DeFi Collective" or a trailing
// "Inc."/"DAO"/emoji.
//
// Revised twice more per review:
//   - (MEDIUM item 5) symmetric Jaccard similarity on `dedupe.ts`'s
//     EVENT-NAME tokenizer (which strips "party"/"happy"/"hour"/etc. as
//     noise for event-title dedup) returned a vacuous 1.0 "match" for two
//     names that both tokenize to the EMPTY set, and reused a stopword
//     list tuned for a different problem. Fixed with its own tokenizer
//     (`hostNameTokens`), Unicode-aware for non-Latin scripts, and a
//     non-empty-token-set requirement.
//   - (HIGH item 1) containment was still symmetric and had no minimum
//     token count on the SHORTER side regardless of which side it was on,
//     so a bare one-word candidate host ("Ethereum") matched a longer
//     trusted entry ("Ethereum Foundation"), and a longer candidate host
//     ("Coinbase Fans Club") matched a short, generic trusted entry
//     ("Coinbase"). Fixed by making the match DIRECTIONAL — see
//     `hostNamesMatch`'s doc comment.
import type { NormalizedEvent, TrustedHostEntry } from './types';

/** Trimmed, lowercased — used for exact-equality and as the match key in
 *  `learning.ts`'s learned trusted/blocked sets. */
export function normalizeHostName(name: string): string {
  return name.trim().toLowerCase();
}

/** A token needs to carry real signal to count as "meaningful" — plain
 *  length for Latin-ish text, but a single non-Latin character (CJK,
 *  Cyrillic, Arabic, ...) is often a whole word on its own, so any
 *  character outside the Latin-1/Latin Extended range makes a token
 *  meaningful regardless of its (code-point) length. */
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

function tokenSetsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const t of a) if (!b.has(t)) return false;
  return true;
}

/**
 * Directional (review finding, HIGH item 1 — this is NOT symmetric):
 * `candidateName` is the event's host/organizer name being checked;
 * `entryName` is the trusted/blocked list entry it's checked against.
 *
 * - Full token-set equality (after filler-word removal, order-independent)
 *   -> match, regardless of token count.
 * - Otherwise, containment is allowed in exactly ONE direction: the
 *   ENTRY's tokens must be a PROPER subset of the CANDIDATE's tokens (the
 *   entry is the shorter, more specific name embedded in a longer
 *   candidate name — e.g. entry "DeFi Collective" contained in candidate
 *   "DeFi Collective Afterparty") — and ONLY when the entry itself has
 *   >= 2 meaningful tokens, so a single generic word as a trusted/blocked
 *   entry ("Coinbase") can never alone satisfy a match against some
 *   longer, unrelated phrase that happens to contain it ("Coinbase Fans
 *   Club").
 * - The REVERSE — the CANDIDATE's tokens a proper subset of the ENTRY's
 *   tokens, e.g. candidate "Ethereum" vs entry "Ethereum Foundation" —
 *   NEVER matches, no matter how many tokens either side has. A bare,
 *   generic word used as a host name must not borrow the trust/block
 *   status of a longer, more specific entry it happens to be a fragment
 *   of.
 */
export function hostNamesMatch(candidateName: string, entryName: string): boolean {
  const candidateNorm = normalizeHostName(candidateName);
  const entryNorm = normalizeHostName(entryName);
  if (!candidateNorm || !entryNorm) return false;
  if (candidateNorm === entryNorm) return true;

  const candidateTokens = hostNameTokens(candidateName);
  const entryTokens = hostNameTokens(entryName);
  if (candidateTokens.size === 0 || entryTokens.size === 0) return false;

  if (tokenSetsEqual(candidateTokens, entryTokens)) return true;

  // Containment, ENTRY-in-CANDIDATE direction only — the entry must be
  // strictly smaller for a proper-subset relationship to even be possible.
  if (candidateTokens.size <= entryTokens.size) return false;
  const meaningfulEntryTokens = [...entryTokens].filter(isMeaningfulToken);
  if (meaningfulEntryTokens.length < 2) return false;
  return [...entryTokens].every((t) => candidateTokens.has(t));
}

/** True if a host/organizer on `event` is in a profile's trusted/blocked
 *  list, by id (exact) or name. Name matching is directional — see
 *  `hostNamesMatch`'s doc comment — with `event`'s host/organizer name as
 *  the CANDIDATE and the profile's list `entry` as the ENTRY. */
export function hostListMatches(
  entries: TrustedHostEntry[],
  event: Pick<NormalizedEvent, 'hosts' | 'organizer'>
): boolean {
  if (entries.length === 0) return false;
  const names = [event.organizer, ...event.hosts.map((h) => h.name)].filter(
    (n): n is string => !!n && n.trim().length > 0
  );
  const ids = new Set(event.hosts.map((h) => h.apiId).filter((id): id is string => !!id));
  return entries.some((e) => (e.id && ids.has(e.id)) || names.some((candidateName) => hostNamesMatch(candidateName, e.name)));
}
