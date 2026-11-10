import http from "node:http";
import { URL } from "node:url";
import { allSettings, initDb, putSetting, setting } from "./db.js";
import { sql } from "./sql.js";
import { balanceByBucket, balanceCents, credit, fmt } from "../billing/points.js";
import * as P from "./platform.js";
import * as V from "./views.js";

const PORT = Number(process.env["PORT"] ?? 4317);
type Ctx = { orgId: string; userId: string };

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

  if (method === "GET" && path === "/") {
    const packs = await Promise.all((await P.listPacks()).map(async (p) => {
      const v = await P.latestVersion(p.id);
      return { ...p, published: Boolean(v), owned: Boolean(v && (await P.entitled(ctx.orgId, v.id))) };
    }));
    return html(res, V.catalogPage(packs, await bal()));
  }

  const packMatch = /^\/packs\/([a-z0-9-]+)$/.exec(path);
  if (method === "GET" && packMatch) {
    const p = await P.getPack(packMatch[1]!);
    if (!p) return html(res, V.layout("Not found", "<h1>No such pack</h1>"), 404);
    const v = await P.latestVersion(p.id);
    return html(res, V.packPage(p, v, Boolean(v && (await P.entitled(ctx.orgId, v.id))),
      await models(), await bal(), url.searchParams.get("err") ?? undefined));
  }

  const pubMatch = /^\/packs\/([a-z0-9-]+)\/publish$/.exec(path);
  if (method === "POST" && pubMatch) {
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
    return html(res, V.runsPage(rows, await bal()));
  }

  // Live trace — tails the persisted transcript, so a reload loses nothing.
  const streamMatch = /^\/runs\/([a-z0-9_]+)\/stream$/.exec(path);
  if (method === "GET" && streamMatch) {
    const runId = streamMatch[1]!;
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
          for (const e of await P.buyerEvents(runId, after)) {
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
    if (!run) return html(res, V.layout("Not found", "<h1>No such run</h1>"), 404);
    const asks = (await P.openAsks(run.id)).map((a) => ({ event_id: a.event_id, name: a.name, input: a.input }));
    return html(res, V.runPage(run, await packNameOf(run.pack_version_id), await bal(),
      run.stop_reason === "budget_reached", asks));
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
    return html(res, V.ledgerPage(rows, await balanceByBucket(ctx.orgId), await bal()));
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
      rows.map((r) => ({ ...r, runs: Number(r.runs), millicents: Number(r.millicents) })), await bal()));
  }

  if (method === "GET" && path === "/settings") return html(res, V.settingsPage(await allSettings(), await bal()));
  if (method === "POST" && path === "/settings") {
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
    `<h1>Not found</h1><p class="lede"><a href="/">Back to the catalog</a></p>`), 404);
}

// --------------------------------------------------------------- bootstrap

async function main(): Promise<void> {
  await initDb();
  const ctx = await P.ensureDemoOrg();
  const seeded = await P.seedCatalog();
  const store = (await sql()).dialect;

  const server = http.createServer((req, res) => {
    route(req, res, ctx).catch((e) => {
      console.error("[error]", msg(e));
      if (!res.headersSent) {
        html(res, V.layout("Error",
          `<h1>Something broke</h1><div class="note bad">${V.esc(msg(e))}</div><p><a href="/">Back</a></p>`), 500);
      } else res.end();
    });
  });

  server.listen(PORT, () => {
    console.log(`agents.alphaceo.ai — http://localhost:${PORT}`);
    console.log(`  store: ${store} · org ${ctx.orgId} · ${seeded} pack(s) seeded`);
    if (store === "sqlite") console.log(`  (set DATABASE_URL to use Postgres: docker compose up -d)`);
  });
}

void main();
