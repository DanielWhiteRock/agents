import http from "node:http";
import { URL } from "node:url";
import { allSettings, initDb, putSetting, setting, settingInt } from "./db.js";
import * as A from "./auth.js";
import { sql } from "./sql.js";
import { balanceByBucket, balanceCents, credit, fmt } from "../billing/points.js";
import * as P from "./platform.js";
import * as V from "./views.js";

const PORT = Number(process.env["PORT"] ?? 4317);
const SECURE_COOKIES = process.env["SECURE_COOKIES"] === "1";
const COOKIE = "agents_session";

type Ctx = { orgId: string; userId: string; role: A.Role; viewer: V.Viewer };

function cookies(req: http.IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setCookie(res: http.ServerResponse, token: string): void {
  const bits = [`${COOKIE}=${encodeURIComponent(token)}`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=2592000"];
  if (SECURE_COOKIES) bits.push("Secure");
  res.setHeader("set-cookie", bits.join("; "));
}

function clearCookie(res: http.ServerResponse): void {
  res.setHeader("set-cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/** Routes reachable without being signed in. Everything else requires a session. */
const PUBLIC = /^\/(login|signup|healthz|invite\/[A-Za-z0-9_-]+)$/;

function body(req: http.IncomingMessage): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on("end", () => {
      const out: Record<string, string> = {};
      for (const [k, v] of new URLSearchParams(raw)) out[k] = v;
      resolve(out);
    });
    req.on("error", reject);
  });
}

const html = (res: http.ServerResponse, s: string, code = 200): void => {
  res.writeHead(code, { "content-type": "text/html; charset=utf-8" });
  res.end(s);
};
const redirect = (res: http.ServerResponse, to: string): void => {
  res.writeHead(303, { location: to });
  res.end();
};
const msg = (e: unknown): string => String((e as Error)?.message ?? e);

async function models(): Promise<string[]> {
  return (await setting("allowed_models")).split(",").map((s) => s.trim()).filter(Boolean);
}

async function packNameOf(packVersionId: string): Promise<string> {
  const v = await P.getVersion(packVersionId);
  if (!v) return "?";
  return (await P.packById(v.pack_id))?.name ?? "?";
}

// ------------------------------------------------------------------ routes

async function route(req: http.IncomingMessage, res: http.ServerResponse, ctx: Ctx): Promise<void> {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = req.method ?? "GET";
  const bal = () => balanceCents(ctx.orgId);
  const viewer = ctx.viewer;
  const ownerOnly = (): void => { if (ctx.role !== "owner") throw new A.ForbiddenError(); };

  if (method === "GET" && path === "/") {
    const packs = await Promise.all((await P.listPacks()).map(async (p) => {
      const v = await P.latestVersion(p.id);
      return { ...p, published: Boolean(v), owned: Boolean(v && (await P.entitled(ctx.orgId, v.id))) };
    }));
    return html(res, V.catalogPage(packs, await bal(), viewer));
  }

  const packMatch = /^\/packs\/([a-z0-9-]+)$/.exec(path);
  if (method === "GET" && packMatch) {
    const p = await P.getPack(packMatch[1]!);
    if (!p) return html(res, V.layout("Not found", "<h1>No such pack</h1>"), 404);
    const v = await P.latestVersion(p.id);
    return html(res, V.packPage(p, v, Boolean(v && (await P.entitled(ctx.orgId, v.id))),
      await models(), await bal(), url.searchParams.get("err") ?? undefined, viewer));
  }

  const pubMatch = /^\/packs\/([a-z0-9-]+)\/publish$/.exec(path);
  if (method === "POST" && pubMatch) {
    ownerOnly();
    try { await P.publishPack(pubMatch[1]!); }
    catch (e) { return redirect(res, `/packs/${pubMatch[1]}?err=${encodeURIComponent(msg(e))}`); }
    return redirect(res, `/packs/${pubMatch[1]}`);
  }

  const acqMatch = /^\/packs\/([a-z0-9-]+)\/acquire$/.exec(path);
  if (method === "POST" && acqMatch) {
    const f = await body(req);
    const slug = acqMatch[1]!;
    const pack = await P.getPack(slug);
    if (!pack) return html(res, V.layout("Not found", "<h1>No such pack</h1>"), 404);
    try {
      const versionId = f["packVersionId"]
        ?? (await P.latestVersion(pack.id))?.id
        ?? (await P.publishPack(slug)).id;
      await P.grantEntitlement(ctx.orgId, versionId);
      const run = await P.startRun({ orgId: ctx.orgId, userId: ctx.userId, packVersionId: versionId, model: f["model"] });
      return redirect(res, `/runs/${run.id}`);
    } catch (e) { return redirect(res, `/packs/${slug}?err=${encodeURIComponent(msg(e))}`); }
  }

  if (method === "POST" && path === "/runs") {
    const f = await body(req);
    const versionId = f["packVersionId"] ?? "";
    const version = await P.getVersion(versionId);
    if (!version) return html(res, V.layout("Error", "<h1>Unknown pack version</h1>"), 400);
    const pack = (await P.packById(version.pack_id))!;
    if (!(await P.entitled(ctx.orgId, versionId))) {
      return redirect(res, `/packs/${pack.slug}?err=${encodeURIComponent("not acquired")}`);
    }
    try {
      const run = await P.startRun({ orgId: ctx.orgId, userId: ctx.userId, packVersionId: versionId, model: f["model"] });
      return redirect(res, `/runs/${run.id}`);
    } catch (e) { return redirect(res, `/packs/${pack.slug}?err=${encodeURIComponent(msg(e))}`); }
  }

  if (method === "GET" && path === "/runs") {
    const rows = await Promise.all((await P.listRuns(ctx.orgId)).map(async (r) => ({
      ...r, pack: await packNameOf(r.pack_version_id),
    })));
    return html(res, V.runsPage(rows, await bal(), viewer));
  }

  // Live trace — tails the persisted transcript, so a reload loses nothing.
  const streamMatch = /^\/runs\/([a-z0-9_]+)\/stream$/.exec(path);
  if (method === "GET" && streamMatch) {
    const runId = streamMatch[1]!;
    const owned = await P.getRun(runId);
    if (!owned || owned.org_id !== ctx.orgId) return html(res, V.layout("Not found", "<h1>No such run</h1>", { viewer }), 404);
    res.writeHead(200, {
      "content-type": "text/event-stream", "cache-control": "no-cache",
      connection: "keep-alive", "x-accel-buffering": "no",
    });
    res.write("retry: 2000\n\n");
    let after = 0, lastMeters = "", lastAsks = "", busy = false;
    const tick = setInterval(() => {
      // A slow query must not overlap the next tick and emit events out of order.
      if (busy || res.writableEnded) return;
      busy = true;
      void (async () => {
        try {
          // Buyer-facing: redacted against the pack's own instructions.
          for (const e of await P.transcriptFor(runId, ctx.orgId, after)) {
            after = e.id;
            res.write(`event: event\ndata: ${JSON.stringify(e)}\n\n`);
          }
          const r = await P.getRun(runId);
          if (r) {
            const m = JSON.stringify({
              list_cost_cents: r.list_cost_cents, budget_cents: r.budget_cents,
              input_tokens: r.input_tokens, output_tokens: r.output_tokens,
              active_seconds: r.active_seconds, billed_cents: r.billed_cents,
              status: r.status, stop_reason: r.stop_reason,
            });
            if (m !== lastMeters) { lastMeters = m; res.write(`event: meters\ndata: ${m}\n\n`); }
          }
          const asks = JSON.stringify((await P.openAsks(runId)).map((a) => a.event_id));
          if (asks !== lastAsks) { lastAsks = asks; res.write(`event: asks\ndata: ${asks}\n\n`); }
        } catch { /* a closed socket is not an error worth logging */ }
        finally { busy = false; }
      })();
    }, 500);
    req.on("close", () => clearInterval(tick));
    return;
  }

  const runMatch = /^\/runs\/([a-z0-9_]+)$/.exec(path);
  if (method === "GET" && runMatch) {
    const run = await P.getRun(runMatch[1]!);
    // A run belongs to an organisation; another org's run is simply not found.
    if (!run || run.org_id !== ctx.orgId) return html(res, V.layout("Not found", "<h1>No such run</h1>", { viewer }), 404);
    const asks = (await P.openAsks(run.id)).map((a) => ({ event_id: a.event_id, name: a.name, input: a.input }));
    return html(res, V.runPage(run, await packNameOf(run.pack_version_id), await bal(),
      run.stop_reason === "budget_reached", asks, viewer));
  }

  // Fire-and-forget: the trace shows the turn arriving live.
  const msgMatch = /^\/runs\/([a-z0-9_]+)\/message$/.exec(path);
  if (method === "POST" && msgMatch) {
    const f = await body(req);
    const runId = msgMatch[1]!;
    void P.sendTurn(runId, f["text"] ?? "").catch((e) => P.recordEvent(runId, "run.error", { message: msg(e) }));
    return redirect(res, `/runs/${runId}`);
  }

  const decMatch = /^\/runs\/([a-z0-9_]+)\/decide$/.exec(path);
  if (method === "POST" && decMatch) {
    const f = await body(req);
    const runId = decMatch[1]!;
    void P.decide(runId, f["eventId"] ?? "", f["result"] === "allow", f["denyMessage"] || undefined)
      .catch((e) => P.recordEvent(runId, "run.error", { message: msg(e) }));
    return redirect(res, `/runs/${runId}`);
  }

  const topMatch = /^\/runs\/([a-z0-9_]+)\/topup$/.exec(path);
  if (method === "POST" && topMatch) {
    try { await P.topUp(topMatch[1]!); }
    catch (e) { await P.recordEvent(topMatch[1]!, "run.error", { message: msg(e) }); }
    return redirect(res, `/runs/${topMatch[1]}`);
  }

  const endMatch = /^\/runs\/([a-z0-9_]+)\/end$/.exec(path);
  if (method === "POST" && endMatch) {
    await P.endRun(endMatch[1]!);
    return redirect(res, "/runs");
  }

  if (method === "GET" && path === "/ledger") {
    const s = await sql();
    const rows = await s.query<{ bucket: string; delta_cents: number; reason: string; run_id: string | null; created_at: string }>(
      `SELECT bucket, delta_cents, reason, run_id, created_at FROM points_ledger
       WHERE org_id = $1 ORDER BY created_at DESC LIMIT 100`, [ctx.orgId]);
    return html(res, V.ledgerPage(rows, await balanceByBucket(ctx.orgId), await bal(), viewer));
  }
  if (method === "POST" && path === "/ledger/topup") {
    const f = await body(req);
    const c = Math.floor(Number(f["cents"] ?? 0));
    if (Number.isFinite(c) && c > 0) await credit(ctx.orgId, "topup", c, "points purchase");
    return redirect(res, "/ledger");
  }

  if (method === "GET" && path === "/authors") {
    const s = await sql();
    const rows = await s.query<{ name: string; author: string; runs: unknown; millicents: unknown }>(`
      SELECT p.name AS name, p.author AS author,
             COUNT(DISTINCT ae.run_id) AS runs,
             COALESCE(SUM(ae.points_millicents), 0) AS millicents
      FROM packs p LEFT JOIN author_earnings ae ON ae.pack_id = p.id
      GROUP BY p.id, p.name, p.author ORDER BY millicents DESC`);
    return html(res, V.authorsPage(
      rows.map((r) => ({ ...r, runs: Number(r.runs), millicents: Number(r.millicents) })), await bal(), viewer));
  }

  if (method === "GET" && path === "/settings") { ownerOnly(); return html(res, V.settingsPage(await allSettings(), await bal(), viewer)); }
  if (method === "POST" && path === "/settings") {
    ownerOnly();
    const f = await body(req);
    if (f["key"]) await putSetting(f["key"], f["value"] ?? "");
    return redirect(res, "/settings");
  }

  if (method === "GET" && path === "/healthz") {
    const s = await sql();
    res.writeHead(200, { "content-type": "application/json" });
    return void res.end(JSON.stringify({ ok: true, store: s.dialect, balance: fmt(await bal()) }));
  }

  return html(res, V.layout("Not found",
    `<h1>Not found</h1><p class="lede"><a href="/">Back to the catalog</a></p>`, { viewer }), 404);
}

// ------------------------------------------------------------------- account

async function accountRoutes(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = req.method ?? "GET";

  if (method === "GET" && path === "/login") { html(res, V.loginPage()); return true; }
  if (method === "POST" && path === "/login") {
    const f = await body(req);
    const user = await A.userByEmail(f["email"] ?? "");
    if (!user || !A.verifyPassword(f["password"] ?? "", user.password_hash)) {
      // One message for both cases: never reveal whether an address exists.
      html(res, V.loginPage("That email and password do not match.", f["email"] ?? ""), 401);
      return true;
    }
    setCookie(res, await A.createSession(user.id));
    redirect(res, "/");
    return true;
  }

  if (method === "GET" && path === "/signup") { html(res, V.signupPage()); return true; }
  if (method === "POST" && path === "/signup") {
    const f = await body(req);
    try {
      const { token } = await A.signUp({
        email: (f["email"] ?? "").trim(), name: (f["name"] ?? "").trim(),
        password: f["password"] ?? "", orgName: (f["orgName"] ?? "").trim(),
      });
      setCookie(res, token);
      redirect(res, "/");
    } catch (e) { html(res, V.signupPage(msg(e), f), 400); }
    return true;
  }

  if (method === "POST" && path === "/logout") {
    await A.destroySession(cookies(req)[COOKIE]);
    clearCookie(res);
    redirect(res, "/login");
    return true;
  }

  const inviteMatch = /^\/invite\/([A-Za-z0-9_-]+)$/.exec(path);
  if (inviteMatch) {
    const token = inviteMatch[1]!;
    const inv = await A.inviteByToken(token);
    if (!inv) { html(res, V.layout("Invitation", `<h1>That invitation is no longer valid</h1>
      <p class="lede">Ask whoever invited you to send a new one. <a href="/login">Sign in</a></p>`), 404); return true; }
    const s = await sql();
    const org = await s.one<{ name: string }>("SELECT name FROM orgs WHERE id = $1", [inv.org_id]);
    if (method === "GET") { html(res, V.invitePage(inv, org?.name ?? "the organisation", token)); return true; }
    const f = await body(req);
    try {
      setCookie(res, await A.acceptInvite(token, (f["name"] ?? "").trim(), f["password"] ?? ""));
      redirect(res, "/");
    } catch (e) { html(res, V.invitePage(inv, org?.name ?? "the organisation", token, msg(e)), 400); }
    return true;
  }
  return false;
}

async function teamRoutes(
  req: http.IncomingMessage, res: http.ServerResponse, ctx: Ctx, path: string, method: string,
): Promise<boolean> {
  const ownerOnly = (): void => { if (ctx.role !== "owner") throw new A.ForbiddenError(); };
  const s = await sql();

  if (method === "GET" && path === "/team") {
    const org = await s.one<{ tier: string }>("SELECT tier FROM orgs WHERE id = $1", [ctx.orgId]);
    html(res, V.teamPage({
      members: await A.orgMembers(ctx.orgId),
      invites: await A.openInvites(ctx.orgId),
      seatsUsed: await A.seatsUsed(ctx.orgId),
      seatLimit: await A.seatLimit(ctx.orgId),
      tier: org?.tier ?? "personal",
      viewer: ctx.viewer, youId: ctx.userId, balance: await balanceCents(ctx.orgId),
      err: new URL(req.url ?? "/", `http://localhost:${PORT}`).searchParams.get("err") ?? undefined,
    }));
    return true;
  }
  if (method === "POST" && path === "/team/invite") {
    ownerOnly();
    const f = await body(req);
    try {
      await A.invite({ orgId: ctx.orgId, email: (f["email"] ?? "").trim(),
        role: f["role"] === "owner" ? "owner" : "member", invitedBy: ctx.userId });
      redirect(res, "/team");
    } catch (e) { redirect(res, `/team?err=${encodeURIComponent(msg(e))}`); }
    return true;
  }
  if (method === "POST" && path === "/team/revoke") {
    ownerOnly();
    const f = await body(req);
    await A.revokeInvite(ctx.orgId, f["token"] ?? "");
    redirect(res, "/team");
    return true;
  }
  if (method === "POST" && path === "/team/role") {
    ownerOnly();
    const f = await body(req);
    try { await A.setRole(ctx.orgId, f["userId"] ?? "", f["role"] === "owner" ? "owner" : "member"); redirect(res, "/team"); }
    catch (e) { redirect(res, `/team?err=${encodeURIComponent(msg(e))}`); }
    return true;
  }
  if (method === "POST" && path === "/team/remove") {
    ownerOnly();
    const f = await body(req);
    try { await A.removeMember(ctx.orgId, f["userId"] ?? ""); redirect(res, "/team"); }
    catch (e) { redirect(res, `/team?err=${encodeURIComponent(msg(e))}`); }
    return true;
  }
  return false;
}

// --------------------------------------------------------------- bootstrap

async function main(): Promise<void> {
  await initDb();
  const seeded = await P.seedCatalog();
  const store = (await sql()).dialect;

  const server = http.createServer((req, res) => {
    void handle(req, res).catch((e) => {
      if (res.headersSent) return void res.end();
      if (e instanceof A.ForbiddenError) {
        return html(res, V.layout("Not allowed",
          `<h1>Not allowed</h1><div class="note">${V.esc(msg(e))}</div>
           <p class="lede"><a href="/">Back to the catalog</a></p>`), 403);
      }
      console.error("[error]", msg(e));
      html(res, V.layout("Error",
        `<h1>Something broke</h1><div class="note bad">${V.esc(msg(e))}</div><p><a href="/">Back</a></p>`), 500);
    });
  });

  server.listen(PORT, async () => {
    const s = await sql();
    const anyone = await s.one("SELECT 1 AS ok FROM users LIMIT 1");
    console.log(`agents.alphaceo.ai — http://localhost:${PORT}`);
    console.log(`  store: ${store} · ${seeded} pack(s) seeded`);
    console.log(anyone ? "  sign in at /login" : "  no accounts yet — create one at /signup");
    if (store === "sqlite") console.log(`  (set DATABASE_URL to use Postgres: docker compose up -d)`);
  });
}

/** Resolve the session, gate everything that is not public, then route. */
async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = req.method ?? "GET";

  if (await accountRoutes(req, res)) return;

  const session = await A.sessionFromToken(cookies(req)[COOKIE]);
  if (!session) {
    if (PUBLIC.test(path)) return html(res, V.layout("Sign in", `<h1>Please sign in</h1>`), 401);
    if (method === "GET") return redirect(res, "/login");
    return html(res, V.layout("Sign in", `<h1>Your session has expired</h1>
      <p class="lede"><a href="/login">Sign in again</a></p>`), 401);
  }

  const s = await sql();
  const org = await s.one<{ name: string }>("SELECT name FROM orgs WHERE id = $1", [session.orgId]);
  const ctx: Ctx = {
    orgId: session.orgId, userId: session.user.id, role: session.role,
    viewer: { name: session.user.name, email: session.user.email, role: session.role, orgName: org?.name ?? "" },
  };

  if (await teamRoutes(req, res, ctx, path, method)) return;
  return route(req, res, ctx);
}

void main();
