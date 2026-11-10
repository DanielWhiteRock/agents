// Integration tests: real node:sqlite, real schema, fake runtime.
// Run against the build with `node --test tests/node/`.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "meter-")), "t.db");

let P, points;

/** A runtime whose turn streams a live snapshot, then settles at a final cost. */
function fakeRuntime(script) {
  let turn = 0;
  const zero = { inputTokens: 0, outputTokens: 0, activeSeconds: 0, listCost: { amount: "0", currency: "USD" } };
  return {
    ensureEnvironment: async () => "env_1",
    publishPack: async () => ({ runtimePackId: "agt_1", version: "1" }),
    createSession: async () => ({ id: "sesn_1", status: "running", stopReason: null, usage: zero }),
    sendMessage: async () => {},
    streamEvents: async () => {
      const step = script[turn];
      return (async function* () {
        if (step.snapshot !== undefined) {
          yield {
            type: "usage.snapshot",
            usage: { inputTokens: 2, outputTokens: step.out, activeSeconds: 1.5,
              listCost: { amount: String(step.snapshot), currency: "USD" } },
            budget: { amount: "50", currency: "USD" },
          };
        }
        yield { type: "status", status: "idle", stopReason: null };
      })();
    },
    readSession: async () => {
      const step = script[turn]; turn += 1;
      return { id: "sesn_1", status: "idle", stopReason: null,
        usage: { inputTokens: 2, outputTokens: step.out, activeSeconds: 1.5,
          listCost: { amount: String(step.finalCost), currency: "USD" } } };
    },
    raiseBudgetTo: async () => {},
    confirmTool: async () => {},
    deleteSession: async () => {},
  };
}

before(async () => {
  P = await import("../../dist/src/app/platform.js");
  points = await import("../../dist/src/billing/points.js");
});

test("bills each turn's delta once, though live snapshots move the observed cost", async () => {
  P.setRuntime(fakeRuntime([{ finalCost: 9, out: 100 }, { snapshot: 12, finalCost: 14, out: 250 }]));
  const { orgId, userId } = await P.ensureDemoOrg();
  await P.seedCatalog();
  const version = await P.publishPack("guardrails");
  await P.grantEntitlement(orgId, version.id);
  const opening = await points.balanceCents(orgId);

  const run = await P.startRun({ orgId, userId, packVersionId: version.id });
  assert.equal((await P.sendTurn(run.id, "one")).billedCents, 9);
  // 14 cumulative minus the 9 already charged. Not 14 again, and not 14-12.
  assert.equal((await P.sendTurn(run.id, "two")).billedCents, 5);

  const after = await P.getRun(run.id);
  assert.equal(after.list_cost_cents, 14);
  assert.equal(after.billed_up_to_cents, 14);
  assert.equal(after.billed_cents, 14);
  assert.equal(opening - (await points.balanceCents(orgId)), 14);
});

test("writes the platform's snapshot onto the run, absolute not additive", async () => {
  P.setRuntime(fakeRuntime([{ snapshot: 4, finalCost: 4, out: 1129 }]));
  const { orgId, userId } = await P.ensureDemoOrg();
  const version = await P.latestVersion((await P.getPack("guardrails")).id);
  const run = await P.startRun({ orgId, userId, packVersionId: version.id });
  await P.sendTurn(run.id, "review this");
  const after = await P.getRun(run.id);
  assert.equal(after.output_tokens, 1129);
  assert.equal(after.list_cost_cents, 4);
  assert.equal(after.budget_cents, 50);
});

test("credits the author in millicents so a sub-cent share survives", async () => {
  P.setRuntime(fakeRuntime([{ finalCost: 2, out: 50 }]));
  const { orgId, userId } = await P.ensureDemoOrg();
  const pack = await P.getPack("guardrails");
  const version = await P.latestVersion(pack.id);
  const before = await points.authorEarningsTotal(pack.id);
  const run = await P.startRun({ orgId, userId, packVersionId: version.id });
  // 20% of 2c is 0.4c = 400 millicents, which whole cents would floor away.
  assert.equal((await P.sendTurn(run.id, "x")).authorCents, 400);
  assert.equal((await points.authorEarningsTotal(pack.id)) - before, 400);
});

test("refuses a run beyond the tier's concurrency limit", async () => {
  P.setRuntime(fakeRuntime([{ finalCost: 1, out: 1 }]));
  const { orgId, userId } = await P.ensureDemoOrg();
  const version = await P.latestVersion((await P.getPack("guardrails")).id);
  const before = await P.activeRunCount(orgId);
  await assert.rejects(
    (async () => { for (let i = 0; i <= 20; i += 1) await P.startRun({ orgId, userId, packVersionId: version.id }); })(),
    /concurrency limit reached/,
  );
  assert.ok((await P.activeRunCount(orgId)) > before);
});
