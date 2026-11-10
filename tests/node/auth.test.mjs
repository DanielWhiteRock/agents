// Auth, organisations, seats and roles against a real schema.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!process.env.DATABASE_URL) {
  process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "auth-")), "t.db");
}

let A, db, sql;
let n = 0;
const email = () => `user${++n}-${Date.now()}@example.com`;

before(async () => {
  db = await import("../../dist/src/app/db.js");
  A = await import("../../dist/src/app/auth.js");
  sql = (await import("../../dist/src/app/sql.js")).sql;
  await db.initDb();
});

test("a password verifies only against itself", () => {
  const hash = A.hashPassword("correct-horse");
  assert.equal(A.verifyPassword("correct-horse", hash), true);
  assert.equal(A.verifyPassword("Correct-horse", hash), false);
  assert.equal(A.verifyPassword("", hash), false);
  assert.equal(A.verifyPassword("correct-horse", null), false);
  assert.equal(A.verifyPassword("correct-horse", "garbage"), false);
});

test("the same password hashes differently every time", () => {
  assert.notEqual(A.hashPassword("correct-horse"), A.hashPassword("correct-horse"));
});

test("a short password is refused", () => {
  assert.throws(() => A.hashPassword("short"), /at least 8/);
});

test("signing up creates an organisation and makes you its owner", async () => {
  const e = email();
  const { userId, orgId, token } = await A.signUp({ email: e, name: "Owner", password: "correct-horse", orgName: "Acme" });
  const session = await A.sessionFromToken(token);
  assert.equal(session.user.id, userId);
  assert.equal(session.orgId, orgId);
  assert.equal(session.role, "owner");
});

test("an email can only be claimed once", async () => {
  const e = email();
  await A.signUp({ email: e, name: "A", password: "correct-horse", orgName: "A" });
  await assert.rejects(A.signUp({ email: e, name: "B", password: "correct-horse", orgName: "B" }), /already has an account/);
});

test("a destroyed session stops working", async () => {
  const { token } = await A.signUp({ email: email(), name: "X", password: "correct-horse", orgName: "X" });
  assert.ok(await A.sessionFromToken(token));
  await A.destroySession(token);
  assert.equal(await A.sessionFromToken(token), null);
});

test("a nonsense token is not a session", async () => {
  assert.equal(await A.sessionFromToken("nope"), null);
  assert.equal(await A.sessionFromToken(undefined), null);
});

test("seats are enforced, and the personal tier has exactly one", async () => {
  const { orgId, userId } = await A.signUp({ email: email(), name: "Solo", password: "correct-horse", orgName: "Solo" });
  assert.equal(await A.seatLimit(orgId), 1);
  assert.equal(await A.seatsUsed(orgId), 1);
  await assert.rejects(
    A.invite({ orgId, email: email(), role: "member", invitedBy: userId }),
    (e) => e.name === "SeatsExhaustedError");
});

test("an invitation can be accepted once, and joins the inviter's organisation", async () => {
  const { orgId, userId } = await A.signUp({ email: email(), name: "Boss", password: "correct-horse", orgName: "Team" });
  const s = await sql();
  await s.query("UPDATE orgs SET tier = 'team' WHERE id = $1", [orgId]);
  const inviteeEmail = email();
  const inv = await A.invite({ orgId, email: inviteeEmail, role: "member", invitedBy: userId });

  const token = await A.acceptInvite(inv.token, "Mate", "another-password");
  const session = await A.sessionFromToken(token);
  assert.equal(session.orgId, orgId, "the invitee lands in the inviting organisation");
  assert.equal(session.role, "member");
  assert.equal(session.user.email, inviteeEmail);

  await assert.rejects(A.acceptInvite(inv.token, "Again", "another-password"), /not valid/);
});

test("an organisation can never be left without an owner", async () => {
  const { orgId, userId } = await A.signUp({ email: email(), name: "Only", password: "correct-horse", orgName: "Only" });
  await assert.rejects(A.setRole(orgId, userId, "member"), /at least one owner/);
  await assert.rejects(A.removeMember(orgId, userId), /at least one owner/);
});

test("removing a member kills their sessions", async () => {
  const { orgId, userId } = await A.signUp({ email: email(), name: "Boss2", password: "correct-horse", orgName: "T2" });
  const s = await sql();
  await s.query("UPDATE orgs SET tier = 'team' WHERE id = $1", [orgId]);
  const inv = await A.invite({ orgId, email: email(), role: "member", invitedBy: userId });
  const token = await A.acceptInvite(inv.token, "Leaver", "another-password");
  const session = await A.sessionFromToken(token);
  await A.removeMember(orgId, session.user.id);
  assert.equal(await A.sessionFromToken(token), null);
});

test("a new organisation starts with its tier's monthly grant", async () => {
  const points = await import("../../dist/src/billing/points.js");
  const { orgId } = await A.signUp({ email: email(), name: "Fresh", password: "correct-horse", orgName: "Fresh" });
  const buckets = await points.balanceByBucket(orgId);
  assert.equal(buckets.grant, 120_000, "the personal tier's 120 points, in thousandths");
  assert.equal(buckets.topup, 0);
  assert.ok((await points.balanceMillipoints(orgId)) > 0, "a new org can actually run something");
});

test("a migration that changes data runs once, however many times we boot", async () => {
  // A one-time cleanup here once deleted every row of the points ledger, and
  // because migrations re-ran on every start it did it again at each boot.
  // Nothing destructive is safe without a record of what already happened.
  const points = await import("../../dist/src/billing/points.js");
  const s = await sql();

  const { orgId } = await A.signUp({
    email: `mig-${Date.now()}@example.com`, password: "correct-horse-battery",
    name: "Mig", orgName: "Mig Ltd",
  });
  const before = await points.balanceMillipoints(orgId);
  assert.ok(before > 0, "a new organisation has its grant");

  const applied = (await s.query("SELECT COUNT(*) AS n FROM schema_migrations"))[0];
  await db.initDb();
  await db.initDb();

  assert.equal(await points.balanceMillipoints(orgId), before,
    "booting again does not move the ledger");
  const after = (await s.query("SELECT COUNT(*) AS n FROM schema_migrations"))[0];
  assert.equal(Number(after.n), Number(applied.n), "and does not re-record anything");
});
