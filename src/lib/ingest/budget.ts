// Monthly LLM cost cap (§5.5, §10 "Abuse / cost"). Checked before each
// classify call; once hit, remaining candidates wait as `pending_classify`
// rather than erroring the run.
import { monthlyLlmCostUsd } from './db';

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
  return { spentUsd, capUsd, exceeded: spentUsd >= capUsd };
}
