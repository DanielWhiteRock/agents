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
  assert.equal(pack.built_on, "", "plain text defaults to '', not SQL NULL, like description does");
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

// --------------------------------------------- generated copy, and its rails

/**
 * The copy-quality guard. A listing that pastes the pack body describes
 * nothing: the instructions reach a buyer through other doors now, so this is
 * not a secrecy control — it is a refusal to ship lazy prose.
 */
const LONG_INSTRUCTIONS = [
  "Open the pricing sheet and find every rate that has not moved in two quarters,",
  "then write the single sentence that explains why it should move now.",
].join(" ");

test("a draft whose text reproduces the instructions is refused", async () => {
  const { pack } = await makePack({ instructions: LONG_INSTRUCTIONS });
  await assert.rejects(
    L.saveDraft(pack.id, {
      ...DRAFT,
      description: "This worker will open the pricing sheet and find every rate that has not moved in two quarters.",
    }, 1),
    /verbatim/i,
    "a twelve-word run lifted out of the instructions must be refused");
  assert.equal(await L.draftFor(pack.id), null, "the refused draft was not stored");
});

test("a draft that describes the pack in its own words is accepted", async () => {
  const { pack } = await makePack({ instructions: LONG_INSTRUCTIONS });
  await L.saveDraft(pack.id, {
    ...DRAFT,
    description: "Audits a price list for rates that have gone stale, and argues for the one that matters.",
  }, 1);
  assert.match((await L.draftFor(pack.id)).description, /^Audits a price list/);
});

test("the guard reads every field of the draft, not only the description", async () => {
  const { pack } = await makePack({ instructions: LONG_INSTRUCTIONS });
  await assert.rejects(
    L.saveDraft(pack.id, {
      ...DRAFT,
      useCases: ["then write the single sentence that explains why it should move now, for you"],
    }, 1),
    /verbatim/i);
});

/**
 * `approveDraft` copies the draft's six fields onto `packs`, faq included — so
 * a generated draft that knows nothing of the answers a creator published out
 * of a real buyer exchange would delete them on approval, unrecoverably,
 * without going back to the thread. A generated draft starts from what is
 * already live.
 */
const PUBLISHED_ANSWER = { q: "Does it need write access?", a: "No — read-only, always." };

test("a generated draft starts from the FAQ already live, so approving only adds", async () => {
  const { orgId, pack } = await makePack();
  const s = await sql();
  await s.query("UPDATE packs SET faq = $1 WHERE id = $2", [JSON.stringify([PUBLISHED_ANSWER]), pack.id]);

  await L.saveGeneratedDraft(pack.id, { ...DRAFT, faq: [{ q: "Which currencies?", a: "USD only." }] }, 1);
  const draft = await L.draftFor(pack.id);
  assert.deepEqual(draft.faq[0], PUBLISHED_ANSWER, "the live answer is the first thing in the draft");
  assert.equal(draft.faq.length, 2, "and the generated question was added to it");

  await L.approveDraft(orgId, pack.slug);
  const live = L.listingOf(await P.getPack(pack.slug));
  assert.deepEqual(live.faq[0], PUBLISHED_ANSWER, "approval did not delete the published answer");
  assert.equal(live.faq.length, 2);
});

test("a generated draft does not duplicate a live answer the model also guessed at", async () => {
  const { pack } = await makePack();
  const s = await sql();
  await s.query("UPDATE packs SET faq = $1 WHERE id = $2", [JSON.stringify([PUBLISHED_ANSWER]), pack.id]);
  await L.saveGeneratedDraft(pack.id, {
    ...DRAFT,
    faq: [{ q: "  does it need write access?  ", a: "Probably not." }],
  }, 1);
  const draft = await L.draftFor(pack.id);
  assert.equal(draft.faq.length, 1, "one question, asked once");
  assert.equal(draft.faq[0].a, PUBLISHED_ANSWER.a, "and the answer a human wrote is the one kept");
});

/**
 * The copy-quality guard judges what the model wrote, not what this module
 * put in front of it.
 *
 * `publishToFaq` stores a buyer's question and a creator's answer word for
 * word, and the instructions are not secret — a creator explaining their own
 * method, or a buyer quoting the exported `.md`, easily shares a twelve-word
 * run with it. Running the guard over the merged FAQ meant such a pack could
 * never have a listing generated again, and the error blamed the model.
 */
test("a published answer that quotes the method does not block generation forever", async () => {
  const { orgId, pack } = await makePack({ instructions: LONG_INSTRUCTIONS });
  const quoted = {
    q: "What does it actually read?",
    a: "It will open the pricing sheet and find every rate that has not moved in two quarters.",
  };
  const s = await sql();
  await s.query("UPDATE packs SET faq = $1 WHERE id = $2", [JSON.stringify([quoted]), pack.id]);

  await L.saveGeneratedDraft(pack.id, {
    ...DRAFT,
    description: "Audits a price list for rates that have gone stale.",
    faq: [{ q: "Which currencies?", a: "USD only." }],
  }, 1);

  const draft = await L.draftFor(pack.id);
  assert.deepEqual(draft.faq[0], quoted, "the published answer is carried forward, not judged");
  assert.equal(draft.faq.length, 2);

  // And it still survives approval, which is the point of carrying it.
  await L.approveDraft(orgId, pack.slug);
  assert.deepEqual(L.listingOf(await P.getPack(pack.slug)).faq[0], quoted);
});

test("the guard still refuses a model-written FAQ entry that quotes the method", async () => {
  const { pack } = await makePack({ instructions: LONG_INSTRUCTIONS });
  await assert.rejects(
    L.saveGeneratedDraft(pack.id, {
      ...DRAFT,
      faq: [{ q: "What does it read?", a: "It will open the pricing sheet and find every rate that has not moved in two quarters." }],
    }, 1),
    /verbatim/i,
    "what the model proposed is still judged, FAQ included");
  assert.equal(await L.draftFor(pack.id), null);
});

test("approving never drops an answer published after the draft was generated", async () => {
  const { orgId, pack } = await makePack();
  await L.saveGeneratedDraft(pack.id, { ...DRAFT, faq: [{ q: "Which currencies?", a: "USD only." }] }, 1);
  // The creator answers a buyer and publishes it from the inbox *after* the
  // generator ran — the draft on disk has never seen it.
  const s = await sql();
  await s.query("UPDATE packs SET faq = $1 WHERE id = $2", [JSON.stringify([PUBLISHED_ANSWER]), pack.id]);

  await L.approveDraft(orgId, pack.slug);
  const live = L.listingOf(await P.getPack(pack.slug));
  assert.ok(live.faq.some((f) => f.q === PUBLISHED_ANSWER.q), "the published answer survived approval");
  assert.ok(live.faq.some((f) => f.q === "Which currencies?"), "and the approved draft is live too");
});

/**
 * Nothing wrote `scenarios` before this task, and the pack page renders
 * `s.reached.length` directly — so a stored scenario missing a field would
 * 500 the whole page rather than skip a card.
 */
test("a stored scenario missing its fields is normalised rather than left to break the page", async () => {
  const { pack } = await makePack();
  const s = await sql();
  await s.query("UPDATE packs SET scenarios = $1, faq = $2 WHERE id = $3", [
    JSON.stringify([{ brief: "A 10% price hike" }, "not an object", null, { output: "no brief at all" }]),
    JSON.stringify([{ q: "Real question?" }, { a: "an answer with no question" }, 7]),
    pack.id]);
  const live = L.listingOf(await P.getPack(pack.slug));
  assert.deepEqual(live.scenarios, [{ brief: "A 10% price hike", reached: [], output: "" }]);
  assert.deepEqual(live.faq, [{ q: "Real question?", a: "" }]);
});

test("a scenario's reached list is normalised to strings", async () => {
  const { pack } = await makePack();
  const s = await sql();
  await s.query("UPDATE packs SET scenarios = $1 WHERE id = $2", [
    JSON.stringify([{ brief: "b", reached: ["bash", 3, null, "read"], output: "o" }]), pack.id]);
  const live = L.listingOf(await P.getPack(pack.slug));
  assert.deepEqual(live.scenarios[0].reached, ["bash", "read"]);
});

test("a draft carries scenarios through approval", async () => {
  const { orgId, pack } = await makePack();
  await L.saveDraft(pack.id, DRAFT, 1);
  await L.approveDraft(orgId, pack.slug);
  assert.deepEqual(L.listingOf(await P.getPack(pack.slug)).scenarios, DRAFT.scenarios);
});

test("markStale stamps the live listing without changing a word of it", async () => {
  const { orgId, pack } = await makePack();
  await L.saveDraft(pack.id, DRAFT, 1);
  await L.approveDraft(orgId, pack.slug);
  await L.markStale(pack.id);
  const after = await P.getPack(pack.slug);
  assert.ok(after.listing_stale_at, "stamped");
  assert.equal(after.description, DRAFT.description, "and the buyer still reads the approved copy");
});

test("a draft keeps the metadata the approval screen needs", async () => {
  const { pack } = await makePack();
  await L.saveDraft(pack.id, DRAFT, 4);
  const meta = await L.draftWithMeta(pack.id);
  assert.equal(meta.sourceVersion, 4);
  assert.ok(meta.generatedAt, "when it was generated");
  assert.equal(meta.listing.description, DRAFT.description);
  assert.equal(await L.draftWithMeta("pk_nothing"), null);
});

// -------------------------------------------- the scenarios frontmatter key

test("a pack carries scenarios in and out of the listing columns", async () => {
  const { orgId, pack } = await makePack();
  const scenarios = [{ brief: "A 10% hike", reached: ["read", "bash"], output: "a flagged diff" }];
  await Auth.updatePack(orgId, pack.slug, { ...INPUT, slug: pack.slug, scenarios });
  assert.deepEqual(L.listingOf(await P.getPack(pack.slug)).scenarios, scenarios);
  // A caller that never mentions scenarios leaves the stored ones alone, the
  // same rule its five siblings already follow.
  await Auth.updatePack(orgId, pack.slug, { ...INPUT, slug: pack.slug });
  assert.deepEqual(L.listingOf(await P.getPack(pack.slug)).scenarios, scenarios);
});

test("a new pack can be created with scenarios", async () => {
  const { orgId } = await A.signUp({ email: email(), name: "Author", password: "correct-horse", orgName: "Scen Co" });
  const scenarios = [{ brief: "A brief", reached: ["read"], output: "an output" }];
  const pack = await Auth.createPack(orgId, { ...INPUT, slug: `scen-${++n}`, scenarios });
  assert.deepEqual(L.listingOf(pack).scenarios, scenarios);
});

// ------------------------------------------------------------- changelog

/**
 * A changelog note is the one exception to listing metadata attaching to the
 * pack rather than the version: it describes the version it ships with, and
 * a version is immutable, so the note is captured once, at publish.
 */
test("publishing with a note records it against that version", async () => {
  const { pack } = await makePack();
  const v = await P.publishPack(pack.slug, "Added support for private repositories.");
  const entries = await P.changelogOf(pack.id);
  assert.deepEqual(entries, [
    { version: v.version, note: "Added support for private repositories.", createdAt: entries[0]?.createdAt },
  ]);
  assert.ok(entries[0].createdAt, "stamped");
});

test("publishing without a note succeeds and records nothing", async () => {
  const { pack } = await makePack();
  const v = await P.publishPack(pack.slug);
  assert.ok(v.id, "the publish itself still succeeds");
  assert.deepEqual(await P.changelogOf(pack.id), []);
});

test("publishing with a blank or whitespace-only note records nothing", async () => {
  const { pack } = await makePack();
  await P.publishPack(pack.slug, "   ");
  assert.deepEqual(await P.changelogOf(pack.id), []);
});

test("changelogOf lists only versions an author actually wrote a note for, newest first", async () => {
  const { pack } = await makePack();
  const v1 = await P.publishPack(pack.slug, "First note.");
  await P.publishPack(pack.slug); // v2, no note
  const v3 = await P.publishPack(pack.slug, "Third note.");

  const entries = await P.changelogOf(pack.id);
  assert.deepEqual(entries.map((e) => e.version), [v3.version, v1.version]);
  assert.equal(entries.find((e) => e.version === v3.version).note, "Third note.");
  assert.equal(entries.find((e) => e.version === v1.version).note, "First note.");
});
