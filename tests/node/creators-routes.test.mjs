// HTTP-level coverage for the three /creators routes added in Task 8:
// GET /creators/:handle, GET /creators/me, POST /creators/me.
//
// `creatorPage` and `creatorEditorPage` are pure functions, tested as such in
// tests/packs/listing-fields.test.ts; the domain module underneath is
// covered in tests/node/creators.test.mjs. What neither of those can see is
// the HTTP layer in between — the session gate, `ownerOnly()`, a 404 for an
// unknown handle, and the redirect+`?err=` round trip a browser actually
// gets on a handle collision. This file drives the real built server with
// `fetch` to pin that down.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, signUpCookie } from "./server-harness.mjs";

let server, A, sql;

before(async () => {
  server = await startServer();
  // One fixture below (a non-owner session) has no route that can hand back
  // a usable invite token — the team page only ever shows a truncated one —
  // so it is built through the domain module directly, onto the exact same
  // SQLite file the server is already serving from.
  process.env.DB_PATH = server.dbPath;
  process.env.DATABASE_URL = "";
  A = await import("../../dist/src/app/auth.js");
  sql = (await import("../../dist/src/app/sql.js")).sql;
});

after(async () => { await server.stop(); });

test("an unknown handle is a 404, not a crash", async () => {
  const cookie = await signUpCookie(server.baseUrl);
  const res = await fetch(`${server.baseUrl}/creators/no-such-handle`, { headers: { cookie } });
  assert.equal(res.status, 404);
});

test("a signed-in viewer with no creator record gets the setup form at /creators/me", async () => {
  const cookie = await signUpCookie(server.baseUrl);
  const res = await fetch(`${server.baseUrl}/creators/me`, { headers: { cookie } });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Set up your creator profile/);
  assert.doesNotMatch(html, /Edit your creator profile/);
});

test("/creators/me requires a session like every other route", async () => {
  const res = await fetch(`${server.baseUrl}/creators/me`, { redirect: "manual" });
  // No cookie at all: the session gate redirects a GET to /login.
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "/login");
});

test("POST /creators/me is refused to anyone but the organisation's owner", async () => {
  const n = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { userId, orgId } = await A.signUp({
    email: `owner-${n}@example.com`, name: "Owner", password: "correct-horse-battery-staple", orgName: `Studio ${n}`,
  });
  // The personal tier a fresh organisation starts on has exactly one seat —
  // bumping the tier is how every other test in this repo gets a second
  // member in to invite.
  const s = await sql();
  await s.query("UPDATE orgs SET tier = 'team' WHERE id = $1", [orgId]);
  const inv = await A.invite({ orgId, email: `member-${n}@example.com`, role: "member", invitedBy: userId });
  const memberToken = await A.acceptInvite(inv.token, "Member", "another-correct-password");
  // The cookie name mirrors `COOKIE` in src/app/server.ts, which is not
  // exported for a test to import.
  const cookie = `agents_session=${encodeURIComponent(memberToken)}`;

  const res = await fetch(`${server.baseUrl}/creators/me`, {
    method: "POST", redirect: "manual",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ handle: `sneaky-${n}`, displayName: "Sneaky" }),
  });
  assert.equal(res.status, 403);

  // And a GET from that same member shows the explanation rather than a
  // form that would just 403 on submit — this organisation never set up a
  // creator profile, so it's the "nothing set up yet" message, not the
  // "only an owner can change this" one. (The page's own sign-out form in
  // the chrome is on every authenticated page, so the check is specifically
  // for the editor's own form, not any <form> at all.)
  const getRes = await fetch(`${server.baseUrl}/creators/me`, { headers: { cookie } });
  assert.equal(getRes.status, 200);
  const html = await getRes.text();
  assert.doesNotMatch(html, /action="\/creators\/me"/);
  assert.match(html, /has not set up a creator profile yet/);
});

test("saving a profile redirects to its public page, and a taken handle comes back as ?err= on the editor", async () => {
  const n = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const handle = `studio-${n}`;
  const cookieA = await signUpCookie(server.baseUrl, { email: `a-${n}@example.com` });

  const resA = await fetch(`${server.baseUrl}/creators/me`, {
    method: "POST", redirect: "manual",
    headers: { cookie: cookieA, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ handle, displayName: "Studio A", bio: "", avatar: "", links: "" }),
  });
  assert.equal(resA.status, 303);
  assert.equal(resA.headers.get("location"), `/creators/${handle}`);

  const page = await fetch(`${server.baseUrl}/creators/${handle}`, { headers: { cookie: cookieA } });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Studio A/);

  // A second organisation trying to take the same handle is sent back to the
  // editor with the domain error in the query string, not a 500.
  const cookieB = await signUpCookie(server.baseUrl, { email: `b-${n}@example.com` });
  const resB = await fetch(`${server.baseUrl}/creators/me`, {
    method: "POST", redirect: "manual",
    headers: { cookie: cookieB, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ handle, displayName: "Studio B" }),
  });
  assert.equal(resB.status, 303);
  const location = resB.headers.get("location");
  assert.match(location, /^\/creators\/me\?err=/);
  assert.match(decodeURIComponent(location), /already taken/);

  // Following that redirect shows the error on the editor page itself.
  const retry = await fetch(`${server.baseUrl}${location}`, { headers: { cookie: cookieB } });
  assert.equal(retry.status, 200);
  assert.match(await retry.text(), /already taken/);
});
