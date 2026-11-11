// A creator: a real record behind a pack, instead of a bare string in
// packs.author. Storage and queries only — no UI, no re-attribution of the
// existing catalog (that is Task 7), and deliberately no rating (Task 9 owns
// the hidden-below-five threshold that an aggregate rating depends on).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!process.env.DATABASE_URL) {
  process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "creators-")), "t.db");
}

let A, P, Auth, Pay, Cr, db, sql;
let n = 0;
const email = () => `c${++n}-${Date.now()}@example.com`;

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
  pricePoints: 0, upgradePoints: 10, instructions: "Step 1: find the number that has to move.",
};

before(async () => {
  db = await import("../../dist/src/app/db.js");
  A = await import("../../dist/src/app/auth.js");
  P = await import("../../dist/src/app/platform.js");
  Auth = await import("../../dist/src/app/authoring.js");
  Pay = await import("../../dist/src/billing/purchases.js");
  Cr = await import("../../dist/src/app/creators.js");
  sql = (await import("../../dist/src/app/sql.js")).sql;
  await db.initDb();
  P.setRuntime(stubRuntime());
});

const org = async (name = "Creator Co") =>
  A.signUp({ email: email(), name: "Creator", password: "correct-horse", orgName: name });

/** Attach a pack to a creator — raw SQL, standing in for Task 7's job. */
const attach = async (packId, creatorId) => {
  const s = await sql();
  await s.query("UPDATE packs SET creator_id = $1 WHERE id = $2", [creatorId, packId]);
};

/**
 * A pack as the pre-creators catalog actually shipped it: a bare `author`
 * string, no `author_org_id`, no `creator_id`. `Auth.createPack` always
 * stamps `author_org_id` from the creating org, so it cannot produce this
 * shape — only raw SQL can, which is exactly what the real 68-pack catalog
 * looks like before Task 7 runs.
 */
const legacyPack = async ({ author = "typeui.sh", authorOrgId = null, builtOn = null } = {}) => {
  const s = await sql();
  const packId = db.id("pk");
  await s.query(
    // `price_cents` named explicitly, like every other writer: the schema
    // declares no default for it, because a database upgraded through the
    // millipoints rename does not have one either. See `upgrade.test.mjs`.
    `INSERT INTO packs (id, slug, name, tagline, author, author_org_id, built_on, price_cents,
       upgrade_points, model, instructions, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,0,10,'claude-opus-5','do the thing',$8)`,
    [packId, `legacy-${++n}`, "Legacy Pack", "does legacy things", author, authorOrgId, builtOn, db.now()]);
  return packId;
};

const packRow = async (packId) => {
  const s = await sql();
  return s.one("SELECT * FROM packs WHERE id = $1", [packId]);
};

test("an unknown handle returns undefined", async () => {
  assert.equal(await Cr.creatorByHandle(`nobody-${Date.now()}`), undefined);
});

test("a creator with no packs attributed yet has stats of zero", async () => {
  const { orgId, userId } = await org();
  const creator = await Cr.upsertCreator({
    orgId, userId, handle: `fresh-${++n}`, displayName: "Fresh Studio",
  });
  assert.deepEqual(await Cr.creatorStats(creator.id), { packs: 0, runs: 0, orgs: 0 });
});

test("upsertCreator creates a profile, then edits the same row by org", async () => {
  const { orgId, userId } = await org();
  const handle = `studio-${++n}`;
  const created = await Cr.upsertCreator({
    orgId, userId, handle, displayName: "A Studio", bio: "we build things",
    links: [{ label: "site", url: "https://a.example" }],
  });
  assert.equal(created.handle, handle);
  assert.equal(created.display_name, "A Studio");
  assert.equal(created.verified, 0, "verified is curator-set, so it starts at 0 regardless of input");
  assert.equal(await Cr.creatorForOrg(orgId).then((c) => c.id), created.id);

  const newHandle = `studio-renamed-${n}`;
  const edited = await Cr.upsertCreator({
    orgId, userId, handle: newHandle, displayName: "A Studio Renamed", bio: "updated bio",
  });
  assert.equal(edited.id, created.id, "saving a profile again edits the same row, not a second one");
  assert.equal(edited.display_name, "A Studio Renamed");
  assert.equal(await Cr.creatorByHandle(handle), undefined, "the old handle is vacated");
  assert.equal(await Cr.creatorByHandle(newHandle).then((c) => c.id), created.id);
});

test("a handle already taken by another org is refused", async () => {
  const first = await org();
  const second = await org();
  const handle = `claimed-${++n}`;
  await Cr.upsertCreator({ orgId: first.orgId, userId: first.userId, handle, displayName: "First" });
  await assert.rejects(
    Cr.upsertCreator({ orgId: second.orgId, userId: second.userId, handle, displayName: "Second" }),
    (e) => e.name === "HandleTakenError",
  );
});

test("creatorStats sums runs and distinct owning orgs across all of a creator's packs, excluding trials", async () => {
  const creatorOrg = await org("Two Pack Creator");
  const creator = await Cr.upsertCreator({
    orgId: creatorOrg.orgId, userId: creatorOrg.userId, handle: `twopack-${++n}`, displayName: "Two Pack Studio",
  });

  const slugA = `creator-pack-a-${n}`, slugB = `creator-pack-b-${n}`;
  const packA = await Auth.createPack(creatorOrg.orgId, { ...INPUT, slug: slugA });
  const packB = await Auth.createPack(creatorOrg.orgId, { ...INPUT, slug: slugB });
  const vA = await P.publishPack(slugA);
  const vB = await P.publishPack(slugB);
  await attach(packA.id, creator.id);
  await attach(packB.id, creator.id);

  const buyer1 = await org("Buyer One");
  const buyer2 = await org("Buyer Two");
  const buyer3 = await org("Trial Only");

  // buyer1 owns both packs; buyer2 owns only A — two distinct owning orgs.
  await Pay.beginPurchase({ orgId: buyer1.orgId, userId: buyer1.userId, packVersionId: vA.id,
    amountCents: 0, description: "x", baseUrl: "http://localhost:4317" });
  await Pay.beginPurchase({ orgId: buyer1.orgId, userId: buyer1.userId, packVersionId: vB.id,
    amountCents: 0, description: "x", baseUrl: "http://localhost:4317" });
  await Pay.beginPurchase({ orgId: buyer2.orgId, userId: buyer2.userId, packVersionId: vA.id,
    amountCents: 0, description: "x", baseUrl: "http://localhost:4317" });

  // Three real runs, split across both packs.
  await P.startRun({ orgId: buyer1.orgId, userId: buyer1.userId, packVersionId: vA.id });
  await P.startRun({ orgId: buyer1.orgId, userId: buyer1.userId, packVersionId: vB.id });
  await P.startRun({ orgId: buyer2.orgId, userId: buyer2.userId, packVersionId: vA.id });

  // A trial run on an unowned pack: must not inflate the run count, and
  // buyer3 is never entitled so it must not inflate the org count either.
  await P.startRun({ orgId: buyer3.orgId, userId: buyer3.userId, packVersionId: vA.id, trial: true });

  assert.deepEqual(await Cr.creatorStats(creator.id), { packs: 2, runs: 3, orgs: 2 });
});

test("claiming takes only the packs nobody owns", async () => {
  const creatorOrg = await org("Shelf Curator");
  const creator = await Cr.upsertCreator({
    orgId: creatorOrg.orgId, userId: creatorOrg.userId, handle: `shelf-${++n}`, displayName: "Shelf Studio",
  });
  const otherOrg = await org("Real Author Co");

  const unowned = await legacyPack();
  const owned = await legacyPack({ authorOrgId: otherOrg.orgId });

  const claimed = await Cr.claimUnownedPacks(creator.id, creatorOrg.orgId);
  assert.equal(claimed, 1, "only the pack nobody owned is counted");

  const unownedRow = await packRow(unowned);
  assert.equal(unownedRow.author_org_id, creatorOrg.orgId);
  assert.equal(unownedRow.creator_id, creator.id);

  const ownedRow = await packRow(owned);
  assert.equal(ownedRow.author_org_id, otherOrg.orgId, "a pack with a real author is never touched");
  assert.equal(ownedRow.creator_id, null, "an owned pack's creator_id is untouched too");
});

test("claiming twice changes nothing the second time", async () => {
  const creatorOrg = await org("Repeat Curator");
  const creator = await Cr.upsertCreator({
    orgId: creatorOrg.orgId, userId: creatorOrg.userId, handle: `repeat-${++n}`, displayName: "Repeat Studio",
  });
  const packId = await legacyPack();

  const first = await Cr.claimUnownedPacks(creator.id, creatorOrg.orgId);
  assert.equal(first, 1, "the one unowned pack is claimed");
  const afterFirst = await packRow(packId);

  const second = await Cr.claimUnownedPacks(creator.id, creatorOrg.orgId);
  assert.equal(second, 0, "nothing is left to claim the second time");

  const afterSecond = await packRow(packId);
  assert.deepEqual(afterSecond, afterFirst, "the row is unchanged by the second pass, not just the count");
});

test("the old byline becomes the built-on line", async () => {
  const creatorOrg = await org("Credit Curator");
  const creator = await Cr.upsertCreator({
    orgId: creatorOrg.orgId, userId: creatorOrg.userId, handle: `credit-${++n}`, displayName: "Credit Studio",
  });

  const mitPack = await legacyPack({ author: "Dietrich Gebert, Cursor, Poteto — MIT" });
  const emptyBuiltOn = await legacyPack({ author: "typeui.sh", builtOn: "" });
  const alreadySet = await legacyPack({ author: "typeui.sh", builtOn: "claude-sonnet-4" });

  await Cr.claimUnownedPacks(creator.id, creatorOrg.orgId);

  const mitRow = await packRow(mitPack);
  assert.equal(mitRow.author, "Dietrich Gebert, Cursor, Poteto — MIT", "the display byline never changes");
  assert.equal(mitRow.built_on, "Dietrich Gebert, Cursor, Poteto — MIT", "upstream credit moves to built_on");

  const emptyRow = await packRow(emptyBuiltOn);
  assert.equal(emptyRow.built_on, "typeui.sh", "an empty-string built_on counts as unset too");

  const setRow = await packRow(alreadySet);
  assert.equal(setRow.built_on, "claude-sonnet-4", "a built_on that is already set is never overwritten");
});

/**
 * Drives the trigger, not the function. Every earlier test in this file
 * calls `Cr.claimUnownedPacks` directly, which proves the UPDATE is correct
 * but never proves it is actually wired into `upsertCreator` for the
 * platform org — the one thing Task 7's controller ruling overrode the
 * brief on. `A.signUp` claims `platform_org_id` via
 * `INSERT ... ON CONFLICT DO NOTHING`, and an earlier test in this file
 * already signed up the first org, so no later `org()` call can ever become
 * the platform org through the application layer. Reassigning the setting
 * with raw SQL — the same "reach past the application layer" move
 * `legacyPack` already uses for a shape `createPack` cannot produce — is the
 * only way left to exercise the real branch at creators.ts:
 * `if (input.orgId === (await platformOrgId()))`.
 *
 * This is deliberately the last test in the file: it overwrites the global
 * `platform_org_id` setting for the rest of this test file's database, and
 * nothing after it may depend on the original value.
 */
test("upsertCreator claims the legacy catalog when the org is the platform org", async () => {
  const platformOrg = await org("Reassigned Platform Org");
  const s = await sql();
  await s.query("UPDATE settings SET value = $1 WHERE key = 'platform_org_id'", [platformOrg.orgId]);
  assert.equal(await db.platformOrgId(), platformOrg.orgId, "the setting now points at this org");

  const packId = await legacyPack({ author: "typeui.sh" });

  const creator = await Cr.upsertCreator({
    orgId: platformOrg.orgId, userId: platformOrg.userId,
    handle: `platform-${++n}`, displayName: "Platform Studio",
  });

  const row = await packRow(packId);
  assert.equal(row.author_org_id, platformOrg.orgId,
    "upsertCreator for the platform org claims the legacy pack on its own, with no direct claimUnownedPacks call");
  assert.equal(row.creator_id, creator.id);
  assert.equal(row.built_on, "typeui.sh", "upstream credit still moves to built_on through the trigger");
});
