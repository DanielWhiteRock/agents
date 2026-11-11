import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parsePackMarkdown } from "../../src/packs/import.js";
import { assertWithinLimits, checkSkills, validateTree, type PackFile } from "../../src/packs/tree.js";
import { ROLES } from "../../src/app/roles.js";

/**
 * The packs that ship in this repository, checked against the importer that
 * would read them.
 *
 * `packs/<slug>/` is a folder an author could push with `scripts/pack-publish.mjs`,
 * which means every one of them goes through `parsePackMarkdown` and
 * `validateTree` on the way in. A pack that fails either is a pack that cannot
 * be published — and nothing told us, because the folders were never read by a
 * test. They are now.
 */
const PACKS_DIR = new URL("../../packs/", import.meta.url).pathname;

const read = (dir: string): PackFile[] => {
  const out: PackFile[] = [];
  const walk = (path: string): void => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = join(path, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push({ path: relative(dir, full), content: readFileSync(full, "utf8") });
    }
  };
  walk(dir);
  return out;
};

const slugs = readdirSync(PACKS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && statSync(join(PACKS_DIR, d.name, "agent.md")).isFile())
  .map((d) => d.name)
  .sort();

const roleIds = new Set(ROLES.map((r) => r.id));

/**
 * One pre-existing failure, named rather than excused.
 *
 * `packs/claude` calls its skill `claude`, and the published rules reserve that
 * word — the Skills API would refuse it on upload, so that pack cannot ship its
 * skill until it is renamed. It is one of the 67 aesthetics and renaming it is
 * its owner's call, not this test's. Recorded here so the suite keeps saying so
 * instead of the folder quietly staying unpublishable.
 */
const KNOWN_ERRORS: Record<string, RegExp> = { claude: /reserved word/ };

describe("the packs in this repository", () => {
  it("found some to check", () => {
    expect(slugs.length).toBeGreaterThan(60);
  });

  it.each(slugs)("%s imports as a pack", (slug) => {
    const tree = read(join(PACKS_DIR, slug));
    const parsed = parsePackMarkdown(readFileSync(join(PACKS_DIR, slug, "agent.md"), "utf8"));

    expect(parsed.name).toBeTruthy();
    expect(parsed.slug).toBe(slug);
    expect(parsed.tagline).toBeTruthy();
    expect(parsed.author).toBeTruthy();
    expect(parsed.model).toBeTruthy();
    expect(parsed.instructions.length).toBeGreaterThan(200);
    // A key we do not understand is a key the author loses silently.
    expect(parsed.unknownKeys).toEqual([]);
    // `platform.roles()` will not advertise a role with no packs, so a pack
    // tagged with a role that does not exist is a pack nobody can find.
    expect(roleIds.has(parsed.role ?? "")).toBe(true);

    const validated = validateTree(tree);
    expect(validated.definition.path).toBe("agent.md");
    assertWithinLimits(tree);
    const known = KNOWN_ERRORS[slug];
    const errors = checkSkills(validated.skills).errors;
    if (known) expect(errors.every((e) => known.test(e.message))).toBe(true);
    else expect(errors).toEqual([]);
  });

  it("credits an upstream wherever a pack carries somebody else's skills", () => {
    // MIT and Apache-2.0 both require the notice to travel with the copy, and
    // `built_on` is the field the listing shows it in.
    for (const slug of ["senior-engineer", "on-call", "security-audit", "growth-lead", "agent-builder"]) {
      const front = readFileSync(join(PACKS_DIR, slug, "agent.md"), "utf8");
      const readme = readFileSync(join(PACKS_DIR, slug, "README.md"), "utf8");
      const credit = parsePackMarkdown(front).builtOn ?? parsePackMarkdown(front).author!;
      expect(credit).toMatch(/MIT|Apache/);
      expect(readme).toMatch(/Copyright/);
    }
  });
});
