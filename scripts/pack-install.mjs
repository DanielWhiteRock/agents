#!/usr/bin/env node
/**
 * Install a pack you own onto this machine.
 *
 *   AGENTS_TOKEN=mk_... node scripts/pack-install.mjs <slug> [--dir .] [--host http://localhost:4317]
 *
 * Writes <slug>.md, which `ant apply <slug>.md` accepts directly.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith("--"));
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const host = flag("host", process.env.AGENTS_HOST ?? "http://localhost:4317");
const dir = flag("dir", ".");
const token = process.env.AGENTS_TOKEN;

if (!slug) {
  console.error("usage: AGENTS_TOKEN=mk_... node scripts/pack-install.mjs <slug> [--dir .] [--host URL]");
  process.exit(2);
}
if (!token) {
  console.error("Set AGENTS_TOKEN to a token from /tokens on the site.");
  process.exit(2);
}

const res = await fetch(`${host}/packs/${encodeURIComponent(slug)}/export`, {
  headers: { authorization: `Bearer ${token}` },
});
if (!res.ok) {
  console.error(`Could not install ${slug}: ${res.status} ${(await res.text()).slice(0, 300)}`);
  process.exit(1);
}
const body = await res.text();
const path = join(dir, `${slug}.md`);
writeFileSync(path, body);
console.log(`Wrote ${path} (${body.length} bytes)`);
console.log(`Apply it with:  ant apply ${path}`);
