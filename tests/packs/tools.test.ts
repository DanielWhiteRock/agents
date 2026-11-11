import { describe, it, expect } from "vitest";
import { parsePackMarkdown } from "../../src/packs/import.js";

/**
 * The `tools:` block every pack's agent.md already carries — the Anthropic
 * agent-toolset shape, a list of configs each with a name and a permission
 * policy. It used to be listed in KNOWN and then silently dropped; this is
 * the parse that keeps it, so the permissions rail has something to read.
 */
const md = `---
name: Ant
description: Restyles interfaces in Ant
tools:
  - type: agent_toolset_20260401
    default_config:
      enabled: true
    configs:
      - name: bash
        permission_policy:
          type: always_allow
      - name: write
        permission_policy:
          type: always_allow
      - name: edit
        permission_policy:
          type: always_allow
---
Do the work.`;

describe("tools off frontmatter", () => {
  it("reads each config's name and its permission policy type", () => {
    const p = parsePackMarkdown(md);
    expect(p.tools).toEqual([
      { name: "bash", policy: "always_allow" },
      { name: "write", policy: "always_allow" },
      { name: "edit", policy: "always_allow" },
    ]);
  });

  it("leaves tools empty when a pack declares none", () => {
    const p = parsePackMarkdown("---\nname: X\n---\nbody");
    expect(p.tools).toEqual([]);
  });

  it("does not report tools as an unknown key", () => {
    const p = parsePackMarkdown(md);
    expect(p.unknownKeys).not.toContain("tools");
  });
});
