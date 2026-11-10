// HTTP-level coverage for the three social-proof routes added in Task 10:
// POST /packs/:slug/review, POST /packs/:slug/vote, POST /packs/:slug/save.
//
// `ratingOf`, `mayReview`, `vote` and `toggleSave` are covered at the domain
// level in tests/node/social.test.mjs, and the pure rendering is covered in
// tests/packs/listing-fields.test.ts. What neither of those can see is the
// HTTP layer in between — the session gate, the redirect-with-`?err=` round
// trip on an ineligible reviewer, and that a vote posted over HTTP really
// does land clamped. This file drives the real built server with `fetch`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, signUpCookie } from "./server-harness.mjs";

let server, A, P, Auth, Pay, S, db, sql;
let n = 0;
const email = () => `sr${++n}-${Date.now()}@example.com`;

// Same stub as tests/node/social.test.mjs and tests/node/trials.test.mjs: it
// runs in *this* test process, against domain modules imported directly, not
// inside the spawned server — so it never reaches a real provider, and never
// touches the server's own runtime singleton.
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

const INPUT = {
  slug: "", name: "Route Reviewer", tagline: "Checks a diff for the obvious stuff",
  author: "A Real Expert", model: "claude-opus-5", effort: "high",
  pricePoints: 0, upgradePoints: 0, instructions: "Read the diff first.",
};

before(async () => {
  server = await startServer();
  // As in tests/node/creators-routes.test.mjs: one fixture below (a
  // completed run) has no route that can produce it, so it is built through
  // the domain module directly, onto the exact same SQLite file the server
  // is already serving from.
  process.env.DB_PATH = server.dbPath;
  process.env.DATABASE_URL = "";
  db = await import("../../dist/src/app/db.js");
  A = await import("../../dist/src/app/auth.js");
  P = await import("../../dist/src/app/platform.js");
  Auth = await import("../../dist/src/app/authoring.js");
  Pay = await import("../../dist/src/billing/purchases.js");
  S = await import("../../dist/src/app/social.js");
  sql = (await import("../../dist/src/app/sql.js")).sql;
  P.setRuntime(stubRuntime());
});

after(async () => { await server.stop(); });

const org = async (name) => A.signUp({ email: email(), name: "Someone", password: "correct-horse-battery-staple", orgName: name });

/** A fresh, published pack, authored by its own organisation. */
const freshPack = async () => {
  const slug = `route-pack-${++n}`;
  const author = await org("Route Author Co");
  const pack = await Auth.createPack(author.orgId, { ...INPUT, slug });
  const version = await P.publishPack(slug);
  return { pack, version };
};

/** A session cookie for an org/user created straight through the domain module. */
const cookieFor = async (userId) => `agents_session=${encodeURIComponent(await A.createSession(userId))}`;

test("POST /packs/:slug/save is a 404 for an unknown pack", async () => {
  const cookie = await signUpCookie(server.baseUrl);
  const res = await fetch(`${server.baseUrl}/packs/no-such-pack/save`, {
    method: "POST", headers: { cookie }, redirect: "manual",
  });
  assert.equal(res.status, 404);
});

test("POST /packs/:slug/save toggles a bookmark, and the pack page reflects it", async () => {
  const { pack } = await freshPack();
  const cookie = await signUpCookie(server.baseUrl);

  const before1 = await fetch(`${server.baseUrl}/packs/${pack.slug}`, { headers: { cookie } });
  assert.match(await before1.text(), />Save</);

  const res = await fetch(`${server.baseUrl}/packs/${pack.slug}/save`, {
    method: "POST", headers: { cookie }, redirect: "manual",
  });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), `/packs/${pack.slug}`);

  const after1 = await fetch(`${server.baseUrl}/packs/${pack.slug}`, { headers: { cookie } });
  assert.match(await after1.text(), />Saved</);

  // Toggling again removes the bookmark.
  await fetch(`${server.baseUrl}/packs/${pack.slug}/save`, { method: "POST", headers: { cookie } });
  const after2 = await fetch(`${server.baseUrl}/packs/${pack.slug}`, { headers: { cookie } });
  assert.match(await after2.text(), />Save</);
});

test("POST /packs/:slug/vote clamps an out-of-range value over the wire, not just in the unit test", async () => {
  const { pack } = await freshPack();
  const cookie = await signUpCookie(server.baseUrl);

  const res = await fetch(`${server.baseUrl}/packs/${pack.slug}/vote`, {
    method: "POST", redirect: "manual",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ value: "99" }),
  });
  assert.equal(res.status, 303);

  const row = await (await sql()).one(
    "SELECT value FROM pack_votes WHERE pack_id = $1", [pack.id],
  );
  assert.equal(Number(row.value), 1, "the route hands the raw form value straight to vote(), which clamps it");

  const page = await fetch(`${server.baseUrl}/packs/${pack.slug}`, { headers: { cookie } });
  assert.match(await page.text(), /Marked useful/);
});

test("POST /packs/:slug/review redirects with ?err= when the viewer has never run the pack", async () => {
  const { pack } = await freshPack();
  const cookie = await signUpCookie(server.baseUrl);

  const res = await fetch(`${server.baseUrl}/packs/${pack.slug}/review`, {
    method: "POST", redirect: "manual",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ rating: "5", body: "Great!", byline: "Someone" }),
  });
  assert.equal(res.status, 303);
  const location = res.headers.get("location");
  assert.match(location, new RegExp(`^/packs/${pack.slug}\\?err=`));
  assert.match(decodeURIComponent(location), /completed a run/);

  // And the page itself shows no form, with the reason why.
  const page = await fetch(`${server.baseUrl}/packs/${pack.slug}`, { headers: { cookie } });
  const html = await page.text();
  assert.match(html, /You can rate this once you have run it\./);
  assert.doesNotMatch(html, new RegExp(`action="/packs/${pack.slug}/review"`));
});

test("POST /packs/:slug/review succeeds once the organisation has a completed, non-trial run, and the page shows it", async () => {
  const { pack, version } = await freshPack();
  const buyer = await org("Route Buyer Co");
  await Pay.beginPurchase({
    orgId: buyer.orgId, userId: buyer.userId, packVersionId: version.id,
    amountCents: 0, description: "x", baseUrl: server.baseUrl,
  });
  const run = await P.startRun({ orgId: buyer.orgId, userId: buyer.userId, packVersionId: version.id });
  await (await sql()).query("UPDATE runs SET ended_at = $1 WHERE id = $2", [db.now(), run.id]);
  assert.equal(await S.mayReview(buyer.orgId, pack.id), true);

  const cookie = await cookieFor(buyer.userId);
  const res = await fetch(`${server.baseUrl}/packs/${pack.slug}/review`, {
    method: "POST", redirect: "manual",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ rating: "5", body: "Did exactly what it said.", byline: "Route Buyer Co" }),
  });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), `/packs/${pack.slug}`);

  const page = await fetch(`${server.baseUrl}/packs/${pack.slug}`, { headers: { cookie } });
  const html = await page.text();
  assert.match(html, /Did exactly what it said\./);
  assert.match(html, /Route Buyer Co/);
  // Below the threshold — one rating — there is still no average anywhere.
  assert.doesNotMatch(html, /\d(\.\d)?\s*\/\s*5/);

  // Re-submitting edits the same review rather than creating a second one.
  const again = await fetch(`${server.baseUrl}/packs/${pack.slug}/review`, {
    method: "POST", redirect: "manual",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ rating: "2", body: "Revised my view after a second run.", byline: "Route Buyer Co" }),
  });
  assert.equal(again.status, 303);
  const rows = await (await sql()).query(
    "SELECT * FROM pack_reviews WHERE pack_id = $1 AND org_id = $2", [pack.id, buyer.orgId],
  );
  assert.equal(rows.length, 1, "one organisation, one review, editable forever");
  assert.equal(Number(rows[0].rating), 2);

  const editPage = await fetch(`${server.baseUrl}/packs/${pack.slug}`, { headers: { cookie } });
  assert.match(await editPage.text(), /Update your review/);
});
