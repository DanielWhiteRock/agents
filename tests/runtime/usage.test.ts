import { describe, it, expect } from "vitest";
import { parseUsage } from "../../src/runtime/usage.js";
import { InvalidMoneyError } from "../../src/runtime/money.js";

describe("parseUsage", () => {
  it("parses a usage object as measured from the live API", () => {
    expect(parseUsage({
      active_seconds: 6.144,
      cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 6493 },
      cache_read_input_tokens: 0,
      input_tokens: 2,
      list_cost: { amount: "5", currency: "USD" },
      output_tokens: 288,
      server_tool_use: { web_fetch_requests: 0, web_search_requests: 0 },
    })).toEqual({
      inputTokens: 2, outputTokens: 288,
      listCost: { amount: "5", currency: "USD" },
      activeSeconds: 6.144,
    });
  });
  it("zeroes usage on a session that has not run", () => {
    expect(parseUsage(undefined)).toEqual({
      inputTokens: 0, outputTokens: 0,
      listCost: { amount: "0", currency: "USD" }, activeSeconds: 0,
    });
  });
  it("propagates an invalid list_cost rather than coercing it", () => {
    expect(() => parseUsage({ list_cost: { amount: "1.5", currency: "USD" } })).toThrow(InvalidMoneyError);
  });
});
