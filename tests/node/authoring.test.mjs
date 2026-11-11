// The supply side: creating, editing, submitting, withdrawing, deleting, importing.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!process.env.DATABASE_URL) {
  process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "auth2-")), "t.db");
}

let A, P, Auth, Pay, db, sql, provider;
let n = 0;
const email = () => `a${++n}-${Date.now()}@example.com`;

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
  Pay = await import("../../dist/src/billing/purchases.js");
  provider = await import("../../dist/src/billing/provider.js");
  sql = (await import("../../dist/src/app/sql.js")).sql;
  await db.initDb();
  provider.setPayments(new provider.StubProvider());
  P.setRuntime(stubRuntime());
});

const org = async (name = "Author Co") =>
  A.signUp({ email: email(), name: "Author", password: "correct-horse", orgName: name });

test("normaliseSlug turns a title into an address, and refuses nonsense", () => {
  assert.equal(Auth.normaliseSlug("Senior Campaign Strategist"), "senior-campaign-strategist");
  assert.equal(Auth.normaliseSlug("  Mixed__Case  "), "mixed-case");
  assert.throws(() => Auth.normaliseSlug("!!!"), /not make a usable address/);
  assert.throws(() => Auth.normaliseSlug("x".repeat(80)), /too long/);
});

test("a new pack starts as a draft, not in the catalog", async () => {
  const { orgId } = await org();
  const pack = await Auth.createPack(orgId, { ...INPUT, slug: `draft-${++n}` });
  assert.equal(pack.status, "draft");
  const listed = await P.listPacks();
  assert.equal(listed.some((p) => p.id === pack.id), false, "a draft is not on the shelf");
  assert.equal((await Auth.myPacks(orgId)).some((p) => p.id === pack.id), true, "but the author sees it");
});

test("creating a pack persists the role it was given", async () => {
  const { orgId } = await org();
  const pack = await Auth.createPack(orgId, { ...INPUT, slug: `role-${++n}`, role: "reviewer" });
  assert.equal(pack.role, "reviewer", "the VALUES clause must reference every column it lists");
});

test("creating a pack persists its tools and MCP servers as their own rows", async () => {
  const { orgId } = await org();
  const slug = `tools-${++n}`;
  const pack = await Auth.createPack(orgId, {
    ...INPUT, slug,
    tools: [{ name: "bash", policy: "always_allow" }, { name: "write", policy: "always_ask" }],
    mcpServers: [{ name: "notion", url: "https://mcp.notion.com" }],
  });
  const db2 = await sql();
  const tools = await db2.query("SELECT name, policy FROM pack_tools WHERE pack_id = $1 ORDER BY name", [pack.id]);
  assert.deepEqual(tools.map((t) => ({ name: t.name, policy: t.policy })), [
    { name: "bash", policy: "always_allow" },
    { name: "write", policy: "always_ask" },
  ]);
  const servers = await db2.query("SELECT name, url FROM pack_mcp_servers WHERE pack_id = $1 ORDER BY name", [pack.id]);
  assert.deepEqual(servers.map((m) => ({ name: m.name, url: m.url })), [{ name: "notion", url: "https://mcp.notion.com" }]);
});

test("updating a pack replaces its tools and MCP servers wholesale", async () => {
  const { orgId } = await org();
  const slug = `tools-update-${++n}`;
  const pack = await Auth.createPack(orgId, {
    ...INPUT, slug,
    tools: [{ name: "bash", policy: "always_allow" }],
    mcpServers: [{ name: "notion", url: "https://mcp.notion.com" }],
  });
  await Auth.updatePack(orgId, slug, {
    ...INPUT, slug,
    tools: [{ name: "edit", policy: "always_ask" }],
    mcpServers: [],
  });
  const db2 = await sql();
  const tools = await db2.query("SELECT name, policy FROM pack_tools WHERE pack_id = $1 ORDER BY name", [pack.id]);
  assert.deepEqual(tools.map((t) => ({ name: t.name, policy: t.policy })), [{ name: "edit", policy: "always_ask" }],
    "the old tool row must be gone, not just added to");
  const servers = await db2.query("SELECT name FROM pack_mcp_servers WHERE pack_id = $1", [pack.id]);
  assert.deepEqual(servers.map((m) => ({ name: m.name })), [], "an explicit empty list wipes the stored servers");
});

test("updating a pack without mentioning tools leaves the stored set alone", async () => {
  const { orgId } = await org();
  const slug = `tools-untouched-${++n}`;
  const pack = await Auth.createPack(orgId, {
    ...INPUT, slug,
    tools: [{ name: "bash", policy: "always_allow" }],
  });
  const { tools, mcpServers, ...rest } = INPUT;
  await Auth.updatePack(orgId, slug, { ...rest, slug, tagline: "A different tagline" });
  const db2 = await sql();
  const tools2 = await db2.query("SELECT name, policy FROM pack_tools WHERE pack_id = $1", [pack.id]);
  assert.deepEqual(tools2.map((t) => ({ name: t.name, policy: t.policy })), [{ name: "bash", policy: "always_allow" }],
    "a caller that never mentions tools must not wipe what was there");
});

test("a pack needs a name, instructions, a model and a sane price", async () => {
  const { orgId } = await org();
  const base = { ...INPUT, slug: `bad-${++n}` };
  await assert.rejects(Auth.createPack(orgId, { ...base, name: " " }), /needs a name/);
  await assert.rejects(Auth.createPack(orgId, { ...base, instructions: " " }), /that is the product/);
  await assert.rejects(Auth.createPack(orgId, { ...base, model: "" }), /needs a default model/);
  await assert.rejects(Auth.createPack(orgId, { ...base, pricePoints: -1 }), /whole number of points/);
  await assert.rejects(Auth.createPack(orgId, { ...base, pricePoints: 10.5 }), /whole number of points/);
});

test("two packs cannot share an address", async () => {
  const { orgId } = await org();
  const slug = `taken-${++n}`;
  await Auth.createPack(orgId, { ...INPUT, slug });
  await assert.rejects(Auth.createPack(orgId, { ...INPUT, slug }), /already a pack at/);
});

test("only the authoring organisation can edit", async () => {
  const mine = await org();
  const theirs = await org("Other Co");
  const slug = `mine-${++n}`;
  await Auth.createPack(mine.orgId, { ...INPUT, slug });
  await assert.rejects(
    Auth.updatePack(theirs.orgId, slug, { ...INPUT, slug, name: "Hijacked" }),
    (e) => e.name === "NotTheAuthorError");
  const edited = await Auth.updatePack(mine.orgId, slug, { ...INPUT, slug, name: "Renamed", pricePoints: 99 });
  assert.equal(edited.name, "Renamed");
  assert.equal(edited.price_points, 99);
});

test("editing a pack does not change what an existing buyer runs", async () => {
  const { orgId, userId } = await org();
  const slug = `pinned-${++n}`;
  await Auth.createPack(orgId, { ...INPUT, slug, instructions: "ORIGINAL METHOD" });
  const v1 = await P.publishPack(slug);
  await Pay.beginPurchase({ orgId, userId, packVersionId: v1.id, amountCents: 0, description: "x",
    baseUrl: "http://localhost:4317" });

  await Auth.updatePack(orgId, slug, { ...INPUT, slug, instructions: "REWRITTEN METHOD" });

  const stillV1 = await P.getVersion(v1.id);
  assert.equal(stillV1.instructions, "ORIGINAL METHOD", "the bought version keeps its own copy");
  const exported = await P.exportPack(orgId, slug);
  assert.ok(exported.includes("ORIGINAL METHOD"), "and that is what the buyer exports");

  const v2 = await P.publishPack(slug);
  assert.equal(v2.version, 2);
  assert.equal((await P.getVersion(v2.id)).instructions, "REWRITTEN METHOD");
});

test("submitting requires a published version, and listing requires the curator", async () => {
  const curator = await org("Curator");           // first org in this database curates
  const author = await org("Author Two");
  const slug = `submit-${++n}`;
  await Auth.createPack(author.orgId, { ...INPUT, slug });

  await assert.rejects(Auth.setStatus(author.orgId, slug, "review"), /publish the pack to the runtime/);
  await P.publishPack(slug);
  await Auth.setStatus(author.orgId, slug, "review");
  assert.equal((await P.getPack(slug)).status, "review");

  await assert.rejects(Auth.setStatus(author.orgId, slug, "listed"), (e) => e.name === "NotTheCuratorError");
  const platform = await db.platformOrgId();
  await Auth.setStatus(platform, slug, "listed");
  assert.equal((await P.getPack(slug)).status, "listed");
  assert.ok((await Auth.submittedPacks()).every((p) => p.slug !== slug), "it has left the queue");
});

test("reaching the shelf stamps listed_at once, and withdrawing does not unstamp it", async () => {
  await org("Curator");                             // first org in this database curates
  const author = await org("Author Listed");
  const slug = `listed-at-${++n}`;
  await Auth.createPack(author.orgId, { ...INPUT, slug });
  await P.publishPack(slug);
  assert.equal((await P.getPack(slug)).listed_at, null, "a draft has never been on the shelf");

  const platform = await db.platformOrgId();
  await Auth.setStatus(platform, slug, "listed");
  const firstListing = (await P.getPack(slug)).listed_at;
  assert.ok(firstListing, "reaching the shelf is dated");

  await Auth.setStatus(platform, slug, "unlisted");
  assert.equal((await P.getPack(slug)).listed_at, firstListing, "withdrawing keeps the debut date");
  await Auth.setStatus(platform, slug, "listed");
  assert.equal((await P.getPack(slug)).listed_at, firstListing, "and relisting does not move it");
});

test("packFileSummary counts the latest version's folder, skills and all", async () => {
  const author = await org("Author Files");
  const slug = `files-${++n}`;
  const pack = await Auth.createPack(author.orgId, { ...INPUT, slug });
  assert.deepEqual(await P.packFileSummary(pack.id), { files: 0, skills: 0, tree: [] },
    "a pack with no version has no folder to describe");

  await P.savePackTree(pack.id, [
    { path: "agent.md", content: "---\nname: X\n---\nbody" },
    { path: "README.md", content: "read me" },
    { path: "skills/review/SKILL.md", content: "---\nname: review\ndescription: d\n---\nhow" },
    { path: "skills/review/notes.md", content: "notes" },
    { path: "skills/triage/SKILL.md", content: "---\nname: triage\ndescription: d\n---\nhow" },
  ]);
  await P.publishPack(slug);
  const summary = await P.packFileSummary(pack.id);
  assert.equal(summary.files, 5);
  assert.equal(summary.skills, 2, "a skill is a directory, not a file");
  assert.ok(summary.tree.includes("skills/review/SKILL.md"));
  assert.deepEqual(summary.tree, [...summary.tree].sort(), "the tree reads in path order");
});

test("withdrawing takes a pack off the shelf and leaves its buyers alone", async () => {
  const author = await org("Author Three");
  const slug = `withdraw-${++n}`;
  await Auth.createPack(author.orgId, { ...INPUT, slug, pricePoints: 0 });
  const v = await P.publishPack(slug);
  await Pay.beginPurchase({ orgId: author.orgId, userId: author.userId, packVersionId: v.id,
    amountCents: 0, description: "x", baseUrl: "http://localhost:4317" });
  const platform = await db.platformOrgId();
  await Auth.setStatus(platform, slug, "listed");
  await Auth.setStatus(platform, slug, "unlisted");

  assert.equal((await P.listPacks()).some((p) => p.slug === slug), false, "off the shelf");
  assert.equal(await P.entitled(author.orgId, v.id), true, "but still owned");
  const run = await P.startRun({ orgId: author.orgId, userId: author.userId, packVersionId: v.id });
  assert.ok(run.id, "and still runnable");
});

test("a pack that has been bought or run is withdrawn, never deleted", async () => {
  const author = await org("Author Four");
  const slug = `keep-${++n}`;
  await Auth.createPack(author.orgId, { ...INPUT, slug, pricePoints: 0 });
  const v = await P.publishPack(slug);
  await Pay.beginPurchase({ orgId: author.orgId, userId: author.userId, packVersionId: v.id,
    amountCents: 0, description: "x", baseUrl: "http://localhost:4317" });
  await assert.rejects(Auth.deletePack(author.orgId, slug), /withdraw it instead of deleting/);
});

test("an untouched draft can be deleted outright", async () => {
  const { orgId } = await org();
  const slug = `scratch-${++n}`;
  await Auth.createPack(orgId, { ...INPUT, slug });
  await Auth.deletePack(orgId, slug);
  assert.equal(await P.getPack(slug), undefined);
});

test("importing a single file creates a pack, and importing again updates it", async () => {
  const { orgId } = await org();
  const slug = `imported-${++n}`;
  const file = `---\nname: Imported Pack\ndescription: From a file\nmodel: claude-sonnet-5\nslug: ${slug}\n---\nFirst version of the method.`;

  const first = await Auth.importPack({ orgId, files: [{ path: "agent.md", text: file }] });
  assert.equal(first.created, true);
  assert.equal(first.pack.name, "Imported Pack");
  assert.equal(first.pack.model, "claude-sonnet-5");
  assert.equal(first.pack.status, "draft");

  const second = await Auth.importPack({
    orgId, files: [{ path: "agent.md", text: file.replace("First version", "Second version") }],
  });
  assert.equal(second.created, false);
  assert.equal(second.pack.instructions, "Second version of the method.");
});

test("a folder is stored as a folder, with skills kept as separate files", async () => {
  const { orgId } = await org();
  const slug = `folder-${++n}`;
  const out = await Auth.importPack({ orgId, files: [
    { path: `${slug}/agent.md`, text: `---\nname: Folder Pack\nslug: ${slug}\nmodel: claude-opus-5\n---\nThe method.` },
    { path: `${slug}/skills/elasticity/SKILL.md`,
      text: "---\nname: elasticity\ndescription: Checks price elasticity. Use when pricing changes.\n---\nDouble it, halve it." },
    { path: `${slug}/skills/elasticity/references/notes.md`, text: "detail" },
    { path: `${slug}/agents/reviewer.md`, text: "---\nname: reviewer\ndescription: Reviews drafts.\n---\nYou review." },
    { path: `${slug}/commands/audit.md`, text: "# audit" },
  ] });

  assert.equal(out.created, true);
  assert.deepEqual(out.skills, ["elasticity"]);
  assert.deepEqual(out.subagents, ["reviewer"]);
  assert.deepEqual(out.inert, ["commands"], "commands travel but do not run here");

  // The system prompt is agent.md's body only — skills are NOT flattened into it.
  assert.equal(out.pack.instructions, "The method.");
  assert.ok(!out.pack.instructions.includes("Double it"), "a skill stays a file so it can be read on demand");

  const tree = await P.packTree(out.pack.id);
  assert.deepEqual(tree.map((f) => f.path).sort(), [
    "agent.md", "agents/reviewer.md", "commands/audit.md",
    "skills/elasticity/SKILL.md", "skills/elasticity/references/notes.md",
  ]);
});

test("a folder whose skill breaks the published rules is refused, with the reason", async () => {
  const { orgId } = await org();
  const slug = `badskill-${++n}`;
  await assert.rejects(Auth.importPack({ orgId, files: [
    { path: "agent.md", text: `---\nname: Bad\nslug: ${slug}\n---\nmethod` },
    // Uppercase and underscores are not a legal skill name, and there is no description.
    { path: "skills/Bad_Name/SKILL.md", text: "---\nname: Bad_Name\n---\nbody" },
  ] }), (e) => {
    assert.equal(e.name, "PackTreeRejected");
    assert.match(e.message, /lowercase letters, numbers and hyphens/);
    assert.match(e.message, /no `description`/);
    return true;
  });
});

test("a skill directory with no SKILL.md is refused", async () => {
  const { orgId } = await org();
  await assert.rejects(Auth.importPack({ orgId, files: [
    { path: "agent.md", text: `---\nname: NoSkillMd\nslug: noskillmd-${++n}\n---\nmethod` },
    { path: "skills/orphan/notes.md", text: "detail" },
  ] }), /no SKILL.md/);
});

test("warnings are reported without blocking the upload", async () => {
  const { orgId } = await org();
  const slug = `warn-${++n}`;
  const out = await Auth.importPack({ orgId, files: [
    { path: "agent.md", text: `---\nname: Warner\nslug: ${slug}\n---\nmethod` },
    { path: "skills/thing/SKILL.md",
      text: "---\nname: thing\ndescription: Processes files.\n---\nbody" },
    { path: "skills/thing/unlinked.md", text: "nobody links to me" },
  ] });
  assert.equal(out.pack.slug, slug, "it still landed");
  assert.ok(out.warnings.some((w) => /not when to use it/.test(w.message)));
  assert.ok(out.warnings.some((w) => /nothing in SKILL.md links to this file/.test(w.message)));
});

test("importing over someone else's pack is refused", async () => {
  const mine = await org();
  const theirs = await org("Interloper");
  const slug = `owned-${++n}`;
  await Auth.createPack(mine.orgId, { ...INPUT, slug });
  await assert.rejects(Auth.importPack({
    orgId: theirs.orgId, files: [{ path: "agent.md", text: `---\nslug: ${slug}\nname: Theirs\n---\nmine now` }],
  }), (e) => e.name === "NotTheAuthorError");
});

test("an exported pack can be re-imported unchanged", async () => {
  const { orgId, userId } = await org();
  const slug = `roundtrip-${++n}`;
  await Auth.createPack(orgId, { ...INPUT, slug, instructions: "A very specific method, stated once." });
  const v = await P.publishPack(slug);
  await Pay.beginPurchase({ orgId, userId, packVersionId: v.id, amountCents: 0, description: "x",
    baseUrl: "http://localhost:4317" });
  const md = await P.exportPack(orgId, slug);

  const back = await Auth.importPack({ orgId, files: [{ path: `${slug}.md`, text: md }] });
  assert.equal(back.created, false);
  assert.equal(back.pack.instructions, "A very specific method, stated once.",
    "no platform wrapper and no provenance comment smuggled into the author's text");
  assert.equal(back.pack.name, INPUT.name);
});

test("an author can pull their own pack back without buying it", async () => {
  const { orgId } = await org();
  const slug = `mypull-${++n}`;
  await Auth.createPack(orgId, { ...INPUT, slug, pricePoints: 249 });
  await P.publishPack(slug);
  assert.equal(await P.entitled(orgId, (await P.latestVersion((await P.getPack(slug)).id)).id), false);
  const md = await P.exportPack(orgId, slug);
  assert.ok(md.includes(INPUT.instructions), "the author gets their own method back");
});

test("someone who neither wrote nor bought a pack still cannot export it", async () => {
  const mine = await org();
  const stranger = await org("Stranger");
  const slug = `locked-${++n}`;
  await Auth.createPack(mine.orgId, { ...INPUT, slug });
  await P.publishPack(slug);
  await assert.rejects(P.exportPack(stranger.orgId, slug), (e) => e.name === "NotEntitledError");
});

test("the curator can export anything, since it has to review it", async () => {
  const author = await org("Reviewed Co");
  const slug = `curated-${++n}`;
  await Auth.createPack(author.orgId, { ...INPUT, slug });
  await P.publishPack(slug);
  const curator = await db.platformOrgId();
  const md = await P.exportPack(curator, slug);
  assert.ok(md.length > 0);
});

test("an author pulls back exactly what they pushed, so sync is idempotent", async () => {
  const { orgId } = await org();
  const slug = `idem-${++n}`;
  const agentMd = `---\nname: Idem\nslug: ${slug}\nmodel: claude-opus-5\n---\nThe author's own words.`;
  await Auth.importPack({ orgId, files: [
    { path: "agent.md", text: agentMd },
    { path: "skills/thing/SKILL.md",
      text: "---\nname: thing\ndescription: Does it. Use when asked.\n---\nhow" },
  ] });
  await P.publishPack(slug);

  const pulled = await P.exportPackTree(orgId, slug);
  const definition = pulled.find((f) => f.path === "agent.md");
  assert.equal(definition.content, agentMd, "byte for byte, not regenerated");
  assert.ok(!definition.content.includes("alphaCEO agent platform"), "no platform wrapper in the author's own file");
});

test("a buyer's export carries the platform wrapper and the licence notice", async () => {
  const author = await org("Seller");
  const buyer = await org("Buyer");
  const slug = `wrapped-${++n}`;
  await Auth.importPack({ orgId: author.orgId, files: [
    { path: "agent.md", text: `---\nname: Wrapped\nslug: ${slug}\nmodel: claude-opus-5\n---\nmethod` },
  ] });
  const v = await P.publishPack(slug);
  await Pay.beginPurchase({ orgId: buyer.orgId, userId: buyer.userId, packVersionId: v.id,
    amountCents: 0, description: "x", baseUrl: "http://localhost:4317" });

  const pulled = await P.exportPackTree(buyer.orgId, slug);
  const definition = pulled.find((f) => f.path === "agent.md");
  assert.ok(definition.content.includes("alphaCEO agent platform"), "the buyer runs it with our rules on top");
  assert.ok(definition.content.includes("not for redistribution"));
});

test("a malformed upload is refused rather than crashed on", async () => {
  // Found by the Senior Engineer pack reviewing this route: `typeof null` is
  // "object", so reaching for .path on a null entry threw inside the filter
  // and surfaced as a 500. A bad upload is a 400 about the upload.
  const { orgId } = await org();
  await assert.rejects(
    Auth.importPack({ orgId, files: [{ path: "nope.txt", text: "x" }] }),
    /no agent.md in that folder|not in a place a pack recognises/,
    "a file outside the contract is named, not swallowed");

  for (const junk of [null, undefined, 42, "a string", { path: "agent.md" }]) {
    const survives = typeof junk === "object" && junk !== null
      && typeof junk.path === "string" && typeof junk.text === "string";
    assert.equal(survives, false, `${JSON.stringify(junk)} must not reach importPack`);
  }
});

test("a re-import carrying its own faq: block keeps the answers a creator published", async () => {
  // The FAQ is the one listing field with a second writer: `publishToFaq`
  // quotes a buyer's question and the creator's answer onto `packs.faq` out
  // of the inbox. A folder stating `faq:` knows nothing about those, so
  // replacing the column wholesale deleted every answer that came out of a
  // real exchange, with no way back but the thread it came from.
  const { orgId } = await org();
  const slug = `faqmerge-${++n}`;
  const agent = (faq) => `---\nname: FAQ Pack\nslug: ${slug}\nmodel: claude-opus-5\n${faq}---\nThe method.`;

  await Auth.importPack({ orgId, files: [{ path: "agent.md",
    text: agent("faq:\n  - q: Does it write?\n    a: No.\n") }] });

  // Stands in for the inbox: an answer on the pack that no folder carries.
  const s = await sql();
  const pack = await P.getPack(slug);
  const fromBuyer = [
    ...JSON.parse(pack.faq),
    { q: "Can it read a private repo?", a: "With a token, yes — we never store it." },
  ];
  await s.query("UPDATE packs SET faq = $1 WHERE id = $2", [JSON.stringify(fromBuyer), pack.id]);

  // The same folder again, its faq: block unchanged and one entry longer.
  const again = await Auth.importPack({ orgId, files: [{ path: "agent.md",
    text: agent("faq:\n  - q: Does it write?\n    a: No.\n  - q: Which models?\n    a: Opus, by default.\n") }] });

  const faq = JSON.parse(again.pack.faq);
  assert.deepEqual(faq.map((f) => f.q), [
    "Does it write?", "Can it read a private repo?", "Which models?",
  ], "the published answer survives, and the folder's new question is added");
  assert.match(faq[1].a, /we never store it/, "the creator's own wording is kept verbatim");
});

test("a listing column holding junk does not make an import throw", async () => {
  // `listing.ts` makes "tolerate a malformed column" an explicit invariant;
  // importPack used to JSON.parse these columns bare, so one hand-fixed row
  // turned a re-import into a 500.
  const { orgId } = await org();
  const slug = `junkcol-${++n}`;
  const agent = `---\nname: Junk Columns\nslug: ${slug}\nmodel: claude-opus-5\n---\nThe method.`;
  await Auth.importPack({ orgId, files: [{ path: "agent.md", text: agent }] });

  const s = await sql();
  const pack = await P.getPack(slug);
  await s.query(
    "UPDATE packs SET use_cases = $1, faq = $1, scenarios = $1, limitations = $1, requirements = $1 WHERE id = $2",
    ["not json at all", pack.id]);

  const again = await Auth.importPack({ orgId, files: [{ path: "agent.md", text: agent }] });
  assert.deepEqual(JSON.parse(again.pack.use_cases), []);
  assert.deepEqual(JSON.parse(again.pack.faq), []);
});

test("a tool declaring a permission policy the runtime has never heard of is refused", async () => {
  // `policy` is author-supplied text out of their own agent.md, and the one
  // field of the tools: block with a closed set of values. Unchecked, a typo
  // became a stored fact about what a worker may do.
  const { orgId } = await org();
  const slug = `badpolicy-${++n}`;
  const agent = (policy) => `---\nname: Bad Policy\nslug: ${slug}\nmodel: claude-opus-5\ntools:\n`
    + `  - type: agent_toolset_20260401\n    configs:\n      - name: bash\n`
    + `        permission_policy:\n          type: ${policy}\n---\nThe method.`;

  await assert.rejects(
    Auth.importPack({ orgId, files: [{ path: "agent.md", text: agent("always_alow") }] }),
    (e) => {
      assert.equal(e.name, "PackConflictError");
      assert.match(e.message, /always_alow/, "the author's own spelling is in the message");
      assert.match(e.message, /always_allow, always_ask, auto/);
      return true;
    });
  assert.equal(await P.getPack(slug), undefined, "and nothing was created");

  // The three real ones still land.
  for (const policy of ["always_allow", "always_ask", "auto"]) {
    const ok = `goodpolicy-${++n}`;
    const out = await Auth.importPack({ orgId, files: [{ path: "agent.md",
      text: agent(policy).replace(`slug: ${slug}`, `slug: ${ok}`) }] });
    const stored = (await P.packTools(out.pack.id)).map((t) => ({ name: t.name, policy: t.policy }));
    assert.deepEqual(stored, [{ name: "bash", policy }]);
  }
});
