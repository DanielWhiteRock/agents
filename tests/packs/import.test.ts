import { describe, it, expect } from "vitest";
import { parsePackMarkdown, parsePackFolder, splitFrontMatter, PackParseError } from "../../src/packs/import.js";
import { exportPackMarkdown } from "../../src/packs/export.js";
import { PACK_ZERO } from "../../src/packs/pack-zero.js";
import { PLATFORM_WRAPPER } from "../../src/packs/wrapper.js";

describe("splitFrontMatter", () => {
  it("separates front matter from the body", () => {
    expect(splitFrontMatter("---\nname: x\n---\nbody here")).toEqual({ front: "name: x", body: "body here" });
  });
  it("treats a file with no front matter as all body", () => {
    expect(splitFrontMatter("just instructions")).toEqual({ front: "", body: "just instructions" });
  });
  it("refuses front matter that never closes", () => {
    expect(() => splitFrontMatter("---\nname: x\nbody")).toThrow(PackParseError);
  });
  it("normalises Windows line endings", () => {
    expect(splitFrontMatter("---\r\nname: x\r\n---\r\nbody").front).toBe("name: x");
  });
});

describe("round trip", () => {
  it("exports and re-reads a pack without changing its meaning", () => {
    const parsed = parsePackMarkdown(exportPackMarkdown(PACK_ZERO, 4));
    expect(parsed.name).toBe(PACK_ZERO.name);
    expect(parsed.tagline).toBe(PACK_ZERO.tagline);
    expect(parsed.model).toBe(PACK_ZERO.model);
    expect(parsed.effort).toBe(PACK_ZERO.effort);
    expect(parsed.slug).toBe(PACK_ZERO.slug);
    expect(parsed.author).toBe(PACK_ZERO.author);
    expect(parsed.instructions).toBe(PACK_ZERO.instructions.trim());
  });

  it("does not accumulate the platform wrapper across repeated trips", () => {
    let md = exportPackMarkdown(PACK_ZERO, 1);
    for (let i = 0; i < 3; i += 1) {
      const p = parsePackMarkdown(md);
      expect(p.instructions).not.toContain(PLATFORM_WRAPPER);
      md = exportPackMarkdown({ ...PACK_ZERO, instructions: p.instructions }, i + 2);
    }
    expect(parsePackMarkdown(md).instructions).toBe(PACK_ZERO.instructions.trim());
  });

  it("survives a name containing a colon and a quote", () => {
    const pack = { ...PACK_ZERO, name: 'Reviewer: "strict" mode' };
    expect(parsePackMarkdown(exportPackMarkdown(pack, 1)).name).toBe('Reviewer: "strict" mode');
  });

  it("carries MCP servers back", () => {
    const pack = { ...PACK_ZERO, mcpServers: [{ name: "crm", url: "https://mcp.example.com/sse" }] };
    expect(parsePackMarkdown(exportPackMarkdown(pack, 1)).mcpServers)
      .toEqual([{ name: "crm", url: "https://mcp.example.com/sse" }]);
  });
});

describe("parsePackMarkdown", () => {
  it("accepts a plain scalar model", () => {
    const p = parsePackMarkdown("---\nname: Thing\nmodel: claude-sonnet-5\n---\nDo the thing well.");
    expect(p.model).toBe("claude-sonnet-5");
    expect(p.instructions).toBe("Do the thing well.");
  });
  it("accepts a file with no front matter at all", () => {
    const p = parsePackMarkdown("Just a method, written plainly.");
    expect(p.instructions).toBe("Just a method, written plainly.");
    expect(p.name).toBeUndefined();
  });
  it("refuses a file with no instructions", () => {
    expect(() => parsePackMarkdown("---\nname: Empty\n---\n\n")).toThrow(/no instructions/);
  });
  it("reports keys it does not understand rather than dropping them silently", () => {
    const p = parsePackMarkdown("---\nname: X\nwibble: 3\n---\nbody");
    expect(p.unknownKeys).toContain("wibble");
  });
  it("reads description as the tagline, since that is what ant apply calls it", () => {
    expect(parsePackMarkdown("---\ndescription: A short line\n---\nbody").tagline).toBe("A short line");
  });
});

describe("parsePackFolder", () => {
  const def = "---\nname: Campaigner\ndescription: Plans campaigns\nmodel: claude-opus-5\n---\nStep 1: the outcome.";

  it("takes a single file as the whole pack", () => {
    expect(parsePackFolder([{ path: "whatever.md", text: def }]).name).toBe("Campaigner");
  });
  it("uses agent.md as the definition and appends the rest as sections", () => {
    const out = parsePackFolder([
      { path: "my-pack/skills/02-channels.md", text: "Channel is chosen last." },
      { path: "my-pack/agent.md", text: def },
      { path: "my-pack/skills/01-audience.md", text: "# Audience\n\nName one group." },
    ]);
    expect(out.name).toBe("Campaigner");
    // Filename order, so an author can number their files and control it.
    expect(out.instructions.indexOf("Name one group")).toBeLessThan(out.instructions.indexOf("Channel is chosen last"));
    // A document with its own heading keeps it; one without gets its filename.
    expect(out.instructions).toContain("# Audience");
    expect(out.instructions).toContain("## 02 channels");
  });
  it("refuses an ambiguous folder rather than guessing which file is the pack", () => {
    expect(() => parsePackFolder([
      { path: "a.md", text: "one" }, { path: "b.md", text: "two" },
    ])).toThrow(/none is called agent.md/);
  });
  it("ignores files that are not text", () => {
    expect(() => parsePackFolder([{ path: "logo.png", text: "" }])).toThrow(/no markdown or text files/);
  });
  it("skips empty files", () => {
    const out = parsePackFolder([{ path: "agent.md", text: def }, { path: "notes.md", text: "   " }]);
    expect(out.instructions).toBe("Step 1: the outcome.");
  });
});
