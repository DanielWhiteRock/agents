// Integration coverage for `search_packs` over the real MCP endpoint: ranked,
// filtered, and reached the way a buyer's agent actually reaches it — a JSON-RPC
// `tools/call` over HTTP, authenticated with a bearer token rather than a
// cookie (`/mcp` resolves `Authorization` before the session gate; see
// `src/app/server.ts`).
//
// `mintToken` and `callTool` live in `mcp-harness.mjs`, a non-test module, so
// later MCP tool tests can import them too without each pulling in this
// file's own `before`/`after`/`test(...)` and starting a second server.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, signUpCookie } from "./server-harness.mjs";
import { mintToken as mintTokenAt, callTool as callToolAt } from "./mcp-harness.mjs";

let server, A, P, Auth, db, sql;
let n = 0;
const email = (tag) => `mcpshelf-${tag}-${++n}-${Date.now()}@example.com`;

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
  P.setRuntime(stubRuntime());
});

after(async () => { await server.stop(); });

// Thin wrappers over `mcp-harness.mjs`'s helpers, bound to this file's own
// server, so every test below reads exactly as it did when these were local.
const mintToken = (cookie) => mintTokenAt(server.baseUrl, cookie);
const callTool = (token, name, args = {}) => callToolAt(server.baseUrl, token, name, args);

/** A listed, published pack, ready to appear on the shelf. */
const listedPack = async (overrides = {}) => {
  const author = await A.signUp({ email: email("author"), name: "Author", password: "correct-horse", orgName: `Author Co ${n}` });
  const slug = overrides.slug ?? `mcp-shelf-pack-${++n}`;
  const pack = await Auth.createPack(author.orgId, {
    slug, name: `Pack ${n}`, tagline: "x", author: "Someone", model: "claude-opus-5",
    pricePoints: 0, upgradePoints: 0, instructions: "Do the thing.", ...overrides, slug,
  });
  await P.publishPack(slug);
  const platform = await db.platformOrgId();
  await Auth.setStatus(platform, slug, "review");
  await Auth.setStatus(platform, slug, "listed");
  return pack;
};

const insertRun = async (orgId, userId, packVersionId) => {
  const s = await sql();
  await s.query(
    `INSERT INTO runs (id, org_id, user_id, pack_version_id, session_id, model, status, budget_cents, started_at, ended_at)
     VALUES ($1,$2,$3,$4,$5,'claude-opus-5','idle',50,$6,$6)`,
    [`run_${++n}`, orgId, userId, packVersionId, `sesn_${n}`, db.now()]);
};

test("an empty query returns a bounded ranked page, not the whole table", async () => {
  const cookie = await signUpCookie(server.baseUrl, { email: email("buyer") });
  const token = await mintToken(cookie);

  const leader = await listedPack({ name: "Trending Leader" });
  const voter = await A.signUp({ email: email("voter"), name: "Voter", password: "correct-horse", orgName: "Voter Co" });
  const leaderVersion = await P.latestVersion(leader.id);
  await insertRun(voter.orgId, voter.userId, leaderVersion.id);

  for (let i = 0; i < 20; i++) await listedPack({ name: `Filler ${i}` });

  const out = await callTool(token, "search_packs", {});
  const header = out.split("\n")[0];
  const counts = /^(\d+) of (\d+) match:$/.exec(header);
  assert.ok(counts, `unexpected header: ${header}`);
  // Bounded to the default page size, even though the catalog (the seed
  // packs plus the 21 just created here) holds more than that.
  assert.equal(Number(counts[1]), 20);
  assert.ok(Number(counts[2]) > 20, "the catalog has more than one page of packs");

  // The leader — the only pack with a real run — must rank first: not the
  // first row by id, and not simply the newest of the 21 just created.
  // split("\n\n")[0] is the "N of M match:" header, so the first pack entry
  // is the block after it.
  const firstEntry = out.split("\n\n")[1];
  assert.match(firstEntry, /Trending Leader/);
});

test("a tool filter nothing declares returns nothing", async () => {
  const cookie = await signUpCookie(server.baseUrl, { email: email("buyer") });
  const token = await mintToken(cookie);

  await listedPack({ name: "Has Playwright", tools: [{ name: "playwright", policy: "auto" }] });

  const out = await callTool(token, "search_packs", { tool: "kling-v2" });
  assert.match(out, /Nothing in the catalog matches/);
  assert.doesNotMatch(out, /Has Playwright/);
});

test("a pack in review is invisible by name and by exact slug", async () => {
  const cookie = await signUpCookie(server.baseUrl, { email: email("buyer") });
  const token = await mintToken(cookie);

  const author = await A.signUp({ email: email("hidden-author"), name: "Author", password: "correct-horse", orgName: "Hidden Co" });
  const slug = `mcp-shelf-hidden-${++n}`;
  const name = "Hidden Pack In Review";
  await Auth.createPack(author.orgId, {
    slug, name, tagline: "x", author: "Someone", model: "claude-opus-5",
    pricePoints: 0, upgradePoints: 0, instructions: "Do it.",
  });
  await P.publishPack(slug);
  await Auth.setStatus(author.orgId, slug, "review"); // never listed

  // Exactly the "nothing found" sentence — no pack entry snuck in alongside it.
  const byName = await callTool(token, "search_packs", { query: name });
  assert.equal(byName, `Nothing in the catalog matches "${name}".`);

  const bySlug = await callTool(token, "search_packs", { query: slug });
  assert.equal(bySlug, `Nothing in the catalog matches "${slug}".`);
});
