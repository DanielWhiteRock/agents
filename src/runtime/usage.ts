import { type Money, ZERO_USD, parseMoney } from "./money.js";

/**
 * What a run consumed.
 *
 * `listCost` is the platform's own figure, priced at public list rates rather
 * than any contracted price — so a negotiated discount becomes margin while
 * buyers are still charged points against list. Do not replace it with a
 * derived or actual-cost number.
 *
 * `activeSeconds` is a float: measured at 6.144 on a single short turn.
 */
export type RuntimeUsage = {
  inputTokens: number;
  outputTokens: number;
  listCost: Money;
  activeSeconds: number;
};

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** A session that has not run yet reports no usage; that is zero, not an error. */
export function parseUsage(raw: unknown): RuntimeUsage {
  if (typeof raw !== "object" || raw === null) {
    return { inputTokens: 0, outputTokens: 0, listCost: ZERO_USD, activeSeconds: 0 };
  }
  const r = raw as Record<string, unknown>;
  return {
    inputTokens: count(r["input_tokens"]),
    outputTokens: count(r["output_tokens"]),
    listCost: r["list_cost"] === undefined ? ZERO_USD : parseMoney(r["list_cost"]),
    activeSeconds: count(r["active_seconds"]),
  };
}
