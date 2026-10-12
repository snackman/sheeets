// $/MTok by model, for run cost estimates (§5.5 budget guard, §12).
// Mirrors the price table in `scripts/ingest-eval.ts` (duplicated rather than
// imported so this lib module has no dependency on `scripts/`) — keep both in
// sync if a listed model's price changes.
const PRICE_TABLE: Record<string, { in: number; out: number }> = {
  'gpt-5-nano': { in: 0.05, out: 0.4 },
  'gpt-5-mini': { in: 0.25, out: 2.0 },
};

export function priceForModel(model: string): { in: number; out: number } {
  return PRICE_TABLE[model] ?? PRICE_TABLE['gpt-5-mini'];
}

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = priceForModel(model);
  return (inputTokens / 1e6) * price.in + (outputTokens / 1e6) * price.out;
}
