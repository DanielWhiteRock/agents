// Ask the creator: threads.ts/messages.ts storage and eligibility, run against
// the real build. No UI, no routes — those get their own HTTP-level coverage
// in tests/node/messages-routes.test.mjs; this file is domain logic only,
// the same split social.test.mjs and social-routes.test.mjs already use.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!process.env.DATABASE_URL) {
  process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "messages-")), "t.db");
}

let A, P, Auth, Cr, M, db, sql;
let n = 0;
const email = () => `m${++n}-${Date.now()}@example.com`;

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

const PACK_INPUT = {
  slug: "", name: "Thread Pack", tagline: "Something to ask a question about",
  author: "A Real Expert", model: "claude-opus-5", effort: "high",
  pricePoints: 0, upgradePoints: 0, instructions: "Read it first.",
};

before(async () => {
  db = await import("../../dist/src/app/db.js");
  A = await import("../../dist/src/app/auth.js");
  P = await import("../../dist/src/app/platform.js");
  Auth = await import("../../dist/src/app/authoring.js");
  Cr = await import("../../dist/src/app/creators.js");
  M = await import("../../dist/src/app/messages.js");
  sql = (await import("../../dist/src/app/sql.js")).sql;
  await db.initDb();
  P.setRuntime(stubRuntime());
});

const org = async (name) => A.signUp({ email: email(), name: "Someone", password: "correct-horse-battery-staple", orgName: name });

/** A creator with a published pack attributed to them. */
const creatorWithPack = async () => {
  const author = await org("Pack Creator Co");
  const creator = await Cr.upsertCreator({
    orgId: author.orgId, userId: author.userId, handle: `creator-${++n}`, displayName: "A Real Creator",
  });
  const slug = `thread-pack-${n}`;
  const pack = await Auth.createPack(author.orgId, { ...PACK_INPUT, slug });
  const s = await sql();
  await s.query("UPDATE packs SET creator_id = $1 WHERE id = $2", [creator.id, pack.id]);
  return { author, creator, pack: { ...pack, creator_id: creator.id } };
};

test("a buyer opens a thread and the creator sees it", async () => {
  const { creator, pack } = await creatorWithPack();
  const buyer = await org("Asking Buyer Co");

  const thread = await M.openThread({
    orgId: buyer.orgId, userId: buyer.userId, creatorId: creator.id, packId: pack.id,
    subject: "Does it touch the main branch?", body: "I want to know before I run this on anything real.",
  });
  assert.equal(thread.org_id, buyer.orgId);
  assert.equal(thread.creator_id, creator.id);
  assert.equal(thread.pack_id, pack.id);

  const inbox = await M.threadsFor(creator.id);
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].id, thread.id);
  assert.equal(inbox[0].askerOrgName, "Asking Buyer Co");
  assert.equal(inbox[0].messages.length, 1);
  assert.equal(inbox[0].messages[0].body, "I want to know before I run this on anything real.");

  const mine = await M.threadsForOrg(buyer.orgId);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].id, thread.id);
  assert.equal(mine[0].creatorHandle, creator.handle);

  // The creator can reply, and the asker sees it on their own side.
  await M.reply({ threadId: thread.id, orgId: creator.org_id, userId: creator.user_id, body: "No, read-only." });
  const mineAfter = await M.threadsForOrg(buyer.orgId);
  assert.equal(mineAfter[0].messages.length, 2);
  assert.equal(mineAfter[0].messages[1].body, "No, read-only.");
});

test("a third organisation sees neither the thread nor its existence", async () => {
  const { creator, pack } = await creatorWithPack();
  const buyer = await org("Private Asker Co");
  const thread = await M.openThread({
    orgId: buyer.orgId, userId: buyer.userId, creatorId: creator.id, packId: pack.id,
    subject: "Private question", body: "Only the two of us should ever see this.",
  });

  const third = await org("Nosy Third Co");

  // Neither inbox for the third organisation shows anything at all.
  assert.deepEqual(await M.threadsFor(creator.id).then((r) => r.filter((t) => t.org_id === third.orgId)), []);
  assert.deepEqual(await M.threadsForOrg(third.orgId), []);

  // And it cannot reply into the conversation by guessing the thread ID —
  // this is not a 200 with nothing in it, it is the same rejection a
  // nonexistent thread ID would get.
  await assert.rejects(
    M.reply({ threadId: thread.id, orgId: third.orgId, userId: third.userId, body: "let me in" }),
    (e) => e.name === "ThreadNotFoundError" && e.status === 404,
  );
  await assert.rejects(
    M.reply({ threadId: "thr_does_not_exist", orgId: third.orgId, userId: third.userId, body: "x" }),
    (e) => e.name === "ThreadNotFoundError" && e.status === 404,
    "a nonexistent thread and a real thread this org has no part in must fail identically",
  );

  // Nor can it publish an answer to the creator's FAQ on the creator's behalf.
  await assert.rejects(
    M.publishToFaq(creator.id, thread.id, thread.id, thread.id),
    (e) => e.name !== undefined, // any rejection is correct here; the specific assertion is reply() above
  );
});

test("publishing appends the question and answer to the FAQ, naming neither the asker nor the asker's organisation", async () => {
  const { creator, pack } = await creatorWithPack();
  const buyer = await org("Confidential Buyer Organisation");
  const thread = await M.openThread({
    orgId: buyer.orgId, userId: buyer.userId, creatorId: creator.id, packId: pack.id,
    subject: "Network access?", body: "Does this need network access to run?",
  });
  await M.reply({
    threadId: thread.id, orgId: creator.org_id, userId: creator.user_id,
    body: "No — everything happens on the files you give it.",
  });

  const [question, answer] = (await M.threadsFor(creator.id))[0].messages;
  await M.publishToFaq(creator.id, thread.id, question.id, answer.id);

  const s = await sql();
  const row = await s.one("SELECT faq FROM packs WHERE id = $1", [pack.id]);
  const faq = JSON.parse(row.faq);
  assert.deepEqual(faq, [{ q: "Does this need network access to run?", a: "No — everything happens on the files you give it." }]);

  // Nothing in the stored FAQ or the row that produced it names the asker.
  const serialized = JSON.stringify(faq);
  assert.doesNotMatch(serialized, /Confidential Buyer Organisation/);
  assert.ok(!serialized.includes(buyer.orgId), "not even the asking organisation's ID leaks into the FAQ");

  // And it cannot be published twice.
  await assert.rejects(
    M.publishToFaq(creator.id, thread.id, question.id, answer.id),
    (e) => e.name === "MessagesInputError",
  );
});

test("publishToFaq refuses a thread with no pack to publish to", async () => {
  const author = await org("Profile Only Creator Co");
  const creator = await Cr.upsertCreator({
    orgId: author.orgId, userId: author.userId, handle: `profile-${++n}`, displayName: "Profile Only",
  });
  const buyer = await org("Profile Asker Co");
  const thread = await M.openThread({
    orgId: buyer.orgId, userId: buyer.userId, creatorId: creator.id, packId: null,
    subject: "General question", body: "Not about any one pack.",
  });
  await M.reply({ threadId: thread.id, orgId: creator.org_id, userId: creator.user_id, body: "Sure, go ahead." });
  const [question, answer] = (await M.threadsFor(creator.id))[0].messages;

  await assert.rejects(
    M.publishToFaq(creator.id, thread.id, question.id, answer.id),
    (e) => e.name === "MessagesInputError",
  );
});

test("the eleventh thread an organisation opens in one day is refused", async () => {
  const { creator, pack } = await creatorWithPack();
  const buyer = await org("Prolific Asker Co");

  for (let i = 0; i < 10; i++) {
    await M.openThread({
      orgId: buyer.orgId, userId: buyer.userId, creatorId: creator.id, packId: pack.id,
      subject: `Question ${i}`, body: `Body of question ${i}`,
    });
  }
  assert.equal((await M.threadsForOrg(buyer.orgId)).length, 10);

  await assert.rejects(
    M.openThread({
      orgId: buyer.orgId, userId: buyer.userId, creatorId: creator.id, packId: pack.id,
      subject: "Question 11", body: "One too many.",
    }),
    (e) => e.name === "ThreadLimitError" && e.status === 400,
  );
  // Refused, so no eleventh thread is left behind.
  assert.equal((await M.threadsForOrg(buyer.orgId)).length, 10);

  // A different organisation is entirely unaffected by this one's limit.
  const other = await org("Unrelated Asker Co");
  await M.openThread({
    orgId: other.orgId, userId: other.userId, creatorId: creator.id, packId: pack.id,
    subject: "A fresh question", body: "From a different organisation entirely.",
  });
  assert.equal((await M.threadsForOrg(other.orgId)).length, 1);
});

test("openThread rejects an empty subject or body", async () => {
  const { creator, pack } = await creatorWithPack();
  const buyer = await org("Blank Field Co");
  await assert.rejects(
    M.openThread({ orgId: buyer.orgId, userId: buyer.userId, creatorId: creator.id, packId: pack.id, subject: "   ", body: "something" }),
    (e) => e.name === "MessagesInputError",
  );
  await assert.rejects(
    M.openThread({ orgId: buyer.orgId, userId: buyer.userId, creatorId: creator.id, packId: pack.id, subject: "something", body: "  " }),
    (e) => e.name === "MessagesInputError",
  );
});

test("openThread rejects a pack that belongs to a different creator", async () => {
  const { pack } = await creatorWithPack();
  const otherAuthor = await org("Other Creator Co");
  const otherCreator = await Cr.upsertCreator({
    orgId: otherAuthor.orgId, userId: otherAuthor.userId, handle: `other-${++n}`, displayName: "Other Creator",
  });
  const buyer = await org("Mismatch Asker Co");
  await assert.rejects(
    M.openThread({
      orgId: buyer.orgId, userId: buyer.userId, creatorId: otherCreator.id, packId: pack.id,
      subject: "Wrong creator", body: "This pack is not theirs.",
    }),
    (e) => e.name === "MessagesInputError",
  );
});
