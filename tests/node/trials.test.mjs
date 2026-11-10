// Trials: a capped run on a pack the organisation does not own.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!process.env.DATABASE_URL) {
  process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "trial-")), "t.db");
}

let A, P, Pay, db, sql, provider;
let n = 0;
const email = () => `t${++n}-${Date.now()}@example.com`;

const stubRuntime = () => ({
  publishPack: async () => ({ runtimePackId: "agt_t", version: "1", skills: [], subagents: [] }),
  ensureEnvironment: async () => "env_1",
  createSession: async () => ({ id: "sesn_t", status: "running", stopReason: null,
    usage: { inputTokens: 0, outputTokens: 0, activeSeconds: 0, listCost: { amount: "0", currency: "USD" } } }),
  sendMessage: async () => {},
  streamEvents: async () => (async function* () { yield { type: "status", status: "idle", stopReason: null }; })(),
  readSession: async () => ({ id: "sesn_t", status: "idle", stopReason: null,
    usage: { inputTokens: 1, outputTokens: 10, activeSeconds: 1, listCost: { amount: "1", currency: "USD" } } }),
  raiseBudgetTo: async () => ({ id: "sesn_t", status: "idle", stopReason: null,
    usage: { inputTokens: 1, outputTokens: 10, activeSeconds: 1, listCost: { amount: "1", currency: "USD" } } }),
  confirmTool: async () => {},
  deleteSession: async () => {},
});

before(async () => {
  db = await import("../../dist/src/app/db.js");
  A = await import("../../dist/src/app/auth.js");
  P = await import("../../dist/src/app/platform.js");
  Pay = await import("../../dist/src/billing/purchases.js");
  provider = await import("../../dist/src/billing/provider.js");
  sql = (await import("../../dist/src/app/sql.js")).sql;
  await db.initDb();
  await P.seedCatalog();
  provider.setPayments(new provider.StubProvider());
  P.setRuntime(stubRuntime());
});

const org = async () => A.signUp({ email: email(), name: "Trialist", password: "correct-horse", orgName: "Trial Co" });

test("a trial runs a pack the organisation does not own", async () => {
  const { orgId, userId } = await org();
  const v = await P.publishPack("campaign-strategist");
  assert.equal(await P.entitled(orgId, v.id), false);
  const run = await P.startRun({ orgId, userId, packVersionId: v.id, trial: true });
  assert.equal(run.is_trial, 1);
  // Capped far below a real run's budget, whatever that cap is configured to be.
  const cap = await db.settingInt("trial_budget_cents");
  assert.equal(run.budget_cents, cap);
  assert.ok(cap < (await db.settingInt("default_run_budget_cents")));
});

test("a trial is capped at its configured number of turns", async () => {
  const { orgId, userId } = await org();
  const v = await P.latestVersion((await P.getPack("campaign-strategist")).id);
  const run = await P.startRun({ orgId, userId, packVersionId: v.id, trial: true });
  const cap = await db.settingInt("trial_turns");
  for (let i = 0; i < cap; i += 1) await P.sendTurn(run.id, `turn ${i}`);
  assert.equal((await P.getRun(run.id)).turn_count, cap);
  await assert.rejects(P.sendTurn(run.id, "one more"), (e) => e.name === "TrialExhaustedError");
});

test("a trial cannot be topped up — buying is the way to continue", async () => {
  const { orgId, userId } = await org();
  const v = await P.publishPack("video-brief");
  const run = await P.startRun({ orgId, userId, packVersionId: v.id, trial: true });
  await assert.rejects(P.topUp(run.id), (e) => e.name === "TrialExhaustedError");
});

test("an organisation gets one trial per pack", async () => {
  const { orgId, userId } = await org();
  const v = await P.publishPack("support-triage");
  await P.startRun({ orgId, userId, packVersionId: v.id, trial: true });
  await assert.rejects(
    P.startRun({ orgId, userId, packVersionId: v.id, trial: true }),
    (e) => e.name === "TrialAlreadyUsedError");
});

test("asking for a trial of a pack you own gives you a full run instead", async () => {
  const { orgId, userId } = await org();
  const v = await P.publishPack("guardrails");
  await Pay.beginPurchase({ orgId, userId, packVersionId: v.id, amountCents: 0, description: "free",
    baseUrl: "http://localhost:4317" });
  const run = await P.startRun({ orgId, userId, packVersionId: v.id, trial: true });
  assert.equal(run.is_trial, 0, "owning it beats trying it");
  assert.equal(run.budget_cents, await db.settingInt("default_run_budget_cents"));
});

test("a trial still costs the trialist's own points, which is what stops it being free forever", async () => {
  const points = await import("../../dist/src/billing/points.js");
  const { orgId, userId } = await org();
  const v = await P.latestVersion((await P.getPack("campaign-strategist")).id);
  const before = await points.balanceCents(orgId);
  const run = await P.startRun({ orgId, userId, packVersionId: v.id, trial: true });
  await P.sendTurn(run.id, "a brief");
  assert.equal(before - (await points.balanceCents(orgId)), 1, "the one cent the fake run cost");
});

test("the author is credited for trial runs too", async () => {
  const points = await import("../../dist/src/billing/points.js");
  const { orgId, userId } = await org();
  const pack = await P.getPack("support-triage");
  const v = (await P.latestVersion(pack.id)) ?? (await P.publishPack("support-triage"));
  const before = await points.authorEarningsTotal(pack.id);
  const run = await P.startRun({ orgId, userId, packVersionId: v.id, trial: true });
  await P.sendTurn(run.id, "three tickets");
  assert.ok((await points.authorEarningsTotal(pack.id)) > before, "a trial is still work the author's method did");
});
