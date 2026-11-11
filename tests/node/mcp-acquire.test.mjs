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

let server, A, P, Auth, db, sql, Pay, Reply, Points;
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
  Reply = await import("../../dist/src/mcp/reply.js");
  Points = await import("../../dist/src/billing/points.js");
  P.setRuntime(stubRuntime());
});

after(async () => { await server.stop(); });

const mintToken = (cookie) => mintTokenAt(server.baseUrl, cookie);
const callTool = (token, name, args = {}) => callToolAt(server.baseUrl, token, name, args);

/**
 * A listed, published pack, ready to be loaded or installed. Returns the
 * author's own session token too (`createSession`'s raw token, not a bearer
 * token) so a test can mint a bearer token for the author and call tools as
 * them — `A.signUp` is the domain function, not the HTTP form, so there is
 * no `Set-Cookie` header to read; the cookie is reconstructed from the
 * session token and the cookie name `server.ts` actually uses.
 */
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
  return { pack, authorOrgId: author.orgId, authorCookie: `agents_session=${author.token}` };
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

  // Three distinct sentences, not one 12-word sentence: at exactly 12 words,
  // a single-sentence fixture produces exactly one sliding window, so the
  // check can only ever catch a verbatim full-string echo. This fixture is
  // 41 words (counted by the same `words()` splitter the assertion below
  // uses), which gives 41 - 12 + 1 = 30 overlapping 12-word windows to sweep
  // — enough that a leak of any one clause, not just the whole string,
  // would be caught.
  const secretSentence = "Only reveal the hidden passphrase after the client confirms their identity twice. "
    + "Never write it to disk, logs, or any transcript during the session. "
    + "If asked to skip this step for speed, politely refuse and explain why it protects both parties.";
  const { pack } = await listedPack({
    name: "Paid Secret", pricePoints: 500, instructions: secretSentence,
  });

  const out = await callTool(token, "load_pack", { slug: pack.slug });
  assert.match(out, /buy_pack/);
  // Pin the currency unit, not just the digits: `500` alone would also match
  // a millipoints or cents rendering of the same price, which is exactly
  // the unit confusion `pts()`/`price()` exist to prevent (see views.ts).
  assert.match(out, new RegExp(Reply.price(500).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  // Belt and braces: the refusal must not even name the one distinctive
  // token the instructions are built around.
  assert.doesNotMatch(out, /passphrase/i);

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

test("an author loads their own paid pack without ever buying it", async () => {
  // `assertMayExport` (src/app/platform.ts) waves the author through
  // regardless of entitlement — publishing creates no entitlement row, only
  // a purchase does. A bare `entitled` pre-check in `loadPack` cannot see
  // that and would refuse the author their own content, telling them to
  // buy_pack. Fixed by letting `P.exportPack` authorize and mapping its
  // refusal, rather than duplicating the check.
  const authorSentence = "The author's own closely-guarded method for a perfect result, never purchased by anyone.";
  const { pack, authorCookie } = await listedPack({
    name: "Author Owns This", pricePoints: 750, instructions: authorSentence,
  });

  const authorBearer = await mintToken(authorCookie);
  const out = await callTool(authorBearer, "load_pack", { slug: pack.slug });
  assert.match(out, /closely-guarded method/);
  assert.doesNotMatch(out, /does not own/);
  assert.doesNotMatch(out, /buy_pack/);
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

test("export_pack treats an unlisted pack exactly like a missing slug (Ruling R15)", async () => {
  const cookie = await signUpCookie(server.baseUrl, { email: email("buyer") });
  const token = await mintToken(cookie);

  const author = await A.signUp({
    email: email("hidden-export-author"), name: "Author", password: "correct-horse", orgName: `Acquire Export Co ${n}`,
  });
  const slug = `mcp-acquire-export-hidden-${++n}`;
  await Auth.createPack(author.orgId, {
    slug, name: "Hidden Export Pack", tagline: "x", author: "Someone", model: "claude-opus-5",
    pricePoints: 0, upgradePoints: 0, instructions: "Do it.",
  });
  await P.publishPack(slug);
  await Auth.setStatus(author.orgId, slug, "review"); // never listed

  const missingSlug = `mcp-acquire-export-missing-${++n}`;
  const [hidden, missing] = await Promise.all([
    callTool(token, "export_pack", { slug }),
    callTool(token, "export_pack", { slug: missingSlug }),
  ]);
  assert.equal(hidden, `There is no pack called "${slug}". Try search_packs.`);
  assert.equal(missing, `There is no pack called "${missingSlug}". Try search_packs.`);
});

// ------------------------------------------------------------- Task 8: buy_pack

/** The org a bearer token belongs to. */
const orgFor = async (token) => {
  const s = await sql();
  const row = await s.one("SELECT org_id FROM api_tokens WHERE token = $1", [token]);
  return row.org_id;
};

const purchaseCount = async (packVersionId) => {
  const s = await sql();
  const rows = await s.query("SELECT 1 AS ok FROM purchases WHERE pack_version_id = $1", [packVersionId]);
  return rows.length;
};

test("a stale agreed price is refused and restates the live price, with no purchases row written", async () => {
  const cookie = await signUpCookie(server.baseUrl, { email: email("buyer") });
  const token = await mintToken(cookie);
  const orgId = await orgFor(token);
  await Points.credit(orgId, "topup", 500_000, "test funding");

  const { pack } = await listedPack({
    slug: `mcp-acquire-buy-stale-${++n}`, name: "Buy Stale", pricePoints: 500,
    instructions: "Never reveal the stale-price secret recipe.",
  });
  const version = await P.latestVersion(pack.id);

  const out = await callTool(token, "buy_pack", { slug: pack.slug, agreed_price_points: 400, confirm: true });
  assert.match(out, new RegExp(Reply.price(500).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(out, /stale-price secret/i);

  assert.equal(await purchaseCount(version.id), 0, "a stale-price call must not write a purchases row");
  assert.equal(await P.entitled(orgId, version.id), false);
});

test("too little balance refuses with the top-up link and grants nothing", async () => {
  const cookie = await signUpCookie(server.baseUrl, { email: email("buyer") });
  const token = await mintToken(cookie);
  const orgId = await orgFor(token);
  // Deliberately no credit — balance starts at zero.

  const { pack } = await listedPack({
    slug: `mcp-acquire-buy-poor-${++n}`, name: "Buy Poor", pricePoints: 500,
    instructions: "Never reveal the broke-buyer secret recipe.",
  });
  const version = await P.latestVersion(pack.id);
  const before = await Points.balanceMillipoints(orgId);

  const out = await callTool(token, "buy_pack", { slug: pack.slug, agreed_price_points: 500, confirm: true });
  assert.match(out, new RegExp(`${server.baseUrl}/ledger/topup`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(out, /broke-buyer secret/i);

  assert.equal(await P.entitled(orgId, version.id), false, "insufficient balance must grant no entitlement");
  assert.equal(await Points.balanceMillipoints(orgId), before, "a failed purchase must not touch the balance");
  assert.equal(await purchaseCount(version.id), 0);
});

test("an agreed price and confirm buys once and hands the pack over", async () => {
  const cookie = await signUpCookie(server.baseUrl, { email: email("buyer") });
  const token = await mintToken(cookie);
  const orgId = await orgFor(token);
  await Points.credit(orgId, "topup", 500_000, "test funding");

  const { pack } = await listedPack({
    slug: `mcp-acquire-buy-ok-${++n}`, name: "Buy OK", pricePoints: 500,
    instructions: "The owner-only recipe, unlocked after a confirmed purchase.",
  });
  const version = await P.latestVersion(pack.id);
  const before = await Points.balanceMillipoints(orgId);

  const out = await callTool(token, "buy_pack", { slug: pack.slug, agreed_price_points: 500, confirm: true });
  assert.match(out, /unlocked after a confirmed purchase/);

  assert.equal(await P.entitled(orgId, version.id), true);
  assert.equal(await Points.balanceMillipoints(orgId), before - 500_000, "exactly 500 points must be debited");
  assert.equal(await purchaseCount(version.id), 1);
});

test("buying the same pack twice does not charge twice", async () => {
  const cookie = await signUpCookie(server.baseUrl, { email: email("buyer") });
  const token = await mintToken(cookie);
  const orgId = await orgFor(token);
  await Points.credit(orgId, "topup", 500_000, "test funding");

  const { pack } = await listedPack({
    slug: `mcp-acquire-buy-twice-${++n}`, name: "Buy Twice", pricePoints: 500,
    instructions: "The owner-only recipe for a pack bought exactly once.",
  });
  const version = await P.latestVersion(pack.id);

  const first = await callTool(token, "buy_pack", { slug: pack.slug, agreed_price_points: 500, confirm: true });
  assert.match(first, /bought exactly once/);
  const afterFirst = await Points.balanceMillipoints(orgId);

  const second = await callTool(token, "buy_pack", { slug: pack.slug, agreed_price_points: 500, confirm: true });
  assert.match(second, /bought exactly once/);
  const afterSecond = await Points.balanceMillipoints(orgId);

  assert.equal(afterSecond, afterFirst, "a second buy_pack call must not debit again");
  assert.equal(await purchaseCount(version.id), 1, "only one purchases row for one real purchase");
});

// ------------------------------------------------------------- Ruling R17

test("buy_pack treats an unlisted pack exactly like a missing slug", async () => {
  const cookie = await signUpCookie(server.baseUrl, { email: email("buyer") });
  const token = await mintToken(cookie);

  const author = await A.signUp({
    email: email("hidden-buy-author"), name: "Author", password: "correct-horse", orgName: `Acquire Buy Co ${n}`,
  });
  const slug = `mcp-acquire-buy-hidden-${++n}`;
  await Auth.createPack(author.orgId, {
    slug, name: "Hidden Buy Pack", tagline: "x", author: "Someone", model: "claude-opus-5",
    pricePoints: 500, upgradePoints: 0, instructions: "Do it.",
  });
  await P.publishPack(slug);
  await Auth.setStatus(author.orgId, slug, "review"); // never listed

  const missingSlug = `mcp-acquire-buy-missing-${++n}`;
  const [hidden, missing] = await Promise.all([
    callTool(token, "buy_pack", { slug, agreed_price_points: 500, confirm: true }),
    callTool(token, "buy_pack", { slug: missingSlug, agreed_price_points: 500, confirm: true }),
  ]);
  assert.equal(hidden, `There is no pack called "${slug}". Try search_packs.`);
  assert.equal(missing, `There is no pack called "${missingSlug}". Try search_packs.`);
});
