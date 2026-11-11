// The taxonomy as data: the `roles` table, its seed, and the one field that
// cannot be data alone.
//
// Everything here touches the database, so it runs on Node's own runner
// against the build like the rest of `tests/node/` — and on whichever dialect
// the suite was pointed at, because the SQL is written once.
//
// The rows this file edits are shared with every other test file in the
// Postgres run (one database, `--test-concurrency=1`), so each test that
// changes a role or lists a pack puts it back afterwards.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!process.env.DATABASE_URL) {
  process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "roles-")), "t.db");
}

let db, P, R, sql;
let n = 0;

/** A listed pack carrying a role, with no author, runtime or signup involved. */
const listPackAs = async (role) => {
  const s = await sql();
  const slug = `roles-fixture-${role}-${++n}`;
  await s.query(
    `INSERT INTO packs (id, slug, name, tagline, author, price_cents, upgrade_points,
       model, instructions, status, role, created_at)
     VALUES ($1, $2, $3, 'Fixture', 'Fixture Co', 0, 0, 'claude-opus-5', 'Do it.', 'listed', $4, $5)`,
    [`pk_${slug}`, slug, `Fixture ${role}`, role, new Date().toISOString()]);
  return `pk_${slug}`;
};

const ids = (rows) => rows.map((r) => r.id);

before(async () => {
  db = await import("../../dist/src/app/db.js");
  P = await import("../../dist/src/app/platform.js");
  R = await import("../../dist/src/app/roles.js");
  ({ sql } = await import("../../dist/src/app/sql.js"));
  await db.initDb();
});

after(async () => {
  const s = await sql();
  await s.query("DELETE FROM packs WHERE slug LIKE 'roles-fixture-%'");
  for (const role of R.ROLES) await db.putRole(role);
});

test("a fresh database gets all eight roles, in the order the design gives them", async () => {
  const rows = await db.listRoles();
  assert.deepEqual(ids(rows), ["engineer", "reviewer", "designer", "writer", "growth", "operator", "security", "agent"]);
  assert.deepEqual(rows, R.ROLES, "the table holds the seed, field for field — rank and listed included");
  for (const r of rows) assert.ok(R.ICON_NAMES.includes(r.icon), `${r.id} asks for an icon views.ts draws`);
});

test("re-running bootstrap neither duplicates a role nor overwrites an edited one", async () => {
  const edited = { ...R.ROLES[0], name: "Engineer (edited)", blurb: "Edited in the database, not in the source." };
  await db.putRole(edited);

  // A genuine second bootstrap: the module's own `ready` promise is cached per
  // instance, so a cache-busted import runs it again — against the same `sql`
  // module, because db.js's own import of it carries no query string and is
  // already resolved.
  const again = await import("../../dist/src/app/db.js?bootstrap=2");
  await again.initDb();

  const rows = await db.listRoles();
  assert.equal(rows.length, 8, "ON CONFLICT DO NOTHING, so a second seed inserts nothing");
  assert.deepEqual(rows[0], edited, "an edited role survives a restart; the seed does not win it back");

  await db.putRole(R.ROLES[0]);
  assert.deepEqual((await db.listRoles())[0], R.ROLES[0]);
});

test("a role with no packs is not advertised", async () => {
  const before_ = await P.roles();
  assert.equal(before_.some((r) => r.id === "operator"), false, "nothing is tagged operator");

  await listPackAs("security");
  const after_ = await P.roles();
  const security = after_.find((r) => r.id === "security");
  assert.ok(security, "a role with a listed pack is advertised");
  assert.equal(security.count, 1);
  assert.equal(after_.some((r) => r.id === "operator"), false,
    "a job we cannot fill stays off the shelf, however the taxonomy orders it");
});

test("rank orders the nav, and the column does it — not the order of the seed", async () => {
  await listPackAs("writer");
  const shown = (await P.roles()).filter((r) => r.id === "writer" || r.id === "security");
  assert.deepEqual(ids(shown), ["writer", "security"], "writer is rank 4, security rank 7");

  await db.putRole({ ...R.ROLES.find((r) => r.id === "security"), rank: 0 });
  const reordered = (await P.roles()).filter((r) => r.id === "writer" || r.id === "security");
  assert.deepEqual(ids(reordered), ["security", "writer"], "a changed rank reorders the shelf with no deploy");

  await db.putRole(R.ROLES.find((r) => r.id === "security"));
});

test("a retired role is not advertised, and its packs keep their id", async () => {
  const packId = await listPackAs("growth");
  await db.putRole({ ...R.ROLES.find((r) => r.id === "growth"), listed: false });

  assert.equal((await P.roles()).some((r) => r.id === "growth"), false, "listed = 0 takes it off the shelf");
  const s = await sql();
  const row = await s.one("SELECT role FROM packs WHERE id = $1", [packId]);
  assert.equal(row.role, "growth", "retiring a role orphans nothing — the row is still there to re-list");
});

test("an icon views.ts cannot draw is rejected, loudly, and nothing is written", async () => {
  await assert.rejects(
    db.putRole({ id: "sparkler", name: "Sparkler", blurb: "Renders a blank tile.", icon: "sparkle", rank: 9, listed: true }),
    /no icon named "sparkle"/);

  const s = await sql();
  assert.equal(await s.one("SELECT id FROM roles WHERE id = 'sparkler'"), undefined,
    "the write is refused before the insert, not cleaned up after it");

  await assert.rejects(
    db.putRole({ ...R.ROLES[0], icon: "lightning" }),
    /no icon named "lightning"/, "an edit to an existing role is checked the same way");
  assert.deepEqual((await db.listRoles()).find((r) => r.id === R.ROLES[0].id), R.ROLES[0],
    "and leaves the role as it was");
});

// ----------------------------------------------------------- the breadcrumb
//
// `views.ts` is a pure render module with no database access, so the pack
// page's breadcrumb cannot read `platform.roles()` itself — it renders
// whatever role object it is handed. The route (`server.ts`) is the thing
// that resolves it, with `P.roleOf`, against this same table. This is the
// regression that matters: before that wiring existed, the breadcrumb read
// the `ROLES` constant directly, so renaming a role here moved the shelf's
// role strip but not this. Driving `db.putRole` → `P.roleOf` → `V.packPage`
// end to end, without touching `roles.ts` at all, is the strongest check
// that it cannot regress back to the constant.
test("renaming a role in the table changes the pack page's breadcrumb", async () => {
  const V = await import("../../dist/src/app/views.js");
  const packId = await listPackAs("engineer");
  const pack = await P.packById(packId);
  const viewer = { name: "T", email: "t@roles.test", role: "owner", orgName: "Roles Test Co" };
  const extrasFor = (role) => ({
    listing: null, stats: { runs: 0, buyers: 0, version: 1 }, permissions: [],
    files: { files: 0, skills: 0, tree: [] }, updatedAt: null, builtOn: null, refundDays: 14,
    creator: null, rating: { average: null, count: 0, distribution: [0, 0, 0, 0, 0] },
    reviews: [], mayReview: false, myReview: null, votes: { count: 0, voted: false },
    saved: false, changelog: [], role,
  });
  const render = async () => V.packPage(
    pack, undefined, false, [], 0, undefined, viewer, null, false, extrasFor(await P.roleOf("engineer")));

  const before_ = await render();
  assert.match(before_, /<a href="\/\?q=engineer">Engineer<\/a>/, "starts out reading the seeded name");

  await db.putRole({ ...R.ROLES.find((r) => r.id === "engineer"), name: "Platform Engineer" });
  try {
    const after_ = await render();
    assert.match(after_, /<a href="\/\?q=engineer">Platform Engineer<\/a>/,
      "the breadcrumb follows a rename in the table");
    assert.doesNotMatch(after_, />Engineer</, "the old, seeded name is gone, not merely joined by the new one");
  } finally {
    await db.putRole(R.ROLES.find((r) => r.id === "engineer"));
  }
});

test("a pack whose role matches no row renders the breadcrumb without a role segment", async () => {
  const V = await import("../../dist/src/app/views.js");
  const packId = await listPackAs("retired-ghost-role");
  const pack = await P.packById(packId);
  const viewer = { name: "T", email: "t2@roles.test", role: "owner", orgName: "Roles Test Co" };
  const extras = {
    listing: null, stats: { runs: 0, buyers: 0, version: 1 }, permissions: [],
    files: { files: 0, skills: 0, tree: [] }, updatedAt: null, builtOn: null, refundDays: 14,
    creator: null, rating: { average: null, count: 0, distribution: [0, 0, 0, 0, 0] },
    reviews: [], mayReview: false, myReview: null, votes: { count: 0, voted: false },
    saved: false, changelog: [], role: await P.roleOf("retired-ghost-role"),
  };
  const h = V.packPage(pack, undefined, false, [], 0, undefined, viewer, null, false, extras);
  assert.equal(extras.role, null, "an id matching no row resolves to null");
  assert.doesNotMatch(h, /\?q=retired-ghost-role/, "no role segment for a role nothing names");
  assert.match(h, /<span>Workers<\/span>/, "the rest of the breadcrumb still renders");
});

// ------------------------------------------------------- the role backfill
//
// Two packs in the catalog have a job the taxonomy has a shelf for, and both
// are defined in code — but `seedCatalog` inserts ON CONFLICT DO NOTHING, so
// a definition that gains a role never reaches the row already on the shelf.
// `ROLE_BACKFILL` is the one statement that does, and it is a data change,
// which is the kind of migration that cannot be allowed to run twice with a
// different outcome: see the points ledger the old re-running loop emptied.
//
// Run directly rather than through `initDb`, because bootstrap records it in
// `schema_migrations` and would never offer a second run to measure.

/** The two slugs, as production holds them: a row that exists, with no role. */
const seedCatalogWithEmptyRoles = async () => {
  await P.seedCatalog();
  const s = await sql();
  await s.query("UPDATE packs SET role = '' WHERE slug IN ('guardrails', 'video-brief')");
};

test("the backfill fills the two empty roles, and says nothing about the other seed packs", async () => {
  await seedCatalogWithEmptyRoles();
  const s = await sql();
  await s.exec(db.ROLE_BACKFILL);

  const roleOf = async (slug) => (await s.one("SELECT role FROM packs WHERE slug = $1", [slug])).role;
  assert.equal(await roleOf("guardrails"), "reviewer", "reads another agent's work before you act on it");
  assert.equal(await roleOf("video-brief"), "writer", "leaves a document a crew can act on");

  // Not an oversight. `campaign-strategist` is the Marketer blurb the evidence
  // killed and `support-triage` is the only example of the dropped Support
  // role, so there is no shelf either one honestly belongs on. Untagged is the
  // decision, and a role nothing is tagged with is not advertised anyway.
  assert.equal(await roleOf("campaign-strategist"), "", "no role is a decision, not a gap");
  assert.equal(await roleOf("support-triage"), "");
});

test("running the backfill twice changes nothing, and a hand-set role is never overwritten", async () => {
  await seedCatalogWithEmptyRoles();
  const s = await sql();
  const snapshot = async () => (await s.query(
    "SELECT slug, role FROM packs WHERE slug IN ('guardrails', 'video-brief') ORDER BY slug"))
    .map((r) => `${r.slug}=${r.role}`);

  await s.exec(db.ROLE_BACKFILL);
  const once = await snapshot();
  await s.exec(db.ROLE_BACKFILL);
  assert.deepEqual(await snapshot(), once, "the second run is a no-op — COALESCE(role, '') = '' is the guard");

  // Somebody disagrees in the editor. The migration must lose that argument,
  // on this boot and on every boot after it.
  await s.query("UPDATE packs SET role = 'designer' WHERE slug = 'video-brief'");
  await s.exec(db.ROLE_BACKFILL);
  await s.exec(db.ROLE_BACKFILL);
  assert.equal((await s.one("SELECT role FROM packs WHERE slug = 'video-brief'")).role, "designer",
    "a human's choice outranks the list in the migration");

  await s.query("UPDATE packs SET role = 'writer' WHERE slug = 'video-brief'");
});

test("a fresh database needs no backfill, because the definitions carry the roles", async () => {
  // `seedCatalog` writes the column now, so the two paths agree: a new
  // database gets the roles from `pack-zero.ts` and `seed-packs.ts`, an old
  // one gets them from the statement above, and neither depends on the other.
  const { SEED_PACKS } = await import("../../dist/src/packs/seed-packs.js");
  const roleOfDefinition = (slug) => SEED_PACKS.find((p) => p.slug === slug).role ?? "";
  assert.equal(roleOfDefinition("guardrails"), "reviewer");
  assert.equal(roleOfDefinition("video-brief"), "writer");
  assert.equal(roleOfDefinition("campaign-strategist"), "");
  assert.equal(roleOfDefinition("support-triage"), "");

  for (const slug of ["guardrails", "video-brief"]) {
    const role = roleOfDefinition(slug);
    assert.ok((await db.listRoles()).some((r) => r.id === role && r.listed),
      `${slug} names ${role}, which is a role the table actually lists`);
  }
});
