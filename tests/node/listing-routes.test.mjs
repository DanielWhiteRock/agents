// HTTP-level coverage for the listing's approval rail: the screen a human
// reads before a generated listing reaches anybody, the route that approves
// it, and the staleness stamp an instructions edit leaves behind.
//
// The domain functions are covered directly in tests/node/listing.test.mjs.
// What that file cannot see is the layer in between: that an unapproved draft
// shows a buyer nothing, that `markStale` is actually reached from the edit
// route, and that a pack whose stored scenarios are malformed still renders a
// page rather than a 500. Driven with `fetch` against the real built server,
// the same way tests/node/messages-routes.test.mjs does.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./server-harness.mjs";

let server, A, Auth, P, L, sql;
let n = 0;
const email = () => `lr${++n}-${Date.now()}@example.com`;

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

const INSTRUCTIONS = "Read the diff, then say the one thing that is wrong with it.";

const PACK_INPUT = {
  slug: "", name: "Listing Route Pack", tagline: "Something with a listing to approve",
  author: "A Real Expert", model: "claude-opus-5", effort: "high",
  pricePoints: 0, upgradePoints: 0, instructions: INSTRUCTIONS,
};

const DRAFT = {
  description: "Audits a branch before it merges.", useCases: ["Review a branch"],
  limitations: ["Needs a real diff"], faq: [{ q: "Does it write?", a: "No." }],
  scenarios: [{ brief: "A noisy refactor", reached: ["read"], output: "three findings" }],
  requirements: ["A git remote"],
};

before(async () => {
  server = await startServer();
  process.env.DB_PATH = server.dbPath;
  process.env.DATABASE_URL = "";
  A = await import("../../dist/src/app/auth.js");
  Auth = await import("../../dist/src/app/authoring.js");
  P = await import("../../dist/src/app/platform.js");
  L = await import("../../dist/src/app/listing.js");
  sql = (await import("../../dist/src/app/sql.js")).sql;
  P.setRuntime(stubRuntime());
});

after(async () => { await server.stop(); });

const cookieFor = async (userId) => `agents_session=${encodeURIComponent(await A.createSession(userId))}`;

/** An owner, their pack, and a session cookie for them. */
const authorWithPack = async (over = {}) => {
  const owner = await A.signUp({
    email: email(), name: "Author", password: "correct-horse-battery-staple", orgName: `Listing Co ${++n}`,
  });
  const slug = `listing-route-${n}`;
  const pack = await Auth.createPack(owner.orgId, { ...PACK_INPUT, slug, ...over });
  return { owner, pack, cookie: await cookieFor(owner.userId) };
};

/** A form POST, the way the browser sends one. */
const form = (cookie, fields = {}) => ({
  method: "POST", redirect: "manual",
  headers: { "content-type": "application/x-www-form-urlencoded", cookie },
  body: new URLSearchParams(fields),
});

/** The edit form's own fields, as the browser submits them. */
const editBody = (over = {}) => ({
  name: PACK_INPUT.name, tagline: PACK_INPUT.tagline, author: PACK_INPUT.author,
  model: PACK_INPUT.model, effort: "high", pricePoints: "0", upgradePoints: "0",
  instructions: INSTRUCTIONS, pinnedModels: "", payoutEmail: "", ...over,
});

test("a draft shows a buyer nothing until a human approves it", async () => {
  const { pack, cookie } = await authorWithPack();
  await L.saveDraft(pack.id, DRAFT, 1);

  const buyer = await A.signUp({
    email: email(), name: "Buyer", password: "correct-horse-battery-staple", orgName: `Buyer Co ${++n}`,
  });
  const asBuyer = await fetch(`${server.baseUrl}/packs/${pack.slug}`, { headers: { cookie: await cookieFor(buyer.userId) } });
  const before = await asBuyer.text();
  assert.equal(asBuyer.status, 200);
  assert.doesNotMatch(before, /Audits a branch before it merges/, "an unapproved draft is not a listing");
  assert.doesNotMatch(before, /What it does/);

  // The author's own approval screen shows it, and says it is not live.
  const screen = await fetch(`${server.baseUrl}/packs/${pack.slug}/listing`, { headers: { cookie } });
  assert.equal(screen.status, 200);
  const screenHtml = await screen.text();
  assert.match(screenHtml, /Audits a branch before it merges/);
  assert.match(screenHtml, /A noisy refactor/);
  assert.match(screenHtml, new RegExp(`/packs/${pack.slug}/listing/approve`));

  const approve = await fetch(`${server.baseUrl}/packs/${pack.slug}/listing/approve`, form(cookie));
  assert.equal(approve.status, 303);

  const after = await fetch(`${server.baseUrl}/packs/${pack.slug}`, { headers: { cookie: await cookieFor(buyer.userId) } });
  const afterHtml = await after.text();
  assert.match(afterHtml, /Audits a branch before it merges/, "approved copy reaches the buyer");
  assert.match(afterHtml, /A noisy refactor/);
});

test("a stranger can neither read nor approve another organisation's draft", async () => {
  const { pack } = await authorWithPack();
  await L.saveDraft(pack.id, DRAFT, 1);
  const stranger = await A.signUp({
    email: email(), name: "Stranger", password: "correct-horse-battery-staple", orgName: `Stranger Co ${++n}`,
  });
  const cookie = await cookieFor(stranger.userId);

  const screen = await fetch(`${server.baseUrl}/packs/${pack.slug}/listing`, { headers: { cookie }, redirect: "manual" });
  assert.equal(screen.status, 403);

  const approve = await fetch(`${server.baseUrl}/packs/${pack.slug}/listing/approve`,
    form(cookie));
  assert.ok(approve.status === 403 || approve.status === 404, `got ${approve.status}`);
  assert.equal((await P.getPack(pack.slug)).description, "", "nothing was published");
});

test("the listing rail requires a session like every other route", async () => {
  const { pack } = await authorWithPack();
  const res = await fetch(`${server.baseUrl}/packs/${pack.slug}/listing`, { redirect: "manual" });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "/login");
});

test("editing instructions marks the listing stale and changes nothing public", async () => {
  const { owner, pack, cookie } = await authorWithPack();
  await L.saveDraft(pack.id, DRAFT, 1);
  await L.approveDraft(owner.orgId, pack.slug);

  const edited = await fetch(`${server.baseUrl}/packs/${pack.slug}/edit`,
    form(cookie, editBody({ instructions: "Read the diff twice, then say what is wrong." })));
  assert.equal(edited.status, 303);

  const after = await P.getPack(pack.slug);
  assert.ok(after.listing_stale_at, "the edit stamped the listing as stale");
  assert.equal(after.description, DRAFT.description, "and published nothing new to a buyer");
  assert.deepEqual(L.listingOf(after).useCases, DRAFT.useCases);

  const page = await fetch(`${server.baseUrl}/packs/${pack.slug}`, { headers: { cookie } });
  const html = await page.text();
  assert.match(html, /Audits a branch before it merges/);
  assert.doesNotMatch(html, /stale/i, "staleness is the author's business, not the buyer's");
});

test("saving the details form without touching the method leaves the listing alone", async () => {
  const { owner, pack, cookie } = await authorWithPack();
  await L.saveDraft(pack.id, DRAFT, 1);
  await L.approveDraft(owner.orgId, pack.slug);

  const saved = await fetch(`${server.baseUrl}/packs/${pack.slug}/edit`,
    form(cookie, editBody({ tagline: "A sharper line" })));
  assert.equal(saved.status, 303);

  const after = await P.getPack(pack.slug);
  assert.equal(after.listing_stale_at, null, "the method did not change, so the listing is not stale");
  assert.equal(after.tagline, "A sharper line");
});

test("approving clears the staleness the edit left behind", async () => {
  const { owner, pack, cookie } = await authorWithPack();
  await L.saveDraft(pack.id, DRAFT, 1);
  await L.approveDraft(owner.orgId, pack.slug);
  await L.markStale(pack.id);

  const screen = await fetch(`${server.baseUrl}/packs/${pack.slug}/listing`, { headers: { cookie } });
  assert.match(await screen.text(), /no longer describes|out of date|stale/i,
    "the author is told the live copy may not describe what ships");

  await L.saveDraft(pack.id, { ...DRAFT, description: "Audits a branch, twice over." }, 2);
  const approve = await fetch(`${server.baseUrl}/packs/${pack.slug}/listing/approve`,
    form(cookie));
  assert.equal(approve.status, 303);
  const after = await P.getPack(pack.slug);
  assert.equal(after.listing_stale_at, null);
  assert.equal(after.description, "Audits a branch, twice over.");
});

test("approving with no draft to approve is a refusal, not a crash", async () => {
  const { pack, cookie } = await authorWithPack();
  const res = await fetch(`${server.baseUrl}/packs/${pack.slug}/listing/approve`,
    form(cookie));
  assert.equal(res.status, 303);
  assert.match(res.headers.get("location"), /\?err=/);
  assert.equal((await P.getPack(pack.slug)).listing_approved_at, null);
});

test("a pack whose stored scenarios are malformed still renders its page", async () => {
  const { pack, cookie } = await authorWithPack();
  const s = await sql();
  // Exactly the shape nothing wrote before this task: an object with no
  // `reached`, which the page renders `.length` off.
  await s.query("UPDATE packs SET scenarios = $1 WHERE id = $2",
    [JSON.stringify([{ brief: "A brief with nothing else" }]), pack.id]);

  const res = await fetch(`${server.baseUrl}/packs/${pack.slug}`, { headers: { cookie } });
  assert.equal(res.status, 200, "a malformed scenario must not 500 the whole pack page");
  assert.match(await res.text(), /A brief with nothing else/);
});

test("re-importing a folder marks the listing stale", async () => {
  const { pack, cookie } = await authorWithPack();
  await L.saveDraft(pack.id, DRAFT, 1);
  const s = await sql();
  await s.query("UPDATE packs SET listing_stale_at = NULL WHERE id = $1", [pack.id]);

  const res = await fetch(`${server.baseUrl}/api/packs`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      slug: pack.slug,
      files: [{ path: "agent.md", text: `---\nname: ${PACK_INPUT.name}\n---\nA different method entirely.` }],
    }),
  });
  assert.equal(res.status, 200, await res.text());
  assert.ok((await P.getPack(pack.slug)).listing_stale_at, "a folder that replaced the method dated the listing");
});
