// HTTP-level coverage for the four routes added in Task 12: GET /inbox,
// POST /threads, POST /threads/:id/reply, POST /threads/:id/publish.
//
// The domain module is covered directly in tests/node/messages.test.mjs;
// what that file cannot see is the HTTP layer in between — the session
// gate, and above all that a third organisation gets a flat 404 from the
// reply and publish routes, not a redirect that would at least confirm the
// thread exists. This file drives the real built server with `fetch`, the
// same way tests/node/social-routes.test.mjs and
// tests/node/creators-routes.test.mjs do.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, signUpCookie } from "./server-harness.mjs";

let server, A, Auth, Cr, P, sql;
let n = 0;
const email = () => `mr${++n}-${Date.now()}@example.com`;

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

const PACK_INPUT = {
  slug: "", name: "Route Thread Pack", tagline: "Something to ask a route-level question about",
  author: "A Real Expert", model: "claude-opus-5", effort: "high",
  pricePoints: 0, upgradePoints: 0, instructions: "Read it first.",
};

before(async () => {
  server = await startServer();
  process.env.DB_PATH = server.dbPath;
  process.env.DATABASE_URL = "";
  A = await import("../../dist/src/app/auth.js");
  Auth = await import("../../dist/src/app/authoring.js");
  Cr = await import("../../dist/src/app/creators.js");
  P = await import("../../dist/src/app/platform.js");
  sql = (await import("../../dist/src/app/sql.js")).sql;
  P.setRuntime(stubRuntime());
});

after(async () => { await server.stop(); });

const org = async (name) => A.signUp({ email: email(), name: "Someone", password: "correct-horse-battery-staple", orgName: name });
const cookieFor = async (userId) => `agents_session=${encodeURIComponent(await A.createSession(userId))}`;

/** A creator (with its own session cookie) and a pack attributed to them, over HTTP fixtures plus one direct SQL fixup. */
const creatorWithPack = async () => {
  const author = await org("Route Creator Co");
  const creator = await Cr.upsertCreator({
    orgId: author.orgId, userId: author.userId, handle: `route-creator-${++n}`, displayName: "Route Creator",
  });
  const slug = `route-thread-pack-${n}`;
  const pack = await Auth.createPack(author.orgId, { ...PACK_INPUT, slug });
  const s = await sql();
  await s.query("UPDATE packs SET creator_id = $1 WHERE id = $2", [creator.id, pack.id]);
  return { author, creator, pack, cookie: await cookieFor(author.userId) };
};

test("/inbox requires a session like every other route", async () => {
  const res = await fetch(`${server.baseUrl}/inbox`, { redirect: "manual" });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "/login");
});

test("a buyer opens a thread through POST /threads and the creator sees it on GET /inbox", async () => {
  const { creator, pack, cookie: creatorCookie } = await creatorWithPack();
  const buyer = await org("Route Buyer Co");
  const buyerCookie = await cookieFor(buyer.userId);

  const openRes = await fetch(`${server.baseUrl}/threads`, {
    method: "POST", redirect: "manual",
    headers: { cookie: buyerCookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      creatorId: creator.id, packId: pack.id,
      subject: "Does it write anything?", body: "Before I run this, does it ever write to disk?",
      back: `/packs/${pack.slug}`,
    }),
  });
  assert.equal(openRes.status, 303);
  assert.equal(openRes.headers.get("location"), "/inbox");

  // The creator's own inbox shows it.
  const creatorInbox = await fetch(`${server.baseUrl}/inbox`, { headers: { cookie: creatorCookie } });
  const creatorHtml = await creatorInbox.text();
  assert.match(creatorHtml, /Asked of you/);
  assert.match(creatorHtml, /Does it write anything\?/);
  assert.match(creatorHtml, /Route Buyer Co/);

  // The buyer's own inbox shows it under "Your questions".
  const buyerInbox = await fetch(`${server.baseUrl}/inbox`, { headers: { cookie: buyerCookie } });
  const buyerHtml = await buyerInbox.text();
  assert.match(buyerHtml, /Your questions/);
  assert.match(buyerHtml, /Does it write anything\?/);

  // The pack page itself shows an entry point for a buyer, but not for the author.
  const packPage = await fetch(`${server.baseUrl}/packs/${pack.slug}`, { headers: { cookie: buyerCookie } });
  assert.match(await packPage.text(), /Ask the creator/);
  const asAuthor = await fetch(`${server.baseUrl}/packs/${pack.slug}`, { headers: { cookie: creatorCookie } });
  assert.doesNotMatch(await asAuthor.text(), /Ask the creator/);
});

test("a third organisation gets a flat 404 from reply and publish, not a redirect that confirms the thread exists", async () => {
  const { creator, pack, cookie: creatorCookie } = await creatorWithPack();
  const buyer = await org("Private Route Buyer Co");
  const buyerCookie = await cookieFor(buyer.userId);

  await fetch(`${server.baseUrl}/threads`, {
    method: "POST",
    headers: { cookie: buyerCookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      creatorId: creator.id, packId: pack.id, subject: "Private", body: "Only the two of us.",
    }),
  });
  const s = await sql();
  const thread = await s.one("SELECT id FROM threads WHERE org_id = $1", [buyer.orgId]);
  assert.ok(thread, "the thread must have actually been created");

  const third = await org("Nosy Route Third Co");
  const thirdCookie = await cookieFor(third.userId);

  const replyRes = await fetch(`${server.baseUrl}/threads/${thread.id}/reply`, {
    method: "POST", redirect: "manual",
    headers: { cookie: thirdCookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ body: "let me in" }),
  });
  assert.equal(replyRes.status, 404);

  const publishRes = await fetch(`${server.baseUrl}/threads/${thread.id}/publish`, {
    method: "POST", redirect: "manual",
    headers: { cookie: thirdCookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ questionId: "x", answerId: "y" }),
  });
  assert.equal(publishRes.status, 404);

  // And the third organisation's own inbox never mentions the thread at all.
  const thirdInbox = await fetch(`${server.baseUrl}/inbox`, { headers: { cookie: thirdCookie } });
  assert.doesNotMatch(await thirdInbox.text(), /Only the two of us/);

  // The thread is untouched by the third organisation's attempts.
  const messages = await s.query("SELECT * FROM thread_messages WHERE thread_id = $1", [thread.id]);
  assert.equal(messages.length, 1, "only the original question — no reply from the third organisation landed");

  // Meanwhile, the creator can still reply normally — the thread was never damaged.
  const okReply = await fetch(`${server.baseUrl}/threads/${thread.id}/reply`, {
    method: "POST", redirect: "manual",
    headers: { cookie: creatorCookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ body: "No, it only reads." }),
  });
  assert.equal(okReply.status, 303);
});

test("a rival creator with its own profile cannot publish into a thread that is not theirs, even though the route's own if(!mine) check passes", async () => {
  // Distinct from the test above: there, the nosy organisation has no
  // creator profile at all, so the route's `if (!mine)` 404s before
  // `publishToFaq` is ever reached. Here the rival organisation *is* a
  // creator — just not this thread's — so the route calls `publishToFaq`
  // with a real, resolvable creator ID, and the privacy boundary has to be
  // the domain function's own `thread.creator_id !== creatorId` check, not
  // the route.
  const { creator, pack, cookie: creatorCookie } = await creatorWithPack();
  const buyer = await org("Rival Scenario Buyer Co");
  const buyerCookie = await cookieFor(buyer.userId);

  await fetch(`${server.baseUrl}/threads`, {
    method: "POST",
    headers: { cookie: buyerCookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      creatorId: creator.id, packId: pack.id, subject: "Rival scenario", body: "Not the rival's business.",
    }),
  });
  const s = await sql();
  const thread = await s.one("SELECT id FROM threads WHERE org_id = $1", [buyer.orgId]);

  const { cookie: rivalCookie } = await creatorWithPack();

  const publishRes = await fetch(`${server.baseUrl}/threads/${thread.id}/publish`, {
    method: "POST", redirect: "manual",
    headers: { cookie: rivalCookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ questionId: thread.id, answerId: thread.id }),
  });
  assert.equal(publishRes.status, 404);

  const pack2 = await s.one("SELECT faq FROM packs WHERE id = $1", [pack.id]);
  assert.deepEqual(JSON.parse(pack2.faq), [], "the rival's attempt left the real creator's FAQ untouched");

  // The real creator can still publish normally afterward.
  await fetch(`${server.baseUrl}/threads/${thread.id}/reply`, {
    method: "POST",
    headers: { cookie: creatorCookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ body: "Correct, not their business." }),
  });
  const [question, answer] = await s.query(
    "SELECT * FROM thread_messages WHERE thread_id = $1 ORDER BY created_at ASC", [thread.id]);
  const okPublish = await fetch(`${server.baseUrl}/threads/${thread.id}/publish`, {
    method: "POST", redirect: "manual",
    headers: { cookie: creatorCookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ questionId: question.id, answerId: answer.id }),
  });
  assert.equal(okPublish.status, 303);
});

test("POST /threads/:id/publish appends to the pack's FAQ and the asker's organisation name appears nowhere on the pack page", async () => {
  const { creator, pack, cookie: creatorCookie } = await creatorWithPack();
  const buyer = await org("Faq Route Buyer Organisation");
  const buyerCookie = await cookieFor(buyer.userId);

  await fetch(`${server.baseUrl}/threads`, {
    method: "POST",
    headers: { cookie: buyerCookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      creatorId: creator.id, packId: pack.id,
      subject: "Repo access?", body: "Does it need write access to my repository?",
    }),
  });
  const s = await sql();
  const thread = await s.one("SELECT id FROM threads WHERE org_id = $1", [buyer.orgId]);

  await fetch(`${server.baseUrl}/threads/${thread.id}/reply`, {
    method: "POST",
    headers: { cookie: creatorCookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ body: "No — read-only, always." }),
  });

  const messages = await s.query(
    "SELECT * FROM thread_messages WHERE thread_id = $1 ORDER BY created_at ASC", [thread.id]);
  const [question, answer] = messages;

  const publishRes = await fetch(`${server.baseUrl}/threads/${thread.id}/publish`, {
    method: "POST", redirect: "manual",
    headers: { cookie: creatorCookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ questionId: question.id, answerId: answer.id }),
  });
  assert.equal(publishRes.status, 303);

  // The raw stored column, not just the page: a passing page render with an
  // out-of-band leak elsewhere in the row would still be a privacy failure.
  const row = await s.one("SELECT faq FROM packs WHERE id = $1", [pack.id]);
  assert.doesNotMatch(row.faq, /Faq Route Buyer Organisation/);
  assert.doesNotMatch(row.faq, new RegExp(buyer.orgId));

  // A neutral third party (no identity of its own in play) sees the FAQ
  // entry on the pack page, quoted as asked and answered.
  const neutral = await org("Neutral Pack Viewer Co");
  const neutralCookie = await cookieFor(neutral.userId);
  const packPage = await fetch(`${server.baseUrl}/packs/${pack.slug}`, { headers: { cookie: neutralCookie } });
  const html = await packPage.text();
  assert.match(html, /Does it need write access to my repository\?/);
  assert.match(html, /No — read-only, always\./);
  assert.doesNotMatch(html, /Faq Route Buyer Organisation/);
});

test("the eleventh POST /threads from one organisation in a day is refused with a redirect carrying ?err=", async () => {
  const { creator, pack } = await creatorWithPack();
  const buyer = await org("Prolific Route Buyer Co");
  const buyerCookie = await cookieFor(buyer.userId);

  for (let i = 0; i < 10; i++) {
    const res = await fetch(`${server.baseUrl}/threads`, {
      method: "POST", redirect: "manual",
      headers: { cookie: buyerCookie, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ creatorId: creator.id, packId: pack.id, subject: `Q${i}`, body: `Body ${i}` }),
    });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get("location"), "/inbox");
  }

  const eleventh = await fetch(`${server.baseUrl}/threads`, {
    method: "POST", redirect: "manual",
    headers: { cookie: buyerCookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ creatorId: creator.id, packId: pack.id, subject: "Q11", body: "One too many" }),
  });
  assert.equal(eleventh.status, 303);
  assert.match(eleventh.headers.get("location"), /^\/inbox\?err=/);

  const s = await sql();
  const rows = await s.query("SELECT id FROM threads WHERE org_id = $1", [buyer.orgId]);
  assert.equal(rows.length, 10, "the eleventh attempt left no new thread behind");
});
