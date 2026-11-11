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

/** Lower-cased, punctuation-stripped words, for comparing runs rather than exact strings. */
const words = (s) => s.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean);

/**
 * Every overlapping `windowSize`-word run in `s`, as a Set of space-joined
 * strings — the unit a leak check sweeps for shared runs over, so a leak of
 * any one clause is caught, not just a leaked full-string echo.
 *
 * A fixture only `windowSize` words long produces exactly one window, which
 * can only ever catch a verbatim full-string match — Task 7's fixture was
 * deliberately much longer than 12 words for this reason, and any fixture
 * handed to `assertNoLeak` below must be too.
 */
const wordRuns = (s, windowSize) => {
  const w = words(s);
  const runs = new Set();
  for (let i = 0; i + windowSize <= w.length; i++) runs.add(w.slice(i, i + windowSize).join(" "));
  return runs;
};

/**
 * Asserts that no `windowSize`-word run of `secret` reappears anywhere in
 * `out` — the sliding-window sweep Task 7 wrote inline for `load_pack`'s
 * refusal, extracted here so `buy_pack` (and whatever Tasks 9/10 add to this
 * file) can reuse it instead of re-deriving it, or falling back to a
 * single-token `doesNotMatch` that a leak of any other clause would miss.
 */
const assertNoLeak = (out, secret, windowSize = 12) => {
  const secretRuns = wordRuns(secret, windowSize);
  const outRuns = wordRuns(out, windowSize);
  let leaked = false;
  for (const r of outRuns) if (secretRuns.has(r)) leaked = true;
  assert.equal(leaked, false, `refusal leaked a ${windowSize}-word run of the instructions:\n${out}`);
};

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
  assertNoLeak(out, secretSentence);
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

/**
 * Three 42-word, three-sentence fixtures (31 overlapping 12-word windows
 * each) so `assertNoLeak` has something to actually sweep — a 6-word
 * fixture produces zero 12-word windows and would pass trivially even if
 * the whole refusal were echoed back, verbatim, into a single reply.
 */
const stalePriceSecret = "Only disclose the stale-price cipher after the buyers identity is double-checked twice. "
  + "Never write the cipher to disk, logs, or any transcript during the session. "
  + "If asked to skip this safeguard for speed, politely refuse and explain why it protects both parties.";
const brokeBuyerSecret = "Only disclose the broke-buyer cipher after the buyers identity is double-checked twice. "
  + "Never write the cipher to disk, logs, or any transcript during the session. "
  + "If asked to skip this safeguard for speed, politely refuse and explain why it protects both parties.";
const overpaySecret = "Only disclose the overpay cipher after the buyers identity is double-checked twice. "
  + "Never write the cipher to disk, logs, or any transcript during the session. "
  + "If asked to skip this safeguard for speed, politely refuse and explain why it protects both parties.";

test("a stale agreed price is refused and restates the live price, with no purchases row written", async () => {
  const cookie = await signUpCookie(server.baseUrl, { email: email("buyer") });
  const token = await mintToken(cookie);
  const orgId = await orgFor(token);
  await Points.credit(orgId, "topup", 500_000, "test funding");

  const { pack } = await listedPack({
    slug: `mcp-acquire-buy-stale-${++n}`, name: "Buy Stale", pricePoints: 500, instructions: stalePriceSecret,
  });
  const version = await P.latestVersion(pack.id);

  const out = await callTool(token, "buy_pack", { slug: pack.slug, agreed_price_points: 400, confirm: true });
  assert.match(out, new RegExp(Reply.price(500).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(out, /cipher/i);
  assertNoLeak(out, stalePriceSecret);

  assert.equal(await purchaseCount(version.id), 0, "a stale-price call must not write a purchases row");
  assert.equal(await P.entitled(orgId, version.id), false);
});

test("an agreed price above the live price is also refused and restates the live price", async () => {
  const cookie = await signUpCookie(server.baseUrl, { email: email("buyer") });
  const token = await mintToken(cookie);
  const orgId = await orgFor(token);
  await Points.credit(orgId, "topup", 500_000, "test funding");

  const { pack } = await listedPack({
    slug: `mcp-acquire-buy-high-${++n}`, name: "Buy High", pricePoints: 500, instructions: overpaySecret,
  });
  const version = await P.latestVersion(pack.id);
  const before = await Points.balanceMillipoints(orgId);

  const out = await callTool(token, "buy_pack", { slug: pack.slug, agreed_price_points: 600, confirm: true });
  assert.match(out, new RegExp(Reply.price(500).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(out, /cipher/i);
  assertNoLeak(out, overpaySecret);

  assert.equal(await purchaseCount(version.id), 0, "an above-market price call must not write a purchases row");
  assert.equal(await P.entitled(orgId, version.id), false);
  assert.equal(await Points.balanceMillipoints(orgId), before, "a rejected mismatch must not touch the balance");
});

test("too little balance refuses with the top-up link and grants nothing", async () => {
  const cookie = await signUpCookie(server.baseUrl, { email: email("buyer") });
  const token = await mintToken(cookie);
  const orgId = await orgFor(token);
  // Deliberately no credit — balance starts at zero.

  const { pack } = await listedPack({
    slug: `mcp-acquire-buy-poor-${++n}`, name: "Buy Poor", pricePoints: 500, instructions: brokeBuyerSecret,
  });
  const version = await P.latestVersion(pack.id);
  const before = await Points.balanceMillipoints(orgId);

  const out = await callTool(token, "buy_pack", { slug: pack.slug, agreed_price_points: 500, confirm: true });
  // C1: the one sanctioned browser exit used to be a dead link — `/ledger/topup`
  // is POST-only with no GET handler, so it 404s. `/ledger` is the page that
  // actually holds the top-up form.
  assert.match(out, new RegExp(`${server.baseUrl}/ledger`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(out, /\/ledger\/topup/);
  assert.doesNotMatch(out, /cipher/i);
  assertNoLeak(out, brokeBuyerSecret);

  assert.equal(await P.entitled(orgId, version.id), false, "insufficient balance must grant no entitlement");
  assert.equal(await Points.balanceMillipoints(orgId), before, "a failed purchase must not touch the balance");
  assert.equal(await purchaseCount(version.id), 0);
});

// The MCP SDK turns a schema-validation failure into a normal tool *result*
// (`isError: true` content, not a JSON-RPC protocol-level error) — verified
// directly against the running server before writing these assertions — so
// `callTool` (which only throws on `payload.error`, the protocol-level
// field) returns the validation message as plain text rather than
// rejecting. These tests capture that text instead of expecting a throw.

test("omitting confirm is refused by the schema, without charging", async () => {
  const cookie = await signUpCookie(server.baseUrl, { email: email("buyer") });
  const token = await mintToken(cookie);
  const orgId = await orgFor(token);
  await Points.credit(orgId, "topup", 500_000, "test funding");

  const { pack } = await listedPack({
    slug: `mcp-acquire-buy-noconfirm-${++n}`, name: "Buy No Confirm", pricePoints: 500,
  });
  const version = await P.latestVersion(pack.id);
  const before = await Points.balanceMillipoints(orgId);

  const out = await callTool(token, "buy_pack", { slug: pack.slug, agreed_price_points: 500 });
  assert.match(out, /confirm/i);

  assert.equal(await Points.balanceMillipoints(orgId), before);
  assert.equal(await P.entitled(orgId, version.id), false);
  assert.equal(await purchaseCount(version.id), 0);
});

test("confirm: false is refused by the schema, without charging", async () => {
  const cookie = await signUpCookie(server.baseUrl, { email: email("buyer") });
  const token = await mintToken(cookie);
  const orgId = await orgFor(token);
  await Points.credit(orgId, "topup", 500_000, "test funding");

  const { pack } = await listedPack({
    slug: `mcp-acquire-buy-falseconfirm-${++n}`, name: "Buy False Confirm", pricePoints: 500,
  });
  const version = await P.latestVersion(pack.id);
  const before = await Points.balanceMillipoints(orgId);

  const out = await callTool(token, "buy_pack", { slug: pack.slug, agreed_price_points: 500, confirm: false });
  assert.match(out, /confirm/i);

  assert.equal(await Points.balanceMillipoints(orgId), before);
  assert.equal(await P.entitled(orgId, version.id), false);
  assert.equal(await purchaseCount(version.id), 0);
});

test("an agreed price and confirm buys once, charges exactly the price, and hands the pack over", async () => {
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
  // R3 fix item 3: the reply must say what was charged, not just hand over
  // the pack silently — an agent that retried after a timeout needs to be
  // able to tell its user whether this call spent anything.
  assert.match(out, /^Bought Buy OK for/);
  assert.match(out, new RegExp(Reply.price(500).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  assert.equal(await P.entitled(orgId, version.id), true);
  assert.equal(await Points.balanceMillipoints(orgId), before - 500_000, "exactly 500 points must be debited");
  assert.equal(await purchaseCount(version.id), 1);
});

test("buying the same pack twice does not charge twice, and says so the second time", async () => {
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
  assert.match(first, /^Bought Buy Twice for/);
  const afterFirst = await Points.balanceMillipoints(orgId);

  const second = await callTool(token, "buy_pack", { slug: pack.slug, agreed_price_points: 500, confirm: true });
  assert.match(second, /bought exactly once/);
  // The second call must be honest that it is a no-op, not reuse the same
  // "Bought ... for ..." receipt as if it had charged again.
  assert.match(second, /^Nothing was charged/);
  const afterSecond = await Points.balanceMillipoints(orgId);

  assert.equal(afterSecond, afterFirst, "a second buy_pack call must not debit again");
  assert.equal(await purchaseCount(version.id), 1, "only one purchases row for one real purchase");
});

// --------------------------------------------------------------- Critical fix:
// `P.mayExport`, not a bare `P.entitled` probe, gates the purchase.

test("an author buying their own paid pack is not charged, and no purchases row appears", async () => {
  const authorSentence = "The author's own closely-guarded method for a perfect result, never purchased by anyone.";
  const { pack, authorOrgId, authorCookie } = await listedPack({
    slug: `mcp-acquire-buy-author-${++n}`, name: "Buy Author Owned", pricePoints: 500, instructions: authorSentence,
  });
  const version = await P.latestVersion(pack.id);
  const authorBearer = await mintToken(authorCookie);
  const before = await Points.balanceMillipoints(authorOrgId);

  const out = await callTool(authorBearer, "buy_pack", { slug: pack.slug, agreed_price_points: 500, confirm: true });
  assert.match(out, /^Nothing was charged/);
  assert.match(out, /closely-guarded method/);

  assert.equal(await Points.balanceMillipoints(authorOrgId), before, "an author must not be charged for their own pack");
  assert.equal(await purchaseCount(version.id), 0, "an author's own pack must never produce a purchases row");
  // Authorship grants access with no entitlements row at all (see
  // `assertMayExport`) — this assertion pins that `buy_pack` did not paper
  // over the gap by inserting one of its own.
  assert.equal(await P.entitled(authorOrgId, version.id), false,
    "authorship must not create a phantom entitlement row");
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

// --------------------------------------------------------------- Task 9

test("my_balance reports points, not dollars", async () => {
  const cookie = await signUpCookie(server.baseUrl, { email: email("buyer") });
  const token = await mintToken(cookie);
  const orgId = await orgFor(token);
  await Points.credit(orgId, "topup", 500_000, "test funding");

  const out = await callTool(token, "my_balance", {});
  assert.doesNotMatch(out, /\$/);
  assert.match(out, /500/);
});

test("top_up returns a link and charges nothing", async () => {
  const cookie = await signUpCookie(server.baseUrl, { email: email("buyer") });
  const token = await mintToken(cookie);
  const orgId = await orgFor(token);
  const before = await Points.balanceMillipoints(orgId);

  const out = await callTool(token, "top_up", { amount_points: 500 });
  assert.match(out, new RegExp(`${server.baseUrl}/ledger`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(out, /\/ledger\/topup/);
  assert.equal(await Points.balanceMillipoints(orgId), before);
});

// C1 (Critical): the reviewer verified against a running build that
// `GET /ledger` is 200 and `GET /ledger/topup` is 404 (that path is
// POST-only). Both `buy_pack`'s insufficient-balance refusal and `top_up`
// used to emit the dead `/ledger/topup` link; this fetches the link each one
// actually emits now and asserts it resolves, so the next URL this surface
// invents cannot rot the same way without a test noticing.
test("the link buy_pack's insufficient-balance refusal emits actually resolves", async () => {
  const cookie = await signUpCookie(server.baseUrl, { email: email("buyer") });
  const token = await mintToken(cookie);
  // Deliberately no credit — balance starts at zero, so buy_pack refuses.

  const { pack } = await listedPack({
    slug: `mcp-acquire-buy-link-${++n}`, name: "Buy Link Pack", pricePoints: 500,
  });

  const out = await callTool(token, "buy_pack", { slug: pack.slug, agreed_price_points: 500, confirm: true });
  const match = /(https?:\/\/\S+\/ledger)\b/.exec(out);
  assert.ok(match, `expected a /ledger link in the refusal:\n${out}`);

  const res = await fetch(match[1], { headers: { cookie } });
  assert.equal(res.status, 200, `expected ${match[1]} to resolve with 200, got ${res.status}`);
});

test("the link top_up emits actually resolves", async () => {
  const cookie = await signUpCookie(server.baseUrl, { email: email("buyer") });
  const token = await mintToken(cookie);

  const out = await callTool(token, "top_up", { amount_points: 500 });
  const match = /(https?:\/\/\S+\/ledger)\b/.exec(out);
  assert.ok(match, `expected a /ledger link in the reply:\n${out}`);

  const res = await fetch(match[1], { headers: { cookie } });
  assert.equal(res.status, 200, `expected ${match[1]} to resolve with 200, got ${res.status}`);
});

test("my_library marks a row whose pack has a newer version", async () => {
  const cookie = await signUpCookie(server.baseUrl, { email: email("buyer") });
  const token = await mintToken(cookie);
  const orgId = await orgFor(token);

  const { pack, authorOrgId } = await listedPack({
    slug: `mcp-acquire-library-behind-${++n}`, name: "Library Behind", pricePoints: 0,
  });
  const v1 = await P.latestVersion(pack.id);
  await P.grantEntitlement(orgId, v1.id);

  // The author publishes a second version after the entitlement was
  // granted, so the row above is now pinned behind the catalog's latest.
  await Auth.updatePack(authorOrgId, pack.slug, {
    slug: pack.slug, name: pack.name, tagline: pack.tagline, author: pack.author,
    model: pack.model, pricePoints: pack.price_points, upgradePoints: pack.upgrade_points,
    instructions: "Version two instructions, now updated.",
  });
  await P.publishPack(pack.slug);

  const out = await callTool(token, "my_library", {});
  assert.match(out, /behind latest \(version 2\)/);
});

test("my_library leaves a current row unmarked", async () => {
  const cookie = await signUpCookie(server.baseUrl, { email: email("buyer") });
  const token = await mintToken(cookie);
  const orgId = await orgFor(token);

  const { pack } = await listedPack({
    slug: `mcp-acquire-library-current-${++n}`, name: "Library Current", pricePoints: 0,
  });
  const v1 = await P.latestVersion(pack.id);
  await P.grantEntitlement(orgId, v1.id);

  const out = await callTool(token, "my_library", {});
  assert.match(out, /Library Current/);
  assert.doesNotMatch(out, /behind latest/);
});

// -------------------------------------------------------------- Task 10

/**
 * A raw `tools/list` call — `mcp-harness.mjs` only exports `callTool`
 * (`tools/call`), so this mirrors its SSE-unwrapping for the one other
 * method these tests need.
 */
async function listTools(token) {
  const res = await fetch(`${server.baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  const raw = await res.text();
  const line = raw.split("\n").find((l) => l.startsWith("data: "));
  const payload = JSON.parse(line ? line.slice(6) : raw);
  if (payload.error) throw new Error(`tools/list failed (${res.status}): ${payload.error.message}`);
  return payload.result.tools;
}

/**
 * Minimal, side-effect-free arguments for every registered tool, so the
 * sweep below can call each one for real rather than merely inspecting its
 * schema. A slug or handle or run id that does not exist is enough: every
 * tool answers a "not found"/"not owned" refusal through the same `text()`
 * helper a successful call would use, so the reason still gets echoed —
 * and, for slug-taking tools, nothing is charged or granted along the way.
 * `assert.ok(extra !== undefined, ...)` below means a newly registered tool
 * with no entry here fails this test immediately, which is the point: it
 * forces this map (and the tool's own `reason` wiring) to be kept current.
 */
const SWEEP_ARGS = {
  search_packs: {},
  pack_details: { slug: "mcp-reason-sweep-missing" },
  list_categories: {},
  get_popular: {},
  get_author: { handle: "mcp-reason-sweep-missing" },
  find_tools: {},
  my_library: {},
  install_pack: { slug: "mcp-reason-sweep-missing" },
  export_pack: { slug: "mcp-reason-sweep-missing" },
  load_pack: { slug: "mcp-reason-sweep-missing" },
  buy_pack: { slug: "mcp-reason-sweep-missing", agreed_price_points: 0, confirm: true },
  my_balance: {},
  top_up: { amount_points: 100 },
  list_runs: {},
  run_trace: { run_id: "mcp-reason-sweep-missing" },
};

test("every registered tool's schema accepts a reason, and echoes it back", async () => {
  const cookie = await signUpCookie(server.baseUrl, { email: email("buyer") });
  const token = await mintToken(cookie);
  const orgId = await orgFor(token);
  const before = await Points.balanceMillipoints(orgId);

  const tools = await listTools(token);
  assert.ok(tools.length > 0, "expected at least one registered tool");

  for (const t of tools) {
    const props = t.inputSchema?.properties ?? {};
    assert.ok("reason" in props, `${t.name} is missing "reason" from its inputSchema`);

    const extra = SWEEP_ARGS[t.name];
    assert.ok(extra !== undefined, `no sweep fixture registered for tool "${t.name}" — add one to SWEEP_ARGS`);

    const reason = `sweep check for ${t.name}`;
    const out = await callTool(token, t.name, { ...extra, reason });
    assert.equal(out.split("\n")[0], reason, `${t.name} did not echo its reason as the first line of its reply`);
  }

  // Every fixture above is a fake slug/handle/run id against a freshly
  // signed-up org with no funding — none of this should have moved points.
  assert.equal(await Points.balanceMillipoints(orgId), before, "the sweep must not have charged anything");
});

test("no tool description tells a buyer to finish in a browser, except top_up", async () => {
  const cookie = await signUpCookie(server.baseUrl, { email: email("buyer") });
  const token = await mintToken(cookie);
  const tools = await listTools(token);
  assert.ok(tools.length > 0, "expected at least one registered tool");

  for (const t of tools) {
    if (t.name === "top_up") continue;
    assert.doesNotMatch(
      t.description ?? "", /browser/i, `${t.name}'s description points a buyer at a browser`);
  }
});
