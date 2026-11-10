// Integration-level coverage for `listPacks`'s real SQL, as opposed to
// `tests/runtime/ranking.test.ts`'s pure-comparator unit tests: this file
// checks that the ranking inputs `rankPacks` is handed actually come out of
// the database the way the design says they must — one query, a rating
// gated the same way the page gates it, and a vote summed only when positive.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!process.env.DATABASE_URL) {
  process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "ranking-")), "t.db");
}

let db, A, P, Auth, sql;
let n = 0;
const email = () => `rk${++n}-${Date.now()}@example.com`;

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

before(async () => {
  db = await import("../../dist/src/app/db.js");
  A = await import("../../dist/src/app/auth.js");
  P = await import("../../dist/src/app/platform.js");
  Auth = await import("../../dist/src/app/authoring.js");
  sql = (await import("../../dist/src/app/sql.js")).sql;
  await db.initDb();
  P.setRuntime(stubRuntime());
});

const org = async (name = "Ranking Co") =>
  A.signUp({ email: email(), name: "Rank Tester", password: "correct-horse", orgName: name });

/** A listed pack, published, with a controllable created_at. */
const listedPack = async (createdAt, overrides = {}) => {
  const author = await org("Pack Author");
  const slug = `rank-pack-${++n}`;
  const pack = await Auth.createPack(author.orgId, {
    slug, name: `Rank Pack ${n}`, tagline: "x", author: "Someone", model: "claude-opus-5",
    pricePoints: 0, upgradePoints: 0, instructions: "Do the thing.", ...overrides,
  });
  await P.publishPack(slug);
  const platform = await db.platformOrgId();
  await Auth.setStatus(platform, slug, "review");
  await Auth.setStatus(platform, slug, "listed");
  const s = await sql();
  if (createdAt) await s.query("UPDATE packs SET created_at = $1 WHERE id = $2", [createdAt, pack.id]);
  return (await P.getPack(slug));
};

const insertRun = async (orgId, userId, packVersionId) => {
  const s = await sql();
  await s.query(
    `INSERT INTO runs (id, org_id, user_id, pack_version_id, session_id, model, status, budget_cents, started_at, ended_at)
     VALUES ($1,$2,$3,$4,$5,'claude-opus-5','idle',50,$6,$6)`,
    [`run_${++n}`, orgId, userId, packVersionId, `sesn_${n}`, db.now()]);
};

const insertReview = async (packId, orgId, userId, rating) => {
  const s = await sql();
  await s.query(
    `INSERT INTO pack_reviews (id, pack_id, org_id, user_id, rating, body, byline, anonymous, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,'','x',0,$6,$6)`,
    [`rev_${++n}`, packId, orgId, userId, rating, db.now()]);
};

const insertVote = async (packId, orgId, value) => {
  const s = await sql();
  await s.query("INSERT INTO pack_votes (pack_id, org_id, value) VALUES ($1,$2,$3)", [packId, orgId, value]);
};

const orderOf = async (slugs) => {
  const rows = await P.listPacks();
  return rows.filter((r) => slugs.includes(r.slug)).map((r) => r.slug);
};

test("with no signal at all, listPacks orders newest first — not most expensive first", async () => {
  const oldExpensive = await listedPack("2020-01-01T00:00:00.000Z", { pricePoints: 9000 });
  const newCheap = await listedPack("2026-11-01T00:00:00.000Z", { pricePoints: 0 });
  assert.deepEqual(await orderOf([oldExpensive.slug, newCheap.slug]), [newCheap.slug, oldExpensive.slug]);
});

test("a curator-set featured_rank beats a pack with every other kind of signal", async () => {
  const busy = await listedPack("2026-01-01T00:00:00.000Z");
  const quiet = await listedPack("2020-01-01T00:00:00.000Z");
  const busyVersion = await P.latestVersion(busy.id);

  // Give `busy` real runs, a shown rating and votes — everything but a
  // curator rank.
  const voters = await Promise.all([1, 2, 3, 4, 5].map(() => org("Voter Co")));
  for (const v of voters) {
    await insertRun(v.orgId, v.userId, busyVersion.id);
    await insertReview(busy.id, v.orgId, v.userId, 5);
    await insertVote(busy.id, v.orgId, 1);
  }

  const platform = await db.platformOrgId();
  await Auth.setFeaturedRank(platform, quiet.slug, 1);

  assert.deepEqual(await orderOf([busy.slug, quiet.slug]), [quiet.slug, busy.slug]);
});

test("a rating below the display threshold contributes nothing to the order", async () => {
  const hidden = await listedPack("2026-01-01T00:00:00.000Z"); // newer, but its rating must not count
  const shown = await listedPack("2020-01-01T00:00:00.000Z"); // older, lower rating, but it IS shown

  // `hidden` gets four 5-star reviews — a high true average, but one short
  // of RATING_THRESHOLD, so `ratingOf` would return `average: null` for it.
  const fourVoters = await Promise.all([1, 2, 3, 4].map(() => org("Reviewer Co")));
  for (const v of fourVoters) await insertReview(hidden.id, v.orgId, v.userId, 5);

  // `shown` gets five 2-star reviews — a low average, but enough ratings to
  // actually be displayed.
  const fiveVoters = await Promise.all([1, 2, 3, 4, 5].map(() => org("Reviewer Co")));
  for (const v of fiveVoters) await insertReview(shown.id, v.orgId, v.userId, 2);

  // Without the threshold gate, `hidden`'s unseen 5.0 average would beat
  // `shown`'s visible 2.0 and also beat `shown` on recency alone. With it,
  // `hidden` has no rating signal at all, and `shown`'s real, visible
  // rating wins.
  assert.deepEqual(await orderOf([hidden.slug, shown.slug]), [shown.slug, hidden.slug]);
});

test("a downvote does not count toward a pack's votes", async () => {
  const netNegativeButTwoUps = await listedPack("2026-01-01T00:00:00.000Z");
  const oneUpOnly = await listedPack("2026-01-01T00:00:00.000Z");

  const upvoters = await Promise.all([1, 2].map(() => org("Upvoter Co")));
  for (const v of upvoters) await insertVote(netNegativeButTwoUps.id, v.orgId, 1);
  const downvoters = await Promise.all([1, 2, 3].map(() => org("Downvoter Co")));
  for (const v of downvoters) await insertVote(netNegativeButTwoUps.id, v.orgId, -1);

  const [singleUpvoter] = await Promise.all([org("Single Upvoter Co")]);
  await insertVote(oneUpOnly.id, singleUpvoter.orgId, 1);

  // Naive sum: netNegativeButTwoUps = 2 - 3 = -1, oneUpOnly = 1 -> oneUpOnly
  // would win. Positive-only sum: netNegativeButTwoUps = 2, oneUpOnly = 1 ->
  // netNegativeButTwoUps must win instead.
  assert.deepEqual(
    await orderOf([netNegativeButTwoUps.slug, oneUpOnly.slug]),
    [netNegativeButTwoUps.slug, oneUpOnly.slug],
  );
});

test("only the curator may set a pack's featured_rank", async () => {
  const pack = await listedPack();
  const stranger = await org("Stranger Co");
  await assert.rejects(Auth.setFeaturedRank(stranger.orgId, pack.slug, 1), (e) => e.name === "NotTheCuratorError");
});
