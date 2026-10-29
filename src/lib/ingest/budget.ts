// Monthly LLM cost cap (§5.5, §10 "Abuse / cost"). Checked before each
// classify call; once hit, remaining candidates wait as `pending_classify`
// rather than erroring the run.
import { monthlyLlmCostUsd, monthlyXCostUsd } from './db';
import { sendAlert } from '../alert';

export const DEFAULT_MONTHLY_CAP_USD = 20;

export function getMonthlyCapUsd(): number {
  const raw = process.env.INGEST_MONTHLY_LLM_USD_CAP;
  const v = raw ? Number(raw) : NaN;
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_MONTHLY_CAP_USD;
}

export interface BudgetStatus {
  spentUsd: number;
  capUsd: number;
  exceeded: boolean;
}

export async function checkMonthlyBudget(): Promise<BudgetStatus> {
  const spentUsd = await monthlyLlmCostUsd();
  const capUsd = getMonthlyCapUsd();
  const exceeded = spentUsd >= capUsd;
  if (exceeded) await sendAlert('budget_cap', `Monthly LLM budget cap reached ($${spentUsd.toFixed(2)} of $${capUsd}). Remaining candidates wait as pending_classify.`);
  return { spentUsd, capUsd, exceeded };
}

/* ------------------------------------------------------------------ */
/* Phase 4 (plan §3.7): X "Posts: Read" spend cap — DELIBERATELY a       */
/* separate cap from the LLM budget above. X API reads cost real money   */
/* ($0.005/post, $0.01/user lookup — plan §12) independent of whether     */
/* anything discovered ever reaches the classifier, so folding it into    */
/* `INGEST_MONTHLY_LLM_USD_CAP` would let classify spend silently eat     */
/* into (or be eaten by) X read spend with no way to see which is which.  */
/* ------------------------------------------------------------------ */

export const DEFAULT_X_MONTHLY_CAP_USD = 15;

export function getXMonthlyCapUsd(): number {
  const raw = process.env.INGEST_X_MONTHLY_USD_CAP;
  const v = raw ? Number(raw) : NaN;
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_X_MONTHLY_CAP_USD;
}

export interface XBudgetStatus {
  spentUsd: number;
  capUsd: number;
  exceeded: boolean;
}

/** Checked before resolving a handle (a "User: Read") and before fetching
 *  a page of posts (a "Posts: Read") — see `sources/x.ts`. Once exceeded,
 *  an `x_account` source's run for this month makes no further X API
 *  calls at all (not even a cheap one), the same "fail closed, don't
 *  silently keep spending" posture as the LLM budget above. */
export async function checkMonthlyXBudget(): Promise<XBudgetStatus> {
  const spentUsd = await monthlyXCostUsd();
  const capUsd = getXMonthlyCapUsd();
  const exceeded = spentUsd >= capUsd;
  if (exceeded) await sendAlert('budget_cap', `Monthly X API budget cap reached ($${spentUsd.toFixed(2)} of $${capUsd}).`);
  return { spentUsd, capUsd, exceeded };
}
