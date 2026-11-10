import { describe, it, expect } from "vitest";
import { parsePackMarkdown } from "../../src/packs/import.js";

/**
 * A folder's own copy of its listing: the long description, the list fields
 * and the FAQ, read off frontmatter so an import is not a blank pack page.
 *
 * `description:` already means the tagline (tested in import.test.ts), and
 * every existing agent.md relies on that staying true — so the long body
 * arrives under its own key, `description_long:`.
 */
const md = `---
name: Three Lenses
description: Three lenses for one branch
description_long: Three bodies of work, pulling against each other.
use_cases: Review a branch, Find the bug you can describe
limitations: Needs a real diff, Not for binary files
requirements: A git remote, Read access to the repo
built_on: "Dietrich Gebert, Cursor, Poteto — MIT"
faq:
  - q: Does it write to the branch?
    a: No, it only reads.
  - q: Does it need network access?
    a: No.
---
Do the work.`;

describe("listing fields off frontmatter", () => {
  it("reads the long description and the list fields off frontmatter", () => {
    const p = parsePackMarkdown(md);
    expect(p.descriptionLong).toBe("Three bodies of work, pulling against each other.");
    expect(p.useCases).toEqual(["Review a branch", "Find the bug you can describe"]);
    expect(p.limitations).toEqual(["Needs a real diff", "Not for binary files"]);
    expect(p.requirements).toEqual(["A git remote", "Read access to the repo"]);
    expect(p.builtOn).toBe("Dietrich Gebert, Cursor, Poteto — MIT");
  });

  it("reads a list of question/answer pairs for the FAQ", () => {
    const p = parsePackMarkdown(md);
    expect(p.faq).toEqual([
      { q: "Does it write to the branch?", a: "No, it only reads." },
      { q: "Does it need network access?", a: "No." },
    ]);
  });

  it("leaves the tagline alone when only description is present", () => {
    const p = parsePackMarkdown("---\ndescription: A short line\n---\nbody");
    expect(p.tagline).toBe("A short line");
    expect(p.descriptionLong).toBeUndefined();
  });

  it("leaves the new fields empty or undefined when a pack asks for none of them", () => {
    const p = parsePackMarkdown("---\nname: X\n---\nbody");
    expect(p.descriptionLong).toBeUndefined();
    expect(p.useCases).toEqual([]);
    expect(p.limitations).toEqual([]);
    expect(p.requirements).toEqual([]);
    expect(p.faq).toEqual([]);
    expect(p.builtOn).toBeUndefined();
  });

  it("does not let an unrecognised nested faq key leave a stray entry", () => {
    const p = parsePackMarkdown("---\nfaq:\n  - a: An answer with no question first\n---\nbody");
    expect(p.faq).toEqual([]);
  });
});
