// The upgrade path: an existing database meeting the current build.
//
// Every other test in this project starts from an empty store, which is the
// one case a deploy never is. That gap cost a production outage: `seedCatalog`
// stopped passing `packs.price_cents` and relied on the `DEFAULT 0` the schema
// declares — a default `CREATE TABLE IF NOT EXISTS` cannot add to a table that
// already exists. On a fresh database the insert worked. On the live one it
// threw `NOT NULL constraint failed: packs.price_cents`, in `main()`, after
// `initDb()` had already renamed `delta_cents` to `delta_millipoints`. So the
// deploy never became healthy, the previous build kept serving, and that build
// asked a migrated database for a column it no longer had: `column
// "delta_cents" does not exist`, on every signed-in page.
//
// So this file starts from the schema as it stood before that rename, puts
// rows in it, and points the real built server at it. SQLite, like the other
// HTTP tests here — `startServer` clears `DATABASE_URL` so the server always
// runs on its own file — and the SQL is one dialect, so the same statements
// are what Postgres gets.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { startServer } from "./server-harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The historical schema, with `db.ts`'s dialect tokens resolved for SQLite. */
const OLD_SCHEMA = readFileSync(join(HERE, "fixtures", "schema-pre-millipoints.sql"), "utf8")
  .split("{REAL}").join("REAL")
  .split("{PK_SERIAL}").join("INTEGER PRIMARY KEY AUTOINCREMENT");

const PASSWORD = "correct-horse-battery-staple";
const EMAIL = "incumbent@upgrade.test";

// The app's own hasher, so the fixture user's password verifies exactly as a
// real one does. Importing the module runs nothing — it does not touch a
// database until something calls into it.
const { hashPassword } = await import("../../dist/src/app/auth.js");
const hash = hashPassword(PASSWORD);

/**
 * A database in the old shape, with data in it.
 *
 * Rows in all four tables the rename has to carry — the ledger it converts,
 * and the orgs, users and packs that have to still be readable afterwards. The
 * ledger is written in the old unit: 120 whole points, which the migration
 * must turn into 120,000 millipoints and must not turn into 120,000,000.
 */
function oldShapedDatabase() {
  const path = join(mkdtempSync(join(tmpdir(), "upgrade-")), "t.db");
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  db.exec(OLD_SCHEMA);
  // Proof there is no migration bookkeeping to lean on: the table that records
  // applied migrations arrived with the rename itself, so a database old
  // enough to need the rename has never heard of it.
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'schema_migrations'").get().n, 0,
    "the fixture must predate migration bookkeeping, or it is not the old shape");
  assert.ok(
    db.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('points_ledger') WHERE name = 'delta_cents'")
      .get().n === 1,
    "the fixture must still count delta_cents, or there is nothing to upgrade");

  db.prepare(`INSERT INTO orgs (id, name, tier, concurrency_limit, created_at)
    VALUES ('org_old', 'Incumbent Ltd', 'personal', 5, '2026-01-01T00:00:00.000Z')`).run();
  db.prepare(`INSERT INTO users (id, org_id, email, name, role, password_hash, created_at)
    VALUES ('usr_old', 'org_old', ?, 'Incumbent Owner', 'owner', ?, '2026-01-01T00:00:00.000Z')`)
    .run(EMAIL, hash);
  db.prepare(`INSERT INTO packs (id, slug, name, tagline, author, price_cents, upgrade_points,
      model, instructions, status, created_at)
    VALUES ('pk_old', 'incumbent-pack', 'Incumbent', 'Shipped before the rename', 'alphaCEO',
      24900, 0, 'claude-opus-5', 'Do the thing.', 'listed', '2026-01-02T00:00:00.000Z')`).run();
  for (const [id, bucket, delta, created] of [
    ["pl_grant", "grant", 120, "2026-01-01T00:00:00.000Z"],
    ["pl_topup", "topup", 500, "2026-01-05T00:00:00.000Z"],
    ["pl_earn", "earning", 37, "2026-01-06T00:00:00.000Z"],
    ["pl_spend", "grant", -20, "2026-01-07T00:00:00.000Z"],
  ]) {
    db.prepare(`INSERT INTO points_ledger (id, org_id, bucket, delta_cents, reason, created_at)
      VALUES (?, 'org_old', ?, ?, 'before the rename', ?)`).run(id, bucket, delta, created);
  }
  db.close();
  return path;
}

/** Columns as the database actually has them: name, type, NOT NULL, default. */
function shapeOf(path) {
  const db = new DatabaseSync(path);
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all().map((r) => r.name);
  const out = [];
  for (const t of tables) {
    for (const c of db.prepare(`SELECT name, type, "notnull", dflt_value FROM pragma_table_info(?)`).all(t)) {
      out.push(`${t}.${c.name} | ${c.type} | notnull=${c.notnull} | default=${c.dflt_value ?? "-"}`);
    }
  }
  db.close();
  // Sorted, not in declaration order: a migrated column is appended to the end
  // of its table while a fresh one sits where the schema puts it, and that
  // difference is not a difference that matters.
  return out.sort();
}

const ledgerTotal = (path) => {
  const db = new DatabaseSync(path);
  const row = db.prepare("SELECT COALESCE(SUM(delta_millipoints), 0) AS t FROM points_ledger").get();
  db.close();
  return Number(row.t);
};

/** The session a browser gets from the real login form. */
async function logIn(baseUrl) {
  const res = await fetch(`${baseUrl}/login`, {
    method: "POST", redirect: "manual",
    body: new URLSearchParams({ email: EMAIL, password: PASSWORD }),
  });
  const cookie = res.headers.get("set-cookie");
  assert.ok(cookie, `the incumbent owner could not sign in (status ${res.status})`);
  return cookie.split(";")[0];
}

test("the current build boots on a pre-rename database and serves a page that reads the ledger", async () => {
  const dbPath = oldShapedDatabase();
  // `startServer` throws with the server's stderr if it exits before answering
  // /healthz, which is exactly the failure this test exists to catch: the
  // outage was a boot crash, not a bad response.
  const srv = await startServer({ dbPath });
  try {
    const health = await (await fetch(`${srv.baseUrl}/healthz`)).json();
    assert.equal(health.ok, true);

    const cookie = await logIn(srv.baseUrl);
    const res = await fetch(`${srv.baseUrl}/`, { headers: { cookie } });
    const body = await res.text();
    assert.equal(res.status, 200, "the catalog must render for an incumbent owner");
    assert.ok(!body.includes("Something broke"), `the catalog rendered an error: ${body.slice(0, 400)}`);
    // The balance in the header is the ledger read back through the new
    // column name, converted: 100 points' worth of grant plus 500 topped up
    // plus 37 earned, in whole points.
    assert.match(body, /class="bal"[^>]*title="637 points left"/,
      "the header must show the converted balance");

    const ledger = await fetch(`${srv.baseUrl}/ledger`, { headers: { cookie } });
    const ledgerBody = await ledger.text();
    assert.equal(ledger.status, 200);
    assert.ok(!ledgerBody.includes("Something broke"), ledgerBody.slice(0, 400));
  } finally {
    await srv.stop();
  }

  assert.equal(ledgerTotal(dbPath), 637_000, "the ledger is converted, once");
});

test("restarting on the upgraded database does not convert it twice", async () => {
  const dbPath = oldShapedDatabase();
  const first = await startServer({ dbPath });
  await first.stop();
  const total = ledgerTotal(dbPath);
  assert.equal(total, 637_000);

  for (let i = 0; i < 2; i += 1) {
    const srv = await startServer({ dbPath });
    try {
      const cookie = await logIn(srv.baseUrl);
      const res = await fetch(`${srv.baseUrl}/`, { headers: { cookie } });
      assert.equal(res.status, 200, "a restart must keep serving");
    } finally {
      await srv.stop();
    }
    assert.equal(ledgerTotal(dbPath), total, `restart ${i + 1} moved the ledger`);
  }
});

test("an upgraded database ends up with the same shape as a fresh one", async () => {
  const upgradedPath = oldShapedDatabase();
  const upgraded = await startServer({ dbPath: upgradedPath });
  await upgraded.stop();

  const fresh = await startServer();
  await fresh.stop();

  // Column for column, including defaults. This is the assertion the outage
  // needed: `packs.price_cents` was NOT NULL with a default on a fresh
  // database and NOT NULL with none on an upgraded one, and nothing said so.
  // A schema change that a migration does not reproduce on an existing
  // database shows up here, whichever column it is.
  assert.deepEqual(shapeOf(upgradedPath), shapeOf(fresh.dbPath));
});
