#!/usr/bin/env node
/**
 * Seed data for the social layer — ratings, reviews, votes, saves and
 * buyer<->creator threads — so the listing thirteen tasks built can actually
 * be looked at in a development database that otherwise has none of it.
 *
 *   node scripts/seed-social.mjs           # seed
 *   node scripts/seed-social.mjs --wipe    # remove exactly what this script wrote
 *
 * The dangerous part: every seeded row is counted by every real aggregate —
 * packStats, ratingOf, the distribution, the vote count, creator totals, the
 * shelf order. It has to work that way, or a seed the stats quietly filtered
 * out would render nothing, which is the whole point defeated. So the only
 * thing standing between this script and fake social proof on a real buyer's
 * screen is `guardEnvironment`/`guardDialect` below — one refusal, checked
 * first, rather than an `is_seed` predicate threaded through six call sites
 * that each have to remember it.
 *
 * `is_seed` (added to `orgs`, `runs`, `pack_reviews`, `pack_votes` in
 * `src/app/db.ts`) exists only so `--wipe` can find exactly the rows this
 * script wrote and remove them — never a real buyer's. No aggregate reads it.
 *
 * Seeded through the domain functions wherever one exists — `auth.signUp`,
 * `purchases.beginPurchase`, `platform.startRun`/`endRun`/`publishPack`,
 * `social.submitReview`/`vote`/`toggleSave`, `creators.upsertCreator`,
 * `messages.openThread`/`reply` — so the seeded data is data the application
 * could actually have produced. `authoring.createPack` is deliberately never
 * called: the packs seeded here are the existing built-in catalog
 * (`platform.seedCatalog`), not new ones. Raw SQL appears only for the
 * `is_seed` stamp itself (a bookkeeping column no domain function has any
 * reason to know about) and in `wipe`, which is pure cleanup, not seeding —
 * each use is commented where it happens.
 */
import { pathToFileURL } from "node:url";
import { initDb } from "../dist/src/app/db.js";
import { sql } from "../dist/src/app/sql.js";
import * as A from "../dist/src/app/auth.js";
import * as P from "../dist/src/app/platform.js";
import * as Pay from "../dist/src/billing/purchases.js";
import * as S from "../dist/src/app/social.js";
import * as Cr from "../dist/src/app/creators.js";
import * as M from "../dist/src/app/messages.js";

export class SeedGuardError extends Error {
  constructor(message) {
    super(message);
    this.name = "SeedGuardError";
  }
}

const REFUSAL = (why) =>
  "refusing to seed: " + why + "\n" +
  "Every aggregate on this platform (packStats, ratingOf, the rating distribution, the vote count,\n" +
  "creator totals, the shelf order) counts a seeded row exactly like a real one — on purpose, because a\n" +
  "seed that the stats filtered out would render nothing. The only thing stopping that fake social proof\n" +
  "from reaching a real buyer is this refusal. It may only ever run against the local SQLite fallback.";

/**
 * The fast guard, checked before anything that could touch a network: a
 * fake/unreachable Postgres URL here must fail in well under a second, not
 * after PostgresSql.connect's ~30s of patient retries. `main` calls this
 * before `initDb`/`sql()` are ever invoked, so the retry loop never starts.
 */
export function guardEnvironment(env = process.env) {
  if (env.DATABASE_URL) {
    throw new SeedGuardError(REFUSAL(`DATABASE_URL is set ("${env.DATABASE_URL}").`));
  }
}

/**
 * The authoritative guard, checked once a `Sql` already exists. Today the
 * only way to get a non-sqlite `Sql` is `DATABASE_URL` being set — which
 * `guardEnvironment` already refuses — so this is a second, independent
 * check on the thing that actually matters (what driver is live) rather than
 * trusting the one input that happens to select it today.
 */
export function guardDialect(s) {
  if (s.dialect !== "sqlite") {
    throw new SeedGuardError(REFUSAL(`the configured database is "${s.dialect}", not sqlite.`));
  }
}

// --------------------------------------------------------------- the stub
//
// publishPack/startRun talk to an AgentRuntime that normally calls a live
// provider. Seeding needs no agent turn to actually run — only the rows a
// finished one would leave — so this stands in for it, the same stand-in
// tests/node/social.test.mjs itself uses, so `platform.ts`'s own publish and
// run paths can be exercised without a key, a network call, or a bill.
const stubRuntime = () => ({
  countSystemTokens: async (_m, sys) => Math.ceil(sys.length / 4),
  publishPack: async () => ({ runtimePackId: `agt_seed_${id()}`, version: "1", skills: [], subagents: [] }),
  ensureEnvironment: async () => "env_seed",
  uploadSkill: async () => ({ name: "x", skillId: "skill_platform_seed", skillVersion: "1" }),
  createSession: async () => ({
    id: `sesn_${id()}`, status: "running", stopReason: null,
    usage: { inputTokens: 0, outputTokens: 0, activeSeconds: 0, listCost: { amount: "0", currency: "USD" } },
  }),
  sendMessage: async () => {},
  streamEvents: async () => (async function* () { yield { type: "status", status: "idle", stopReason: null }; })(),
  readSession: async () => ({
    id: "sesn_seed", status: "idle", stopReason: null,
    usage: { inputTokens: 1, outputTokens: 5, activeSeconds: 1, listCost: { amount: "1", currency: "USD" } },
  }),
  deleteSession: async () => {},
  listOutputs: async () => [],
  downloadOutput: async () => ({ bytes: Buffer.alloc(0), filename: "f" }),
});

let n = 0;
const id = () => `${Date.now().toString(36)}${(++n).toString(36)}`;
const email = (tag) => `seed-${tag}-${id()}@example.invalid`;

// ------------------------------------------------------------- the actors

/** A fresh organisation, via the real sign-up path, marked as seed-owned. */
async function seedOrg(name, personName = "Seed") {
  const { userId, orgId, token } = await A.signUp({
    email: email(name.toLowerCase().replace(/[^a-z0-9]+/g, "-")),
    name: personName, password: "correct-horse-seed", orgName: name,
  });
  const s = await sql();
  // Raw SQL: `is_seed` is a bookkeeping column `--wipe` reads, not a domain
  // concept auth.signUp has any reason to know about.
  await s.query("UPDATE orgs SET is_seed = 1 WHERE id = $1", [orgId]);
  return { orgId, userId, token };
}

/** This org buys the pack for $0 (every path here is free, like the test harness's own) and completes one run. */
async function completedRun(org, packVersionId) {
  await Pay.beginPurchase({
    orgId: org.orgId, userId: org.userId, packVersionId,
    amountCents: 0, description: "seed", baseUrl: "http://localhost:4317",
  });
  const run = await P.startRun({ orgId: org.orgId, userId: org.userId, packVersionId });
  await P.endRun(run.id);
  const s = await sql();
  await s.query("UPDATE runs SET is_seed = 1 WHERE id = $1", [run.id]);
  return run;
}

async function review(org, packId, rating, body, byline) {
  await S.submitReview({ orgId: org.orgId, userId: org.userId, packId, rating, body, byline, anonymous: false });
  const s = await sql();
  await s.query("UPDATE pack_reviews SET is_seed = 1 WHERE pack_id = $1 AND org_id = $2", [packId, org.orgId]);
}

async function castVote(org, packId, value) {
  await S.vote(org.orgId, packId, value);
  const s = await sql();
  await s.query("UPDATE pack_votes SET is_seed = 1 WHERE pack_id = $1 AND org_id = $2", [packId, org.orgId]);
}

async function bookmark(org, packId) {
  await S.toggleSave(org.orgId, org.userId, packId);
}

/** The pack's latest version, publishing it first if this is a fresh catalog that never has been. */
async function ensurePublished(slug) {
  const pack = await P.getPack(slug);
  if (!pack) throw new Error(`no such pack: ${slug} — did seedCatalog run?`);
  const existing = await P.latestVersion(pack.id);
  const version = existing ?? (await P.publishPack(slug));
  return { pack, version };
}

// ------------------------------------------- the platform_org_id side effect
//
// `auth.signUp` — which every `seedOrg` call goes through, deliberately,
// because it is the real sign-up path — ends by calling `claimPlatformOrg`:
// an `INSERT ... ON CONFLICT (key) DO NOTHING` on `settings.platform_org_id`.
// On a database with no prior sign-ups, that is a one-way claim: the first
// organisation this script creates becomes the platform's permanent curator,
// and nothing else ever un-sets it. `wipe()` deleting that org from `orgs`
// would leave `platform_org_id` pointing at a row that no longer exists —
// not a crash, since every curator check is an equality against this value,
// but "nobody is the curator" for the rest of that database's life, which
// breaks `--wipe`'s own promise to remove what the seed created and nothing
// else. These two functions make that promise hold: a snapshot taken once,
// before the first `seedOrg` call, of whatever `platform_org_id` was (or
// that it was absent), restored verbatim by `wipe()` — and the snapshot
// itself removed, since it is as much a seed artifact as any row above.
const PLATFORM_ORG_SNAPSHOT_KEY = "seed_social_platform_org_id_snapshot";
const ABSENT = "__absent__";

/** Called once, before any org is created. A second seed() run (without a wipe in between) must not overwrite the true original with an in-between state, so this is a no-op once the snapshot already exists. */
async function snapshotPlatformOrgId() {
  const s = await sql();
  const already = await s.one("SELECT 1 AS ok FROM settings WHERE key = $1", [PLATFORM_ORG_SNAPSHOT_KEY]);
  if (already) return;
  const current = await s.one("SELECT value FROM settings WHERE key = 'platform_org_id'");
  await s.query(
    "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING",
    [PLATFORM_ORG_SNAPSHOT_KEY, current ? current.value : ABSENT],
  );
}

/** Restores platform_org_id to exactly what snapshotPlatformOrgId recorded — including deleting it if it was absent before — then deletes the snapshot itself. A no-op if seed() never ran (or was already wiped) in this database. */
async function restorePlatformOrgId() {
  const s = await sql();
  const snapshot = await s.one("SELECT value FROM settings WHERE key = $1", [PLATFORM_ORG_SNAPSHOT_KEY]);
  if (!snapshot) return;
  if (snapshot.value === ABSENT) {
    await s.query("DELETE FROM settings WHERE key = 'platform_org_id'");
  } else {
    await s.query(
      "INSERT INTO settings (key, value) VALUES ('platform_org_id', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
      [snapshot.value],
    );
  }
  await s.query("DELETE FROM settings WHERE key = $1", [PLATFORM_ORG_SNAPSHOT_KEY]);
}

// -------------------------------------------------------------- the seed

async function seed() {
  P.setRuntime(stubRuntime());
  await P.seedCatalog(); // idempotent: ON CONFLICT (slug) DO NOTHING
  // Before the first organisation is created — see the block above.
  await snapshotPlatformOrgId();

  // Pack A: seven ratings, above RATING_THRESHOLD (5) — the average renders.
  const { pack: packA, version: versionA } = await ensurePublished("guardrails");
  const ratingsA = [5, 5, 4, 5, 3, 4, 2];
  const reviewersA = [];
  for (const [i, rating] of ratingsA.entries()) {
    const org = await seedOrg(`Guardrails Reviewer ${i + 1}`);
    await completedRun(org, versionA.id);
    await review(org, packA.id, rating,
      `Caught a real issue in review ${i + 1} before it shipped.`, org.orgId);
    reviewersA.push(org);
  }

  // Pack B: exactly four ratings — deliberately at the threshold's doorstep,
  // so the average stays hidden. The contrast with pack A is the point.
  const { pack: packB, version: versionB } = await ensurePublished("campaign-strategist");
  const ratingsB = [5, 4, 4, 3];
  for (const [i, rating] of ratingsB.entries()) {
    const org = await seedOrg(`Campaign Reviewer ${i + 1}`);
    await completedRun(org, versionB.id);
    await review(org, packB.id, rating, `Used it for brief ${i + 1}.`, org.orgId);
  }

  // Votes on pack A: three real upvotes and one downvote, from organisations
  // that never ran anything — `vote` needs no run, unlike a review. The
  // downvote (`-1` is a legitimate stored value) must not inflate the
  // rendered "useful" count, which only ever counts `value > 0`.
  const voteOrgs = await Promise.all(
    ["Just Looking Co", "Window Shopper Co", "Bookmarked It Co", "Not For Me Co"].map((n2) => seedOrg(n2)));
  await castVote(voteOrgs[0], packA.id, 1);
  await castVote(voteOrgs[1], packA.id, 1);
  await castVote(voteOrgs[2], packA.id, 1);
  await castVote(voteOrgs[3], packA.id, -1);

  // Saves: two of pack A's own reviewers also bookmarked it.
  await bookmark(reviewersA[0], packA.id);
  await bookmark(reviewersA[1], packA.id);

  // Two threads, asked of a creator's profile rather than any one pack —
  // `openThread`'s `packId` is nullable for exactly this case — so seeding
  // buyer<->creator messaging does not require re-attributing a real
  // catalog pack's `creator_id` as a side effect of running this script.
  const creatorOrg = await seedOrg("Seed Studio", "Creator");
  const creator = await Cr.upsertCreator({
    orgId: creatorOrg.orgId, userId: creatorOrg.userId,
    handle: `seed-studio-${id()}`, displayName: "Seed Studio", bio: "Seeded for local review.",
  });
  const asker1 = await seedOrg("Asking Org One");
  const asker2 = await seedOrg("Asking Org Two");
  const thread1 = await M.openThread({
    orgId: asker1.orgId, userId: asker1.userId, creatorId: creator.id,
    subject: "Does this handle a multi-currency catalog?",
    body: "We sell in six currencies — does the worker reason about FX, or only one at a time?",
  });
  await M.reply({
    threadId: thread1.id, orgId: creatorOrg.orgId, userId: creatorOrg.userId,
    body: "It takes one currency per run today; run it once per currency for now.",
  });
  const thread2 = await M.openThread({
    orgId: asker2.orgId, userId: asker2.userId, creatorId: creator.id,
    subject: "Can it read a Notion doc for context?",
    body: "Our briefs live in Notion — can this pull from there, or does it need a pasted brief?",
  });

  return {
    packA: { slug: packA.slug, ratings: ratingsA.length },
    packB: { slug: packB.slug, ratings: ratingsB.length },
    votes: { up: 3, down: 1 },
    saves: 2,
    threads: [thread1.id, thread2.id],
  };
}

// -------------------------------------------------------------- the wipe

/**
 * Removes exactly the rows this script wrote — every row whose organisation
 * is `is_seed`, plus the creator profile and threads that organisation owns
 * — and nothing else. Never touches `packs` or `pack_versions`: a catalog
 * pack this script published (because it had no version yet) stays
 * published after a wipe, same as any other publish.
 *
 * Deleted in FK order (children before the parents `orgs`/`runs` they point
 * at), using subqueries scoped to `is_seed` rather than passed parameters —
 * nothing here is untrusted input, so there is nothing to parameterise.
 *
 * Also restores `platform_org_id` (see `restorePlatformOrgId` above) — the
 * one thing seeding changes that is not reachable from `orgs.is_seed`,
 * because it lives in `settings`, keyed by nothing seed-specific.
 */
async function wipe() {
  const s = await sql();
  const SEED_ORGS = "(SELECT id FROM orgs WHERE is_seed = 1)";
  const SEED_CREATORS = `(SELECT id FROM creators WHERE org_id IN ${SEED_ORGS})`;
  const before = await s.one("SELECT COUNT(*) AS n FROM orgs WHERE is_seed = 1");
  await s.exec(`DELETE FROM thread_messages WHERE thread_id IN
    (SELECT id FROM threads WHERE org_id IN ${SEED_ORGS} OR creator_id IN ${SEED_CREATORS})`);
  await s.exec(`DELETE FROM threads WHERE org_id IN ${SEED_ORGS} OR creator_id IN ${SEED_CREATORS}`);
  await s.exec(`DELETE FROM pack_saves WHERE org_id IN ${SEED_ORGS}`);
  await s.exec(`DELETE FROM pack_votes WHERE org_id IN ${SEED_ORGS}`);
  await s.exec(`DELETE FROM pack_reviews WHERE org_id IN ${SEED_ORGS}`);
  await s.exec(`DELETE FROM run_events WHERE run_id IN (SELECT id FROM runs WHERE org_id IN ${SEED_ORGS})`);
  await s.exec(`DELETE FROM entitlements WHERE org_id IN ${SEED_ORGS}`);
  await s.exec(`DELETE FROM purchases WHERE org_id IN ${SEED_ORGS}`);
  await s.exec(`DELETE FROM points_ledger WHERE org_id IN ${SEED_ORGS}`);
  await s.exec(`DELETE FROM runs WHERE org_id IN ${SEED_ORGS}`);
  await s.exec(`DELETE FROM creators WHERE org_id IN ${SEED_ORGS}`);
  await s.exec(`DELETE FROM user_sessions WHERE user_id IN (SELECT id FROM users WHERE org_id IN ${SEED_ORGS})`);
  await s.exec(`DELETE FROM users WHERE org_id IN ${SEED_ORGS}`);
  await s.exec("DELETE FROM orgs WHERE is_seed = 1");
  await restorePlatformOrgId();
  return Number(before?.n ?? 0);
}

// ----------------------------------------------------------------- the CLI

export async function main(argv = process.argv.slice(2), env = process.env) {
  // The environment first: a script that must never touch production should
  // not even try to connect to one.
  try {
    guardEnvironment(env);
  } catch (e) {
    console.error(e.message);
    return 2;
  }

  await initDb();
  const s = await sql();
  try {
    guardDialect(s);
  } catch (e) {
    console.error(e.message);
    return 2;
  }

  if (argv.includes("--wipe")) {
    const n2 = await wipe();
    console.log(`Wiped ${n2} seed organisation(s) and everything under them.`);
    return 0;
  }

  const result = await seed();
  console.log(`Seeded ${result.packA.slug}: ${result.packA.ratings} ratings (average renders).`);
  console.log(`Seeded ${result.packB.slug}: ${result.packB.ratings} ratings (below threshold — no average).`);
  console.log(`Votes on ${result.packA.slug}: ${result.votes.up} up, ${result.votes.down} down (only the up count is "useful").`);
  console.log(`Saves on ${result.packA.slug}: ${result.saves}.`);
  console.log(`Threads: ${result.threads.join(", ")}`);
  console.log("\nRun again with --wipe to remove everything this script wrote.");
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main());
}
