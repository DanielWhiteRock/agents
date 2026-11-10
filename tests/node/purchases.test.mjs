// Purchases, refunds and author payouts against a real schema.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!process.env.DATABASE_URL) {
  process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "pur-")), "t.db");
}

let A, P, Pay, db, sql, points, provider;
let n = 0;
const email = () => `buyer${++n}-${Date.now()}@example.com`;

/** A provider that always needs the buyer to approve first. */
function redirectingProvider() {
  return {
    name: "test-redirect", real: true,
    charge: async (r) => ({ ref: `ext_${r.reference}`, status: "redirect", approveUrl: `https://pay.example/${r.reference}` }),
    capture: async () => ({ status: "paid" }),
    refund: async () => {},
    payout: async (r) => ({ ref: `payout_${r.reference}` }),
  };
}

before(async () => {
  db = await import("../../dist/src/app/db.js");
  A = await import("../../dist/src/app/auth.js");
  P = await import("../../dist/src/app/platform.js");
  Pay = await import("../../dist/src/billing/purchases.js");
  points = await import("../../dist/src/billing/points.js");
  provider = await import("../../dist/src/billing/provider.js");
  sql = (await import("../../dist/src/app/sql.js")).sql;
  await db.initDb();
  await P.seedCatalog();
  P.setRuntime({
    publishPack: async () => ({ runtimePackId: "agt_test", version: "1" }),
    ensureEnvironment: async () => "env_1",
  });
});

async function org() {
  const { orgId, userId } = await A.signUp({ email: email(), name: "Buyer", password: "correct-horse", orgName: "Buyer Co" });
  return { orgId, userId };
}
const ARGS = { baseUrl: "http://localhost:4317" };

test("a free pack grants an entitlement without creating a purchase", async () => {
  provider.setPayments(new provider.StubProvider());
  const { orgId, userId } = await org();
  const v = await P.publishPack("guardrails"); // price 0
  const out = await Pay.beginPurchase({ orgId, userId, packVersionId: v.id, amountCents: 0, description: "free", ...ARGS });
  assert.equal(out.status, "granted");
  assert.equal(out.purchaseId, null);
  assert.equal(await P.entitled(orgId, v.id), true);
  assert.equal((await Pay.purchasesFor(orgId)).length, 0, "nothing to charge, so nothing recorded");
});

test("a paid pack is only entitled once the purchase is paid", async () => {
  provider.setPayments(redirectingProvider());
  const { orgId, userId } = await org();
  const v = await P.publishPack("campaign-strategist"); // 24900
  const out = await Pay.beginPurchase({ orgId, userId, packVersionId: v.id, amountCents: 24900, description: "x", ...ARGS });

  assert.equal(out.status, "redirect");
  assert.match(out.approveUrl, /^https:\/\/pay\.example\//);
  assert.equal(await P.entitled(orgId, v.id), false, "not entitled while the charge is pending");

  await Pay.completePurchase(out.purchaseId);
  assert.equal(await P.entitled(orgId, v.id), true);
  const p = await Pay.getPurchase(out.purchaseId);
  assert.equal(p.status, "paid");
  assert.ok(p.refundable_until > new Date().toISOString(), "a refund window opens on payment");
});

test("completing twice is harmless", async () => {
  provider.setPayments(redirectingProvider());
  const { orgId, userId } = await org();
  const v = await P.publishPack("video-brief");
  const out = await Pay.beginPurchase({ orgId, userId, packVersionId: v.id, amountCents: 19900, description: "x", ...ARGS });
  await Pay.completePurchase(out.purchaseId);
  const again = await Pay.completePurchase(out.purchaseId);
  assert.equal(again.status, "paid");
});

test("a failed capture leaves the buyer unentitled", async () => {
  provider.setPayments({ ...redirectingProvider(), capture: async () => ({ status: "failed" }) });
  const { orgId, userId } = await org();
  const v = await P.publishPack("support-triage");
  const out = await Pay.beginPurchase({ orgId, userId, packVersionId: v.id, amountCents: 9900, description: "x", ...ARGS });
  await assert.rejects(Pay.completePurchase(out.purchaseId), /not completed/);
  assert.equal(await P.entitled(orgId, v.id), false);
  assert.equal((await Pay.getPurchase(out.purchaseId)).status, "failed");
});

test("a refund inside the window takes the entitlement back with it", async () => {
  provider.setPayments(new provider.StubProvider());
  const { orgId, userId } = await org();
  const v = await P.publishPack("campaign-strategist");
  const out = await Pay.beginPurchase({ orgId, userId, packVersionId: v.id, amountCents: 24900, description: "x", ...ARGS });
  assert.equal(await P.entitled(orgId, v.id), true);
  await Pay.refundPurchase(out.purchaseId, orgId);
  assert.equal(await P.entitled(orgId, v.id), false);
  assert.equal((await Pay.getPurchase(out.purchaseId)).status, "refunded");
});

test("a refund after the window is refused", async () => {
  provider.setPayments(new provider.StubProvider());
  const { orgId, userId } = await org();
  const v = await P.publishPack("video-brief");
  const out = await Pay.beginPurchase({ orgId, userId, packVersionId: v.id, amountCents: 19900, description: "x", ...ARGS });
  const s = await sql();
  await s.query("UPDATE purchases SET refundable_until = $1 WHERE id = $2",
    [new Date(Date.now() - 86400_000).toISOString(), out.purchaseId]);
  await assert.rejects(Pay.refundPurchase(out.purchaseId, orgId), /window has closed/);
  assert.equal(await P.entitled(orgId, v.id), true, "the pack stays bought");
});

test("another organisation cannot refund your purchase", async () => {
  provider.setPayments(new provider.StubProvider());
  const { orgId, userId } = await org();
  const other = await org();
  const v = await P.publishPack("support-triage");
  const out = await Pay.beginPurchase({ orgId, userId, packVersionId: v.id, amountCents: 9900, description: "x", ...ARGS });
  await assert.rejects(Pay.refundPurchase(out.purchaseId, other.orgId), /no such purchase/);
});

test("buying points credits non-expiring compute, and cannot be refunded", async () => {
  provider.setPayments(new provider.StubProvider());
  const { orgId, userId } = await org();
  const before = await points.balanceCents(orgId);
  const out = await Pay.beginPointsPurchase({ orgId, userId, amountCents: 750, ...ARGS });
  assert.equal(out.status, "granted");
  assert.equal((await points.balanceCents(orgId)) - before, 750);
  assert.equal((await points.balanceByBucket(orgId)).topup >= 750, true);
  await assert.rejects(Pay.refundPurchase(out.purchaseId, orgId), /cannot be refunded/);
});

test("author earnings are not payable until the refund window has passed", async () => {
  provider.setPayments(new provider.StubProvider());
  const s = await sql();
  const pack = await P.getPack("support-triage");
  await s.query("UPDATE packs SET author_payout_email = $1 WHERE id = $2", ["author@example.com", pack.id]);
  const { orgId, userId } = await org();
  const v = await P.latestVersion(pack.id);
  const runId = `run_t${++n}`;
  await s.query(
    `INSERT INTO runs (id, org_id, user_id, pack_version_id, session_id, model, status, budget_cents, started_at)
     VALUES ($1,$2,$3,$4,'sesn_x','claude-opus-5','idle',50,$5)`,
    [runId, orgId, userId, v.id, new Date().toISOString()]);
  await points.creditAuthor(pack.id, runId, 100); // 20% of 100c = 20c = 20000 millicents

  const freshDue = (await Pay.payoutsDue()).find((d) => d.pack_id === pack.id);
  assert.equal(freshDue, undefined, "a brand new earning is still inside the window");

  await s.query("UPDATE author_earnings SET created_at = $1 WHERE pack_id = $2",
    [new Date(Date.now() - 20 * 86400_000).toISOString(), pack.id]);
  const due = (await Pay.payoutsDue()).find((d) => d.pack_id === pack.id);
  assert.ok(due, "once the window has passed it becomes payable");
  assert.equal(due.millicents, 20000);

  const paid = await Pay.payAuthor(pack.id);
  assert.equal(paid.millicents, 20000);
  assert.equal(await Pay.payAuthor(pack.id), null, "the same earning is never paid twice");
});

test("a failed payout releases the earnings for a later attempt", async () => {
  const s = await sql();
  const pack = await P.getPack("video-brief");
  await s.query("UPDATE packs SET author_payout_email = $1 WHERE id = $2", ["v@example.com", pack.id]);
  const { orgId, userId } = await org();
  const v = await P.latestVersion(pack.id);
  const runId = `run_f${++n}`;
  await s.query(
    `INSERT INTO runs (id, org_id, user_id, pack_version_id, session_id, model, status, budget_cents, started_at)
     VALUES ($1,$2,$3,$4,'sesn_y','claude-opus-5','idle',50,$5)`,
    [runId, orgId, userId, v.id, new Date().toISOString()]);
  await points.creditAuthor(pack.id, runId, 500);
  await s.query("UPDATE author_earnings SET created_at = $1 WHERE pack_id = $2",
    [new Date(Date.now() - 20 * 86400_000).toISOString(), pack.id]);

  provider.setPayments({ ...new provider.StubProvider(), payout: async () => { throw new Error("provider down"); } });
  await assert.rejects(Pay.payAuthor(pack.id), /provider down/);

  provider.setPayments(new provider.StubProvider());
  const retry = await Pay.payAuthor(pack.id);
  assert.ok(retry && retry.millicents > 0, "the earnings survived the failure and paid on retry");
});

test("an author with no payout address is refused rather than silently skipped", async () => {
  provider.setPayments(new provider.StubProvider());
  const s = await sql();
  const pack = await P.getPack("campaign-strategist");
  await s.query("UPDATE packs SET author_payout_email = NULL WHERE id = $1", [pack.id]);
  await assert.rejects(Pay.payAuthor(pack.id), /no payout address/);
});

test("a refund stops the run, and the pack cannot be run again", async () => {
  provider.setPayments(new provider.StubProvider());
  const { orgId, userId } = await org();
  const v = await P.publishPack("support-triage");
  const out = await Pay.beginPurchase({ orgId, userId, packVersionId: v.id, amountCents: 9900, description: "x", ...ARGS });

  P.setRuntime({
    publishPack: async () => ({ runtimePackId: "agt_test", version: "1" }),
    ensureEnvironment: async () => "env_1",
    createSession: async () => ({ id: "sesn_r", status: "running", stopReason: null,
      usage: { inputTokens: 0, outputTokens: 0, activeSeconds: 0, listCost: { amount: "0", currency: "USD" } } }),
    deleteSession: async () => {},
  });
  const run = await P.startRun({ orgId, userId, packVersionId: v.id });
  assert.equal((await P.getRun(run.id)).ended_at, null);

  await Pay.refundPurchase(out.purchaseId, orgId);

  assert.ok((await P.getRun(run.id)).ended_at, "the open run was terminated by the refund");
  await assert.rejects(P.sendTurn(run.id, "keep going"), (e) => e.name === "NotEntitledError");
  await assert.rejects(P.startRun({ orgId, userId, packVersionId: v.id }), (e) => e.name === "NotEntitledError");
});

test("a run cannot be started on a pack that was never bought", async () => {
  provider.setPayments(new provider.StubProvider());
  const { orgId, userId } = await org();
  const v = await P.latestVersion((await P.getPack("campaign-strategist")).id);
  await assert.rejects(P.startRun({ orgId, userId, packVersionId: v.id }), (e) => e.name === "NotEntitledError");
});

test("a run is refused when the balance is empty, and allowed once topped up", async () => {
  provider.setPayments(new provider.StubProvider());
  const s = await sql();
  const { orgId, userId } = await org();
  const v = await P.publishPack("guardrails");
  await Pay.beginPurchase({ orgId, userId, packVersionId: v.id, amountCents: 0, description: "free", ...ARGS });
  P.setRuntime({
    publishPack: async () => ({ runtimePackId: "agt_test", version: "1" }),
    ensureEnvironment: async () => "env_1",
    createSession: async () => ({ id: "sesn_p", status: "running", stopReason: null,
      usage: { inputTokens: 0, outputTokens: 0, activeSeconds: 0, listCost: { amount: "0", currency: "USD" } } }),
    deleteSession: async () => {},
  });

  // Spend the signup grant down to nothing.
  await s.query("DELETE FROM points_ledger WHERE org_id = $1", [orgId]);
  await assert.rejects(P.startRun({ orgId, userId, packVersionId: v.id }), (e) => e.name === "OutOfPointsError");

  await Pay.beginPointsPurchase({ orgId, userId, amountCents: 300, ...ARGS });
  const run = await P.startRun({ orgId, userId, packVersionId: v.id });
  assert.ok(run.id, "with compute bought, the run starts");
});
