// Publisher lease (migration 20261029150000_ingest_publisher_lease.sql):
// serializes sheet-row inserts (ThrottledSheetPublisher — pipeline
// auto-publish AND admin approve) against the dedupe sweep's row deletes on
// the SAME tab. Both address rows by index; an insert landing between the
// sweep's re-read and its delete would shift rows and delete the wrong one.
//
// Degrades gracefully: until the migration is applied (missing RPC), the
// work runs WITHOUT the lock and a warning is logged — exactly today's
// behavior, never worse.
import { randomUUID } from 'node:crypto';
import { getIngestSupabase, isMissingRelationError } from './db';

export type LeaseAcquireResult = 'acquired' | 'busy' | 'unavailable';

export interface LeaseBackend {
  tryAcquire(key: string, holder: string, ttlSeconds: number): Promise<LeaseAcquireResult>;
  release(key: string, holder: string): Promise<void>;
}

export class PublisherLeaseBusyError extends Error {
  constructor(key: string, waitedMs: number) {
    super(`publisher lease ${key} busy after waiting ${waitedMs}ms`);
    this.name = 'PublisherLeaseBusyError';
  }
}

/** Real backend: the two RPCs from the migration. A missing function means
 *  "not applied yet" -> 'unavailable' (caller proceeds unlocked); any other
 *  error throws (caller fails closed — e.g. the candidate stays queued). */
export const supabaseLeaseBackend: LeaseBackend = {
  async tryAcquire(key, holder, ttlSeconds) {
    const { data, error } = await getIngestSupabase().rpc('ingest_try_acquire_publisher_lease', {
      p_key: key,
      p_holder: holder,
      p_ttl_seconds: ttlSeconds,
    });
    if (error) {
      if (isMissingRelationError(error)) return 'unavailable';
      throw new Error(`publisher lease acquire failed: ${error.message}`);
    }
    return data === true ? 'acquired' : 'busy';
  },
  async release(key, holder) {
    const { error } = await getIngestSupabase().rpc('ingest_release_publisher_lease', { p_key: key, p_holder: holder });
    // Best-effort: the lease expires on its own (ttl) anyway.
    if (error && !isMissingRelationError(error)) {
      console.warn(`[publisher-lease] release of ${key} failed: ${error.message}`);
    }
  },
};

export function sheetLeaseKey(gid: number): string {
  return `sheet:${gid}`;
}

export interface WithLeaseOptions {
  /** Lease lifetime; a crashed holder blocks others at most this long. */
  ttlSeconds?: number;
  /** How long to keep retrying while another holder has it. 0 = one try. */
  waitMs?: number;
  pollMs?: number;
  backend?: LeaseBackend;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

let warnedUnavailable = false;

/**
 * Run `fn` while holding the lease `key`. Throws `PublisherLeaseBusyError`
 * if another holder keeps it for longer than `waitMs`. If the lease
 * migration isn't applied yet, runs `fn` unlocked (with a one-time warning).
 */
export async function withPublisherLease<T>(key: string, fn: () => Promise<T>, opts: WithLeaseOptions = {}): Promise<T> {
  const backend = opts.backend ?? supabaseLeaseBackend;
  const ttlSeconds = opts.ttlSeconds ?? 60;
  const waitMs = opts.waitMs ?? 20_000;
  const pollMs = opts.pollMs ?? 500;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? (() => Date.now());
  const holder = randomUUID();

  const started = now();
  for (;;) {
    const res = await backend.tryAcquire(key, holder, ttlSeconds);
    if (res === 'unavailable') {
      if (!warnedUnavailable) {
        warnedUnavailable = true;
        console.warn('[publisher-lease] lease RPC missing (migration 20261029150000 not applied) — proceeding WITHOUT the publisher lock');
      }
      return fn();
    }
    if (res === 'acquired') break;
    if (now() - started >= waitMs) throw new PublisherLeaseBusyError(key, now() - started);
    await sleep(pollMs);
  }

  try {
    return await fn();
  } finally {
    await backend.release(key, holder).catch((err) => {
      console.warn(`[publisher-lease] release of ${key} threw: ${err instanceof Error ? err.message : err}`);
    });
  }
}

/** Test-only: reset the one-time warning latch. */
export function __resetLeaseWarningForTests(): void {
  warnedUnavailable = false;
}
