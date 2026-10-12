// $/MTok by model, for run cost estimates (§5.5 budget guard, §12).
//
// The single source of truth — `scripts/ingest-eval.ts` used to carry its
// own duplicate of this table (a Phase 1b follow-up fixed in Phase 2, per
// plans/event-ingestion.md: "sharing the duplicated model price tables
// between ingest-eval.ts and pricing.ts") and now imports `PRICE_TABLE`/
// `priceForModel` from here instead. Prices confirmed live against
// GET /v1/models + current OpenAI pricing at the time of the tuning round
// (2026-10-11) — there's no pricing-lookup API, so update this (one place)
// if a listed model's price changes.
export const PRICE_TABLE: Record<string, { in: number; out: number }> = {
  'gpt-5-nano': { in: 0.05, out: 0.4 },
  'gpt-5-mini': { in: 0.25, out: 2.0 },
};

/** `fallbackModel` lets callers pick what an unlisted model prices as —
 *  production code (this module's own `estimateCostUsd`) falls back to the
 *  production default (`gpt-5-mini`); the eval harness falls back to its
 *  own default sweep model (`gpt-5-nano`) by passing it explicitly. */
export function priceForModel(model: string, fallbackModel: string = 'gpt-5-mini'): { in: number; out: number } {
  return PRICE_TABLE[model] ?? PRICE_TABLE[fallbackModel] ?? PRICE_TABLE['gpt-5-mini'];
}

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = priceForModel(model);
  return (inputTokens / 1e6) * price.in + (outputTokens / 1e6) * price.out;
}
