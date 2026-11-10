import { PLATFORM_WRAPPER } from "./wrapper.js";
import type { PackDefinition } from "./types.js";

/**
 * Reading a pack back in.
 *
 * The inverse of exportPackMarkdown, so a pack can leave and return unchanged.
 * The format is deliberately the one `ant apply` consumes — markdown with YAML
 * front matter — which means an author can write a pack in their editor, keep
 * it in git, and push it here without learning anything bespoke.
 *
 * This is a small hand-rolled reader for the handful of keys a pack uses, not a
 * YAML implementation. Anything it does not recognise is reported rather than
 * silently dropped, because quietly ignoring half an author's definition is
 * worse than refusing it.
 */
export type ParsedPack = {
  name?: string;
  tagline?: string;
  model?: string;
  effort?: PackDefinition["effort"];
  slug?: string;
  author?: string;
  instructions: string;
  mcpServers: Array<{ name: string; url: string }>;
  pinnedModels: string[];
  /** Anthropic's prebuilt skills a pack asks for: pptx, xlsx, docx, pdf. */
  anthropicSkills: string[];
  /** A model the agent may consult mid-turn. */
  advisorModel?: string;
  /** Where the web tools may look. One list or the other, never both. */
  web?: { allowedDomains?: string[]; blockedDomains?: string[] };
  /** Keys present in the file that this reader does not understand. */
  unknownKeys: string[];
};

const PREBUILT = new Set(["pptx", "xlsx", "docx", "pdf"]);

/**
 * Public suffixes an author is likely to mistake for a domain.
 *
 * The API wants a registrable hostname and refuses `gov.uk` or `com`. This is
 * not the full public suffix list — it is the handful that get typed by
 * accident, caught at upload so the author is not told at publish time. The API
 * remains the authority for anything subtler.
 */
const PUBLIC_SUFFIXES = new Set([
  "co.uk", "gov.uk", "ac.uk", "org.uk", "me.uk", "net.uk", "sch.uk",
  "com.au", "net.au", "org.au", "gov.au", "co.nz", "co.za", "co.il", "org.il",
  "co.jp", "or.jp", "ne.jp", "com.br", "com.cn", "com.mx", "com.tr", "co.in",
]);

function checkDomains(label: string, domains: string[]): void {
  for (const d of domains) {
    const host = d.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!host.includes(".")) {
      throw new PackParseError(
        `web.${label}: "${d}" is a single label. Give a plain hostname like "example.com".`);
    }
    if (PUBLIC_SUFFIXES.has(host)) {
      throw new PackParseError(
        `web.${label}: "${d}" is a public suffix, not a registrable domain — the API refuses it. `
        + `Use a hostname under it, such as "www.${host}".`);
    }
  }
}

export class PackParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackParseError";
  }
}

const KNOWN = new Set([
  "name", "model", "description", "tagline", "tools", "mcp_servers", "metadata",
  "skills", "slug", "author", "pinned_models", "multiagent", "advisor", "web",
]);

const list = (v: string): string[] =>
  v.replace(/^\[|\]$/g, "").split(",").map((x) => x.trim().replace(/^["']|["']$/g, "")).filter(Boolean);

function unquote(v: string): string {
  const t = v.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return t;
}

/** Split front matter from body. Front matter is optional. */
export function splitFrontMatter(text: string): { front: string; body: string } {
  const normalised = text.replace(/\r\n/g, "\n");
  if (!normalised.startsWith("---\n")) return { front: "", body: normalised };
  const end = normalised.indexOf("\n---", 4);
  if (end === -1) throw new PackParseError("the front matter opens with --- but never closes");
  return { front: normalised.slice(4, end), body: normalised.slice(end + 4).replace(/^\n+/, "") };
}

export function parsePackMarkdown(text: string): ParsedPack {
  const { front, body } = splitFrontMatter(text);
  const out: ParsedPack = {
    instructions: "", mcpServers: [], pinnedModels: [], anthropicSkills: [], unknownKeys: [],
  };

  const lines = front.split("\n");
  let topKey = "";
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const indent = line.length - line.trimStart().length;

    if (indent === 0) {
      const m = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
      if (!m) continue;
      topKey = m[1]!;
      const value = m[2]!.trim();
      if (!KNOWN.has(topKey)) out.unknownKeys.push(topKey);
      if (topKey === "name" && value) out.name = unquote(value);
      if ((topKey === "description" || topKey === "tagline") && value) out.tagline = unquote(value);
      if (topKey === "slug" && value) out.slug = unquote(value);
      if (topKey === "author" && value) out.author = unquote(value);
      // `model: claude-opus-5` as a scalar, or an object on the lines below.
      if (topKey === "model" && value) out.model = unquote(value);
      // `advisor: claude-opus-5` as a scalar, or an object on the lines below.
      if (topKey === "advisor" && value) out.advisorModel = unquote(value);
      if (topKey === "pinned_models" && value) out.pinnedModels = list(value);
      continue;
    }

    const nested = /^\s*-?\s*([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
    if (!nested) continue;
    const key = nested[1]!;
    const value = unquote(nested[2]!);
    if (topKey === "model") {
      if (key === "id" && value) out.model = value;
      if (key === "effort" && value) out.effort = value as PackDefinition["effort"];
    }
    if (topKey === "mcp_servers") {
      if (key === "name") out.mcpServers.push({ name: value, url: "" });
      if (key === "url" && out.mcpServers.length) out.mcpServers[out.mcpServers.length - 1]!.url = value;
    }
    if (topKey === "skills") {
      // Anthropic's prebuilt skills are referenced by short name. A pack's own
      // skills are directories, not front matter, so a custom entry here is a
      // mistake worth naming rather than ignoring.
      if (key === "skill_id" && value) out.anthropicSkills.push(value);
    }
    if (topKey === "advisor" && key === "model" && value) out.advisorModel = value;
    if (topKey === "web") {
      // Accumulated rather than replaced: assigning a fresh object for each key
      // would drop the first list and hide an author declaring both.
      if (key === "allowed_domains") out.web = { ...out.web, allowedDomains: list(value) };
      if (key === "blocked_domains") out.web = { ...out.web, blockedDomains: list(value) };
    }
    if (topKey === "metadata") {
      if (key === "pack_slug" && value) out.slug ??= value;
      if (key === "author" && value) out.author ??= value;
    }
  }
  out.mcpServers = out.mcpServers.filter((m) => m.name && m.url);

  // The exported body carries the platform wrapper and a provenance comment
  // above the author's text. Strip both so a round trip does not accumulate
  // copies of our own prompt inside the author's instructions.
  let instructions = body;
  instructions = instructions.replace(/<!--[\s\S]*?-->\s*/g, "");
  const wrapperAt = instructions.indexOf(PLATFORM_WRAPPER);
  if (wrapperAt !== -1) {
    instructions = instructions.slice(wrapperAt + PLATFORM_WRAPPER.length);
  }
  instructions = instructions.replace(/^\s*---\s*PACK INSTRUCTIONS \(proprietary\)\s*---\s*/m, "");
  out.instructions = instructions.trim();

  if (!out.instructions) {
    throw new PackParseError("there are no instructions in that file — the body below the front matter is empty");
  }
  if (out.web?.allowedDomains?.length && out.web?.blockedDomains?.length) {
    throw new PackParseError("web: give allowed_domains or blocked_domains, not both — the API rejects the pair");
  }
  if (out.web?.allowedDomains) checkDomains("allowed_domains", out.web.allowedDomains);
  if (out.web?.blockedDomains) checkDomains("blocked_domains", out.web.blockedDomains);
  const unknownSkills = out.anthropicSkills.filter((id) => !PREBUILT.has(id));
  if (unknownSkills.length > 0) {
    throw new PackParseError(
      `skills: "${unknownSkills.join(", ")}" is not one of Anthropic's prebuilt skills `
      + `(${[...PREBUILT].join(", ")}). A pack's own skills are directories under skills/, not front matter.`);
  }
  return out;
}

/**
 * A folder of files as one pack.
 *
 * The definition is the file called agent.md, pack.md or SKILL.md; everything
 * else is treated as a skill document and appended under its own heading, in
 * filename order, so an author can keep their method in several files without
 * us needing to model a filesystem.
 */
export function parsePackFolder(files: Array<{ path: string; text: string }>): ParsedPack {
  const usable = files.filter((f) => /\.(md|markdown|txt)$/i.test(f.path) && f.text.trim());
  if (usable.length === 0) throw new PackParseError("no markdown or text files in that upload");

  const base = (p: string): string => p.split("/").pop() ?? p;
  const isDefinition = (p: string): boolean => /^(agent|pack|skill)\.(md|markdown)$/i.test(base(p));

  const definition = usable.find((f) => isDefinition(f.path))
    ?? (usable.length === 1 ? usable[0]! : undefined);
  if (!definition) {
    throw new PackParseError(
      `several files were uploaded but none is called agent.md, so it is not clear which one defines the pack `
      + `(got: ${usable.map((f) => base(f.path)).join(", ")})`);
  }

  const parsed = parsePackMarkdown(definition.text);
  const extras = usable
    .filter((f) => f !== definition)
    .sort((a, b) => a.path.localeCompare(b.path));

  if (extras.length > 0) {
    const sections = extras.map((f) => {
      const title = base(f.path).replace(/\.(md|markdown|txt)$/i, "").replace(/[-_]/g, " ");
      // Already-headed documents keep their own heading rather than gaining a second.
      const bodyText = f.text.replace(/\r\n/g, "\n").trim();
      return bodyText.startsWith("#") ? bodyText : `## ${title}\n\n${bodyText}`;
    });
    parsed.instructions = [parsed.instructions, ...sections].join("\n\n");
  }
  return parsed;
}
