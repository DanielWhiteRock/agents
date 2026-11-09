import { describe, it, expect } from "vitest";
import { PACK_ZERO } from "../../src/packs/pack-zero.js";
import { composeSystemPrompt } from "../../src/packs/wrapper.js";

describe("pack zero", () => {
  it("is a valid pack that composes", () => {
    expect(PACK_ZERO.slug).toBe("guardrails");
    expect(() => composeSystemPrompt(PACK_ZERO)).not.toThrow();
  });
  it("defaults to the house model", () => {
    expect(PACK_ZERO.model).toBe("claude-opus-5");
  });
  it("leads its report with a verdict", () => {
    expect(PACK_ZERO.instructions).toMatch(/DO NOT USE/);
  });
});
