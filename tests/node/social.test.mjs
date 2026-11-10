// Ratings, reviews, votes, saves. The marketplace deliberately shows no star
// ratings until a pack has earned five of them, and only an organisation that
// actually ran the thing (not trialled it, not merely bought it) may rate it
// at all. No UI, no routes, no seeding — storage and eligibility only.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!process.env.DATABASE_URL) {
  process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "social-")), "t.db");
}

let A, P, Auth, Pay, S, db, sql;
let n = 0;
const email = () => `s${++n}-${Date.now()}@example.com`;

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
  S = await import("../../dist/src/app/social.js");
  sql = (await import("../../dist/src/app/sql.js")).sql;
  await db.initDb();
  P.setRuntime(stubRuntime());
});

const org = async (name = "Reviewer Co") =>
  A.signUp({ email: email(), name: "Reviewer", password: "correct-horse", orgName: name });

/** A fresh pack, published, with one entitled org. */
const packAndVersion = async () => {
  const slug = `social-pack-${++n}`;
  const author = await org("Pack Author");
  const pack = await Auth.createPack(author.orgId, { ...INPUT, slug });
  const version = await P.publishPack(slug);
  return { pack, version, author };
};

/** A buyer org, entitled to the version, with a started run. */
const buyerWithRun = async (versionId) => {
  const buyer = await org("Buyer Co");
  await Pay.beginPurchase({
    orgId: buyer.orgId, userId: buyer.userId, packVersionId: versionId,
    amountCents: 0, description: "x", baseUrl: "http://localhost:4317",
  });
  const run = await P.startRun({ orgId: buyer.orgId, userId: buyer.userId, packVersionId: versionId });
  return { buyer, run };
};

const endRun = async (runId) => {
  const s = await sql();
  await s.query("UPDATE runs SET ended_at = $1 WHERE id = $2", [db.now(), runId]);
};

test("RATING_THRESHOLD is 5 and is the only copy of that number", async () => {
  assert.equal(S.RATING_THRESHOLD, 5);
});

test("a trial does not earn you an opinion", async () => {
  const { pack, version } = await packAndVersion();
  const buyer = await org("Trial Only Co");
  const run = await P.startRun({ orgId: buyer.orgId, userId: buyer.userId, packVersionId: version.id, trial: true });
  await endRun(run.id);

  assert.equal(await S.mayReview(buyer.orgId, pack.id), false, "a trial run never confers eligibility");
  await assert.rejects(
    S.submitReview({
      orgId: buyer.orgId, userId: buyer.userId, packId: pack.id,
      rating: 5, body: "great", byline: "Trial Only Co", anonymous: false,
    }),
    "submitReview must throw when mayReview is false",
  );
});

test("a run that has not ended does not earn you an opinion either", async () => {
  const { pack, version } = await packAndVersion();
  const { buyer, run } = await buyerWithRun(version.id);
  // Deliberately not ended: started_at is set, ended_at stays null.
  assert.equal(run.ended_at, null);

  assert.equal(await S.mayReview(buyer.orgId, pack.id), false, "an unfinished run is not an opinion yet");
  await assert.rejects(
    S.submitReview({
      orgId: buyer.orgId, userId: buyer.userId, packId: pack.id,
      rating: 4, body: "looks promising so far", byline: "Buyer Co", anonymous: false,
    }),
  );
});

test("a completed, non-trial run earns you an opinion", async () => {
  const { pack, version } = await packAndVersion();
  const { buyer, run } = await buyerWithRun(version.id);
  await endRun(run.id);

  assert.equal(await S.mayReview(buyer.orgId, pack.id), true);
  await S.submitReview({
    orgId: buyer.orgId, userId: buyer.userId, packId: pack.id,
    rating: 5, body: "did exactly what it said", byline: "Buyer Co", anonymous: false,
  });
});

test("submitReview rejects a non-finite rating rather than storing it as null", async () => {
  const { pack, version } = await packAndVersion();
  const { buyer, run } = await buyerWithRun(version.id);
  await endRun(run.id);

  await assert.rejects(
    S.submitReview({
      orgId: buyer.orgId, userId: buyer.userId, packId: pack.id,
      rating: NaN, body: "a malformed rating field", byline: "Buyer Co", anonymous: false,
    }),
    (e) => e.name === "SocialInputError",
  );

  const s = await sql();
  const row = await s.one("SELECT * FROM pack_reviews WHERE pack_id = $1 AND org_id = $2", [pack.id, buyer.orgId]);
  assert.equal(row, undefined, "a rejected rating leaves no review behind — not one with rating bound to null");

  // Omitting the rating entirely is the legitimate, body-only case, and
  // still works: `== null` is the only path that means "no rating given".
  await S.submitReview({
    orgId: buyer.orgId, userId: buyer.userId, packId: pack.id,
    body: "no rating, just notes", byline: "Buyer Co", anonymous: false,
  });
  const after = await s.one("SELECT * FROM pack_reviews WHERE pack_id = $1 AND org_id = $2", [pack.id, buyer.orgId]);
  assert.equal(after.rating, null);
});

test("the average appears at exactly five ratings and not at four", async () => {
  const { pack, version } = await packAndVersion();

  // Four reviewers, each with a completed non-trial run.
  for (let i = 0; i < 4; i += 1) {
    const { buyer, run } = await buyerWithRun(version.id);
    await endRun(run.id);
    await S.submitReview({
      orgId: buyer.orgId, userId: buyer.userId, packId: pack.id,
      rating: 5, body: `review ${i}`, byline: `Buyer ${i}`, anonymous: false,
    });
  }

  const atFour = await S.ratingOf(pack.id);
  assert.equal(atFour.count, 4);
  assert.equal(atFour.average, null, "below threshold, the average stays hidden");
  assert.deepEqual(atFour.distribution, [0, 0, 0, 0, 4], "distribution is always real, even hidden");

  // A fifth reviewer crosses the threshold.
  const { buyer, run } = await buyerWithRun(version.id);
  await endRun(run.id);
  await S.submitReview({
    orgId: buyer.orgId, userId: buyer.userId, packId: pack.id,
    rating: 5, body: "fifth", byline: "Fifth Buyer", anonymous: false,
  });

  const atFive = await S.ratingOf(pack.id);
  assert.equal(atFive.count, 5);
  assert.equal(atFive.average, 5, "at the threshold, the average is revealed");
  assert.deepEqual(atFive.distribution, [0, 0, 0, 0, 5]);
});

test("one organisation has one review, editable forever", async () => {
  const { pack, version } = await packAndVersion();
  const { buyer, run } = await buyerWithRun(version.id);
  await endRun(run.id);

  await S.submitReview({
    orgId: buyer.orgId, userId: buyer.userId, packId: pack.id,
    rating: 3, body: "first pass: okay", byline: "Buyer Co", anonymous: false,
  });
  await S.submitReview({
    orgId: buyer.orgId, userId: buyer.userId, packId: pack.id,
    rating: 2, body: "second pass, after more use: worse than I thought", byline: "Buyer Co", anonymous: false,
  });

  const s = await sql();
  const rows = await s.query("SELECT * FROM pack_reviews WHERE pack_id = $1 AND org_id = $2", [pack.id, buyer.orgId]);
  assert.equal(rows.length, 1, "one organisation, one row — the second submit edits it");
  assert.equal(rows[0].rating, 2);
  assert.equal(rows[0].body, "second pass, after more use: worse than I thought");

  const rating = await S.ratingOf(pack.id);
  assert.equal(rating.count, 1, "editing does not create a second rating");
});

test("an anonymous review keeps its rating and loses its byline", async () => {
  const { pack, version } = await packAndVersion();
  const { buyer, run } = await buyerWithRun(version.id);
  await endRun(run.id);

  await S.submitReview({
    orgId: buyer.orgId, userId: buyer.userId, packId: pack.id,
    rating: 4, body: "solid, would not want my name on it", byline: "Buyer Co", anonymous: true,
  });

  const s = await sql();
  const row = await s.one("SELECT * FROM pack_reviews WHERE pack_id = $1 AND org_id = $2", [pack.id, buyer.orgId]);
  assert.equal(Number(row.rating), 4, "the rating survives anonymity");
  assert.ok(!row.byline, "the byline does not survive anonymity");
  assert.equal(Number(row.anonymous), 1);

  const rating = await S.ratingOf(pack.id);
  assert.equal(rating.count, 1, "an anonymous rating still counts");
});

test("the public review row never carries the reviewing user's name or email", async () => {
  const { pack, version } = await packAndVersion();
  const { buyer, run } = await buyerWithRun(version.id);
  await endRun(run.id);
  await S.submitReview({
    orgId: buyer.orgId, userId: buyer.userId, packId: pack.id,
    rating: 5, body: "fine", byline: "Buyer Co", anonymous: false,
  });

  const s = await sql();
  const row = await s.one("SELECT * FROM pack_reviews WHERE pack_id = $1 AND org_id = $2", [pack.id, buyer.orgId]);
  const user = await s.one("SELECT name, email FROM users WHERE id = $1", [buyer.userId]);
  const values = Object.values(row).map((v) => String(v));
  assert.ok(!values.includes(user.name), "the user's personal name must not appear on the review row");
  assert.ok(!values.includes(user.email), "the user's email must not appear on the review row");
  assert.equal(row.user_id, buyer.userId, "user_id is kept, for audit, not display");
});

test("votes need no run at all", async () => {
  const { pack } = await packAndVersion();
  const voter = await org("Just Looking Co");
  // No purchase, no run — votes are the lighter signal.
  await S.vote(voter.orgId, pack.id, 1);

  const s = await sql();
  const row = await s.one("SELECT * FROM pack_votes WHERE pack_id = $1 AND org_id = $2", [pack.id, voter.orgId]);
  assert.equal(Number(row.value), 1);

  // Voting again from the same org updates rather than duplicating.
  await S.vote(voter.orgId, pack.id, -1);
  const rows = await s.query("SELECT * FROM pack_votes WHERE pack_id = $1 AND org_id = $2", [pack.id, voter.orgId]);
  assert.equal(rows.length, 1);
  assert.equal(Number(rows[0].value), -1);
});

test("vote() clamps anything outside -1..1, because the next task orders the shelf by it", async () => {
  const { pack } = await packAndVersion();
  const voter = await org("Enthusiastic Co");

  await S.vote(voter.orgId, pack.id, 99);
  const s = await sql();
  let row = await s.one("SELECT value FROM pack_votes WHERE pack_id = $1 AND org_id = $2", [pack.id, voter.orgId]);
  assert.equal(Number(row.value), 1, "an oversized positive value is clamped to 1");

  await S.vote(voter.orgId, pack.id, -14);
  row = await s.one("SELECT value FROM pack_votes WHERE pack_id = $1 AND org_id = $2", [pack.id, voter.orgId]);
  assert.equal(Number(row.value), -1, "an oversized negative value is clamped to -1");

  await S.vote(voter.orgId, pack.id, 0.6);
  row = await s.one("SELECT value FROM pack_votes WHERE pack_id = $1 AND org_id = $2", [pack.id, voter.orgId]);
  assert.equal(Number(row.value), 1, "a fractional in-range value rounds rather than truncating to 0");
});

test("vote() rejects a non-finite value rather than inventing 0", async () => {
  const { pack } = await packAndVersion();
  const voter = await org("Malformed Vote Co");

  await assert.rejects(S.vote(voter.orgId, pack.id, NaN), (e) => e.name === "SocialInputError");
  await assert.rejects(S.vote(voter.orgId, pack.id, Infinity), (e) => e.name === "SocialInputError");
  await assert.rejects(S.vote(voter.orgId, pack.id, -Infinity), (e) => e.name === "SocialInputError");

  const s = await sql();
  const row = await s.one("SELECT * FROM pack_votes WHERE pack_id = $1 AND org_id = $2", [pack.id, voter.orgId]);
  assert.equal(row, undefined, "nothing in the domain means 0; a rejected vote leaves no row behind");
});

test("toggleSave bookmarks a pack, then un-bookmarks it", async () => {
  const { pack } = await packAndVersion();
  const saver = await org("Saver Co");

  const first = await S.toggleSave(saver.orgId, saver.userId, pack.id);
  assert.equal(first, true, "first toggle saves it");
  const s = await sql();
  assert.ok(await s.one("SELECT 1 AS ok FROM pack_saves WHERE pack_id = $1 AND org_id = $2", [pack.id, saver.orgId]));

  const second = await S.toggleSave(saver.orgId, saver.userId, pack.id);
  assert.equal(second, false, "second toggle removes it");
  assert.equal(
    await s.one("SELECT 1 AS ok FROM pack_saves WHERE pack_id = $1 AND org_id = $2", [pack.id, saver.orgId]),
    undefined,
  );
});

test("creatorRating applies the same threshold across all of a creator's packs", async () => {
  const creatorOrg = await org("Rated Creator Co");
  const Cr = await import("../../dist/src/app/creators.js");
  const creator = await Cr.upsertCreator({
    orgId: creatorOrg.orgId, userId: creatorOrg.userId, handle: `rated-${++n}`, displayName: "Rated Studio",
  });

  const slugA = `rated-pack-a-${n}`, slugB = `rated-pack-b-${n}`;
  const packA = await Auth.createPack(creatorOrg.orgId, { ...INPUT, slug: slugA });
  const packB = await Auth.createPack(creatorOrg.orgId, { ...INPUT, slug: slugB });
  const vA = await P.publishPack(slugA);
  const vB = await P.publishPack(slugB);
  const sAttach = await sql();
  await sAttach.query("UPDATE packs SET creator_id = $1 WHERE id IN ($2, $3)", [creator.id, packA.id, packB.id]);

  // Four ratings on A, none on B — below threshold across the creator's packs.
  for (let i = 0; i < 4; i += 1) {
    const { buyer, run } = await buyerWithRun(vA.id);
    await endRun(run.id);
    await S.submitReview({
      orgId: buyer.orgId, userId: buyer.userId, packId: packA.id,
      rating: 4, body: `r${i}`, byline: `B${i}`, anonymous: false,
    });
  }
  let rating = await S.creatorRating(creator.id);
  assert.equal(rating.count, 4);
  assert.equal(rating.average, null);

  // A fifth rating, on the other pack, crosses the threshold for the creator.
  const { buyer, run } = await buyerWithRun(vB.id);
  await endRun(run.id);
  await S.submitReview({
    orgId: buyer.orgId, userId: buyer.userId, packId: packB.id,
    rating: 5, body: "fifth, on the other pack", byline: "Fifth", anonymous: false,
  });

  rating = await S.creatorRating(creator.id);
  assert.equal(rating.count, 5);
  assert.equal(rating.average, (4 * 4 + 5) / 5);
});

// ----------------------------------------------------------------- seeding
//
// scripts/seed-social.mjs makes the social layer above visible in a
// development database with no runs, ratings or threads yet. Its one safety
// mechanism is a refusal to run anywhere but a local SQLite database — no
// `is_seed` filter anywhere in packStats, ratingOf, the distribution, the
// vote count, creator totals or the shelf order, on purpose.

let Seed;
test("seed-social: setup", async () => {
  Seed = await import("../../scripts/seed-social.mjs");
});

test("the seed refuses a Postgres target: DATABASE_URL set means a non-zero exit before any connection is attempted", async () => {
  // A deliberately unreachable host. If the guard did not fire before the
  // database layer ever saw this value, this call would hang retrying a
  // connection for ~30s (see PostgresSql.connect) instead of returning fast.
  assert.throws(
    () => Seed.guardEnvironment({ DATABASE_URL: "postgres://unreachable.invalid/db" }),
    (e) => e.name === "SeedGuardError",
    "DATABASE_URL set must refuse immediately, before a connection attempt",
  );
});

test("the seed does not refuse when DATABASE_URL is absent", async () => {
  assert.doesNotThrow(() => Seed.guardEnvironment({}));
});

test("guardDialect refuses anything that is not sqlite, independent of what selected it", async () => {
  assert.throws(() => Seed.guardDialect({ dialect: "postgres" }), (e) => e.name === "SeedGuardError");
  assert.doesNotThrow(() => Seed.guardDialect({ dialect: "sqlite" }));
});

test("main() refuses a Postgres target end to end: non-zero exit, nothing written", async () => {
  const s = await sql();
  const before = await s.one("SELECT COUNT(*) AS n FROM orgs");
  const code = await Seed.main([], { DATABASE_URL: "postgres://unreachable.invalid/db" });
  assert.notEqual(code, 0, "a refused run must exit non-zero");
  const after = await s.one("SELECT COUNT(*) AS n FROM orgs");
  assert.equal(Number(after.n), Number(before.n), "a refused run must write nothing");
});

test("seeding: one pack crosses the rating threshold, one sits deliberately at four, votes and saves and threads all land", async () => {
  const s = await sql();
  const code = await Seed.main([]);
  assert.equal(code, 0);

  const guardrails = await P.getPack("guardrails");
  const campaign = await P.getPack("campaign-strategist");

  const above = await S.ratingOf(guardrails.id);
  assert.equal(above.count, 7);
  assert.ok(above.average !== null, "seven ratings clears RATING_THRESHOLD — the average must render");
  assert.equal(above.distribution.reduce((a, b) => a + b, 0), 7);

  const atFour = await S.ratingOf(campaign.id);
  assert.equal(atFour.count, 4);
  assert.equal(atFour.average, null, "four ratings is deliberately below RATING_THRESHOLD — no average");

  // Only positive votes are "useful" — the seeded downvote must not inflate it.
  const useful = await s.query("SELECT 1 AS ok FROM pack_votes WHERE pack_id = $1 AND value > 0", [guardrails.id]);
  assert.equal(useful.length, 3, "three upvotes, and the downvote must not count toward 'useful'");
  const downvotes = await s.query("SELECT 1 AS ok FROM pack_votes WHERE pack_id = $1 AND value < 0", [guardrails.id]);
  assert.equal(downvotes.length, 1, "the downvote is still a real stored row — just not a useful one");

  const saves = await s.query("SELECT 1 AS ok FROM pack_saves WHERE pack_id = $1", [guardrails.id]);
  assert.equal(saves.length, 2);

  const threads = await s.query(
    "SELECT t.* FROM threads t JOIN creators c ON c.id = t.creator_id WHERE c.handle LIKE 'seed-studio-%'");
  assert.equal(threads.length, 2, "two threads were opened against the seeded creator's profile");
  const messages = await s.query(
    "SELECT m.* FROM thread_messages m WHERE m.thread_id IN (SELECT id FROM threads WHERE creator_id IN (SELECT id FROM creators WHERE handle LIKE 'seed-studio-%'))");
  assert.ok(messages.length >= 3, "the question and at least one reply landed");
});

test("--wipe removes every seeded row and nothing else: the catalog packs stay published", async () => {
  const s = await sql();
  // Seed again so this test is independent of ordering/execution of the one above.
  await Seed.main([]);

  const guardrails = await P.getPack("guardrails");
  const beforeWipe = await S.ratingOf(guardrails.id);
  assert.ok(beforeWipe.count > 0, "there is something seeded to remove");

  const code = await Seed.main(["--wipe"]);
  assert.equal(code, 0);

  const afterWipe = await S.ratingOf(guardrails.id);
  assert.deepEqual(afterWipe, { average: null, count: 0, distribution: [0, 0, 0, 0, 0] },
    "every seeded review on this pack is gone");

  const seedOrgsLeft = await s.one("SELECT COUNT(*) AS n FROM orgs WHERE is_seed = 1");
  assert.equal(Number(seedOrgsLeft.n), 0, "no org marked is_seed survives a wipe");

  const threadsLeft = await s.query(
    "SELECT 1 AS ok FROM threads t JOIN creators c ON c.id = t.creator_id WHERE c.handle LIKE 'seed-studio-%'");
  assert.equal(threadsLeft.length, 0, "the seeded threads are gone too");

  // The pack itself, and the version seeding published, must survive: wipe
  // removes the fake social proof, never the real catalog.
  const stillThere = await P.getPack("guardrails");
  assert.ok(stillThere, "the catalog pack itself is untouched by --wipe");
  assert.equal(stillThere.status, "listed");
  const version = await P.latestVersion(stillThere.id);
  assert.ok(version, "the published version seeding created (or reused) is left in place");
});
