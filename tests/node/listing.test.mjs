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

let A, P, Auth, db, sql;
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
