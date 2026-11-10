// Schedules firing against a real schema and the ordinary run path.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!process.env.DATABASE_URL) {
  process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "sch-")), "t.db");
}

let A, P, Pay, Sch, db, sql, provider, points;
let n = 0;
const email = () => `s${++n}-${Date.now()}@example.com`;
let turns = [];

/**
 * runDueSchedules deliberately does not await the turn — the ticker must not be
 * held up by a run that takes minutes — so a test that asserts the brief was
 * sent has to wait for it rather than assume it already happened.
 */
async function waitFor(predicate, what, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`timed out waiting for ${what}`);
}

const stubRuntime = () => ({
  publishPack: async () => ({ runtimePackId: "agt_s", version: "1", skills: [], subagents: [] }),
  ensureEnvironment: async () => "env_1",
  createSession: async () => ({ id: `sesn_${++n}`, status: "running", stopReason: null,
    usage: { inputTokens: 0, outputTokens: 0, activeSeconds: 0, listCost: { amount: "0", currency: "USD" } } }),
  sendMessage: async (_sid, text) => { turns.push(text); },
  streamEvents: async () => (async function* () { yield { type: "status", status: "idle", stopReason: null }; })(),
  readSession: async () => ({ id: "sesn_s", status: "idle", stopReason: null,
    usage: { inputTokens: 1, outputTokens: 5, activeSeconds: 1, listCost: { amount: "1", currency: "USD" } } }),
  raiseBudgetTo: async () => ({}), confirmTool: async () => {}, deleteSession: async () => {},
});

before(async () => {
  db = await import("../../dist/src/app/db.js");
  A = await import("../../dist/src/app/auth.js");
  P = await import("../../dist/src/app/platform.js");
  Pay = await import("../../dist/src/billing/purchases.js");
  Sch = await import("../../dist/src/app/schedules.js");
  points = await import("../../dist/src/billing/points.js");
  provider = await import("../../dist/src/billing/provider.js");
  sql = (await import("../../dist/src/app/sql.js")).sql;
  await db.initDb();
  await P.seedCatalog();
  provider.setPayments(new provider.StubProvider());
  P.setRuntime(stubRuntime());
});

async function ownedOrg(slug = "guardrails") {
  const { orgId, userId } = await A.signUp({ email: email(), name: "Sched", password: "correct-horse", orgName: "S Co" });
  const pack = await P.getPack(slug);
  const v = (await P.latestVersion(pack.id)) ?? (await P.publishPack(slug));
  await Pay.beginPurchase({ orgId, userId, packVersionId: v.id, amountCents: 0, description: "free",
    baseUrl: "http://localhost:4317" });
  return { orgId, userId, versionId: v.id };
}

test("a schedule cannot be created for a pack the organisation does not own", async () => {
  const { orgId, userId } = await A.signUp({ email: email(), name: "No", password: "correct-horse", orgName: "No Co" });
  const v = await P.publishPack("campaign-strategist");
  await assert.rejects(Sch.createSchedule({
    orgId, userId, packVersionId: v.id, name: "nope", prompt: "do it",
    cadence: "daily", hour: 9, weekday: 1,
  }), (e) => e.name === "NotEntitledError");
});

test("a schedule needs a brief", async () => {
  const { orgId, userId, versionId } = await ownedOrg();
  await assert.rejects(Sch.createSchedule({
    orgId, userId, packVersionId: versionId, name: "empty", prompt: "   ",
    cadence: "daily", hour: 9, weekday: 1,
  }), /needs a brief/);
});

test("a due schedule starts a run and sends its brief", async () => {
  turns = [];
  const { orgId, userId, versionId } = await ownedOrg();
  const sch = await Sch.createSchedule({
    orgId, userId, packVersionId: versionId, name: "hourly sweep",
    prompt: "Review yesterday's output.", cadence: "hourly", hour: 9, weekday: 1,
  });
  const before = (await P.listRuns(orgId)).length;
  const out = await Sch.runDueSchedules(new Date());
  assert.ok(out.fired >= 1);
  assert.equal((await P.listRuns(orgId)).length, before + 1);
  await waitFor(() => turns.includes("Review yesterday's output."), "the brief to be sent");
  const after = await Sch.getSchedule(sch.id);
  assert.ok(after.last_run_at, "the firing is recorded");
  assert.ok(after.last_run_id, "and it points at the run");
  assert.equal(after.last_error, null);
});

test("it does not fire the same schedule twice in one window", async () => {
  const { orgId, userId, versionId } = await ownedOrg();
  await Sch.createSchedule({
    orgId, userId, packVersionId: versionId, name: "once",
    prompt: "once please", cadence: "hourly", hour: 9, weekday: 1,
  });
  const t = new Date();
  await Sch.runDueSchedules(t);
  const mid = (await P.listRuns(orgId)).length;
  await Sch.runDueSchedules(new Date(t.getTime() + 60_000));
  assert.equal((await P.listRuns(orgId)).length, mid, "a minute later it is still not due");
});

test("a paused schedule is skipped", async () => {
  const { orgId, userId, versionId } = await ownedOrg();
  const sch = await Sch.createSchedule({
    orgId, userId, packVersionId: versionId, name: "paused",
    prompt: "should not run", cadence: "hourly", hour: 9, weekday: 1,
  });
  await Sch.setEnabled(orgId, sch.id, false);
  const before = (await P.listRuns(orgId)).length;
  await Sch.runDueSchedules(new Date());
  assert.equal((await P.listRuns(orgId)).length, before);
});

test("a schedule that cannot run records why and waits for its next window", async () => {
  const s = await sql();
  const { orgId, userId, versionId } = await ownedOrg();
  const sch = await Sch.createSchedule({
    orgId, userId, packVersionId: versionId, name: "broke",
    prompt: "do it", cadence: "hourly", hour: 9, weekday: 1,
  });
  // Drain the points so the run is refused.
  await s.query("DELETE FROM points_ledger WHERE org_id = $1", [orgId]);
  const out = await Sch.runDueSchedules(new Date());
  assert.equal(out.failed >= 1, true);
  const after = await Sch.getSchedule(sch.id);
  assert.match(after.last_error, /no points left/);
  assert.ok(after.last_run_at, "stamped anyway, so it does not retry in a loop");
  assert.equal(after.last_run_id, null);
});

test("deleting a schedule stops it", async () => {
  const { orgId, userId, versionId } = await ownedOrg();
  const sch = await Sch.createSchedule({
    orgId, userId, packVersionId: versionId, name: "doomed",
    prompt: "x", cadence: "hourly", hour: 9, weekday: 1,
  });
  await Sch.deleteSchedule(orgId, sch.id);
  assert.equal(await Sch.getSchedule(sch.id), undefined);
});

test("one organisation cannot touch another's schedule", async () => {
  const mine = await ownedOrg();
  const theirs = await ownedOrg();
  const sch = await Sch.createSchedule({
    orgId: mine.orgId, userId: mine.userId, packVersionId: mine.versionId,
    name: "mine", prompt: "x", cadence: "daily", hour: 9, weekday: 1,
  });
  await Sch.deleteSchedule(theirs.orgId, sch.id);
  assert.ok(await Sch.getSchedule(sch.id), "still there — the delete was scoped to the other org");
  await Sch.setEnabled(theirs.orgId, sch.id, false);
  assert.equal((await Sch.getSchedule(sch.id)).enabled, 1, "and so was the pause");
});
