/**
 * A pack is a folder, in the layout Claude Code plugins already use.
 *
 *   my-pack/
 *     agent.md                      the agent definition (ant apply format)
 *     .claude-plugin/plugin.json    optional manifest
 *     skills/
 *       elasticity/
 *         SKILL.md                  name + description frontmatter
 *         references/notes.md       whatever the skill ships
 *         scripts/check.sh
 *       competitors/SKILL.md
 *     agents/reviewer.md            subagents this pack can delegate to
 *     commands/audit.md             slash commands
 *     hooks/pre-run.sh              hooks
 *     workflows/sweep.js            workflow scripts
 *     docs/, README.md, LICENSE
 *
 * Nothing here is invented: it is the shape a plugin on disk already has.
 *
 * What the hosted runtime can act on is narrower than what the folder can
 * hold. `skills/` upload to the Skills API and attach to the agent, so the
 * model gets progressive disclosure and reads only the skill a task calls for.
 * `agents/` become subagents. `commands/`, `hooks/` and `workflows/` are Claude
 * Code client features with no server-side equivalent — they are stored,
 * versioned and exported faithfully, and they do not execute here. Saying that
 * plainly is better than quietly dropping an author's files.
 */
export type PackFile = { path: string; content: string };
export type PackTree = PackFile[];

export type SkillDir = {
  /** Directory name under skills/, which is the skill's identity here. */
  name: string;
  /** Files relative to the skill directory. SKILL.md sits at its root. */
  files: PackFile[];
};

export type SubagentFile = { name: string; file: PackFile };

export class PackTreeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackTreeError";
  }
}

export const DEFINITION_NAMES = ["agent.md", "pack.md"];

/** Directories a pack may contain, and whether this platform can run them. */
export const PACK_DIRS = {
  skills: { runsHere: true, what: "uploaded as platform skills and attached to the agent" },
  agents: { runsHere: true, what: "attached as subagents the pack can delegate to" },
  commands: { runsHere: false, what: "slash commands — carried and exported, not run here" },
  hooks: { runsHere: false, what: "hooks — carried and exported, not run here" },
  workflows: { runsHere: false, what: "workflow scripts — carried and exported, not run here" },
  docs: { runsHere: false, what: "documentation — carried and exported" },
  ".claude-plugin": { runsHere: false, what: "plugin manifest — carried and exported" },
} as const;

const ALLOWED_TOP = new Set<string>(Object.keys(PACK_DIRS));
const ALLOWED_ROOT_FILES = /^(README|LICENSE|CHANGELOG|CLAUDE|AGENTS)(\.[a-z]+)?$/i;

/** Strip a wrapping folder so `my-pack/agent.md` and `agent.md` are one tree. */
export function normaliseTree(files: PackFile[]): PackTree {
  const cleaned = files
    .map((f) => ({ path: f.path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, ""), content: f.content }))
    // No traversal, and no dotfiles except the plugin manifest directory.
    .filter((f) => f.path && !f.path.split("/").some((seg) =>
      seg === ".." || (seg.startsWith(".") && seg !== ".claude-plugin")));
  if (cleaned.length === 0) return [];

  const tops = new Set(cleaned.map((f) => f.path.split("/")[0]!));
  const wrapped = tops.size === 1
    && cleaned.every((f) => f.path.includes("/"))
    && !DEFINITION_NAMES.includes([...tops][0]!.toLowerCase())
    && !ALLOWED_TOP.has([...tops][0]!);
  if (!wrapped) return cleaned;
  const prefix = `${[...tops][0]!}/`;
  return cleaned.map((f) => ({ path: f.path.slice(prefix.length), content: f.content }));
}

export function findDefinition(tree: PackTree): PackFile | undefined {
  return tree.find((f) => DEFINITION_NAMES.includes(f.path.toLowerCase()))
    ?? (tree.length === 1 && /\.(md|markdown)$/i.test(tree[0]!.path) ? tree[0] : undefined);
}

/** Every `skills/<name>/...` grouped, with SKILL.md required at the root. */
export function findSkillDirs(tree: PackTree): SkillDir[] {
  const byName = new Map<string, PackFile[]>();
  for (const f of tree) {
    const m = /^skills\/([^/]+)\/(.+)$/.exec(f.path);
    if (!m) continue;
    const name = m[1]!;
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name)!.push({ path: m[2]!, content: f.content });
  }
  const dirs: SkillDir[] = [];
  for (const [name, files] of [...byName.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!files.some((f) => f.path.toLowerCase() === "skill.md")) {
      throw new PackTreeError(`skills/${name}/ has no SKILL.md — a skill directory needs one at its root`);
    }
    // SKILL.md first: it is the entry point, and the only file loaded eagerly.
    dirs.push({
      name,
      files: files.sort((a, b) => {
        const aRoot = a.path.toLowerCase() === "skill.md" ? 0 : 1;
        const bRoot = b.path.toLowerCase() === "skill.md" ? 0 : 1;
        return aRoot - bRoot || a.path.localeCompare(b.path);
      }),
    });
  }
  return dirs;
}

/** `agents/<name>.md` — subagent definitions. */
export function findSubagents(tree: PackTree): SubagentFile[] {
  return tree
    .filter((f) => /^agents\/[^/]+\.(md|markdown)$/i.test(f.path))
    .map((f) => ({ name: f.path.replace(/^agents\//, "").replace(/\.(md|markdown)$/i, ""), file: f }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Which carried-but-not-executed directories a tree uses, for honest reporting. */
export function inertDirs(tree: PackTree): string[] {
  const used = new Set<string>();
  for (const f of tree) {
    const top = f.path.split("/")[0]!;
    if (top in PACK_DIRS && !PACK_DIRS[top as keyof typeof PACK_DIRS].runsHere) used.add(top);
  }
  return [...used].sort();
}

/** `name` and `description` from a SKILL.md or an agents/*.md frontmatter. */
export function readFrontMatterMeta(text: string): { name?: string; description?: string } {
  const normalised = text.replace(/\r\n/g, "\n");
  if (!normalised.startsWith("---\n")) return {};
  const end = normalised.indexOf("\n---", 4);
  if (end === -1) return {};
  const out: { name?: string; description?: string } = {};
  for (const line of normalised.slice(4, end).split("\n")) {
    const m = /^(name|description):\s*(.+)$/.exec(line.trim());
    if (!m) continue;
    const value = m[2]!.trim().replace(/^["']|["']$/g, "");
    if (m[1] === "name") out.name = value;
    else out.description = value;
  }
  return out;
}

/** Refuse a tree we cannot publish, rather than uploading half of it. */
export function validateTree(tree: PackTree): {
  definition: PackFile; skills: SkillDir[]; subagents: SubagentFile[]; inert: string[];
} {
  if (tree.length === 0) throw new PackTreeError("that upload has no usable files");
  const definition = findDefinition(tree);
  if (!definition) {
    throw new PackTreeError(
      "no agent.md in that folder, so it is not clear which file defines the pack "
      + `(got: ${tree.map((f) => f.path).slice(0, 8).join(", ")})`);
  }
  const skills = findSkillDirs(tree);
  const subagents = findSubagents(tree);

  const stray = tree.filter((f) => {
    if (f.path === definition.path) return false;
    const top = f.path.split("/")[0]!;
    if (f.path.includes("/")) return !ALLOWED_TOP.has(top);
    return !ALLOWED_ROOT_FILES.test(f.path);
  });
  if (stray.length > 0) {
    throw new PackTreeError(
      `these files are not in a place a pack recognises: ${stray.map((f) => f.path).slice(0, 6).join(", ")}`
      + ` — a pack holds agent.md and the directories ${[...ALLOWED_TOP].join(", ")}`);
  }
  return { definition, skills, subagents, inert: inertDirs(tree) };
}

export const MAX_FILE_BYTES = 256 * 1024;
export const MAX_TREE_FILES = 200;

export function assertWithinLimits(tree: PackTree): void {
  if (tree.length > MAX_TREE_FILES) {
    throw new PackTreeError(`that folder has ${tree.length} files; the limit is ${MAX_TREE_FILES}`);
  }
  for (const f of tree) {
    const bytes = Buffer.byteLength(f.content, "utf8");
    if (bytes > MAX_FILE_BYTES) {
      throw new PackTreeError(`${f.path} is ${Math.round(bytes / 1024)}KB; the limit is ${MAX_FILE_BYTES / 1024}KB`);
    }
  }
}

// ------------------------------------------------- skill rules, as published

/**
 * Anthropic documents hard rules for SKILL.md and firm guidance around it.
 * Checking a pack against them before it is listed is cheap, and it is the only
 * feedback an author gets before a buyer is the one who finds the problem.
 *
 * Errors are things the platform itself will reject. Warnings are the published
 * best practices — worth telling an author about, never worth blocking on.
 */
export type SkillProblem = { skill: string; file: string; message: string };
export type SkillCheck = { errors: SkillProblem[]; warnings: SkillProblem[] };

const SKILL_NAME = /^[a-z0-9-]+$/;
const RESERVED = ["anthropic", "claude"];
const MAX_NAME = 64;
const MAX_DESCRIPTION = 1024;
const MAX_BODY_LINES = 500;
const FIRST_PERSON = /\b(I can|I will|I'll|you can use this|we can)\b/i;

export function checkSkill(dir: SkillDir): SkillCheck {
  const errors: SkillProblem[] = [];
  const warnings: SkillProblem[] = [];
  const at = (file: string, message: string): SkillProblem => ({ skill: dir.name, file, message });

  const skillMd = dir.files.find((f) => f.path.toLowerCase() === "skill.md");
  if (!skillMd) {
    errors.push(at("SKILL.md", "missing — a skill directory needs SKILL.md at its root"));
    return { errors, warnings };
  }

  const { name, description } = readFrontMatterMeta(skillMd.content);
  if (!name) {
    errors.push(at("SKILL.md", "front matter has no `name`"));
  } else {
    if (name.length > MAX_NAME) errors.push(at("SKILL.md", `name is ${name.length} characters; the limit is ${MAX_NAME}`));
    if (!SKILL_NAME.test(name)) {
      errors.push(at("SKILL.md", `name "${name}" must be lowercase letters, numbers and hyphens only`));
    }
    if (RESERVED.some((w) => name.includes(w))) {
      errors.push(at("SKILL.md", `name "${name}" contains a reserved word (${RESERVED.join(", ")})`));
    }
    if (name !== dir.name) {
      warnings.push(at("SKILL.md", `name "${name}" does not match the directory "${dir.name}" — keep them the same`));
    }
  }

  if (!description) {
    errors.push(at("SKILL.md", "front matter has no `description` — it is how the model decides to use the skill at all"));
  } else {
    if (description.length > MAX_DESCRIPTION) {
      errors.push(at("SKILL.md", `description is ${description.length} characters; the limit is ${MAX_DESCRIPTION}`));
    }
    if (FIRST_PERSON.test(description)) {
      warnings.push(at("SKILL.md", "write the description in the third person — it is injected into the system prompt"));
    }
    if (!/\b(use (it )?when|when the user|when working)\b/i.test(description)) {
      warnings.push(at("SKILL.md", "the description says what the skill does but not when to use it, which is half of what it is for"));
    }
  }
  if (/<[a-z][^>]*>/i.test(`${name ?? ""} ${description ?? ""}`)) {
    errors.push(at("SKILL.md", "name and description cannot contain XML tags"));
  }

  const body = skillMd.content.replace(/^---\n[\s\S]*?\n---\n?/, "");
  const lines = body.split("\n").length;
  if (lines > MAX_BODY_LINES) {
    warnings.push(at("SKILL.md",
      `the body is ${lines} lines; keep it under ${MAX_BODY_LINES} and move detail into bundled files`));
  }

  for (const f of dir.files) {
    if (f.path.includes("\\")) {
      warnings.push(at(f.path, "use forward slashes in paths; backslashes break on anything but Windows"));
    }
  }

  // References must be one level deep: a file reached only through another file
  // tends to be read partially, which silently loses information.
  const linked = new Set<string>();
  for (const m of body.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = m[1]!.split("#")[0]!;
    if (/^[a-z]+:/i.test(target) || !target) continue;
    linked.add(target.replace(/^\.\//, ""));
  }
  const bundled = dir.files.filter((f) => f.path.toLowerCase() !== "skill.md");
  for (const f of bundled) {
    if (/\.(md|markdown)$/i.test(f.path) && !linked.has(f.path)) {
      warnings.push(at(f.path, "nothing in SKILL.md links to this file, so the model will probably never read it"));
    }
  }
  for (const f of bundled) {
    if (!/\.(md|markdown)$/i.test(f.path)) continue;
    for (const m of f.content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = m[1]!.split("#")[0]!.replace(/^\.\//, "");
      if (/^[a-z]+:/i.test(target) || !target) continue;
      if (bundled.some((b) => b.path === target)) {
        warnings.push(at(f.path,
          `links to ${target}, which is two levels from SKILL.md — link it from SKILL.md instead`));
      }
    }
  }
  return { errors, warnings };
}

export function checkSkills(skills: SkillDir[]): SkillCheck {
  const out: SkillCheck = { errors: [], warnings: [] };
  for (const dir of skills) {
    const c = checkSkill(dir);
    out.errors.push(...c.errors);
    out.warnings.push(...c.warnings);
  }
  return out;
}
