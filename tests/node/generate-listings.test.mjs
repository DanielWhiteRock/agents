// The generator, with the model call replaced.
//
// `scripts/generate-listings.mjs` exports everything except the one function
// that talks to Anthropic, and takes that function as an argument — so this
// file exercises the whole path (read the pack, build the brief, parse the
// proposal, write a draft) without a network call, an API key, or a bill.
// Nothing here may depend on live credentials.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!process.env.DATABASE_URL) {
  process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "generate-")), "t.db");
}

let A, Auth, P, L, G, db, sql;
let n = 0;
const email = () => `g${++n}-${Date.now()}@example.com`;

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

const INSTRUCTIONS = [
  "You are reviewing a pricing change before it ships.",
  "Open the sheet, find every rate that has not moved in two quarters, and write the one sentence that says why it should.",
].join("\n\n");

const INPUT = {
  slug: "", name: "Pricing Reviewer", tagline: "Checks a pricing change before you ship it",
  author: "A Real Expert", model: "claude-opus-5", effort: "high",
  pricePoints: 49, upgradePoints: 10, instructions: INSTRUCTIONS,
};

/** What a well-behaved model hands back: derived prose, in the stored shape. */
const PROPOSAL = {
  description: "Reads a price list the way a finance lead would, and argues for the one rate that should move.",
  use_cases: ["Sanity-check a price rise before it ships", "Find the rate nobody has looked at in a year"],
  limitations: ["Does not convert currencies", "Needs the sheet, not a screenshot"],
  faq: [{ q: "Which file formats?", a: "A CSV or a pasted table." }],
  scenarios: [{ brief: "A 10% rise across one tier", reached: ["read the sheet", "flagged two stale rates"], output: "A short memo, worst rate first." }],
  requirements: ["A current price list"],
};

before(async () => {
  db = await import("../../dist/src/app/db.js");
  A = await import("../../dist/src/app/auth.js");
  Auth = await import("../../dist/src/app/authoring.js");
  P = await import("../../dist/src/app/platform.js");
  L = await import("../../dist/src/app/listing.js");
  sql = (await import("../../dist/src/app/sql.js")).sql;
  G = await import("../../scripts/generate-listings.mjs");
  await db.initDb();
  P.setRuntime(stubRuntime());
});

const makePack = async (over = {}) => {
  const { orgId } = await A.signUp({ email: email(), name: "Author", password: "correct-horse", orgName: "Gen Co" });
  const slug = `gen-${++n}`;
  const pack = await Auth.createPack(orgId, { ...INPUT, slug, ...over });
  await P.savePackTree(pack.id, [
    { path: "agent.md", content: `---\nname: ${INPUT.name}\n---\n${INSTRUCTIONS}` },
    { path: "skills/stale-rates/SKILL.md",
      content: "---\nname: stale-rates\ndescription: How to spot a rate that has not moved\n---\n\nLook at the date column." },
    { path: "docs/worked-example.md", content: "A worked example." },
  ]);
  const s = await sql();
  await s.query("INSERT INTO pack_tools (pack_id, name, policy) VALUES ($1,$2,$3)", [pack.id, "read", "always_allow"]);
  await s.query("INSERT INTO pack_tools (pack_id, name, policy) VALUES ($1,$2,$3)", [pack.id, "bash", "always_ask"]);
  return { orgId, pack: (await P.getPack(slug)) };
};

/** A stand-in for the one function that would reach the network. */
const proposeFrom = (payload) => {
  const calls = [];
  const propose = async (args) => { calls.push(args); return JSON.stringify(payload); };
  return { propose, calls };
};

test("the script fails with a clear message when there is no API key, rather than half-running", () => {
  assert.throws(() => G.resolveApiKey({}), /ANTHROPIC_API_KEY/,
    "the refusal has to name the thing that is missing");
  assert.equal(G.resolveApiKey({ ANTHROPIC_API_KEY: "sk-ant-test" }), "sk-ant-test");
});

test("the brief is bounded by what the pack actually has", async () => {
  const { pack } = await makePack();
  const brief = G.packBrief(await G.contextFor(pack));
  assert.match(brief, /Pricing Reviewer/);
  assert.match(brief, /stale-rates/, "the real skill names");
  assert.match(brief, /bash/, "the real tool list");
  assert.match(brief, /docs\/worked-example\.md/, "the real folder manifest");
  assert.match(brief, new RegExp(INSTRUCTIONS.slice(0, 30).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    "and the instructions themselves, which is what there is to describe");
});

test("the instruction to the model is to derive, not to reproduce", () => {
  const system = G.systemPrompt();
  assert.match(system, /not quote|never quote|do not reproduce|without quoting/i);
  assert.match(system, /only what the pack supports|cannot support|nothing the pack/i);
});

test("a proposal becomes a draft, and never touches what buyers are reading", async () => {
  const { pack } = await makePack();
  const { propose, calls } = proposeFrom(PROPOSAL);

  const result = await G.generateForPack(pack.slug, { propose });
  assert.equal(result.ok, true, result.reason);
  assert.equal(calls.length, 1, "one model call per pack");

  const draft = await L.draftFor(pack.id);
  assert.equal(draft.description, PROPOSAL.description);
  assert.deepEqual(draft.useCases, PROPOSAL.use_cases);
  assert.deepEqual(draft.scenarios, PROPOSAL.scenarios);
  assert.deepEqual(draft.requirements, PROPOSAL.requirements);

  const live = await P.getPack(pack.slug);
  assert.equal(live.description, "", "the pack itself is untouched — a draft is the terminal state");
  assert.equal(live.listing_approved_at, null);
});

test("a generated draft starts from the FAQ a creator already published", async () => {
  const { pack } = await makePack();
  const published = { q: "Does it need write access?", a: "No — read-only, always." };
  const s = await sql();
  await s.query("UPDATE packs SET faq = $1 WHERE id = $2", [JSON.stringify([published]), pack.id]);

  const { propose } = proposeFrom(PROPOSAL);
  await G.generateForPack(pack.slug, { propose });

  const draft = await L.draftFor(pack.id);
  assert.deepEqual(draft.faq[0], published, "the published answer leads");
  assert.deepEqual(draft.faq[1], PROPOSAL.faq[0]);
});

/**
 * The pack whose FAQ already quotes its own method must still be
 * generatable. The guard is there to judge the model's prose, and a creator's
 * published answer is neither the model's nor new.
 */
test("a pack whose published FAQ quotes the method can still have a listing generated", async () => {
  const { pack } = await makePack();
  const quoted = {
    q: "What does it actually read?",
    a: "It will open the sheet, find every rate that has not moved in two quarters, and say so.",
  };
  const s = await sql();
  await s.query("UPDATE packs SET faq = $1 WHERE id = $2", [JSON.stringify([quoted]), pack.id]);

  const { propose } = proposeFrom(PROPOSAL);
  const result = await G.generateForPack(pack.slug, { propose });
  assert.equal(result.ok, true, result.reason);

  const draft = await L.draftFor(pack.id);
  assert.deepEqual(draft.faq[0], quoted, "the published answer survived into the draft");
  assert.deepEqual(draft.faq[1], PROPOSAL.faq[0]);
});

test("a proposal that pastes the pack body is refused and leaves no draft", async () => {
  const { pack } = await makePack();
  const { propose } = proposeFrom({
    ...PROPOSAL,
    description: "Open the sheet, find every rate that has not moved in two quarters, and write the one sentence.",
  });
  const result = await G.generateForPack(pack.slug, { propose });
  assert.equal(result.ok, false);
  assert.match(result.reason, /verbatim/i);
  assert.equal(await L.draftFor(pack.id), null);
});

test("junk from the model is a reported failure, not a written draft", async () => {
  const { pack } = await makePack();
  const bad = await G.generateForPack(pack.slug, { propose: async () => "I would rather not." });
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /JSON|proposal/i);
  assert.equal(await L.draftFor(pack.id), null);

  const empty = await G.generateForPack(pack.slug, { propose: async () => JSON.stringify({ description: "   " }) });
  assert.equal(empty.ok, false, "a proposal with nothing in it is not a listing");
  assert.equal(await L.draftFor(pack.id), null);
});

test("a fenced code block around the JSON is read, not refused", () => {
  const parsed = G.parseProposal("Here you go:\n```json\n{\"description\":\"A line.\"}\n```\n");
  assert.equal(parsed.description, "A line.");
  assert.throws(() => G.parseProposal("no json here"), /JSON|proposal/i);
});

test("the proposal is normalised into the stored shape, junk and all", () => {
  const listing = G.listingFrom({
    description: "  A line.  ",
    use_cases: ["One", "", 7, "Two"],
    limitations: "not a list",
    faq: [{ q: "Q?", a: "A." }, { a: "no question" }, "junk"],
    scenarios: [{ brief: "B", reached: ["x", 3], output: "O" }, { reached: [] }],
    requirements: null,
  });
  assert.equal(listing.description, "A line.");
  assert.deepEqual(listing.useCases, ["One", "Two"]);
  assert.deepEqual(listing.limitations, []);
  assert.deepEqual(listing.faq, [{ q: "Q?", a: "A." }]);
  assert.deepEqual(listing.scenarios, [{ brief: "B", reached: ["x"], output: "O" }]);
  assert.deepEqual(listing.requirements, []);
});

test("a slug nobody has is a reported failure, not a thrown stack", async () => {
  const result = await G.generateForPack("no-such-pack-anywhere", { propose: async () => JSON.stringify(PROPOSAL) });
  assert.equal(result.ok, false);
  assert.match(result.reason, /no pack/i);
});

test("--all walks every listed pack and reports one line each", async () => {
  const { pack } = await makePack();
  const { propose, calls } = proposeFrom(PROPOSAL);
  const s = await sql();
  await s.query("UPDATE packs SET status = 'listed' WHERE id = $1", [pack.id]);

  const results = await G.generateAll({ propose });
  assert.ok(results.length >= 1);
  assert.ok(results.some((r) => r.slug === pack.slug && r.ok), "the listed pack got a draft");
  assert.equal(calls.length, results.length, "one call per pack, no retries behind the scenes");
});
