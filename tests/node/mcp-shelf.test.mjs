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

let server, A, P, Auth, db, sql, Creators;
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
  Creators = await import("../../dist/src/app/creators.js");
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

const insertRun = async (orgId, userId, packVersionId, startedAt = db.now()) => {
  const s = await sql();
  await s.query(
    `INSERT INTO runs (id, org_id, user_id, pack_version_id, session_id, model, status, budget_cents, started_at, ended_at)
     VALUES ($1,$2,$3,$4,$5,'claude-opus-5','idle',50,$6,$6)`,
    [`run_${++n}`, orgId, userId, packVersionId, `sesn_${n}`, startedAt]);
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

// I1/M2: `slug` is now a scored field, so a listed pack is findable by its
// own exact slug — the positive control that makes "a pack in review is
// invisible … by exact slug" below a real assertion rather than a vacuous
// one (before I1, a *listed* pack's own slug would not have matched either,
// so that test passed whether or not the review-status filtering worked).
test("a listed pack is findable by its own exact slug", async () => {
  const cookie = await signUpCookie(server.baseUrl, { email: email("buyer") });
  const token = await mintToken(cookie);

  const pack = await listedPack({ slug: `mcp-shelf-slugfind-${++n}`, name: "Slug Findable Widget" });

  const out = await callTool(token, "search_packs", { query: pack.slug });
  assert.match(out, /Slug Findable Widget/);
});

// M8: `search_packs`'s `category` filter had no test at all.
test("a category filter restricts the shelf to packs tagged with it", async () => {
  const cookie = await signUpCookie(server.baseUrl, { email: email("buyer") });
  const token = await mintToken(cookie);

  await listedPack({ name: "Tagged Widget", tags: "widgetry" });
  await listedPack({ name: "Untagged Gadget", tags: "gadgetry" });

  const out = await callTool(token, "search_packs", { category: "widgetry" });
  assert.match(out, /Tagged Widget/);
  assert.doesNotMatch(out, /Untagged Gadget/);
});

// M8: no non-default `sort` mode had a test either.
test("sort: most_used orders packs by run count, not catalog order", async () => {
  const cookie = await signUpCookie(server.baseUrl, { email: email("buyer") });
  const token = await mintToken(cookie);

  const quiet = await listedPack({ name: "Most Used Quiet Worker" });
  const busy = await listedPack({ name: "Most Used Busy Worker" });
  const runner = await A.signUp({
    email: email("mostused-runner"), name: "Runner", password: "correct-horse", orgName: `Most Used Runner Co ${n}`,
  });
  const busyVersion = await P.latestVersion(busy.id);
  await insertRun(runner.orgId, runner.userId, busyVersion.id);

  const out = await callTool(token, "search_packs", { query: "Most Used", sort: "most_used" });
  const first = out.split("\n\n")[1];
  assert.match(first, /Most Used Busy Worker/, `expected the pack with a run to sort first, got:\n${out}`);
  void quiet;
});

test("a tool filter nothing declares returns nothing", async () => {
  const cookie = await signUpCookie(server.baseUrl, { email: email("buyer") });
  const token = await mintToken(cookie);

  await listedPack({ name: "Has Playwright", tools: [{ name: "playwright", policy: "auto" }] });

  const out = await callTool(token, "search_packs", { tool: "kling-v2" });
  assert.match(out, /Nothing in the catalog matches/);
  assert.doesNotMatch(out, /Has Playwright/);
});

test("pack_details carries the listing, the permissions rail and the creator", async () => {
  const cookie = await signUpCookie(server.baseUrl, { email: email("buyer") });
  const token = await mintToken(cookie);

  const pack = await listedPack({
    slug: `senior-engineer-${n}`,
    name: "Senior Engineer",
    descriptionLong: "Reads your code, writes tests and ships the fix.",
    useCases: ["Fix a failing CI build"],
    tools: [{ name: "bash", policy: "always_allow" }, { name: "write", policy: "always_allow" }],
  });

  const out = await callTool(token, "pack_details", { slug: pack.slug });
  for (const needle of ["Reads your code", "bash, write", "runs", "version", "Use cases", "Fix a failing CI build"]) {
    assert.match(out, new RegExp(needle), `expected to find ${JSON.stringify(needle)} in:\n${out}`);
  }
  // M7: this pack has no creator claimed — an inverted ternary could print
  // "(creator: null)" or similar and still pass every assertion above.
  assert.doesNotMatch(out, /\(creator:/);
});

test("pack_details shows the creator handle once a pack is claimed", async () => {
  const cookie = await signUpCookie(server.baseUrl, { email: email("buyer") });
  const token = await mintToken(cookie);

  const pack = await listedPack({ name: "Claimed Widget" });
  const creatorAuthor = await A.signUp({ email: email("creator"), name: "Creator", password: "correct-horse", orgName: `Creator Co ${n}` });
  const creator = await Creators.upsertCreator({
    userId: creatorAuthor.userId, orgId: creatorAuthor.orgId, handle: `handle-${n}`, displayName: "The Creator",
  });
  // Attach the creator directly rather than relying on `claimUnownedPacks`
  // (which only ever touches a pack with no author org at all) — this test
  // is about `pack_details` rendering a handle off `creator_id`, not about
  // the re-attribution migration.
  const s = await sql();
  await s.query("UPDATE packs SET creator_id = $1 WHERE id = $2", [creator.id, pack.id]);

  const out = await callTool(token, "pack_details", { slug: pack.slug });
  assert.match(out, new RegExp(`@handle-${n}`));
});

test("pack_details points at load_pack and no longer refuses to reveal instructions", async () => {
  const cookie = await signUpCookie(server.baseUrl, { email: email("buyer") });
  const token = await mintToken(cookie);

  const pack = await listedPack({ name: "Loadable Widget" });
  const out = await callTool(token, "pack_details", { slug: pack.slug });
  assert.match(out, /load_pack/);
  assert.doesNotMatch(out, /not available through any tool/);
});

test("pack_details tells an author they own their own paid pack, not to buy it", async () => {
  // `P.mayExport` — not a bare `P.entitled` probe — is the one rule
  // `load_pack` and `buy_pack` already decide ownership by: an author (and
  // the platform curator) can read and run their own pack with no
  // `entitlements` row ever written. Before this fix, `pack_details` used
  // a bare `entitled` check and told an author "Owned by you: no" and "To
  // buy it, call buy_pack" for a pack they wrote and never bought.
  const author = await A.signUp({
    email: email("details-author"), name: "Author", password: "correct-horse", orgName: `Details Author Co ${n}`,
  });
  const slug = `mcp-details-author-owned-${++n}`;
  await Auth.createPack(author.orgId, {
    slug, name: "Author Owned Widget", tagline: "x", author: "Someone", model: "claude-opus-5",
    pricePoints: 500, upgradePoints: 0, instructions: "Do it.",
  });
  await P.publishPack(slug);
  const platform = await db.platformOrgId();
  await Auth.setStatus(platform, slug, "review");
  await Auth.setStatus(platform, slug, "listed");

  const authorBearer = await mintToken(`agents_session=${author.token}`);
  const version = await P.latestVersion((await P.getPack(slug)).id);

  // No purchases row and no entitlement — ownership here comes from
  // authorship alone, exactly as `assertMayExport`'s first clause grants it.
  assert.equal(await P.entitled(author.orgId, version.id), false);

  const out = await callTool(authorBearer, "pack_details", { slug });
  assert.match(out, /Owned by you: yes/);
  assert.match(out, /Start a run at/);
  assert.doesNotMatch(out, /To buy it/);
});

test("pack_details carries the reason line when one is given", async () => {
  const cookie = await signUpCookie(server.baseUrl, { email: email("buyer") });
  const token = await mintToken(cookie);

  const pack = await listedPack({ name: "Explained Widget" });
  const out = await callTool(token, "pack_details", { slug: pack.slug, reason: "evaluating for a client" });
  assert.match(out, /^evaluating for a client\n/);
});

test("an unlisted pack is 'no such pack' from pack_details, worded exactly like a missing slug", async () => {
  const cookie = await signUpCookie(server.baseUrl, { email: email("buyer") });
  const token = await mintToken(cookie);

  const author = await A.signUp({ email: email("hidden-author2"), name: "Author", password: "correct-horse", orgName: "Hidden Co 2" });
  const slug = `mcp-details-hidden-${++n}`;
  await Auth.createPack(author.orgId, {
    slug, name: "Hidden Details Pack", tagline: "x", author: "Someone", model: "claude-opus-5",
    pricePoints: 0, upgradePoints: 0, instructions: "Do it.",
  });
  await P.publishPack(slug);
  await Auth.setStatus(author.orgId, slug, "review"); // never listed

  const missingSlug = `mcp-details-missing-${++n}`;
  const [hidden, missing] = await Promise.all([
    callTool(token, "pack_details", { slug }),
    callTool(token, "pack_details", { slug: missingSlug }),
  ]);
  const expected = `There is no pack called "${slug}". Try search_packs.`;
  assert.equal(hidden, expected);
  assert.equal(missing, `There is no pack called "${missingSlug}". Try search_packs.`);
});

test("a pack in review is invisible by name and by exact slug", async () => {
  const cookie = await signUpCookie(server.baseUrl, { email: email("buyer") });
  const token = await mintToken(cookie);

  const author = await A.signUp({ email: email("hidden-author"), name: "Author", password: "correct-horse", orgName: "Hidden Co" });
  // Deliberately not the file's usual `mcp-shelf-...` prefix, and the name
  // below is deliberately nonsense, not "...Pack..." or "...Review...": I1
  // made `slug` a scored field and relaxed word matching to a leading
  // boundary, both correctly — but that means "mcp" and "shelf" (shared by
  // every other fixture's default slug in this file), "pack" (ditto), and
  // "review" (which now correctly matches the shipped "Guardrails
  // Reviewer" pack every fresh database seeds) would each turn this into a
  // test of catalog pollution via real, listed packs rather than of the
  // review-status invisibility it actually checks. A real slug is a
  // meaningful, chosen string, not a shared test namespace prefix — so this
  // one is deliberately unique instead of reusing the file's convention.
  const slug = `zyxquol-concealed-${++n}`;
  const name = "Zyxquol Vprxalt Qzorlak";
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

// ------------------------------------------------------------------- Task 4

test("categories count only listed packs", async () => {
  const cookie = await signUpCookie(server.baseUrl, { email: email("buyer") });
  const token = await mintToken(cookie);

  // The shipped catalog's own "Pack Zero" already carries "engineering" as a
  // listed pack — the one count this asserts on. This test's own fixture is
  // deliberately left in review, to prove it does *not* add a second one.
  const author = await A.signUp({
    email: email("categories-hidden-author"), name: "Author", password: "correct-horse",
    orgName: `Categories Hidden Co ${n}`,
  });
  const hiddenSlug = `mcp-categories-hidden-${++n}`;
  await Auth.createPack(author.orgId, {
    slug: hiddenSlug, name: "Engineering Hidden", tagline: "x", author: "Someone", model: "claude-opus-5",
    pricePoints: 0, upgradePoints: 0, instructions: "Do it.", tags: "engineering",
  });
  await P.publishPack(hiddenSlug);
  await Auth.setStatus(author.orgId, hiddenSlug, "review"); // never listed

  const out = await callTool(token, "list_categories", {});
  assert.match(out, /engineering · 1\b/);
});

test("get_popular week ignores a run from last month", async () => {
  const cookie = await signUpCookie(server.baseUrl, { email: email("buyer") });
  const token = await mintToken(cookie);

  const pack = await listedPack({ slug: `mcp-popular-senior-engineer-${++n}`, name: "Popular Senior Engineer" });
  const runner = await A.signUp({
    email: email("popular-runner"), name: "Runner", password: "correct-horse", orgName: `Popular Runner Co ${n}`,
  });
  const version = await P.latestVersion(pack.id);
  const fortyDaysAgo = new Date(Date.now() - 40 * 86_400_000).toISOString();
  await insertRun(runner.orgId, runner.userId, version.id, fortyDaysAgo);

  assert.doesNotMatch(await callTool(token, "get_popular", { timeframe: "week" }), /senior-engineer/);
  assert.match(await callTool(token, "get_popular", { timeframe: "all_time" }), /senior-engineer/);
});

// ------------------------------------------------------------------- Task 5

test("get_author lists the creator's packs and their stats", async () => {
  const cookie = await signUpCookie(server.baseUrl, { email: email("buyer") });
  const token = await mintToken(cookie);

  const pack = await listedPack({ slug: `mcp-author-senior-engineer-${++n}`, name: "Author Senior Engineer" });
  const creatorAuthor = await A.signUp({
    email: email("author-creator"), name: "Creator", password: "correct-horse", orgName: `Author Creator Co ${n}`,
  });
  const handle = `author-handle-${++n}`;
  const creator = await Creators.upsertCreator({
    userId: creatorAuthor.userId, orgId: creatorAuthor.orgId, handle, displayName: "Author Creator",
  });
  const s = await sql();
  await s.query("UPDATE packs SET creator_id = $1 WHERE id = $2", [creator.id, pack.id]);

  const out = await callTool(token, "get_author", { handle });
  assert.match(out, /senior-engineer/);
  assert.match(out, /\d+ packs?/);
});

test("an unknown handle is not found, not an empty profile", async () => {
  const cookie = await signUpCookie(server.baseUrl, { email: email("buyer") });
  const token = await mintToken(cookie);

  assert.match(await callTool(token, "get_author", { handle: "nobody" }), /no such creator/i);
});

// ------------------------------------------------------------------- Task 6

test("find_tools names the packs that declare a tool", async () => {
  const cookie = await signUpCookie(server.baseUrl, { email: email("buyer") });
  const token = await mintToken(cookie);

  await listedPack({
    slug: `mcp-tools-senior-engineer-${++n}`, name: "Tools Senior Engineer",
    tools: [{ name: "bash", policy: "always_allow" }, { name: "write", policy: "always_allow" }],
  });

  const out = await callTool(token, "find_tools", { query: "bash" });
  assert.match(out, /bash/);
  assert.match(out, /senior-engineer/);
});

test("find_tools with no query lists the whole index", async () => {
  const cookie = await signUpCookie(server.baseUrl, { email: email("buyer") });
  const token = await mintToken(cookie);

  await listedPack({
    slug: `mcp-tools-index-${++n}`, name: "Tools Index Pack",
    tools: [
      { name: "bash", policy: "always_allow" }, { name: "write", policy: "always_allow" },
      { name: "edit", policy: "always_allow" },
    ],
  });

  const out = await callTool(token, "find_tools", {});
  for (const toolName of ["bash", "write", "edit"]) assert.match(out, new RegExp(toolName));
});

test("find_tools reaches MCP servers as well as tools", async () => {
  const cookie = await signUpCookie(server.baseUrl, { email: email("buyer") });
  const token = await mintToken(cookie);

  await listedPack({
    slug: `mcp-tools-figma-${++n}`, name: "Tools Figma Pack",
    mcpServers: [{ name: "figma", url: "https://figma.example.com/mcp" }],
  });

  assert.match(await callTool(token, "find_tools", { query: "figma" }), /figma/);
});
