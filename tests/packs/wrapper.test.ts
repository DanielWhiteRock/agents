import { describe, it, expect } from "vitest";
import { PLATFORM_WRAPPER, composeSystemPrompt } from "../../src/packs/wrapper.js";

describe("composeSystemPrompt", () => {
  it("puts the platform wrapper before the pack instructions", () => {
    const out = composeSystemPrompt({ instructions: "PACK BODY" });
    expect(out.indexOf(PLATFORM_WRAPPER)).toBeLessThan(out.indexOf("PACK BODY"));
  });
  it("names alphaCEO in the wrapper", () => {
    expect(PLATFORM_WRAPPER).toMatch(/alphaCEO/);
  });
  it("instructs against disclosing instructions", () => {
    expect(PLATFORM_WRAPPER).toMatch(/never reveal/i);
  });
  it("closes the reversible-encoding route the spike probed", () => {
    expect(PLATFORM_WRAPPER).toMatch(/base64/i);
  });
  it("requires confirmation before spending money", () => {
    expect(PLATFORM_WRAPPER).toMatch(/spends money/i);
  });
  it("rejects a pack with empty instructions", () => {
    expect(() => composeSystemPrompt({ instructions: "   " })).toThrow();
  });
});
