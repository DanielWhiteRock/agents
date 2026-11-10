#!/usr/bin/env node
/**
 * Push a pack folder to the marketplace.
 *
 *   AGENTS_TOKEN=mk_... node scripts/pack-publish.mjs ./my-pack [--slug my-pack] [--host http://localhost:4317]
 *
 * The folder's agent.md is the definition; every other .md is appended in
 * filename order. A single .md file works too. The pack arrives as a draft.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith("--"));
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const host = flag("host", process.env.AGENTS_HOST ?? "http://localhost:4317");
const slug = flag("slug", undefined);
const token = process.env.AGENTS_TOKEN;

if (!target) {
  console.error("usage: AGENTS_TOKEN=mk_... node scripts/pack-publish.mjs <folder-or-file> [--slug x] [--host URL]");
  process.exit(2);
}
if (!token) {
  console.error("Set AGENTS_TOKEN to a token from /tokens on the site.");
  process.exit(2);
}

function collect(path, root = path) {
  const st = statSync(path);
  if (st.isFile()) return [{ path: relative(root, path) || path.split("/").pop(), text: readFileSync(path, "utf8") }];
  return readdirSync(path, { withFileTypes: true })
    .filter((d) => !d.name.startsWith("."))
    .flatMap((d) => collect(join(path, d.name), root));
}

const files = collect(target).filter((f) => /\.(md|markdown|txt)$/i.test(f.path));
if (files.length === 0) {
  console.error(`No markdown or text files under ${target}.`);
  process.exit(1);
}
console.log(`Sending ${files.length} file(s): ${files.map((f) => f.path).join(", ")}`);

const res = await fetch(`${host}/api/packs`, {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify({ files, ...(slug ? { slug } : {}) }),
});
const out = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`Failed: ${res.status} ${out.error ?? ""}`);
  process.exit(1);
}
console.log(`${out.created ? "Created" : "Updated"} ${out.name} at /packs/${out.slug} (${out.status})`);
if (out.skills?.length) console.log(`Skills: ${out.skills.join(", ")}`);
if (out.subagents?.length) console.log(`Subagents: ${out.subagents.join(", ")}`);
if (out.carriedNotRun?.length) {
  console.log(`Carried but not run on the platform: ${out.carriedNotRun.join(", ")}`);
}
if (out.unknownKeys?.length) console.log(`Ignored unrecognised keys: ${out.unknownKeys.join(", ")}`);
if (out.warnings?.length) {
  console.log("\nWorth fixing:");
  for (const w of out.warnings) console.log(`  - ${w}`);
}
console.log(`\nFinish it at ${host}/packs/${out.slug}/edit`);
