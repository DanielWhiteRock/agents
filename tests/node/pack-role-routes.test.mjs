// The surface that puts a pack in a role.
//
// The taxonomy became data and the shelf counts it, but for a while nothing
// could write `packs.role` except `importPack` reading an `agent.md`: the
// editor had no field, `packFields` dropped it, and `seedCatalog` never
// updates a row that exists. The catalog showed two role tiles out of eight
// for that reason and not for want of packs.
//
// So what is pinned here is the whole path a human takes — the select is
// rendered from the `roles` TABLE, what they pick is stored, and "no role" is
// something they can actually choose. Driven with `fetch` against the real
// built server, like the other `*-routes` files; the editor route is not
// exported, so HTTP is the only way to reach it.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./server-harness.mjs";

let server, A, Auth, P, db, sql;
let n = 0;
const email = () => `pr${++n}-${Date.now()}@example.com`;

const INSTRUCTIONS = "Read the thing, then say what not to trust in it.";

const PACK_INPUT = {
  slug: "", name: "Role Route Pack", tagline: "A pack that needs a job",
  author: "A Real Expert", model: "claude-opus-5", effort: "high",
  pricePoints: 0, upgradePoints: 0, instructions: INSTRUCTIONS,
};

before(async () => {
  server = await startServer();
  process.env.DB_PATH = server.dbPath;
  process.env.DATABASE_URL = "";
  A = await import("../../dist/src/app/auth.js");
  Auth = await import("../../dist/src/app/authoring.js");
  P = await import("../../dist/src/app/platform.js");
  db = await import("../../dist/src/app/db.js");
  sql = (await import("../../dist/src/app/sql.js")).sql;
});

after(async () => { await server.stop(); });

const cookieFor = async (userId) => `agents_session=${encodeURIComponent(await A.createSession(userId))}`;

/** An owner, their pack, and a session cookie for them. */
const authorWithPack = async (over = {}) => {
  const owner = await A.signUp({
    email: email(), name: "Author", password: "correct-horse-battery-staple", orgName: `Role Co ${++n}`,
  });
  const slug = `role-route-${n}`;
  const pack = await Auth.createPack(owner.orgId, { ...PACK_INPUT, slug, ...over });
  return { owner, pack, cookie: await cookieFor(owner.userId) };
};

/** A form POST, the way the browser sends one. */
const form = (cookie, fields = {}) => ({
  method: "POST", redirect: "manual",
  headers: { "content-type": "application/x-www-form-urlencoded", cookie },
  body: new URLSearchParams(fields),
});

/** The details form's own fields, as the browser submits them — role included. */
const editBody = (over = {}) => ({
  name: PACK_INPUT.name, tagline: PACK_INPUT.tagline, author: PACK_INPUT.author,
  model: PACK_INPUT.model, effort: "high", pricePoints: "0", upgradePoints: "0",
  instructions: INSTRUCTIONS, pinnedModels: "", payoutEmail: "", role: "", ...over,
});

const roleOf = async (slug) => (await P.getPack(slug)).role;

test("the editor offers the roles the table holds, and a way to pick none", async () => {
  const { pack, cookie } = await authorWithPack();
  const res = await fetch(`${server.baseUrl}/packs/${pack.slug}/edit`, { headers: { cookie } });
  assert.equal(res.status, 200);
  const html = await res.text();

  assert.match(html, /<select name="role">/, "there is a field for the job at all");
  for (const role of await db.listRoles()) {
    assert.match(html, new RegExp(`<option value="${role.id}"`), `${role.id} is offered`);
  }
  assert.match(html, /<option value=""( selected)?>\(no role\)<\/option>/,
    "no role is a choice, because four packs on the catalog are deliberately in none");
  assert.match(html, /<option value="" selected>/, "a pack with no role shows none selected");
});

test("the select is rendered from the table, not from the ROLES constant", async () => {
  const { pack, cookie } = await authorWithPack();
  const seed = (await db.listRoles()).find((r) => r.id === "writer");
  await db.putRole({ ...seed, name: "Writer (renamed in the table)" });
  try {
    const html = await (await fetch(`${server.baseUrl}/packs/${pack.slug}/edit`, { headers: { cookie } })).text();
    assert.match(html, /Writer \(renamed in the table\)/, "a renamed row reaches the editor with no deploy");
    assert.doesNotMatch(html, /<option value="writer">Writer<\/option>/, "and the seeded name is gone");
  } finally {
    await db.putRole(seed);
  }
});

test("a retired role is not offered, but a pack already in one keeps it on save", async () => {
  const { pack, cookie } = await authorWithPack({ role: "growth" });
  const seed = (await db.listRoles()).find((r) => r.id === "growth");
  await db.putRole({ ...seed, listed: false });
  try {
    const html = await (await fetch(`${server.baseUrl}/packs/${pack.slug}/edit`, { headers: { cookie } })).text();
    assert.match(html, /<option value="growth" selected>growth — no longer listed<\/option>/,
      "the role it has is shown, labelled, so Save cannot silently re-file it");

    // The browser submits whatever is selected, which is that same option.
    const saved = await fetch(`${server.baseUrl}/packs/${pack.slug}/edit`, form(cookie, editBody({ role: "growth" })));
    assert.equal(saved.status, 303);
    assert.equal(await roleOf(pack.slug), "growth", "opening the editor and saving changed nothing");
  } finally {
    await db.putRole(seed);
  }
});

test("picking a role stores it, and the shelf then advertises that job", async () => {
  const { pack, cookie } = await authorWithPack();
  assert.equal(await roleOf(pack.slug), "", "starts in no role");

  const res = await fetch(`${server.baseUrl}/packs/${pack.slug}/edit`, form(cookie, editBody({ role: "reviewer" })));
  assert.equal(res.status, 303);
  assert.equal(await roleOf(pack.slug), "reviewer", "the select persists — this is the whole gap");

  // A draft is not on the shelf, so the tile needs the pack listed. Written
  // straight to the column: approval is somebody else's route and not what is
  // under test.
  const s = await sql();
  await s.query("UPDATE packs SET status = 'listed' WHERE slug = $1", [pack.slug]);
  const tile = (await P.roles()).find((r) => r.id === "reviewer");
  assert.ok(tile, "a role with a pack in it is advertised");
  assert.ok(tile.count >= 1);
  await s.query("UPDATE packs SET status = 'draft' WHERE slug = $1", [pack.slug]);
});

test("choosing no role clears one, and a form that carries no role field keeps it", async () => {
  const { pack, cookie } = await authorWithPack({ role: "reviewer" });

  // A caller with no opinion — an older form, a route posting only details —
  // must not wipe a role somebody set.
  const quiet = editBody();
  delete quiet.role;
  await fetch(`${server.baseUrl}/packs/${pack.slug}/edit`, form(cookie, quiet));
  assert.equal(await roleOf(pack.slug), "reviewer", "an absent field is not an instruction to blank it");

  const cleared = await fetch(`${server.baseUrl}/packs/${pack.slug}/edit`, form(cookie, editBody({ role: "" })));
  assert.equal(cleared.status, 303);
  assert.equal(await roleOf(pack.slug), "",
    "no role stays reachable — it is the honest state for work no surviving role describes");
});

test("a new pack can be written straight into a role", async () => {
  const owner = await A.signUp({
    email: email(), name: "Author", password: "correct-horse-battery-staple", orgName: `Role Co ${++n}`,
  });
  const cookie = await cookieFor(owner.userId);
  const slug = `role-route-new-${n}`;
  const res = await fetch(`${server.baseUrl}/authors/packs`, form(cookie, editBody({ slug, role: "designer" })));
  assert.equal(res.status, 303);
  assert.equal(await roleOf(slug), "designer");
});
