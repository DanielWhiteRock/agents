#!/usr/bin/env node
/**
 * agents — push and pull pack folders, the way git moves a repo.
 *
 *   agents sync [folder]        push the folder and publish it
 *   agents pull <slug> [folder] write the pack out as a folder
 *   agents status [folder]      what is here versus what is published
 *   agents list                 the catalog, and what this organisation owns
 *
 * Configuration, in order of precedence: flags, environment, then .agents.json
 * in the folder you are syncing.
 *
 *   AGENTS_TOKEN=mk_...   a token from /tokens
 *   AGENTS_HOST=https://agents.alphaceo.ai
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const argv = process.argv.slice(2);
const command = argv[0] ?? "help";
const positional = argv.slice(1).filter((a) => !a.startsWith("--"));
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};

const TEXT = /\.(md|markdown|txt|json|ya?ml|sh|js|mjs|ts|py)$/i;
const SKIP = new Set(["node_modules", ".git", "dist", ".DS_Store"]);

function config(dir) {
  const file = join(dir, ".agents.json");
  if (!existsSync(file)) return {};
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return {}; }
}

function settings(dir = ".") {
  const c = config(dir);
  const host = flag("host", process.env.AGENTS_HOST ?? c.host ?? "http://localhost:4317");
  const token = flag("token", process.env.AGENTS_TOKEN ?? c.token);
  return { host, token, slug: flag("slug", c.slug) };
}

function die(message, code = 1) {
  console.error(message);
  process.exit(code);
}

function collect(path, root = path) {
  const st = statSync(path);
  if (st.isFile()) {
    return [{ path: relative(root, path).split("\\").join("/") || path.split("/").pop(), full: path }];
  }
  return readdirSync(path, { withFileTypes: true })
    .filter((d) => !SKIP.has(d.name) && !(d.name.startsWith(".") && d.name !== ".claude-plugin"))
    .flatMap((d) => collect(join(path, d.name), root));
}

function readFolder(dir) {
  if (!existsSync(dir)) die(`No such folder: ${dir}`, 2);
  const files = collect(resolve(dir))
    .filter((f) => TEXT.test(f.path))
    .map((f) => ({ path: f.path, text: readFileSync(f.full, "utf8") }));
  if (files.length === 0) die(`Nothing syncable in ${dir} — a pack needs at least an agent.md.`);
  return files;
}

async function call(host, token, path, init = {}) {
  if (!token) die("Set AGENTS_TOKEN to a token from /tokens (or put it in .agents.json).", 2);
  let res;
  try {
    res = await fetch(`${host}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers },
      redirect: "manual",
    });
  } catch (e) {
    // A stack trace is not a useful answer to "the server is not running".
    const why = e?.cause?.code === "ECONNREFUSED" ? "nothing is listening there" : (e?.message ?? String(e));
    die(`Could not reach ${host} — ${why}.\nIs the server running, and is AGENTS_HOST right?`, 3);
  }
  const body = await res.text();
  let parsed;
  try { parsed = body ? JSON.parse(body) : {}; } catch { parsed = { raw: body }; }
  if (res.status === 401) die("That token was rejected. Create a new one at /tokens.", 2);
  return { ok: res.status < 400, status: res.status, body: parsed };
}

// ------------------------------------------------------------------- sync

async function sync() {
  const dir = positional[0] ?? ".";
  const { host, token, slug } = settings(dir);
  const files = readFolder(dir);

  console.log(`Syncing ${files.length} file(s) from ${dir} to ${host}`);
  const push = await call(host, token, "/api/packs", {
    method: "POST", body: JSON.stringify({ files, ...(slug ? { slug } : {}) }),
  });
  if (!push.ok) die(`  push failed: ${push.status} ${push.body.error ?? push.body.raw ?? ""}`);

  const out = push.body;
  console.log(`  ${out.created ? "created" : "updated"} ${out.name} at /packs/${out.slug} (${out.status})`);
  if (out.skills?.length) console.log(`  skills:    ${out.skills.join(", ")}`);
  if (out.subagents?.length) console.log(`  subagents: ${out.subagents.join(", ")}`);
  if (out.commands?.length) console.log(`  commands:  ${out.commands.map((c) => "/" + c).join(" ")}`);
  if (out.hooks?.length) console.log(`  hooks:     ${out.hooks.join(", ")}`);
  if (out.workflows?.length) console.log(`  workflows: ${out.workflows.join(", ")}`);
  if (out.anthropicSkills?.length) console.log(`  anthropic: ${out.anthropicSkills.join(", ")}`);
  if (out.advisorModel) console.log(`  advisor:   ${out.advisorModel}`);
  if (out.warnings?.length) {
    console.log("\n  worth fixing:");
    for (const w of out.warnings) console.log(`    - ${w}`);
  }

  const publish = await call(host, token, `/packs/${out.slug}/publish`, { method: "POST" });
  if (!publish.ok) die(`\n  published to the catalogue but not to the runtime: ${publish.status}`);
  console.log(`\n  published. run it at ${host}/packs/${out.slug}`);

  // Remember where this folder syncs to, so the next sync needs no flags.
  const file = join(dir, ".agents.json");
  const existing = config(dir);
  if (existing.slug !== out.slug || existing.host !== host) {
    writeFileSync(file, `${JSON.stringify({ ...existing, host, slug: out.slug }, null, 2)}\n`);
    console.log(`  remembered in ${file}`);
  }
}

// ------------------------------------------------------------------- pull

async function pull() {
  const slug = positional[0] ?? settings(".").slug;
  if (!slug) die("usage: agents pull <slug> [folder]", 2);
  const dir = positional[1] ?? slug;
  const { host, token } = settings(".");

  const res = await call(host, token, `/packs/${encodeURIComponent(slug)}/export?format=json`);
  if (!res.ok) die(`  pull failed: ${res.status} ${res.body.error ?? res.body.raw ?? ""}`);

  for (const file of res.body.files) {
    const target = join(dir, file.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.content);
  }
  writeFileSync(join(dir, ".agents.json"), `${JSON.stringify({ host, slug }, null, 2)}\n`);
  console.log(`Wrote ${res.body.files.length} file(s) into ${dir}/`);
  for (const f of res.body.files) console.log(`  ${f.path}`);
  console.log(`\nSync changes back with:  agents sync ${dir}`);
}

// ----------------------------------------------------------------- status

async function status() {
  const dir = positional[0] ?? ".";
  const { host, token, slug } = settings(dir);
  if (!slug) die(`${dir} has no .agents.json — run: agents sync ${dir}`, 2);
  const local = readFolder(dir);
  const res = await call(host, token, `/packs/${encodeURIComponent(slug)}/export?format=json`);
  if (!res.ok) die(`  could not read ${slug}: ${res.status} ${res.body.error ?? ""}`);

  const remote = new Map(res.body.files.map((f) => [f.path, f.content]));
  const here = new Map(local.map((f) => [f.path, f.text]));
  const changed = [...here].filter(([p, c]) => remote.has(p) && remote.get(p) !== c).map(([p]) => p);
  const added = [...here.keys()].filter((p) => !remote.has(p));
  const removed = [...remote.keys()].filter((p) => !here.has(p) && p !== "agent.md");

  console.log(`${slug} on ${host}`);
  if (!changed.length && !added.length && !removed.length) return void console.log("  in sync");
  for (const p of added) console.log(`  new      ${p}`);
  for (const p of changed) console.log(`  changed  ${p}`);
  for (const p of removed) console.log(`  gone     ${p}`);
  console.log(`\nSync with:  agents sync ${dir}`);
}

async function list() {
  const { host, token } = settings(".");
  const res = await call(host, token, "/api/packs");
  if (!res.ok) die(`  could not list: ${res.status} ${res.body.error ?? ""}`);
  for (const p of res.body.packs ?? []) {
    console.log(`  ${p.owned ? "✓" : " "} ${p.slug.padEnd(28)} ${p.status.padEnd(9)} ${p.name}`);
  }
  console.log("\n  ✓ = this organisation owns it");
}

const COMMANDS = { sync, pull, status, list };
if (!COMMANDS[command]) {
  console.log(`agents — move pack folders between here and the marketplace

  agents sync [folder]         push the folder and publish it
  agents pull <slug> [folder]  write a pack out as a folder
  agents status [folder]       what is here versus what is published
  agents list                  the catalog, and what you own

  --host URL   --token mk_...  --slug name

Set AGENTS_TOKEN and AGENTS_HOST, or keep them in .agents.json next to agent.md.`);
  process.exit(command === "help" ? 0 : 2);
}
await COMMANDS[command]();
