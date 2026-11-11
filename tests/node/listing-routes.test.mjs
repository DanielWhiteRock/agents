// HTTP-level coverage for the listing's approval rail: the screen a human
// reads before a generated listing reaches anybody, the route that approves
// it, and the staleness stamp an instructions edit leaves behind.
//
// The domain functions are covered directly in tests/node/listing.test.mjs.
// What that file cannot see is the layer in between: that an unapproved draft
// shows a buyer nothing, that `markStale` is actually reached from the edit
// route, and that a pack whose stored scenarios are malformed still renders a
// page rather than a 500. Driven with `fetch` against the real built server,
// the same way tests/node/messages-routes.test.mjs does.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./server-harness.mjs";

let server, A, Auth, P, L, sql;
let n = 0;
const email = () => `lr${++n}-${Date.now()}@example.com`;

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

const INSTRUCTIONS = "Read the diff, then say the one thing that is wrong with it.";

const PACK_INPUT = {
  slug: "", name: "Listing Route Pack", tagline: "Something with a listing to approve",
  author: "A Real Expert", model: "claude-opus-5", effort: "high",
  pricePoints: 0, upgradePoints: 0, instructions: INSTRUCTIONS,
};

const DRAFT = {
  description: "Audits a branch before it merges.", useCases: ["Review a branch"],
  limitations: ["Needs a real diff"], faq: [{ q: "Does it write?", a: "No." }],
  scenarios: [{ brief: "A noisy refactor", reached: ["read"], output: "three findings" }],
  requirements: ["A git remote"],
};

before(async () => {
  server = await startServer();
  process.env.DB_PATH = server.dbPath;
  process.env.DATABASE_URL = "";
  A = await import("../../dist/src/app/auth.js");
  Auth = await import("../../dist/src/app/authoring.js");
  P = await import("../../dist/src/app/platform.js");
  L = await import("../../dist/src/app/listing.js");
  sql = (await import("../../dist/src/app/sql.js")).sql;
  P.setRuntime(stubRuntime());
});

after(async () => { await server.stop(); });

const cookieFor = async (userId) => `agents_session=${encodeURIComponent(await A.createSession(userId))}`;

/** An owner, their pack, and a session cookie for them. */
const authorWithPack = async (over = {}) => {
  const owner = await A.signUp({
    email: email(), name: "Author", password: "correct-horse-battery-staple", orgName: `Listing Co ${++n}`,
  });
  const slug = `listing-route-${n}`;
  const pack = await Auth.createPack(owner.orgId, { ...PACK_INPUT, slug, ...over });
  return { owner, pack, cookie: await cookieFor(owner.userId) };
};

/** A form POST, the way the browser sends one. */
const form = (cookie, fields = {}) => ({
  method: "POST", redirect: "manual",
  headers: { "content-type": "application/x-www-form-urlencoded", cookie },
  body: new URLSearchParams(fields),
});

/** The edit form's own fields, as the browser submits them. */
const editBody = (over = {}) => ({
  name: PACK_INPUT.name, tagline: PACK_INPUT.tagline, author: PACK_INPUT.author,
  model: PACK_INPUT.model, effort: "high", pricePoints: "0", upgradePoints: "0",
  instructions: INSTRUCTIONS, pinnedModels: "", payoutEmail: "", ...over,
});

test("a draft shows a buyer nothing until a human approves it", async () => {
  const { pack, cookie } = await authorWithPack();
  await L.saveDraft(pack.id, DRAFT, 1);

  const buyer = await A.signUp({
    email: email(), name: "Buyer", password: "correct-horse-battery-staple", orgName: `Buyer Co ${++n}`,
  });
  const asBuyer = await fetch(`${server.baseUrl}/packs/${pack.slug}`, { headers: { cookie: await cookieFor(buyer.userId) } });
  const before = await asBuyer.text();
  assert.equal(asBuyer.status, 200);
  assert.doesNotMatch(before, /Audits a branch before it merges/, "an unapproved draft is not a listing");
  assert.doesNotMatch(before, /What it does/);

  // The author's own approval screen shows it, and says it is not live.
  const screen = await fetch(`${server.baseUrl}/packs/${pack.slug}/listing`, { headers: { cookie } });
  assert.equal(screen.status, 200);
  const screenHtml = await screen.text();
  assert.match(screenHtml, /Audits a branch before it merges/);
  assert.match(screenHtml, /A noisy refactor/);
  assert.match(screenHtml, new RegExp(`/packs/${pack.slug}/listing/approve`));

  const approve = await fetch(`${server.baseUrl}/packs/${pack.slug}/listing/approve`, form(cookie));
  assert.equal(approve.status, 303);

  const after = await fetch(`${server.baseUrl}/packs/${pack.slug}`, { headers: { cookie: await cookieFor(buyer.userId) } });
  const afterHtml = await after.text();
  assert.match(afterHtml, /Audits a branch before it merges/, "approved copy reaches the buyer");
  assert.match(afterHtml, /A noisy refactor/);
});

test("a stranger can neither read nor approve another organisation's draft", async () => {
  const { pack } = await authorWithPack();
  await L.saveDraft(pack.id, DRAFT, 1);
  const stranger = await A.signUp({
    email: email(), name: "Stranger", password: "correct-horse-battery-staple", orgName: `Stranger Co ${++n}`,
  });
  const cookie = await cookieFor(stranger.userId);

  const screen = await fetch(`${server.baseUrl}/packs/${pack.slug}/listing`, { headers: { cookie }, redirect: "manual" });
  assert.equal(screen.status, 403);

  const approve = await fetch(`${server.baseUrl}/packs/${pack.slug}/listing/approve`,
    form(cookie));
  assert.ok(approve.status === 403 || approve.status === 404, `got ${approve.status}`);
  assert.equal((await P.getPack(pack.slug)).description, "", "nothing was published");
});

test("the listing rail requires a session like every other route", async () => {
  const { pack } = await authorWithPack();
  const res = await fetch(`${server.baseUrl}/packs/${pack.slug}/listing`, { redirect: "manual" });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "/login");
});

test("editing instructions marks the listing stale and changes nothing public", async () => {
  const { owner, pack, cookie } = await authorWithPack();
  await L.saveDraft(pack.id, DRAFT, 1);
  await L.approveDraft(owner.orgId, pack.slug);

  const edited = await fetch(`${server.baseUrl}/packs/${pack.slug}/edit`,
    form(cookie, editBody({ instructions: "Read the diff twice, then say what is wrong." })));
  assert.equal(edited.status, 303);

  const after = await P.getPack(pack.slug);
  assert.ok(after.listing_stale_at, "the edit stamped the listing as stale");
  assert.equal(after.description, DRAFT.description, "and published nothing new to a buyer");
  assert.deepEqual(L.listingOf(after).useCases, DRAFT.useCases);

  const page = await fetch(`${server.baseUrl}/packs/${pack.slug}`, { headers: { cookie } });
  const html = await page.text();
  assert.match(html, /Audits a branch before it merges/);
  assert.doesNotMatch(html, /stale/i, "staleness is the author's business, not the buyer's");
});

test("saving the details form without touching the method leaves the listing alone", async () => {
  const { owner, pack, cookie } = await authorWithPack();
  await L.saveDraft(pack.id, DRAFT, 1);
  await L.approveDraft(owner.orgId, pack.slug);

  const saved = await fetch(`${server.baseUrl}/packs/${pack.slug}/edit`,
    form(cookie, editBody({ tagline: "A sharper line" })));
  assert.equal(saved.status, 303);

  const after = await P.getPack(pack.slug);
  assert.equal(after.listing_stale_at, null, "the method did not change, so the listing is not stale");
  assert.equal(after.tagline, "A sharper line");
});

test("approving clears the staleness the edit left behind", async () => {
  const { owner, pack, cookie } = await authorWithPack();
  await L.saveDraft(pack.id, DRAFT, 1);
  await L.approveDraft(owner.orgId, pack.slug);
  await L.markStale(pack.id);

  const screen = await fetch(`${server.baseUrl}/packs/${pack.slug}/listing`, { headers: { cookie } });
  assert.match(await screen.text(), /no longer describes|out of date|stale/i,
    "the author is told the live copy may not describe what ships");

  await L.saveDraft(pack.id, { ...DRAFT, description: "Audits a branch, twice over." }, 2);
  const approve = await fetch(`${server.baseUrl}/packs/${pack.slug}/listing/approve`,
    form(cookie));
  assert.equal(approve.status, 303);
  const after = await P.getPack(pack.slug);
  assert.equal(after.listing_stale_at, null);
  assert.equal(after.description, "Audits a branch, twice over.");
});

test("approving with no draft to approve is a refusal, not a crash", async () => {
  const { pack, cookie } = await authorWithPack();
  const res = await fetch(`${server.baseUrl}/packs/${pack.slug}/listing/approve`,
    form(cookie));
  assert.equal(res.status, 303);
  assert.match(res.headers.get("location"), /\?err=/);
  assert.equal((await P.getPack(pack.slug)).listing_approved_at, null);
});

test("a pack whose stored scenarios are malformed still renders its page", async () => {
  const { pack, cookie } = await authorWithPack();
  const s = await sql();
  // Exactly the shape nothing wrote before this task: an object with no
  // `reached`, which the page renders `.length` off.
  await s.query("UPDATE packs SET scenarios = $1 WHERE id = $2",
    [JSON.stringify([{ brief: "A brief with nothing else" }]), pack.id]);

  const res = await fetch(`${server.baseUrl}/packs/${pack.slug}`, { headers: { cookie } });
  assert.equal(res.status, 200, "a malformed scenario must not 500 the whole pack page");
  assert.match(await res.text(), /A brief with nothing else/);
});

test("re-importing a folder marks the listing stale", async () => {
  const { pack, cookie } = await authorWithPack();
  await L.saveDraft(pack.id, DRAFT, 1);
  const s = await sql();
  await s.query("UPDATE packs SET listing_stale_at = NULL WHERE id = $1", [pack.id]);

  const res = await fetch(`${server.baseUrl}/api/packs`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      slug: pack.slug,
      files: [{ path: "agent.md", text: `---\nname: ${PACK_INPUT.name}\n---\nA different method entirely.` }],
    }),
  });
  assert.equal(res.status, 200, await res.text());
  assert.ok((await P.getPack(pack.slug)).listing_stale_at, "a folder that replaced the method dated the listing");
});

// ------------------------------------------------------------- changelog
//
// Actually publishing goes through the real `ManagedAgentsRuntime` in this
// harness — `startServer()` runs the built server as its own child process,
// so `P.setRuntime(stubRuntime())` in this file's `before()` only reaches
// this process, never that one. The route wiring (`note` read off the form
// body and handed to `P.publishPack`) is exercised for real in
// `tests/node/listing.test.mjs`'s domain-level publish tests instead; what
// is worth pinning down at the HTTP layer is that the form offers the field
// at all, and that an unpublished pack renders no changelog heading.

test("the editor's publish form offers an optional changelog note", async () => {
  const { pack, cookie } = await authorWithPack();
  const res = await fetch(`${server.baseUrl}/packs/${pack.slug}/edit`, { headers: { cookie } });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /name="note"/);
  assert.match(html, new RegExp(`action="/packs/${pack.slug}/publish"[\\s\\S]*?name="note"`));
});

test("an unpublished pack's page renders no changelog heading", async () => {
  const { pack, cookie } = await authorWithPack();
  const res = await fetch(`${server.baseUrl}/packs/${pack.slug}`, { headers: { cookie } });
  assert.equal(res.status, 200);
  assert.doesNotMatch(await res.text(), /Changelog/);
});

// ----------------------------------------------------- the permissions rail
//
// The rail is the block the spec singles out as "derived, not
// author-declared". What it used to render was `pack_tools.policy` — the
// author's own agent.md text, which never reaches the runtime: `publishPack`
// builds the agent config from the platform-wide setting and forces
// always_ask where the pack ships a PreToolUse hook. So a pack could declare
// always_allow, run with always_ask, and have the page tell a buyer it runs
// unattended. The branch's own export→re-import round trip makes the inverse
// the normal case, since `export.ts` writes always_ask into every exported
// agent.md and the importer now reads it back.

const toolsBlock = (policy) => `tools:
  - type: agent_toolset_20260401
    default_config:
      enabled: true
    configs:
      - name: bash
        permission_policy:
          type: ${policy}
`;

const HOOK = "---\nname: no-rm\nevent: PreToolUse\ntool: bash\nmatch: rm -rf\n---\nNot on a buyer's machine.";

test("the rail states the policy a run is configured with, not the one the author declared", async () => {
  const owner = await A.signUp({
    email: email(), name: "Author", password: "correct-horse-battery-staple", orgName: `Rail Co ${++n}`,
  });
  const cookie = await cookieFor(owner.userId);

  // Declares always_allow, ships a PreToolUse hook: the hook can only bind if
  // the call pauses, so the published version really does run always_ask.
  const hookedSlug = `rail-hooked-${n}`;
  await Auth.importPack({ orgId: owner.orgId, files: [
    { path: "agent.md",
      text: `---\nname: Hooked\nslug: ${hookedSlug}\nmodel: claude-opus-5\n${toolsBlock("always_allow")}---\nThe method.` },
    { path: "hooks/no-rm.md", text: HOOK },
  ] });
  await P.publishPack(hookedSlug);

  const hooked = await (await fetch(`${server.baseUrl}/packs/${hookedSlug}`, { headers: { cookie } })).text();
  assert.match(hooked, /bash — pauses for a human/,
    "a pack whose hook forces always_ask says so, whatever its agent.md declared");
  assert.doesNotMatch(hooked, /bash — runs unattended/);

  // Declares always_ask — the posture every exported agent.md carries — and
  // ships no hook, so the run is configured from the platform default.
  const plainSlug = `rail-plain-${n}`;
  await Auth.importPack({ orgId: owner.orgId, files: [
    { path: "agent.md",
      text: `---\nname: Plain\nslug: ${plainSlug}\nmodel: claude-opus-5\n${toolsBlock("always_ask")}---\nThe method.` },
  ] });
  await P.publishPack(plainSlug);

  const plain = await (await fetch(`${server.baseUrl}/packs/${plainSlug}`, { headers: { cookie } })).text();
  assert.match(plain, /bash — runs unattended/,
    "the platform default is what the run gets, so it is what the rail says");
  assert.doesNotMatch(plain, /bash — pauses for a human/);
});

test("a pack with no stored tools gets the platform-level statement, in a buyer's terms", async () => {
  const { pack, cookie } = await authorWithPack();
  const page = await (await fetch(`${server.baseUrl}/packs/${pack.slug}`, { headers: { cookie } })).text();
  assert.match(page, /run shell commands/);
  assert.match(page, /read and write files in the run&#39;s workspace/);
  assert.match(page, /run unattended, without pausing for approval/);
  assert.doesNotMatch(page, /no tools recorded/, "an internals report is not a disclosure");
});

// ----------------------------------------------- editing before approving
//
// `POST /packs/:slug/listing` is the writer that did not exist: the six
// listing fields had exactly two, a folder import and the generator, so the
// approval screen's only choices were publish-verbatim, publish-nothing, or
// pay for another model call. The spec says twice that the author "edits
// freely, and approves".

test("an author edits a generated draft and approves what they wrote, not what the model wrote", async () => {
  const { pack, cookie } = await authorWithPack();
  await L.saveDraft(pack.id, DRAFT, 1);

  // The screen hands back fields, filled with the generator's words.
  const screen = await (await fetch(`${server.baseUrl}/packs/${pack.slug}/listing`, { headers: { cookie } })).text();
  assert.match(screen, new RegExp(`action="/packs/${pack.slug}/listing"`));
  assert.match(screen, /<textarea name="description"/);

  const saved = await fetch(`${server.baseUrl}/packs/${pack.slug}/listing`, form(cookie, {
    description: "Audits a branch before it merges, and says so plainly.",
    useCases: "Review a branch\nRead a dependency bump",
    limitations: "Needs a real diff",
    requirements: "A git remote",
    faq: "Q: Does it write?\nA: No — it reads and reports.",
    scenarios: "Brief: A noisy refactor\nReached: read, bash\nOutput: three findings, worst first",
  }));
  assert.equal(saved.status, 303);
  assert.equal(saved.headers.get("location"), `/packs/${pack.slug}/listing?saved=1`);

  // Saved as a draft — and still nothing a buyer can see.
  const draft = await L.draftFor(pack.id);
  assert.equal(draft.description, "Audits a branch before it merges, and says so plainly.");
  assert.deepEqual(draft.useCases, ["Review a branch", "Read a dependency bump"]);
  assert.deepEqual(draft.faq, [{ q: "Does it write?", a: "No — it reads and reports." }]);
  assert.deepEqual(draft.scenarios, [
    { brief: "A noisy refactor", reached: ["read", "bash"], output: "three findings, worst first" },
  ]);
  assert.equal((await P.getPack(pack.slug)).description, "", "a save publishes nothing");

  const approved = await fetch(`${server.baseUrl}/packs/${pack.slug}/listing/approve`, form(cookie));
  assert.equal(approved.status, 303);
  const after = await P.getPack(pack.slug);
  assert.equal(after.description, "Audits a branch before it merges, and says so plainly.",
    "the author's wording is what reaches the buyer");
  assert.deepEqual(L.listingOf(after).useCases, ["Review a branch", "Read a dependency bump"]);
});

test("a hand-written draft that pastes the method back is refused with the reason", async () => {
  // The copy-quality guard lives in `saveDraft`, so it covers a person
  // typing the instructions into the box exactly as it covers a generator.
  const { pack, cookie } = await authorWithPack();
  const res = await fetch(`${server.baseUrl}/packs/${pack.slug}/listing`, form(cookie, {
    description: `${INSTRUCTIONS} ${INSTRUCTIONS}`,
  }));
  assert.equal(res.status, 303);
  assert.match(decodeURIComponent(res.headers.get("location")), /verbatim/);
  assert.equal(await L.draftFor(pack.id), null, "nothing was written");
});

test("a stranger cannot edit another organisation's draft", async () => {
  const { pack } = await authorWithPack();
  await L.saveDraft(pack.id, DRAFT, 1);
  const stranger = await A.signUp({
    email: email(), name: "Stranger", password: "correct-horse-battery-staple", orgName: `Stranger Co ${++n}`,
  });
  const res = await fetch(`${server.baseUrl}/packs/${pack.slug}/listing`,
    form(await cookieFor(stranger.userId), { description: "Mine now." }));
  assert.ok(res.status === 403 || res.status === 404, `got ${res.status}`);
  assert.equal((await L.draftFor(pack.id)).description, DRAFT.description, "the draft is untouched");
});
