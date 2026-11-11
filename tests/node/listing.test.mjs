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

let A, P, Auth, L, M, Cr, db, sql;
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
  M = await import("../../dist/src/app/messages.js");
  Cr = await import("../../dist/src/app/creators.js");
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

/**
 * Who wrote the draft decides what approval does with the FAQ.
 *
 * The merge above exists to stop a *generator* deleting an answer a creator
 * published out of a real buyer exchange. It was never meant to stop a person
 * editing their own listing — and because it did, nothing in the application
 * could change or delete a live answer, while the approval screen said the
 * draft would be published as saved. `saveDraft` is the human path and marks
 * the draft as such; `saveGeneratedDraft` marks it as the machine's.
 */
test("an answer the author rewrote by hand reaches the page", async () => {
  const { orgId, pack } = await makePack();
  const s = await sql();
  await s.query("UPDATE packs SET faq = $1 WHERE id = $2", [JSON.stringify([PUBLISHED_ANSWER]), pack.id]);

  await L.saveDraft(pack.id, {
    ...DRAFT,
    faq: [{ q: PUBLISHED_ANSWER.q, a: "No — read-only, and it never pushes a branch." }],
  }, 1);
  await L.approveDraft(orgId, pack.slug);

  const live = L.listingOf(await P.getPack(pack.slug));
  assert.deepEqual(live.faq, [{ q: PUBLISHED_ANSWER.q, a: "No — read-only, and it never pushes a branch." }],
    "the author's correction is what a buyer reads, not the answer it replaced");
});

test("an answer the author deleted by hand leaves the page", async () => {
  const { orgId, pack } = await makePack();
  const keep = { q: "Which currencies?", a: "USD only." };
  const s = await sql();
  await s.query("UPDATE packs SET faq = $1 WHERE id = $2",
    [JSON.stringify([PUBLISHED_ANSWER, keep]), pack.id]);

  // The author emptied one block out of the FAQ box and saved what was left.
  await L.saveDraft(pack.id, { ...DRAFT, faq: [keep] }, 1);
  await L.approveDraft(orgId, pack.slug);

  assert.deepEqual(L.listingOf(await P.getPack(pack.slug)).faq, [keep],
    "an answer removed from the box is removed from the page");
});

test("a human editing a generated draft takes it over, and can then delete a live answer", async () => {
  const { orgId, pack } = await makePack();
  const s = await sql();
  await s.query("UPDATE packs SET faq = $1 WHERE id = $2", [JSON.stringify([PUBLISHED_ANSWER]), pack.id]);

  await L.saveGeneratedDraft(pack.id, { ...DRAFT, faq: [{ q: "Which currencies?", a: "USD only." }] }, 1);
  const seeded = await L.draftWithMeta(pack.id);
  assert.equal(seeded.authoredBy, "generator", "the generator wrote it");
  assert.equal(seeded.listing.faq.length, 2, "and it was seeded from what is live");

  // The author reads that box, removes the published answer and saves: the
  // contents are now theirs, whoever typed them first.
  await L.saveDraft(pack.id, {
    ...DRAFT,
    faq: seeded.listing.faq.filter((f) => f.q !== PUBLISHED_ANSWER.q),
  }, 1);
  assert.equal((await L.draftWithMeta(pack.id)).authoredBy, "human", "saving flipped the provenance");

  await L.approveDraft(orgId, pack.slug);
  const live = L.listingOf(await P.getPack(pack.slug));
  assert.deepEqual(live.faq.map((f) => f.q), ["Which currencies?"],
    "the answer the author removed is gone, because they took responsibility for the box");
});

test("a draft left unmarked is read as the generator's, which is the side that loses nothing", async () => {
  const { orgId, pack } = await makePack();
  const s = await sql();
  await s.query("UPDATE packs SET faq = $1 WHERE id = $2", [JSON.stringify([PUBLISHED_ANSWER]), pack.id]);
  await L.saveDraft(pack.id, { ...DRAFT, faq: [{ q: "Which currencies?", a: "USD only." }] }, 1);
  // A row written before the column existed, or by a writer that does not set
  // it: the default covers the first, this covers anything else.
  await s.query("UPDATE pack_listing_drafts SET authored_by = $1 WHERE pack_id = $2", ["", pack.id]);
  assert.equal((await L.draftWithMeta(pack.id)).authoredBy, "generator");

  await L.approveDraft(orgId, pack.slug);
  assert.ok(L.listingOf(await P.getPack(pack.slug)).faq.some((f) => f.q === PUBLISHED_ANSWER.q),
    "an unmarked draft is merged, so the published answer survives");
});

// --------------------------------------------------- a save with nothing in it
//
// The upsert takes whatever arrives, so a submission with all six boxes blank
// used to replace a generated draft with an empty one and say nothing: the
// draft gone, and a model call to get it back.

const EMPTY = {
  description: "", useCases: [], limitations: [], faq: [], scenarios: [], requirements: [],
};

test("a save with every field empty is refused, and the draft that was there survives", async () => {
  const { pack } = await makePack();
  await L.saveGeneratedDraft(pack.id, DRAFT, 1);

  await assert.rejects(L.saveDraft(pack.id, EMPTY, 1), /every field was blank/);

  const still = await L.draftWithMeta(pack.id);
  assert.equal(still.listing.description, DRAFT.description, "the draft is exactly as it was");
  assert.equal(still.authoredBy, "generator", "and the refused save did not claim it either");
});

test("emptying five of the six fields is a real listing, and publishes", async () => {
  // The refusal is only for a submission with nothing in it at all — every
  // individual field, the FAQ included, can still be cleared and published.
  const { orgId, pack } = await makePack();
  const s = await sql();
  await s.query("UPDATE packs SET faq = $1 WHERE id = $2", [JSON.stringify([PUBLISHED_ANSWER]), pack.id]);

  await L.saveDraft(pack.id, { ...EMPTY, description: "Audits a price list, and nothing else." }, 1);
  await L.approveDraft(orgId, pack.slug);

  const live = L.listingOf(await P.getPack(pack.slug));
  assert.equal(live.description, "Audits a price list, and nothing else.");
  assert.deepEqual(live.faq, [], "including the FAQ the author emptied");
  assert.deepEqual(live.useCases, []);
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

// ------------------------------------------------- two writers, one column
//
// `packs.faq` is written by `approveDraft` here and by `publishToFaq` in
// messages.ts, and both of them read the column, change it in memory and
// write the whole thing back. Interleaved, the loser's entry is gone — the
// same content loss the FAQ merge exists to prevent, arrived at from the
// other direction. There is no transaction primitive in `src/app/sql.ts` and
// adding one is its own piece of work, so the write is conditional on the
// value it was computed from and retried on a miss.

/** A pack, its author, a creator profile for that author, and a buyer's thread about it. */
const packWithThread = async () => {
  const author = await A.signUp({
    email: email(), name: "Author", password: "correct-horse", orgName: `Race Author ${++n}`,
  });
  const slug = `race-${n}`;
  const pack = await Auth.createPack(author.orgId, { ...INPUT, slug });
  const creator = await Cr.upsertCreator({
    orgId: author.orgId, userId: author.userId,
    handle: `race-creator-${n}`, displayName: "Race Creator",
  });
  const s = await sql();
  await s.query("UPDATE packs SET creator_id = $1 WHERE id = $2", [creator.id, pack.id]);

  const buyer = await A.signUp({
    email: email(), name: "Buyer", password: "correct-horse", orgName: `Race Buyer ${n}`,
  });
  const thread = await M.openThread({
    orgId: buyer.orgId, userId: buyer.userId, creatorId: creator.id, packId: pack.id,
    subject: "Currencies?", body: "Does it handle more than one currency in a run?",
  });
  await M.reply({
    threadId: thread.id, orgId: author.orgId, userId: author.userId,
    body: "One per run today — run it once per currency.",
  });
  // Picked by who wrote them, not by order: both rows can carry the same
  // millisecond, and `publishToFaq` insists the question is the asker's and
  // the answer the creator's.
  const messages = await s.query("SELECT * FROM thread_messages WHERE thread_id = $1", [thread.id]);
  return {
    author, buyer, pack, creator, thread,
    question: messages.find((m) => m.org_id === buyer.orgId),
    answer: messages.find((m) => m.org_id === author.orgId),
  };
};

test("a FAQ write computed from a stale read lands nothing rather than overwriting", async () => {
  const { pack, creator, thread, question, answer } = await packWithThread();
  const s = await sql();

  // What `approveDraft` reads before it merges.
  const was = (await P.packById(pack.id)).faq ?? "";

  // A creator publishes an answer out of the inbox in the gap.
  await M.publishToFaq(creator.id, thread.id, question.id, answer.id);
  const published = JSON.parse((await P.packById(pack.id)).faq);
  assert.equal(published.length, 1);

  // The stale write — the one that used to clobber it — now affects no rows,
  // which is what the retry is triggered by. RETURNING on both drivers.
  const written = await s.query(
    "UPDATE packs SET faq = $1 WHERE id = $2 AND COALESCE(faq, '') = $3 RETURNING id",
    [JSON.stringify([{ q: "Mine", a: "Only mine." }]), pack.id, was]);
  assert.equal(written.length, 0, "a conditional write on a changed value writes nothing");
  assert.deepEqual(JSON.parse((await P.packById(pack.id)).faq), published, "the published answer survives");

  // And the condition is the whole of what saves it: the same statement
  // without the guard — what both writers used to run — takes the answer out.
  await s.query("UPDATE packs SET faq = $1 WHERE id = $2",
    [JSON.stringify([{ q: "Mine", a: "Only mine." }]), pack.id]);
  assert.deepEqual(JSON.parse((await P.packById(pack.id)).faq), [{ q: "Mine", a: "Only mine." }],
    "unguarded, the creator's published answer is simply gone");
});

test("publishing an answer and approving a listing at the same time loses neither", async () => {
  const { author, pack, creator, thread, question, answer } = await packWithThread();
  const s = await sql();
  // One entry already live, so the merge has something to carry as well.
  await s.query("UPDATE packs SET faq = $1 WHERE id = $2",
    [JSON.stringify([{ q: "Already live?", a: "Yes." }]), pack.id]);
  // The generator's draft, deliberately: a draft the author saved is
  // authoritative for the FAQ, so the merge this race is about is the one on
  // the generated path.
  await L.saveGeneratedDraft(pack.id, { ...DRAFT, faq: [{ q: "From the generator?", a: "Yes." }] }, 1);

  // Both read-modify-write cycles in flight at once: each `await` inside them
  // is a point where the other one runs, which is exactly the interleaving.
  await Promise.all([
    M.publishToFaq(creator.id, thread.id, question.id, answer.id),
    L.approveDraft(author.orgId, pack.slug),
  ]);

  const faq = JSON.parse((await P.packById(pack.id)).faq);
  const questions = faq.map((f) => f.q);
  assert.ok(questions.includes("Already live?"), "the entry that was already live survives");
  assert.ok(questions.includes("From the generator?"), "the approved draft's entry is there");
  assert.ok(questions.includes(question.body), "and so is the answer published out of the inbox");
  assert.equal(await L.draftFor(pack.id), null, "the draft was consumed exactly once");
});

/**
 * The third writer of `packs.faq`: a folder's own `faq:` block, merged by
 * `importPack`. The merge stops a re-import deleting a published answer it
 * knows nothing about. The compare-and-set below stops the *read* it merged
 * from going stale under it, which is the same loss by a different route.
 *
 * This first case pins the merge, end to end, with both writers in flight —
 * not the condition: the interleaving Node actually produces here runs the
 * two writes in order, so it would pass without a guard. The case after it is
 * the one that fails if the condition goes.
 */
test("a folder re-import and an inbox publish at the same time lose neither answer", async () => {
  const { author, pack, creator, thread, question, answer } = await packWithThread();
  const s = await sql();
  await s.query("UPDATE packs SET faq = $1 WHERE id = $2",
    [JSON.stringify([{ q: "Already live?", a: "Yes." }]), pack.id]);

  const files = [{
    path: "agent.md",
    text: `---\nname: ${pack.name}\nslug: ${pack.slug}\nmodel: claude-opus-5\n`
      + `faq:\n  - q: From the folder?\n    a: Yes.\n---\n${INPUT.instructions}`,
  }];

  // Both read-modify-write cycles in flight at once, the same interleaving the
  // approval test above drives.
  await Promise.all([
    M.publishToFaq(creator.id, thread.id, question.id, answer.id),
    Auth.importPack({ orgId: author.orgId, files }),
  ]);

  const questions = JSON.parse((await P.packById(pack.id)).faq).map((f) => f.q);
  assert.ok(questions.includes("Already live?"), "the entry that was already live survives");
  assert.ok(questions.includes("From the folder?"), "the folder's own entry landed");
  assert.ok(questions.includes(question.body),
    "and so does the answer published out of the inbox while the import was running");
});

test("an import's write computed from a stale FAQ read lands nothing at all", async () => {
  const { author, pack, creator, thread, question, answer } = await packWithThread();
  const s = await sql();
  await s.query("UPDATE packs SET faq = $1 WHERE id = $2",
    [JSON.stringify([{ q: "Already live?", a: "Yes." }]), pack.id]);

  // What the import reads before it merges the folder's own entries in.
  const was = (await P.packById(pack.id)).faq ?? "";

  // The creator publishes an answer out of the inbox in the gap — the whole
  // of the window the merge cannot see, because it already read the column.
  await M.publishToFaq(creator.id, thread.id, question.id, answer.id);

  // The import's write, still carrying the value it computed from that read.
  // Refused, and nothing written — which is what the retry re-reads on.
  await assert.rejects(
    Auth.updatePack(author.orgId, pack.slug, {
      ...INPUT, slug: pack.slug,
      faq: [{ q: "Already live?", a: "Yes." }, { q: "From the folder?", a: "Yes." }],
    }, { faq: was }),
    /same time/);

  const questions = JSON.parse((await P.packById(pack.id)).faq).map((f) => f.q);
  assert.ok(questions.includes(question.body), "the answer published in the gap survives");
  assert.ok(!questions.includes("From the folder?"), "and the stale write landed nothing");
});

test("an import's write with the FAQ it really read goes through", async () => {
  // The other half of the condition: it refuses a stale write, not every write.
  const { author, pack } = await packWithThread();
  const s = await sql();
  await s.query("UPDATE packs SET faq = $1 WHERE id = $2",
    [JSON.stringify([{ q: "Already live?", a: "Yes." }]), pack.id]);
  const was = (await P.packById(pack.id)).faq ?? "";

  await Auth.updatePack(author.orgId, pack.slug, {
    ...INPUT, slug: pack.slug,
    faq: [{ q: "Already live?", a: "Yes." }, { q: "From the folder?", a: "Yes." }],
  }, { faq: was });

  const questions = JSON.parse((await P.packById(pack.id)).faq).map((f) => f.q);
  assert.deepEqual(questions, ["Already live?", "From the folder?"]);
});

test("a changelog note is written once per version, and a repeat is ignored rather than thrown", async () => {
  // The insert used to carry no ON CONFLICT. Today the only racer is stopped
  // earlier by `pack_versions`' UNIQUE (pack_id, version), so this is defence
  // in depth — but it is also the one place the clause itself is exercised,
  // and `ON CONFLICT (a, b)` against a composite primary key is a different
  // constraint kind from the other upserts in this schema.
  const { pack } = await makePack();
  await P.publishPack(pack.slug, "The first note.");
  const s = await sql();
  const repeat = await s.query(
    `INSERT INTO pack_changelog (pack_id, version, note, created_at) VALUES ($1,$2,$3,$4)
     ON CONFLICT (pack_id, version) DO NOTHING`,
    [pack.id, 1, "A second note for the same, immutable version.", db.now()]);
  assert.equal(repeat.length, 0, "nothing inserted, and nothing thrown");
  const notes = await P.changelogOf(pack.id);
  assert.deepEqual(notes.map((c) => c.note), ["The first note."], "the note already recorded stands");
});
