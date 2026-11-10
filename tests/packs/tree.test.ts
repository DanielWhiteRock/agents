import { describe, it, expect } from "vitest";
import {
  normaliseTree, findDefinition, findSkillDirs, findSubagents, inertDirs,
  readFrontMatterMeta, validateTree, assertWithinLimits, PackTreeError, PACK_DIRS,
} from "../../src/packs/tree.js";
import { tarball, tarGz } from "../../src/packs/tar.js";
import { gunzipSync } from "node:zlib";

const f = (path: string, content = "x") => ({ path, content });

describe("normaliseTree", () => {
  it("strips the wrapping folder a directory picker adds", () => {
    expect(normaliseTree([f("my-pack/agent.md"), f("my-pack/skills/a/SKILL.md")]).map((x) => x.path))
      .toEqual(["agent.md", "skills/a/SKILL.md"]);
  });
  it("leaves an already-flat tree alone", () => {
    expect(normaliseTree([f("agent.md"), f("skills/a/SKILL.md")]).map((x) => x.path))
      .toEqual(["agent.md", "skills/a/SKILL.md"]);
  });
  it("does not mistake a real top-level directory for a wrapper", () => {
    expect(normaliseTree([f("skills/a/SKILL.md"), f("skills/b/SKILL.md")]).map((x) => x.path))
      .toEqual(["skills/a/SKILL.md", "skills/b/SKILL.md"]);
  });
  it("refuses path traversal", () => {
    expect(normaliseTree([f("../../etc/passwd"), f("agent.md")]).map((x) => x.path)).toEqual(["agent.md"]);
  });
  it("drops dotfiles but keeps the plugin manifest", () => {
    expect(normaliseTree([f(".git/config"), f(".claude-plugin/plugin.json"), f("agent.md")]).map((x) => x.path))
      .toEqual([".claude-plugin/plugin.json", "agent.md"]);
  });
});

describe("findSkillDirs", () => {
  it("groups each skill directory and sorts its files", () => {
    const dirs = findSkillDirs([
      f("skills/beta/SKILL.md"), f("skills/alpha/references/n.md"), f("skills/alpha/SKILL.md"),
    ]);
    expect(dirs.map((d) => d.name)).toEqual(["alpha", "beta"]);
    expect(dirs[0]!.files.map((x) => x.path)).toEqual(["SKILL.md", "references/n.md"]);
  });
  it("refuses a skill directory with no SKILL.md", () => {
    expect(() => findSkillDirs([f("skills/alpha/notes.md")])).toThrow(/no SKILL.md/);
  });
  it("accepts lowercase skill.md, since filesystems differ", () => {
    expect(findSkillDirs([f("skills/alpha/skill.md")])).toHaveLength(1);
  });
});

describe("findSubagents", () => {
  it("reads agents/*.md as subagents", () => {
    expect(findSubagents([f("agents/reviewer.md"), f("agents/writer.md"), f("skills/a/SKILL.md")])
      .map((s) => s.name)).toEqual(["reviewer", "writer"]);
  });
  it("ignores anything nested deeper", () => {
    expect(findSubagents([f("agents/sub/dir.md")])).toHaveLength(0);
  });
});

describe("readFrontMatterMeta", () => {
  it("reads name and description", () => {
    expect(readFrontMatterMeta("---\nname: pr-summary\ndescription: Summarise a PR.\n---\n\n# body"))
      .toEqual({ name: "pr-summary", description: "Summarise a PR." });
  });
  it("returns nothing for a file without front matter", () => {
    expect(readFrontMatterMeta("just text")).toEqual({});
  });
});

describe("validateTree", () => {
  const good = [
    f("agent.md", "---\nname: X\n---\nbody"),
    f("skills/elasticity/SKILL.md", "---\nname: elasticity\n---\nhow"),
    f("skills/elasticity/references/notes.md"),
    f("agents/reviewer.md"), f("commands/audit.md"), f("hooks/pre.sh"),
    f("README.md"), f(".claude-plugin/plugin.json"),
  ];

  it("accepts the whole plugin layout", () => {
    const out = validateTree(good);
    expect(out.definition.path).toBe("agent.md");
    expect(out.skills.map((s) => s.name)).toEqual(["elasticity"]);
    expect(out.subagents.map((s) => s.name)).toEqual(["reviewer"]);
  });
  it("reports which directories travel but do not run here", () => {
    expect(validateTree(good).inert).toEqual([".claude-plugin", "commands", "hooks"]);
  });
  it("refuses a folder with no definition", () => {
    expect(() => validateTree([f("skills/a/SKILL.md"), f("skills/b/SKILL.md")])).toThrow(/no agent.md/);
  });
  it("names files that are in no recognised place", () => {
    expect(() => validateTree([f("agent.md"), f("random/thing.md")])).toThrow(/not in a place a pack recognises/);
  });
  it("takes a single markdown file as a pack with no skills", () => {
    const out = validateTree([f("whatever.md", "method")]);
    expect(out.skills).toHaveLength(0);
    expect(out.definition.path).toBe("whatever.md");
  });
  it("every documented directory is actually allowed", () => {
    for (const dir of Object.keys(PACK_DIRS)) {
      expect(() => validateTree([f("agent.md"), f(`${dir}/thing.md`)])).not.toThrow();
    }
  });
});

describe("assertWithinLimits", () => {
  it("refuses an oversized file by name", () => {
    expect(() => assertWithinLimits([f("skills/a/SKILL.md", "x".repeat(300 * 1024))]))
      .toThrow(/skills\/a\/SKILL.md is \d+KB/);
  });
  it("refuses too many files", () => {
    expect(() => assertWithinLimits(Array.from({ length: 201 }, (_, i) => f(`skills/a/${i}.md`))))
      .toThrow(/201 files/);
  });
});

describe("tarball", () => {
  const tree = [f("agent.md", "hello"), f("skills/a/SKILL.md", "skill")];

  it("writes 512-byte blocks and ends with two empty ones", () => {
    const tar = tarball(tree, "my-pack", new Date(0));
    expect(tar.length % 512).toBe(0);
    expect(tar.subarray(tar.length - 1024).every((b) => b === 0)).toBe(true);
  });
  it("roots every entry under the pack name", () => {
    const tar = tarball(tree, "my-pack", new Date(0));
    expect(tar.subarray(0, 100).toString("utf8").replace(/\0+$/, "")).toBe("my-pack/agent.md");
  });
  it("writes a checksum that matches the header", () => {
    const tar = tarball([f("agent.md", "hello")], "p", new Date(0));
    const header = Buffer.from(tar.subarray(0, 512));
    const stored = parseInt(header.subarray(148, 155).toString("ascii"), 8);
    header.write("        ", 148, 8, "ascii");
    let sum = 0;
    for (const b of header) sum += b;
    expect(sum).toBe(stored);
  });
  it("gzips to something that gunzips back to the tar", () => {
    const plain = tarball(tree, "my-pack", new Date(0));
    expect(gunzipSync(tarGz(tree, "my-pack", new Date(0))).equals(plain)).toBe(true);
  });
  it("refuses a path too long for a tar header rather than truncating it", () => {
    expect(() => tarball([f(`skills/${"a".repeat(120)}/SKILL.md`)], "p")).toThrow(/path too long/);
  });
});

import { checkSkill, checkSkills } from "../../src/packs/tree.js";

const skill = (frontmatter: string, body = "# Thing\n\nDo it.", extra: Array<{ path: string; content: string }> = []) => ({
  name: "processing-pdfs",
  files: [{ path: "SKILL.md", content: `---\n${frontmatter}\n---\n${body}` }, ...extra],
});

const good = "name: processing-pdfs\ndescription: Extracts text and tables from PDF files. Use when the user mentions PDFs or document extraction.";

describe("checkSkill — the published rules", () => {
  it("passes a skill that follows them", () => {
    const out = checkSkill(skill(good));
    expect(out.errors).toEqual([]);
    expect(out.warnings).toEqual([]);
  });

  it("requires a name and a description", () => {
    expect(checkSkill(skill("description: Does a thing. Use when asked.")).errors[0]!.message).toMatch(/no `name`/);
    expect(checkSkill(skill("name: thing")).errors[0]!.message).toMatch(/no `description`/);
  });

  it("enforces the documented name format", () => {
    expect(checkSkill(skill("name: Processing_PDFs\ndescription: x. Use when y.")).errors[0]!.message)
      .toMatch(/lowercase letters, numbers and hyphens/);
  });

  it("enforces the 64-character name limit", () => {
    const long = "a".repeat(65);
    expect(checkSkill(skill(`name: ${long}\ndescription: x. Use when y.`)).errors.some((e) => /65 characters/.test(e.message))).toBe(true);
  });

  it("rejects the reserved words", () => {
    for (const word of ["claude-helper", "anthropic-tools"]) {
      expect(checkSkill(skill(`name: ${word}\ndescription: x. Use when y.`)).errors.some((e) => /reserved word/.test(e.message))).toBe(true);
    }
  });

  it("enforces the 1024-character description limit", () => {
    const long = "x".repeat(1025);
    expect(checkSkill(skill(`name: thing\ndescription: ${long}`)).errors.some((e) => /1024/.test(e.message))).toBe(true);
  });

  it("rejects XML tags in the metadata", () => {
    expect(checkSkill(skill("name: thing\ndescription: <b>bold</b>. Use when y.")).errors.some((e) => /XML tags/.test(e.message))).toBe(true);
  });

  it("warns about a first-person description, which is injected into the system prompt", () => {
    expect(checkSkill(skill("name: thing\ndescription: I can help you process PDFs. Use when asked.")).warnings
      .some((w) => /third person/.test(w.message))).toBe(true);
  });

  it("warns when a description says what but not when", () => {
    expect(checkSkill(skill("name: thing\ndescription: Processes PDF files and extracts tables.")).warnings
      .some((w) => /not when to use it/.test(w.message))).toBe(true);
  });

  it("warns when the body runs past 500 lines", () => {
    expect(checkSkill(skill(good, "x\n".repeat(520))).warnings.some((w) => /under 500/.test(w.message))).toBe(true);
  });

  it("warns about a bundled file nothing links to", () => {
    expect(checkSkill(skill(good, "# Thing\n\nDo it.", [{ path: "reference.md", content: "detail" }])).warnings
      .some((w) => /nothing in SKILL.md links to this file/.test(w.message))).toBe(true);
  });

  it("accepts a bundled file that SKILL.md links to", () => {
    const out = checkSkill(skill(good, "# Thing\n\nSee [reference.md](reference.md).", [
      { path: "reference.md", content: "detail" },
    ]));
    expect(out.warnings).toEqual([]);
  });

  it("warns about a reference two levels deep, which gets read partially", () => {
    const out = checkSkill(skill(good, "See [advanced.md](advanced.md).", [
      { path: "advanced.md", content: "See [details.md](details.md)." },
      { path: "details.md", content: "the actual information" },
    ]));
    expect(out.warnings.some((w) => /two levels from SKILL.md/.test(w.message))).toBe(true);
  });

  it("warns when the directory and the declared name disagree", () => {
    expect(checkSkill({ ...skill(good), name: "pdfs" }).warnings
      .some((w) => /does not match the directory/.test(w.message))).toBe(true);
  });

  it("reports a missing SKILL.md as an error and stops there", () => {
    const out = checkSkill({ name: "empty", files: [{ path: "notes.md", content: "x" }] });
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0]!.message).toMatch(/missing/);
  });

  it("names which skill each problem belongs to, across several", () => {
    const out = checkSkills([
      { ...skill(good), name: "ok-skill", files: [{ path: "SKILL.md", content: `---\nname: ok-skill\ndescription: Does it. Use when asked.\n---\nbody` }] },
      { name: "broken", files: [{ path: "SKILL.md", content: "---\nname: Broken_Name\n---\nbody" }] },
    ]);
    expect(out.errors.every((e) => e.skill === "broken")).toBe(true);
    expect(out.errors.length).toBeGreaterThanOrEqual(2);
  });
});

import { PLATFORM_SKILLS } from "../../src/packs/platform-skills.js";

describe("the platform's own skills", () => {
  it("pass the same rules we enforce on an author", () => {
    // Shipping a skill that would be rejected on upload would be indefensible.
    const out = checkSkills(PLATFORM_SKILLS.map((s) => ({ name: s.name, files: s.files.map((f) => ({ path: f.path, content: f.content })) })));
    expect(out.errors).toEqual([]);
    expect(out.warnings).toEqual([]);
  });

  it("say both what they do and when to use them", () => {
    for (const skill of PLATFORM_SKILLS) {
      const md = skill.files.find((f) => f.path === "SKILL.md")!;
      expect(md.content).toMatch(/Use when/i);
    }
  });

  it("keep their bundled files one level from SKILL.md", () => {
    for (const skill of PLATFORM_SKILLS) {
      const md = skill.files.find((f) => f.path === "SKILL.md")!.content;
      for (const f of skill.files.filter((x) => x.path !== "SKILL.md")) {
        expect(md).toContain(f.path);
      }
    }
  });
});
