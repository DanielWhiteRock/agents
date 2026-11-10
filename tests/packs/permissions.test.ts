import { describe, it, expect } from "vitest";
import { permissionSummary } from "../../src/packs/permissions.js";

/**
 * The permissions rail is derived, not declared: it reads what a pack
 * actually stored (tools, MCP servers, pinned web domains) and turns that
 * into human-readable lines. `permissionSummary` is the pure function that
 * does the turning — no DB, no platform settings, just the shape the caller
 * hands it.
 */
describe("permissionSummary", () => {
  it("says what a pack with bash, write and edit may do", () => {
    const { lines } = permissionSummary({
      tools: [
        { name: "bash", policy: "always_allow" },
        { name: "write", policy: "always_allow" },
        { name: "edit", policy: "always_allow" },
      ],
      mcpServers: [],
      defaultPolicy: "always_allow",
    });
    expect(lines).toContain("bash, write, edit — runs unattended");
  });

  it("groups tools by policy rather than flattening them into one line", () => {
    const { lines } = permissionSummary({
      tools: [
        { name: "bash", policy: "always_ask" },
        { name: "write", policy: "always_allow" },
      ],
      mcpServers: [],
      defaultPolicy: "always_allow",
    });
    expect(lines).toContain("bash — pauses for a human");
    expect(lines).toContain("write — runs unattended");
  });

  it("falls back to the platform statement when a pack has no stored tools", () => {
    const { lines } = permissionSummary({
      tools: [],
      mcpServers: [],
      defaultPolicy: "always_allow",
    });
    expect(lines.some((l) => l.includes("no tools") && l.includes("runs unattended"))).toBe(true);
  });

  it("falls back to the platform statement using whatever policy is configured", () => {
    const { lines } = permissionSummary({
      tools: [],
      mcpServers: [],
      defaultPolicy: "always_ask",
    });
    expect(lines.some((l) => l.includes("no tools") && l.includes("pauses for a human"))).toBe(true);
  });

  it("names pinned web domains", () => {
    const { lines } = permissionSummary({
      tools: [{ name: "bash", policy: "always_allow" }],
      mcpServers: [],
      web: { allowedDomains: ["example.com", "docs.example.com"] },
      defaultPolicy: "always_allow",
    });
    expect(lines).toContain("web: limited to example.com, docs.example.com");
  });

  it("says unrestricted when there are no pinned domains", () => {
    const { lines } = permissionSummary({
      tools: [{ name: "bash", policy: "always_allow" }],
      mcpServers: [],
      defaultPolicy: "always_allow",
    });
    expect(lines).toContain("web: unrestricted");
  });

  it("names the MCP servers a pack connects to", () => {
    const { lines } = permissionSummary({
      tools: [],
      mcpServers: [{ name: "notion", url: "https://mcp.notion.com" }],
      defaultPolicy: "always_allow",
    });
    expect(lines).toContain("connects to notion (https://mcp.notion.com)");
  });
});
