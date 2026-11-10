import { describe, it, expect } from "vitest";
import { exportPackMarkdown } from "../../src/packs/export.js";
import { PACK_ZERO } from "../../src/packs/pack-zero.js";
import { PLATFORM_WRAPPER } from "../../src/packs/wrapper.js";
import type { PackDefinition } from "../../src/packs/types.js";

const md = exportPackMarkdown(PACK_ZERO, 3);

describe("exportPackMarkdown", () => {
  it("opens and closes YAML front matter", () => {
    expect(md.startsWith("---\n")).toBe(true);
    expect(md.split("---").length).toBeGreaterThanOrEqual(3);
  });
  it("carries the model as an object so effort travels with it", () => {
    expect(md).toContain("model:\n  id: claude-opus-5");
    expect(md).toContain("  effort: high");
  });
  it("restates always_ask on the destructive built-ins", () => {
    for (const tool of ["bash", "write", "edit"]) expect(md).toContain(`- name: ${tool}`);
    expect(md.match(/type: always_ask/g)?.length).toBe(3);
  });
  it("includes the platform wrapper above the author's instructions", () => {
    expect(md.indexOf(PLATFORM_WRAPPER)).toBeGreaterThan(-1);
    expect(md.indexOf(PLATFORM_WRAPPER)).toBeLessThan(md.indexOf("You review work produced by other AI agents"));
  });
  it("records which pack and version this file came from", () => {
    expect(md).toContain("pack_slug: guardrails");
    expect(md).toContain('pack_version: "3"');
  });
  it("says it is the author's work and not for redistribution", () => {
    expect(md).toMatch(/not for redistribution/);
  });
  it("names the command that applies it", () => {
    expect(md).toContain("ant apply guardrails.md");
  });
  it("quotes a name containing a colon, which would otherwise break the YAML", () => {
    const pack: PackDefinition = { ...PACK_ZERO, name: "Reviewer: strict mode", tagline: 'He said "no"' };
    const out = exportPackMarkdown(pack, 1);
    expect(out).toContain('name: "Reviewer: strict mode"');
    expect(out).toContain('description: "He said \\"no\\""');
  });
  it("omits effort entirely for a model that rejects it", () => {
    const out = exportPackMarkdown({ ...PACK_ZERO, model: "claude-haiku-4-5", effort: undefined }, 1);
    expect(out).not.toContain("effort:");
    expect(out).toContain("id: claude-haiku-4-5");
  });
  it("emits mcp_servers and a matching toolset entry when a pack has them", () => {
    const out = exportPackMarkdown({
      ...PACK_ZERO, mcpServers: [{ name: "crm", url: "https://mcp.example.com/sse" }],
    }, 1);
    expect(out).toContain("mcp_server_name: crm");
    expect(out).toContain("url: https://mcp.example.com/sse");
  });
});
