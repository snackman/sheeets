import { createHash } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { getClientIp } from '@/lib/rate-limit';
import { bucketIp } from '@/lib/ip-bucket';
import {
  recordSubmissionAttempt,
  countRecentSubmissionAttempts,
  deleteSubmissionAttempt,
  countRecentAttemptsByTag,
} from '@/lib/ingest/db';

/**
 * Thin wrapper that reuses the Supabase `ingest_submission_attempts` ledger
 * (created for host submissions) as a persistent, cross-instance per-IP
 * counter for other public endpoints. Rows are namespaced by hashing
 * `<scope>:<ip bucket>` into `ip_hash` and tagging `conference` with a
 * `sec:` prefix, so they never collide with host-submission per-IP counts
 * and are excluded from the host global/per-conference ceilings (see
 * `countGlobalRecentSubmissionAttempts`).
 *
 * Failures talking to the ledger are logged and treated as "no data":
 * callers pair this with an in-memory limiter so an outage never opens the
 * door fully and never blocks legitimate users either.
 */
export function ledgerKey(scope: string, req: NextRequest): string {
  return createHash('sha256').update(`${scope}:${bucketIp(getClientIp(req))}`).digest('hex');
}

export async function recordLedgerAttempt(scope: string, req: NextRequest): Promise<void> {
  try {
    await recordSubmissionAttempt(ledgerKey(scope, req), `sec:${scope}`);
  } catch (err) {
    console.error(`[ledger-rate-limit] record failed (${scope}):`, err);
  }
}

/** Attempts by this client for `scope` within `windowMs`; 0 if the ledger is unreachable. */
export async function countLedgerAttempts(scope: string, req: NextRequest, windowMs: number): Promise<number> {
  try {
    return await countRecentSubmissionAttempts(ledgerKey(scope, req), windowMs);
  } catch (err) {
    console.error(`[ledger-rate-limit] count failed (${scope}):`, err);
    return 0;
  }
}

/**
 * Reserve one attempt: insert FIRST, then count. Every request's insert is
 * committed before its own count runs, so at most `max` concurrent requests
 * can observe a count <= max and the limit holds under parallelism. Returns
 * the row id (to refund later) and the count including this attempt; both
 * are null if the ledger is unreachable.
 */
export async function reserveLedgerAttempt(
  scope: string,
  req: NextRequest,
  windowMs: number
): Promise<{ id: string | null; count: number | null }> {
  const key = ledgerKey(scope, req);
  let id: string | null = null;
  try {
    id = await recordSubmissionAttempt(key, `sec:${scope}`);
    const count = await countRecentSubmissionAttempts(key, windowMs);
    return { id, count };
  } catch (err) {
    console.error(`[ledger-rate-limit] reserve failed (${scope}):`, err);
    // Keep the id (if the insert succeeded) so the caller can still refund it.
    return { id, count: null };
  }
}

/** Refund a reservation made by `reserveLedgerAttempt`. */
export async function releaseLedgerAttempt(id: string | null): Promise<void> {
  if (!id) return;
  try {
    await deleteSubmissionAttempt(id);
  } catch (err) {
    console.error('[ledger-rate-limit] release failed:', err);
  }
}

/** Attempts across ALL clients for `scope` within `windowMs`; null if the ledger is unreachable. */
export async function countLedgerScope(scope: string, windowMs: number): Promise<number | null> {
  try {
    return await countRecentAttemptsByTag(`sec:${scope}`, windowMs);
  } catch (err) {
    console.error(`[ledger-rate-limit] scope count failed (${scope}):`, err);
    return null;
  }
}
