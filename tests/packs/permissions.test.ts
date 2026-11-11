import { describe, it, expect } from "vitest";
import { permissionSummary } from "../../src/packs/permissions.js";

/**
 * The permissions rail is derived, not declared. It reads the tool *names* a
 * pack stored and the policy the run is **effectively** configured with — the
 * platform-wide setting, forced to `always_ask` where the pack ships a
 * PreToolUse hook — and turns that into human-readable lines.
 *
 * It deliberately does not read `pack_tools.policy`: that is the author's own
 * `agent.md` text and it never reaches the runtime, so rendering it let the
 * rail say "runs unattended" about a worker that actually pauses. The
 * resolution lives in `platform.effectivePolicy`; this is the pure function
 * that puts the answer into words.
 */
describe("permissionSummary", () => {
  it("says what a pack with bash, write and edit may do", () => {
    const { lines } = permissionSummary({
      tools: ["bash", "write", "edit"],
      mcpServers: [],
      policy: "always_allow",
    });
    expect(lines).toContain("bash, write, edit — runs unattended");
  });

  it("states the effective policy, not whatever the author's agent.md declared", () => {
    // The branch's own export→re-import round trip stores `always_ask` for
    // these three, because `export.ts` writes that into every exported
    // agent.md deliberately. The run is still configured from the platform
    // setting, so the rail must follow the run.
    const { lines } = permissionSummary({
      tools: ["bash", "write", "edit"],
      mcpServers: [],
      policy: "always_allow",
    });
    expect(lines).not.toContain("bash, write, edit — pauses for a human");
    expect(lines).toContain("bash, write, edit — runs unattended");
  });

  it("says a worker pauses when a hook has forced it to", () => {
    const { lines } = permissionSummary({
      tools: ["bash", "write"],
      mcpServers: [],
      policy: "always_ask",
    });
    expect(lines).toContain("bash, write — pauses for a human");
  });

  it("states the platform-level truth when a pack has no stored tools", () => {
    const { lines } = permissionSummary({
      tools: [],
      mcpServers: [],
      policy: "always_allow",
    });
    // What any worker here may do, in a buyer's terms — not a report on the
    // state of our own tables.
    expect(lines.some((l) => /shell commands/.test(l) && /read and write files/.test(l))).toBe(true);
    expect(lines.some((l) => /run unattended/.test(l))).toBe(true);
    expect(lines.join(" ")).not.toMatch(/no tools recorded/);
  });

  it("changes the posture sentence with the effective policy, and stays grammatical", () => {
    const asked = permissionSummary({ tools: [], mcpServers: [], policy: "always_ask" }).lines;
    expect(asked.some((l) => /pauses for a human/.test(l))).toBe(true);

    const auto = permissionSummary({ tools: [], mcpServers: [], policy: "auto" }).lines;
    expect(auto.some((l) => /left to the server's judgement/.test(l))).toBe(true);
    // The old line read "the platform default left to the server's judgement".
    expect(auto.join(" ")).not.toMatch(/default left to/);
  });

  it("names pinned web domains", () => {
    const { lines } = permissionSummary({
      tools: ["bash"],
      mcpServers: [],
      web: { allowedDomains: ["example.com", "docs.example.com"] },
      policy: "always_allow",
    });
    expect(lines).toContain("web: limited to example.com, docs.example.com");
  });

  it("says unrestricted when there are no pinned domains", () => {
    const { lines } = permissionSummary({
      tools: ["bash"],
      mcpServers: [],
      policy: "always_allow",
    });
    expect(lines).toContain("web: unrestricted");
  });

  it("names the MCP servers a pack connects to", () => {
    const { lines } = permissionSummary({
      tools: [],
      mcpServers: [{ name: "notion", url: "https://mcp.notion.com" }],
      policy: "always_allow",
    });
    expect(lines).toContain("connects to notion (https://mcp.notion.com)");
  });
});
