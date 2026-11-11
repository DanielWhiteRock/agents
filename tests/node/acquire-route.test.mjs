// HTTP-level coverage for POST /packs/:slug/acquire — I5 of the
// 2026-11-11 mcp-buyer-surface fix wave: `P.mayExport`, not a bare
// `P.entitled` probe, must gate whether this route charges an organisation
// for a pack. An author (or the platform curator) already holds access to
// their own pack with no `entitlements` row at all, so the old bare
// `entitled` check let an author "buy" their own pack through this exact
// route and burn real points for nothing — the identical bug already fixed
// in `buy_pack` (src/mcp/acquire.ts), just reached through the website
// instead of MCP.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./server-harness.mjs";

let server, A, P, Auth, Points, sql;
let n = 0;
const email = (tag) => `acqroute-${tag}-${++n}-${Date.now()}@example.com`;

// Same stub as tests/node/social-routes.test.mjs and friends: runs in this
// test process, against domain modules imported directly, never reaching a
// real provider.
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
  server = await startServer();
  process.env.DB_PATH = server.dbPath;
  process.env.DATABASE_URL = "";
  A = await import("../../dist/src/app/auth.js");
  P = await import("../../dist/src/app/platform.js");
  Auth = await import("../../dist/src/app/authoring.js");
  Points = await import("../../dist/src/billing/points.js");
  sql = (await import("../../dist/src/app/sql.js")).sql;
  P.setRuntime(stubRuntime());
});

after(async () => { await server.stop(); });

test("an author acquiring their own paid pack over the web route is not charged", async () => {
  const author = await A.signUp({
    email: email("author"), name: "Author", password: "correct-horse", orgName: `Acquire Route Author Co ${n}`,
  });
  const slug = `acquire-route-author-${++n}`;
  const pack = await Auth.createPack(author.orgId, {
    slug, name: "Author Owned Route Pack", tagline: "x", author: "Someone", model: "claude-opus-5",
    pricePoints: 500, upgradePoints: 0, instructions: "Do it.",
  });
  await P.publishPack(slug);
  const version = await P.latestVersion(pack.id);

  // Funded, so a pre-fix run would actually be able to debit the author —
  // an unfunded author would instead hit `buyWithPoints`'s own
  // insufficient-balance throw, which would mask this bug behind a
  // different error rather than demonstrate it.
  await Points.credit(author.orgId, "topup", 500_000, "test funding");
  const before = await Points.balanceMillipoints(author.orgId);

  const cookie = `agents_session=${author.token}`;
  const res = await fetch(`${server.baseUrl}/packs/${slug}/acquire`, {
    method: "POST", redirect: "manual",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({}),
  });
  // Always a redirect either way (success or an error caught by the route's
  // own try/catch) — the thing under test is whether anything was charged,
  // not where this particular redirect lands.
  assert.equal(res.status, 303);

  const after = await Points.balanceMillipoints(author.orgId);
  assert.equal(after, before, "an author must not be charged for acquiring their own pack");

  const s = await sql();
  const rows = await s.query("SELECT 1 AS ok FROM purchases WHERE pack_version_id = $1", [version.id]);
  assert.equal(rows.length, 0, "an author's own pack must never produce a purchases row");
});
