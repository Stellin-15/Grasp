/**
 * API list prices per million tokens (input, output), checked 2026-09-25.
 * Claude Code on a Claude plan is not billed per token; these give an
 * "API-equivalent" figure so users can judge how much of their plan a run uses.
 */
const PRICES: [RegExp, number, number][] = [
  [/fable/i, 10, 50],
  [/opus/i, 4, 20],
  [/haiku/i, 1, 5],
  [/sonnet/i, 2, 10],
];

export function estimateUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): { usd: number; basis: string } {
  const hit = PRICES.find(([re]) => re.test(model));
  // Unknown or "default" model: Sonnet rates as a middle estimate.
  const [, inp, out] = hit ?? [/sonnet/, 2, 10];
  const label = hit ? model : "Sonnet rates (your Claude Code default model may differ)";
  return { usd: (inputTokens * inp + outputTokens * out) / 1_000_000, basis: label };
}
