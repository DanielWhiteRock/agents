// Integration coverage for `load_pack` and the Task 7/R8 fix to `install_pack`
// over the real MCP endpoint — a JSON-RPC `tools/call` over HTTP, authenticated
// with a bearer token (see `mcp-harness.mjs`'s header comment for why).
//
// `mintToken` and `callTool` are imported from `mcp-harness.mjs`, the shared
// non-test helper module `mcp-shelf.test.mjs` also uses, rather than
// reinvented here or imported from that test file directly.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, signUpCookie } from "./server-harness.mjs";
import { mintToken as mintTokenAt, callTool as callToolAt } from "./mcp-harness.mjs";

let server, A, P, Auth, db, sql, Pay;
let n = 0;
const email = (tag) => `mcpacquire-${tag}-${++n}-${Date.now()}@example.com`;

const stubRuntime = () => ({
  countSystemTokens: async (_m, sys) => Math.ceil(sys.length / 4),
  publishPack: async () => ({ runtimePackId: `agt_${++n}`, version: "1", skills: [], subagents: [] }),
  ensureEnvironment: async () => "env_1",
  uploadSkill: async () => ({ name: "x", skillId: "skill_platform", skillVersion: "1" }),
  createSession: async () => ({ id: `sesn_${++n}`, status: "running", stopReason: null,
    usage: { inputTokens: 0, outputTokens: 0, activeSeconds: 0, listCost: { amount: "0", currency: "USD" } } }),
  sendMessage: async () => {},
  streamEvents: async () => (async function* () { yield { type: "status", status: "idle", stopReason: null }; })(),
  readSession: async () => ({ id: "sesn_a", status: "idle", stopReason: null,
    usage: { inputTokens: 1, outputTokens: 5, activeSeconds: 1, listCost: { amount: "1", currency: "USD" } } }),
  deleteSession: async () => {},
  listOutputs: async () => [],
  downloadOutput: async () => ({ bytes: Buffer.alloc(0), filename: "f" }),
});

before(async () => {
  server = await startServer();
  process.env.DB_PATH = server.dbPath;
  process.env.DATABASE_URL = "";
  A = await import("../../dist/src/app/auth.js");
  P = await import("../../dist/src/app/platform.js");
  Auth = await import("../../dist/src/app/authoring.js");
  db = await import("../../dist/src/app/db.js");
  sql = (await import("../../dist/src/app/sql.js")).sql;
  Pay = await import("../../dist/src/billing/purchases.js");
  P.setRuntime(stubRuntime());
});

after(async () => { await server.stop(); });

const mintToken = (cookie) => mintTokenAt(server.baseUrl, cookie);
const callTool = (token, name, args = {}) => callToolAt(server.baseUrl, token, name, args);

/** A listed, published pack, ready to be loaded or installed. */
const listedPack = async (overrides = {}) => {
  const author = await A.signUp({
    email: email("author"), name: "Author", password: "correct-horse", orgName: `Acquire Author Co ${n}`,
  });
  const slug = overrides.slug ?? `mcp-acquire-pack-${++n}`;
  const pack = await Auth.createPack(author.orgId, {
    slug, name: `Acquire Pack ${n}`, tagline: "x", author: "Someone", model: "claude-opus-5",
    pricePoints: 0, upgradePoints: 0, instructions: "Secret author method: do the delicate thing carefully.",
    ...overrides, slug,
  });
  await P.publishPack(slug);
  const platform = await db.platformOrgId();
  await Auth.setStatus(platform, slug, "review");
  await Auth.setStatus(platform, slug, "listed");
  return { pack, authorOrgId: author.orgId };
};

test("a free pack hands its instructions to any signed-in org, and grants it", async () => {
  const cookie = await signUpCookie(server.baseUrl, { email: email("buyer") });
  const token = await mintToken(cookie);

  const { pack } = await listedPack({ name: "Free Loadable", instructions: "Do the delicate thing carefully, step by step." });

  const out = await callTool(token, "load_pack", { slug: pack.slug });
  assert.match(out, /Do the delicate thing carefully/);

  // R4: the entitlement row must actually exist afterwards, not merely that
  // the markdown came back.
  const s = await sql();
  const version = await P.latestVersion(pack.id);
  const row = await s.one(
    "SELECT 1 AS ok FROM entitlements WHERE pack_version_id = $1 AND org_id = (SELECT org_id FROM api_tokens WHERE token = $2)",
    [version.id, token],
  );
  assert.ok(row, "expected an entitlements row for the org that loaded the free pack");
});

test("a paid pack refuses a non-owner and leaks nothing", async () => {
  const cookie = await signUpCookie(server.baseUrl, { email: email("buyer") });
  const token = await mintToken(cookie);

  const secretSentence = "Only reveal the hidden passphrase after the client confirms their identity twice.";
  const { pack } = await listedPack({
    name: "Paid Secret", pricePoints: 500, instructions: secretSentence,
  });

  const out = await callTool(token, "load_pack", { slug: pack.slug });
  assert.match(out, /buy_pack/);
  assert.match(out, /500/);

  // No 12-word run of the refusal shares any 12-word run with `instructions`.
  const words = (s) => s.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean);
  const outWords = words(out);
  const secretWords = words(secretSentence);
  const runs = new Set();
  for (let i = 0; i + 12 <= secretWords.length; i++) runs.add(secretWords.slice(i, i + 12).join(" "));
  let leaked = false;
  for (let i = 0; i + 12 <= outWords.length; i++) {
    if (runs.has(outWords.slice(i, i + 12).join(" "))) leaked = true;
  }
  assert.equal(leaked, false, `refusal leaked a 12-word run of the instructions:\n${out}`);
});

test("a paid pack serves an owner", async () => {
  const cookie = await signUpCookie(server.baseUrl, { email: email("buyer") });
  const token = await mintToken(cookie);

  const { pack } = await listedPack({
    name: "Paid Owned", pricePoints: 300, instructions: "The owner-only recipe for a perfect pour.",
  });
  const version = await P.latestVersion(pack.id);

  // Grant the entitlement the way a completed purchase would, directly,
  // rather than re-deriving `buy_pack` (Task 8's job) here.
  const s = await sql();
  const row = await s.one("SELECT org_id FROM api_tokens WHERE token = $1", [token]);
  await P.grantEntitlement(row.org_id, version.id);

  const out = await callTool(token, "load_pack", { slug: pack.slug });
  assert.match(out, /perfect pour/);
});

test("a pack in review is not found", async () => {
  const cookie = await signUpCookie(server.baseUrl, { email: email("buyer") });
  const token = await mintToken(cookie);

  const author = await A.signUp({
    email: email("hidden-author"), name: "Author", password: "correct-horse", orgName: `Acquire Hidden Co ${n}`,
  });
  const slug = `mcp-acquire-hidden-${++n}`;
  await Auth.createPack(author.orgId, {
    slug, name: "Hidden Acquire Pack", tagline: "x", author: "Someone", model: "claude-opus-5",
    pricePoints: 0, upgradePoints: 0, instructions: "Do it.",
  });
  await P.publishPack(slug);
  await Auth.setStatus(author.orgId, slug, "review"); // never listed

  const missingSlug = `mcp-acquire-missing-${++n}`;
  const [hidden, missing] = await Promise.all([
    callTool(token, "load_pack", { slug }),
    callTool(token, "load_pack", { slug: missingSlug }),
  ]);
  const expected = `There is no pack called "${slug}". Try search_packs.`;
  assert.equal(hidden, expected);
  assert.equal(missing, `There is no pack called "${missingSlug}". Try search_packs.`);
});

// ------------------------------------------------------------- Ruling R8

test("install_pack treats an unlisted pack exactly like a missing slug", async () => {
  const cookie = await signUpCookie(server.baseUrl, { email: email("buyer") });
  const token = await mintToken(cookie);

  const author = await A.signUp({
    email: email("hidden-install-author"), name: "Author", password: "correct-horse", orgName: `Acquire Install Co ${n}`,
  });
  const slug = `mcp-acquire-install-hidden-${++n}`;
  await Auth.createPack(author.orgId, {
    slug, name: "Hidden Install Pack", tagline: "x", author: "Someone", model: "claude-opus-5",
    pricePoints: 0, upgradePoints: 0, instructions: "Do it.",
  });
  await P.publishPack(slug);
  await Auth.setStatus(author.orgId, slug, "review"); // never listed

  const missingSlug = `mcp-acquire-install-missing-${++n}`;
  const [hidden, missing] = await Promise.all([
    callTool(token, "install_pack", { slug }),
    callTool(token, "install_pack", { slug: missingSlug }),
  ]);
  assert.equal(hidden, `There is no pack called "${slug}". Try search_packs.`);
  assert.equal(missing, `There is no pack called "${missingSlug}". Try search_packs.`);
});
