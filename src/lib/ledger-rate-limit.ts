import { createHash } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { getClientIp } from '@/lib/rate-limit';
import { bucketIp } from '@/lib/ip-bucket';
import { recordSubmissionAttempt, countRecentSubmissionAttempts } from '@/lib/ingest/db';

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
