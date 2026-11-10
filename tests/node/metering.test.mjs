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
    uploadSkill: async () => ({ name: "x", skillId: "skill_platform", skillVersion: "1" }),
    countSystemTokens: async (_m, sys) => Math.ceil(sys.length / 4),
    publishPack: async () => ({ runtimePackId: "agt_1", version: "1", skills: [], subagents: [] }),
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
  listOutputs: async () => [],
  downloadOutput: async () => ({ bytes: Buffer.alloc(0), filename: "f" }),
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
  await P.grantEntitlement(orgId, version.id);
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
  await P.grantEntitlement(orgId, version.id);
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
  await P.grantEntitlement(orgId, version.id);
  await assert.rejects(
    (async () => { for (let i = 0; i <= 20; i += 1) await P.startRun({ orgId, userId, packVersionId: version.id }); })(),
    /concurrency limit reached/,
  );
  assert.ok((await P.activeRunCount(orgId)) > before);
});

test("a budget_reached recorded from the stream is not wiped by the session's null", async () => {
  const sql = (await import("../../dist/src/app/sql.js")).sql;
  const s = await sql();
  // A runtime whose stream reports the cap but whose session object does not —
  // which is exactly what the live platform does.
  P.setRuntime({
    countSystemTokens: async (_m, sys) => Math.ceil(sys.length / 4),
    publishPack: async () => ({ runtimePackId: "agt_b", version: "1", skills: [], subagents: [], mounts: [] }),
    ensureEnvironment: async () => "env_1",
    uploadSkill: async () => ({ name: "x", skillId: "skill_platform", skillVersion: "1" }),
    createSession: async () => ({ id: "sesn_b", status: "running", stopReason: null,
      usage: { inputTokens: 0, outputTokens: 0, activeSeconds: 0, listCost: { amount: "0", currency: "USD" } } }),
    sendMessage: async () => {},
    streamEvents: async () => (async function* () {
      yield { type: "status", status: "idle", stopReason: "budget_reached" };
    })(),
    readSession: async () => ({ id: "sesn_b", status: "idle", stopReason: null,
      usage: { inputTokens: 1, outputTokens: 9, activeSeconds: 1, listCost: { amount: "16", currency: "USD" } } }),
    raiseBudgetTo: async () => ({}), confirmTool: async () => {}, deleteSession: async () => {},
  listOutputs: async () => [],
  downloadOutput: async () => ({ bytes: Buffer.alloc(0), filename: "f" }),
  });
  // A fresh organisation: an earlier test in this file deliberately fills its
  // concurrency limit, and reusing that one would fail for the wrong reason.
  const A = await import("../../dist/src/app/auth.js");
  const { orgId, userId } = await A.signUp({
    email: `cap-${Date.now()}@example.com`, name: "Cap", password: "correct-horse", orgName: "Cap Co",
  });
  const version = await P.latestVersion((await P.getPack("guardrails")).id);
  await P.grantEntitlement(orgId, version.id);
  const run = await P.startRun({ orgId, userId, packVersionId: version.id });
  await P.sendTurn(run.id, "go");

  const after = await P.getRun(run.id);
  assert.equal(after.stop_reason, "budget_reached",
    "the UI needs this to offer a top-up; the session object would have said null");
  void s;
});

test("only what the platform marks downloadable is reported as a deliverable", async () => {
  const sql = (await import("../../dist/src/app/sql.js")).sql;
  const s = await sql();
  const A = await import("../../dist/src/app/auth.js");
  const Auth = await import("../../dist/src/app/authoring.js");

  const { orgId, userId } = await A.signUp({
    email: `out-${Date.now()}@example.com`, name: "Out", password: "correct-horse", orgName: "Out Co",
  });
  const slug = `outputs-${Date.now()}`;

  // The live listing returns mounted pack files alongside real deliverables,
  // with fresh ids, so only the downloadable flag separates them. The adapter
  // does that filtering; here the runtime is faked past it.
  P.setRuntime({
    ensureEnvironment: async () => "env_1",
    uploadSkill: async () => ({ name: "x", skillId: "skill_platform", skillVersion: "1" }),
    countSystemTokens: async (_m, sys) => Math.ceil(sys.length / 4),
    publishPack: async () => ({
      runtimePackId: "agt_o", version: "1", skills: [], subagents: [],
      mounts: [{ path: "agent.md", fileId: "file_mounted", mountPath: "pack/agent.md" }],
    }),
    createSession: async () => ({ id: "sesn_o", status: "running", stopReason: null,
      usage: { inputTokens: 0, outputTokens: 0, activeSeconds: 0, listCost: { amount: "0", currency: "USD" } } }),
    sendMessage: async () => {},
    streamEvents: async () => (async function* () { yield { type: "status", status: "idle", stopReason: null }; })(),
    readSession: async () => ({ id: "sesn_o", status: "idle", stopReason: null,
      usage: { inputTokens: 1, outputTokens: 5, activeSeconds: 1, listCost: { amount: "1", currency: "USD" } } }),
    listOutputs: async () => [{ fileId: "file_real", filename: "report.html", sizeBytes: 2048 }],
    downloadOutput: async () => ({ bytes: Buffer.from("<html>"), filename: "report.html" }),
    raiseBudgetTo: async () => ({}), confirmTool: async () => {}, deleteSession: async () => {},
  });

  await Auth.importPack({ orgId, files: [{ path: "agent.md", text: `---\nname: Out\nslug: ${slug}\n---\nmethod` }] });
  const v = await P.publishPack(slug);
  await P.grantEntitlement(orgId, v.id);
  const run = await P.startRun({ orgId, userId, packVersionId: v.id });
  await P.sendTurn(run.id, "make me a report");

  const outputs = await P.runOutputs(run.id);
  assert.deepEqual(outputs.map((o) => o.filename), ["report.html"],
    "only what the agent produced, not what we mounted for it");
  assert.equal(Number(outputs[0].size_bytes), 2048);
  void s;
});

test("a restart closes the runs it left open, and frees the slots they held", async () => {
  // The loop that drives a turn lives in this process, so a deploy mid-turn
  // orphans the run row. Since the concurrency limit counts open runs, an
  // orphan costs the organisation a slot for good — five deploys and a personal
  // tier can no longer start anything. Startup has to clean up after the last
  // process, and bill for what that process actually spent.
  P.setRuntime(fakeRuntime([{ finalCost: 0, out: 0 }]));
  const { orgId, userId } = await P.ensureDemoOrg();
  const version = await P.latestVersion((await P.getPack("guardrails")).id);
  await P.grantEntitlement(orgId, version.id);
  // An earlier test deliberately filled this org's slots with open runs; that
  // those are reclaimable at all is the behaviour under test.
  await P.reconcileOpenRuns();
  assert.equal(await P.activeRunCount(orgId), 0);

  // Fresh script: the fake advances through it on every readSession, and
  // clearing the board above consumed the old one.
  P.setRuntime(fakeRuntime([{ finalCost: 7, out: 3 }]));
  const run = await P.startRun({ orgId, userId, packVersionId: version.id });
  const held = await P.activeRunCount(orgId);
  assert.ok(held >= 1, "the run holds a slot while it is open");

  const closed = await P.reconcileOpenRuns();
  assert.ok(closed >= 1, "it closed at least the run we started");
  assert.equal(await P.activeRunCount(orgId), 0, "and every slot is free again");

  const after = await P.getRun(run.id);
  assert.ok(after.ended_at, "the run is ended");
  assert.equal(after.list_cost_cents, 7, "metered one last time from the provider");

  const events = await P.runEvents(run.id);
  assert.ok(events.some((e) => e.kind === "run.interrupted"),
    "and the transcript says why it stopped, rather than going silent");
});

test("the usage breakdown is measured, and context is the last request not a sum", async () => {
  // The page exists to tell a buyer where their context and money went, so the
  // numbers have to be the provider's, not ours. Two requests: the second's
  // figures are what the model was holding when it last answered, and adding
  // the two together would produce a number that means nothing.
  P.setRuntime(fakeRuntime([{ finalCost: 3, out: 20 }]));
  const { orgId, userId } = await P.ensureDemoOrg();
  const version = await P.latestVersion((await P.getPack("guardrails")).id);
  await P.grantEntitlement(orgId, version.id);
  await P.reconcileOpenRuns();

  P.setRuntime(fakeRuntime([{ finalCost: 3, out: 20 }]));
  const run = await P.startRun({ orgId, userId, packVersionId: version.id });
  await P.recordEvent(run.id, "model.usage",
    { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheCreationTokens: 4000 });
  await P.recordEvent(run.id, "model.usage",
    { inputTokens: 40, outputTokens: 9, cacheReadTokens: 4000, cacheCreationTokens: 60 });
  await P.recordEvent(run.id, "tool.use", { name: "bash", input: {}, permission: "allow" });
  await P.recordEvent(run.id, "tool.use", { name: "bash", input: {}, permission: "allow" });
  await P.recordEvent(run.id, "tool.use", { name: "web_search", input: {}, permission: "allow" });

  const u = await P.runUsage(run.id);
  assert.equal(u.used, 4100, "the last request's in + cache read + cache write, not the sum of both");
  assert.equal(u.requests, 2);
  assert.equal(u.cacheRead, 4000);
  assert.equal(u.cacheCreation, 60);
  assert.equal(u.systemTokens + u.conversation, u.used, "the parts account for the whole");
  assert.ok(u.window >= u.used, "and none of it exceeds the window");
  assert.deepEqual(u.tools, [{ name: "bash", calls: 2 }, { name: "web_search", calls: 1 }],
    "tools are counted and ordered by how often they were reached for");
});

test("a run that has sent nothing reports an empty breakdown rather than guessing", async () => {
  P.setRuntime(fakeRuntime([{ finalCost: 1, out: 1 }]));
  const { orgId, userId } = await P.ensureDemoOrg();
  const version = await P.latestVersion((await P.getPack("guardrails")).id);
  await P.grantEntitlement(orgId, version.id);
  await P.reconcileOpenRuns();
  P.setRuntime(fakeRuntime([{ finalCost: 1, out: 1 }]));
  const run = await P.startRun({ orgId, userId, packVersionId: version.id });
  const u = await P.runUsage(run.id);
  assert.equal(u.used, 0);
  assert.equal(u.tools.length, 0);
});

test("deleting a transcript removes what was said and keeps what it cost", async () => {
  // The spec calls a retention and deletion policy release-one work, because
  // the provider keeps session transcripts until something explicitly deletes
  // them — so no policy is a policy of forever, which nobody chose.
  P.setRuntime(fakeRuntime([{ finalCost: 5, out: 11 }]));
  const { orgId, userId } = await P.ensureDemoOrg();
  const version = await P.latestVersion((await P.getPack("guardrails")).id);
  await P.grantEntitlement(orgId, version.id);
  await P.reconcileOpenRuns();

  P.setRuntime(fakeRuntime([{ finalCost: 5, out: 11 }]));
  const run = await P.startRun({ orgId, userId, packVersionId: version.id });
  await P.recordEvent(run.id, "user.message", { text: "something private" });
  assert.ok((await P.runEvents(run.id)).length > 0);

  await P.forgetTranscript(run.id);

  const events = await P.runEvents(run.id);
  assert.ok(!events.some((e) => JSON.stringify(e).includes("something private")),
    "what was said is gone");
  assert.ok(events.some((e) => e.kind === "transcript.purged"),
    "and the deletion is recorded, because an empty trace and a deleted one are different facts");

  const after = await P.getRun(run.id);
  assert.ok(after.transcript_purged_at, "the run says when");
  assert.equal(after.budget_cents, run.budget_cents, "the billing record survives");
});

test("retention deletes finished transcripts past the window and leaves live ones", async () => {
  const { putSetting } = await import("../../dist/src/app/db.js");
  const sql = (await import("../../dist/src/app/sql.js")).sql;
  P.setRuntime(fakeRuntime([{ finalCost: 1, out: 1 }]));
  const { orgId, userId } = await P.ensureDemoOrg();
  const version = await P.latestVersion((await P.getPack("guardrails")).id);
  await P.grantEntitlement(orgId, version.id);
  await P.reconcileOpenRuns();

  P.setRuntime(fakeRuntime([{ finalCost: 1, out: 1 }, { finalCost: 1, out: 1 }]));
  const old = await P.startRun({ orgId, userId, packVersionId: version.id });
  const live = await P.startRun({ orgId, userId, packVersionId: version.id });
  const s = await sql();
  // Finished, and finished long enough ago to be past any sane window.
  await s.query("UPDATE runs SET ended_at = $1 WHERE id = $2",
    ["2020-01-01T00:00:00.000Z", old.id]);

  await putSetting("transcript_retention_days", "30");
  const purged = await P.purgeExpiredTranscripts();
  assert.ok(purged >= 1);
  assert.ok((await P.getRun(old.id)).transcript_purged_at, "the old one is gone");
  assert.equal((await P.getRun(live.id)).transcript_purged_at ?? null, null,
    "a run still going is never deleted out from under itself");

  // 0 is "keep forever" — a choice, not the absence of one.
  await putSetting("transcript_retention_days", "0");
  assert.equal(await P.purgeExpiredTranscripts(), 0);
  await putSetting("transcript_retention_days", "90");
});
