// Host/organizer matching for a profile's trusted/blocked lists (§5.4) and
// the Phase 2 learned-host-signal derivation (`learning.ts`).
//
// Extracted out of `pipeline.ts` (it was a private, untested helper there)
// and made fuzzier — a Phase 1b follow-up listed for Phase 2
// (plans/event-ingestion.md): exact lowercase-equality missed trivial
// variants like "The DeFi Collective" vs "DeFi Collective", "ETHGlobal" vs
// "ETH Global", or a trailing "Inc."/"DAO"/emoji. Token-set Jaccard
// similarity — the same metric `dedupe.ts` uses for event-name fuzzy
// matching — catches those too, while staying conservative enough (0.8)
// that unrelated short names ("ETH Denver" vs "ETH Global") don't collide.
import { nameTokens, jaccardSimilarity } from './dedupe';
import type { NormalizedEvent, TrustedHostEntry } from './types';

export const FUZZY_HOST_NAME_SIMILARITY_THRESHOLD = 0.8;

export function normalizeHostName(name: string): string {
  return name.trim().toLowerCase();
}

/** Exact (post-normalization) OR fuzzy token-set match between two host/org names. */
export function hostNamesMatch(a: string, b: string): boolean {
  const an = normalizeHostName(a);
  const bn = normalizeHostName(b);
  if (!an || !bn) return false;
  if (an === bn) return true;
  const sim = jaccardSimilarity(nameTokens(a), nameTokens(b));
  return sim >= FUZZY_HOST_NAME_SIMILARITY_THRESHOLD;
}

/** True if a host/organizer on `event` is in a profile's trusted/blocked
 *  list, by id (exact) or name (exact-or-fuzzy, `hostNamesMatch`). */
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
