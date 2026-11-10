// The storage foundation for a full listing: columns on packs, and a drafts
// table for content awaiting approval. No reading or rendering logic here.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!process.env.DATABASE_URL) {
  process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "listing-")), "t.db");
}

let A, P, Auth, L, db, sql;
let n = 0;
const email = () => `l${++n}-${Date.now()}@example.com`;

const stubRuntime = () => ({
  countSystemTokens: async (_m, sys) => Math.ceil(sys.length / 4),
  publishPack: async () => ({ runtimePackId: `agt_${++n}`, version: "1", skills: [], subagents: [] }),
  ensureEnvironment: async () => "env_1",
  uploadSkill: async () => ({ name: "x", skillId: "skill_platform", skillVersion: "1" }),
  createSession: async () => ({ id: `sesn_${++n}`, status: "running", stopReason: null,
    usage: { inputTokens: 0, outputTokens: 0, activeSeconds: 0, listCost: { amount: "0", currency: "USD" } } }),
  sendMessage: async () => {},
  streamEvents: async () => (async function* () { yield { type: "status", status: "idle", stopReason: null }; })(),
  readSession: async () => ({ id: "sesn_a", status: "idle", stopReason: null,
    usage: { inputTokens: 1, outputTokens: 5, activeSeconds: 1, listCost: { amount: "1", currency: "USD" } } }),
  deleteSession: async () => {},
  listOutputs: async () => [],
  downloadOutput: async () => ({ bytes: Buffer.alloc(0), filename: "f" }),
});

const INPUT = {
  slug: "", name: "Pricing Reviewer", tagline: "Checks a pricing change before you ship it",
  author: "A Real Expert", model: "claude-opus-5", effort: "high",
  pricePoints: 49, upgradePoints: 10, instructions: "Step 1: find the number that has to move.",
};

before(async () => {
  db = await import("../../dist/src/app/db.js");
  A = await import("../../dist/src/app/auth.js");
  P = await import("../../dist/src/app/platform.js");
  Auth = await import("../../dist/src/app/authoring.js");
  L = await import("../../dist/src/app/listing.js");
  sql = (await import("../../dist/src/app/sql.js")).sql;
  await db.initDb();
  P.setRuntime(stubRuntime());
});

/** signUp + Auth.createPack, the way authoring.test.mjs builds a pack to test against. */
const makePack = async (overrides = {}) => {
  const { orgId } = await A.signUp({ email: email(), name: "Author", password: "correct-horse", orgName: "Lister Co" });
  const slug = `listing-${++n}`;
  const pack = await Auth.createPack(orgId, { ...INPUT, slug, ...overrides });
  return { orgId, pack };
};

test("a new pack carries empty listing fields and no draft", async () => {
  const { pack } = await makePack();
  assert.equal(pack.description, "");
  assert.deepEqual(JSON.parse(pack.use_cases || "[]"), []);
  assert.equal(pack.listing_approved_at, null);
  const s = await sql();
  assert.equal(await s.one("SELECT 1 AS ok FROM pack_listing_drafts WHERE pack_id = $1", [pack.id]), undefined);
});

const DRAFT = {
  description: "Drafted copy.", useCases: ["Audit a price change"], limitations: ["No currency conversion"],
  faq: [{ q: "Does it support EUR?", a: "Not yet." }],
  scenarios: [{ brief: "A 10% price hike", reached: ["found the stale rate"], output: "a flagged diff" }],
  requirements: ["A pricing sheet"],
};

test("approving a draft publishes it and leaves no draft behind", async () => {
  const { orgId, pack } = await makePack();
  await L.saveDraft(pack.id, DRAFT, 1);
  await L.approveDraft(orgId, pack.slug);

  const approved = await P.getPack(pack.slug);
  assert.equal(approved.description, DRAFT.description);
  assert.deepEqual(L.listingOf(approved).useCases, DRAFT.useCases);
  assert.deepEqual(L.listingOf(approved).faq, DRAFT.faq);
  assert.ok(approved.listing_approved_at, "the approval is stamped");
  assert.equal(approved.listing_stale_at, null);
  assert.equal(await L.draftFor(pack.id), null, "no draft left behind");
});

test("generating again does not disturb what is already published", async () => {
  const { orgId, pack } = await makePack();
  await L.saveDraft(pack.id, { ...DRAFT, description: "Version A." }, 1);
  await L.approveDraft(orgId, pack.slug);

  await L.saveDraft(pack.id, { ...DRAFT, description: "Version B." }, 2);

  const stillLive = await P.getPack(pack.slug);
  assert.equal(stillLive.description, "Version A.", "the live copy is untouched by a new draft");
  const pending = await L.draftFor(pack.id);
  assert.equal(pending.description, "Version B.");
});

test("only the author or the curator may approve", async () => {
  const { pack } = await makePack();
  const stranger = await A.signUp({ email: email(), name: "Stranger", password: "correct-horse", orgName: "Stranger Co" });
  await L.saveDraft(pack.id, DRAFT, 1);
  await assert.rejects(L.approveDraft(stranger.orgId, pack.slug), /only the organisation/);
});

test("listingOf survives a malformed column", async () => {
  const { pack } = await makePack();
  const s = await sql();
  await s.query("UPDATE packs SET use_cases = $1 WHERE id = $2", ["not json", pack.id]);
  const reloaded = await P.getPack(pack.slug);
  assert.deepEqual(L.listingOf(reloaded).useCases, []);
});
