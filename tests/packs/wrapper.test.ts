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

describe("heroSrc", () => {
  it("serves a bare filename from our own assets", async () => {
    const { heroSrc } = await import("../../src/app/views.js");
    expect(heroSrc("brutalism.webp")).toBe("/assets/brutalism.webp");
    expect(heroSrc("/brutalism.webp")).toBe("/assets/brutalism.webp");
  });

  it("passes an author's own https URL through", async () => {
    const { heroSrc } = await import("../../src/app/views.js");
    const url = "https://pub-xyz.r2.dev/agents/systems/brutalism.webp";
    expect(heroSrc(url)).toBe(url);
  });

  it("refuses any other scheme", async () => {
    // A card is not worth mixed content, and `javascript:` in an img src is
    // inert but is also a sign somebody is probing.
    const { heroSrc } = await import("../../src/app/views.js");
    expect(heroSrc("http://insecure.example/x.webp")).toBe("");
    expect(heroSrc("javascript:alert(1)")).toBe("");
    expect(heroSrc("data:image/svg+xml,<svg/>")).toBe("");
  });
});
