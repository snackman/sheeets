// Persisted retry list for read-once discovery sources (X advances its
// `since_id` cursor every run; a Telegram post scrolls off the channel
// page). A link whose enrichment was DEFERRED (Luma 429/5xx, or the Luma
// budget ran out before it was tried) writes no candidate row, so without
// this it would be lost with no trace once its post is behind the cursor.
// Stored under `ingest_sources.cursor.retry_urls`, merged with whatever
// else the source keeps in its cursor.

export interface RetryUrlEntry {
  url: string;
  /** Post permalink / source ref the link came from (kept for provenance). */
  ref: string | null;
  first_deferred_at: string;
  reason: string;
}

export const RETRY_URLS_MAX = 100;
export const RETRY_URL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function retryUrlsOf(cursor: unknown): RetryUrlEntry[] {
  const list = (cursor as { retry_urls?: unknown } | null)?.retry_urls;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (e): e is RetryUrlEntry => !!e && typeof e === 'object' && typeof (e as RetryUrlEntry).url === 'string' && typeof (e as RetryUrlEntry).first_deferred_at === 'string'
  );
}

/**
 * Next retry list: previous entries minus the ones handled this run
 * (`handled`: processed with any outcome other than deferred) and minus
 * expired ones, plus links newly deferred this run. Oldest entries are
 * dropped first past `RETRY_URLS_MAX`. Entries not attempted at all this
 * run (deadline) are simply kept.
 */
export function nextRetryUrls(
  prev: RetryUrlEntry[],
  deferred: Map<string, { ref: string | null; reason: string }>,
  handled: Set<string>,
  now: number = Date.now()
): RetryUrlEntry[] {
  const out: RetryUrlEntry[] = [];
  const seen = new Set<string>();
  for (const e of prev) {
    if (handled.has(e.url) || seen.has(e.url)) continue;
    if (now - new Date(e.first_deferred_at).getTime() > RETRY_URL_TTL_MS) continue;
    const again = deferred.get(e.url);
    out.push(again ? { ...e, reason: again.reason } : e);
    seen.add(e.url);
  }
  for (const [url, info] of deferred) {
    if (seen.has(url)) continue;
    out.push({ url, ref: info.ref, first_deferred_at: new Date(now).toISOString(), reason: info.reason });
    seen.add(url);
  }
  return out.slice(Math.max(0, out.length - RETRY_URLS_MAX));
}

export function sameRetryUrls(a: RetryUrlEntry[], b: RetryUrlEntry[]): boolean {
  return a.length === b.length && a.every((e, i) => e.url === b[i].url && e.reason === b[i].reason);
}
