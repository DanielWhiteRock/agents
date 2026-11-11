#!/usr/bin/env node
/**
 * Move this project's media into one namespace in the shared R2 bucket.
 *
 * The bucket is shared with a dozen other projects — nearly 19,000 objects —
 * and this project's art sits loose at `agents/systems/` and `agents/front/`.
 * This files it under one prefix instead:
 *
 *   agents/systems/<slug>.webp  ->  agentspace/agents/alphaceo/<slug>.webp
 *   agents/front/<name>.<ext>   ->  agentspace/front/<name>.<ext>
 *
 * The `alphaceo` segment is the creator. Every pack on the shelf today is
 * first-party, and no creator records exist yet, so one house segment is the
 * honest answer; real handles sit beside it when `creators` is populated.
 * Page art has no slug and no author, so it gets its own group rather than
 * being filed under a creator who did not write it as a pack.
 *
 * Phases, in order. Each is a separate run, so you can stop and look:
 *
 *   --plan         print every old -> new mapping. Touches nothing.
 *   --copy         write the new keys. Leaves the old ones in place.
 *   --rewrite      point packs/<slug>/agent.md and the front-page plan at them.
 *   --verify       fetch every new public URL and check it serves.
 *   --delete-old   remove the old keys. Refuses unless --verify passed first.
 *
 * Nothing outside `agents/` is ever read, written or listed by key — the other
 * 18,838 objects in that bucket are not ours to touch.
 *
 * Credentials come from .env (CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_R2_BUCKET,
 * CLOUDFLARE_R2_ACCESS_KEY_ID, CLOUDFLARE_R2_SECRET_ACCESS_KEY,
 * CLOUDFLARE_R2_PUBLIC_URL) and are never printed.
 */
import { createHmac, createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const PROJECT = "agentspace";
const CREATOR = "alphaceo";
const OLD_PACKS = "agents/systems/";
const OLD_FRONT = "agents/front/";
const FRONT_PLAN = "docs/superpowers/plans/2026-11-10-front-page.md";
const VERIFIED_MARKER = join(ROOT, ".superpowers", "r2-verified");

// ---------------------------------------------------------------- credentials

function env() {
  const path = join(ROOT, ".env");
  if (!existsSync(path)) die(".env not found — this script reads its credentials from there.");
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  const need = ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_R2_BUCKET",
    "CLOUDFLARE_R2_ACCESS_KEY_ID", "CLOUDFLARE_R2_SECRET_ACCESS_KEY", "CLOUDFLARE_R2_PUBLIC_URL"];
  const missing = need.filter((k) => !out[k]);
  if (missing.length) die(`.env is missing ${missing.join(", ")}`);
  return out;
}

const E = env();
const HOST = `${E.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`;
const BUCKET = E.CLOUDFLARE_R2_BUCKET;
const PUBLIC = E.CLOUDFLARE_R2_PUBLIC_URL.replace(/\/+$/, "");

const die = (m) => { console.error(m); process.exit(1); };
const hmac = (k, d) => createHmac("sha256", k).update(d).digest();
const sha256 = (d) => createHash("sha256").update(d).digest("hex");
/** Each path segment encoded, slashes kept — what SigV4 wants in a canonical URI. */
const enc = (key) => key.split("/").map(encodeURIComponent).join("/");

/** One SigV4-signed request. Body is always empty: list, copy and delete need none. */
async function sign(method, path, query = {}, extraHeaders = {}) {
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = amzDate.slice(0, 8);
  const cq = Object.keys(query).sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`).join("&");
  const payloadHash = sha256("");
  const headers = { host: HOST, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate, ...extraHeaders };
  const names = Object.keys(headers).map((h) => h.toLowerCase()).sort();
  const canonicalHeaders = names.map((n) => {
    const key = Object.keys(headers).find((h) => h.toLowerCase() === n);
    return `${n}:${String(headers[key]).trim()}\n`;
  }).join("");
  const signedHeaders = names.join(";");
  const cr = [method, path, cq, canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${date}/auto/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(cr)].join("\n");
  const signing = hmac(hmac(hmac(hmac(`AWS4${E.CLOUDFLARE_R2_SECRET_ACCESS_KEY}`, date), "auto"), "s3"), "aws4_request");
  const signature = createHmac("sha256", signing).update(toSign).digest("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${E.CLOUDFLARE_R2_ACCESS_KEY_ID}/${scope}, `
    + `SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const res = await fetch(`https://${HOST}${path}${cq ? `?${cq}` : ""}`, { method, headers });
  const body = await res.text();
  if (!res.ok) die(`${method} ${path} -> HTTP ${res.status}\n${body.slice(0, 400)}`);
  return body;
}

/** Every object under one prefix, paginated. Parsed per <Contents> so field order cannot break it. */
async function listPrefix(prefix) {
  const out = [];
  let token;
  do {
    const q = { "list-type": "2", "max-keys": "1000", prefix };
    if (token) q["continuation-token"] = token;
    const xml = await sign("GET", `/${BUCKET}`, q);
    for (const block of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const k = /<Key>([^<]*)<\/Key>/.exec(block[1]);
      const s = /<Size>(\d+)<\/Size>/.exec(block[1]);
      if (k && !k[1].endsWith("/")) out.push({ key: k[1], size: s ? Number(s[1]) : 0 });
    }
    const t = /<NextContinuationToken>([^<]+)</.exec(xml);
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml) && t ? t[1] : undefined;
  } while (token);
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

const copy = (from, to) => sign("PUT", `/${BUCKET}/${enc(to)}`, {},
  { "x-amz-copy-source": `/${BUCKET}/${enc(from)}` });
const remove = (key) => sign("DELETE", `/${BUCKET}/${enc(key)}`);

// ------------------------------------------------------------------- planning

/** Old key -> new key, for the two groups this project owns. */
function newKeyFor(key) {
  if (key.startsWith(OLD_PACKS)) return `${PROJECT}/agents/${CREATOR}/${key.slice(OLD_PACKS.length)}`;
  if (key.startsWith(OLD_FRONT)) return `${PROJECT}/front/${key.slice(OLD_FRONT.length)}`;
  return null;
}

async function plan() {
  const objects = [...await listPrefix(OLD_PACKS), ...await listPrefix(OLD_FRONT)];
  const moves = [];
  const skipped = [];
  for (const o of objects) {
    const to = newKeyFor(o.key);
    if (to) moves.push({ ...o, to });
    else skipped.push(o.key);
  }
  return { moves, skipped };
}

// --------------------------------------------------------------------- phases

async function doPlan() {
  const { moves, skipped } = await plan();
  const packs = moves.filter((m) => m.key.startsWith(OLD_PACKS));
  const front = moves.filter((m) => m.key.startsWith(OLD_FRONT));
  console.log(`${moves.length} objects to move (${packs.length} pack images, ${front.length} front-page assets)`);
  console.log(`${(moves.reduce((a, m) => a + m.size, 0) / 1024).toFixed(0)} KB total\n`);
  for (const m of moves) console.log(`  ${m.key}\n    -> ${m.to}`);
  if (skipped.length) console.log(`\nleft alone (no rule): ${skipped.join(", ")}`);
  const refs = packRefs();
  console.log(`\nagent.md files whose image: line will be rewritten: ${refs.length}`);
  const unmatched = refs.filter((r) => !newKeyFor(r.key));
  if (unmatched.length) console.log(`  WARNING: ${unmatched.length} point outside agents/: ${unmatched.map((u) => u.slug).join(", ")}`);
  console.log("\nnothing was written. Run --copy next.");
}

async function doCopy() {
  const { moves } = await plan();
  let n = 0;
  for (const m of moves) {
    await copy(m.key, m.to);
    n += 1;
    if (n % 10 === 0 || n === moves.length) console.log(`  copied ${n}/${moves.length}`);
  }
  console.log(`\n${n} objects copied. Old keys still in place. Run --rewrite next.`);
}

/** Every pack whose frontmatter image: points into the bucket. */
function packRefs() {
  const out = [];
  for (const dir of readdirSync(join(ROOT, "packs"), { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const file = join(ROOT, "packs", dir.name, "agent.md");
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf8");
    const m = new RegExp(`^image:\\s*"?${PUBLIC.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/([^"\\s]+)"?\\s*$`, "m").exec(text);
    if (m) out.push({ slug: dir.name, file, key: m[1], text });
  }
  return out;
}

function doRewrite() {
  let packs = 0;
  for (const r of packRefs()) {
    const to = newKeyFor(r.key);
    if (!to) { console.log(`  skipped ${r.slug}: ${r.key} has no rule`); continue; }
    writeFileSync(r.file, r.text.replace(`${PUBLIC}/${r.key}`, `${PUBLIC}/${to}`), "utf8");
    packs += 1;
  }
  console.log(`  rewrote image: in ${packs} agent.md files`);

  const planFile = join(ROOT, FRONT_PLAN);
  if (existsSync(planFile)) {
    const before = readFileSync(planFile, "utf8");
    const after = before.replaceAll(`${PUBLIC}/${OLD_FRONT}`, `${PUBLIC}/${PROJECT}/front/`);
    if (after !== before) {
      writeFileSync(planFile, after, "utf8");
      const n = before.split(`${PUBLIC}/${OLD_FRONT}`).length - 1;
      console.log(`  rewrote ${n} front-page URLs in ${FRONT_PLAN}`);
    }
  }
  console.log("\nRun --verify next.");
}

async function doVerify() {
  const { moves } = await plan();
  const bad = [];
  for (const m of moves) {
    const res = await fetch(`${PUBLIC}/${m.to}`, { method: "GET" });
    const len = Number(res.headers.get("content-length") ?? 0);
    if (!res.ok) bad.push(`${m.to}: HTTP ${res.status}`);
    else if (len !== m.size) bad.push(`${m.to}: ${len} bytes, expected ${m.size}`);
  }
  // Every rewritten reference must resolve too — the point is the live page, not the bucket.
  for (const r of packRefs()) {
    const res = await fetch(`${PUBLIC}/${r.key}`);
    if (!res.ok) bad.push(`${r.slug} agent.md -> ${r.key}: HTTP ${res.status}`);
  }
  if (bad.length) {
    console.error(`${bad.length} problems:\n  ${bad.join("\n  ")}`);
    process.exit(1);
  }
  writeFileSync(VERIFIED_MARKER, `${new Date().toISOString()} ${moves.length}\n`, "utf8");
  console.log(`all ${moves.length} new keys serve at the right size, and every agent.md image: resolves.`);
  console.log("--delete-old is now unlocked.");
}

async function doDelete() {
  if (!existsSync(VERIFIED_MARKER)) die("refusing: run --verify first (it writes the marker this checks).");
  const { moves } = await plan();
  let n = 0;
  for (const m of moves) { await remove(m.key); n += 1; }
  console.log(`${n} old keys deleted. ${OLD_PACKS} and ${OLD_FRONT} are now empty.`);
}

// ----------------------------------------------------------------------- main

const phase = process.argv[2];
const phases = {
  "--plan": doPlan, "--copy": doCopy, "--rewrite": doRewrite,
  "--verify": doVerify, "--delete-old": doDelete,
};
if (!phases[phase]) die(`usage: node scripts/r2-media.mjs ${Object.keys(phases).join(" | ")}`);
await phases[phase]();
