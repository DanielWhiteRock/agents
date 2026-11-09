import http from "node:http";
import { URL } from "node:url";
import { allSettings, getDb, putSetting, setting } from "./db.js";
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

function models(): string[] {
  return setting("allowed_models").split(",").map((s) => s.trim()).filter(Boolean);
}

// ------------------------------------------------------------------ routes

async function route(req: http.IncomingMessage, res: http.ServerResponse, ctx: Ctx): Promise<void> {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = req.method ?? "GET";
  const bal = () => balanceCents(ctx.orgId);

  // Catalog
  if (method === "GET" && path === "/") {
    const packs = P.listPacks().map((p) => {
      const v = P.latestVersion(p.id);
      return { ...p, published: Boolean(v), owned: Boolean(v && P.entitled(ctx.orgId, v.id)) };
    });
    return html(res, V.catalogPage(packs, bal()));
  }

  // Pack detail
  const packMatch = /^\/packs\/([a-z0-9-]+)$/.exec(path);
  if (method === "GET" && packMatch) {
    const p = P.getPack(packMatch[1]!);
    if (!p) return html(res, V.layout("Not found", "<h1>No such pack</h1>"), 404);
    const v = P.latestVersion(p.id);
    return html(res, V.packPage(p, v, Boolean(v && P.entitled(ctx.orgId, v.id)), models(), bal(),
      url.searchParams.get("err") ?? undefined));
  }

  // Publish a pack to the runtime
  const pubMatch = /^\/packs\/([a-z0-9-]+)\/publish$/.exec(path);
  if (method === "POST" && pubMatch) {
    try { await P.publishPack(pubMatch[1]!); }
    catch (e) { return redirect(res, `/packs/${pubMatch[1]}?err=${encodeURIComponent(msg(e))}`); }
    return redirect(res, `/packs/${pubMatch[1]}`);
  }

  // Acquire (entitlement) then start a run
  const acqMatch = /^\/packs\/([a-z0-9-]+)\/acquire$/.exec(path);
  if (method === "POST" && acqMatch) {
    const f = await body(req);
    const slug = acqMatch[1]!;
    const pack = P.getPack(slug);
    if (!pack) return html(res, V.layout("Not found", "<h1>No such pack</h1>"), 404);
    let versionId = f["packVersionId"];
    if (!versionId) {
      const v = P.latestVersion(pack.id) ?? (await P.publishPack(slug));
      versionId = v.id;
    }
    P.grantEntitlement(ctx.orgId, versionId);
    try {
      const run = await P.startRun({ orgId: ctx.orgId, userId: ctx.userId, packVersionId: versionId, model: f["model"] });
      return redirect(res, `/runs/${run.id}`);
    } catch (e) { return redirect(res, `/packs/${slug}?err=${encodeURIComponent(msg(e))}`); }
  }

  // Start a run on an owned pack
  if (method === "POST" && path === "/runs") {
    const f = await body(req);
    const versionId = f["packVersionId"] ?? "";
    const version = P.getVersion(versionId);
    if (!version) return html(res, V.layout("Error", "<h1>Unknown pack version</h1>"), 400);
    const pack = getDb().prepare("SELECT slug FROM packs WHERE id = ?").get(version.pack_id) as { slug: string };
    if (!P.entitled(ctx.orgId, versionId)) return redirect(res, `/packs/${pack.slug}?err=${encodeURIComponent("not acquired")}`);
    try {
      const run = await P.startRun({ orgId: ctx.orgId, userId: ctx.userId, packVersionId: versionId, model: f["model"] });
      return redirect(res, `/runs/${run.id}`);
    } catch (e) { return redirect(res, `/packs/${pack.slug}?err=${encodeURIComponent(msg(e))}`); }
  }

  // Run list
  if (method === "GET" && path === "/runs") {
    const rows = P.listRuns(ctx.orgId).map((r) => {
      const v = P.getVersion(r.pack_version_id);
      const p = v ? getDb().prepare("SELECT name FROM packs WHERE id = ?").get(v.pack_id) as { name: string } : { name: "?" };
      return { ...r, pack: p.name };
    });
    return html(res, V.runsPage(rows, bal()));
  }

  // Live trace stream — tails the persisted transcript, so a reload loses nothing.
  const streamMatch = /^\/runs\/([a-z0-9_]+)\/stream$/.exec(path);
  if (method === "GET" && streamMatch) {
    const runId = streamMatch[1]!;
    res.writeHead(200, {
      "content-type": "text/event-stream", "cache-control": "no-cache",
      connection: "keep-alive", "x-accel-buffering": "no",
    });
    res.write("retry: 2000\n\n");
    let after = 0;
    let lastMeters = "";
    let lastAsks = "";
    const tick = setInterval(() => {
      try {
        for (const e of P.runEvents(runId, after)) {
          after = e.id;
          res.write(`event: event\ndata: ${JSON.stringify(e)}\n\n`);
        }
        const r = P.getRun(runId);
        if (r) {
          const m = JSON.stringify({
            list_cost_cents: r.list_cost_cents, budget_cents: r.budget_cents,
            input_tokens: r.input_tokens, output_tokens: r.output_tokens,
            active_seconds: r.active_seconds, billed_cents: r.billed_cents,
            status: r.status, stop_reason: r.stop_reason,
          });
          if (m !== lastMeters) { lastMeters = m; res.write(`event: meters\ndata: ${m}\n\n`); }
          const asks = JSON.stringify(P.openAsks(runId).map((a) => a.event_id));
          if (asks !== lastAsks) { lastAsks = asks; res.write(`event: asks\ndata: ${asks}\n\n`); }
        }
      } catch { /* a closed socket is not an error worth logging */ }
    }, 500);
    req.on("close", () => clearInterval(tick));
    return;
  }

  // Run page
  const runMatch = /^\/runs\/([a-z0-9_]+)$/.exec(path);
  if (method === "GET" && runMatch) {
    const run = P.getRun(runMatch[1]!);
    if (!run) return html(res, V.layout("Not found", "<h1>No such run</h1>"), 404);
    const v = P.getVersion(run.pack_version_id)!;
    const pack = getDb().prepare("SELECT name FROM packs WHERE id = ?").get(v.pack_id) as { name: string };
    return html(res, V.runPage(run, pack.name, bal(), run.stop_reason === "budget_reached",
      P.openAsks(run.id).map((a) => ({ event_id: a.event_id, name: a.name, input: a.input }))));
  }

  // Send a turn. Fire-and-forget: the trace shows it arriving live.
  const msgMatch = /^\/runs\/([a-z0-9_]+)\/message$/.exec(path);
  if (method === "POST" && msgMatch) {
    const f = await body(req);
    const runId = msgMatch[1]!;
    void P.sendTurn(runId, f["text"] ?? "").catch((e) => {
      P.recordEvent(runId, "run.error", { message: msg(e) });
    });
    return redirect(res, `/runs/${runId}`);
  }

  // Answer a paused tool call
  const decMatch = /^\/runs\/([a-z0-9_]+)\/decide$/.exec(path);
  if (method === "POST" && decMatch) {
    const f = await body(req);
    const runId = decMatch[1]!;
    const allow = f["result"] === "allow";
    void P.decide(runId, f["eventId"] ?? "", allow, f["denyMessage"] || undefined)
      .catch((e) => P.recordEvent(runId, "run.error", { message: msg(e) }));
    return redirect(res, `/runs/${runId}`);
  }

  const topMatch = /^\/runs\/([a-z0-9_]+)\/topup$/.exec(path);
  if (method === "POST" && topMatch) {
    try { await P.topUp(topMatch[1]!); }
    catch (e) { P.recordEvent(topMatch[1]!, "run.error", { message: msg(e) }); }
    return redirect(res, `/runs/${topMatch[1]}`);
  }

  const endMatch = /^\/runs\/([a-z0-9_]+)\/end$/.exec(path);
  if (method === "POST" && endMatch) {
    await P.endRun(endMatch[1]!);
    return redirect(res, "/runs");
  }

  // Points
  if (method === "GET" && path === "/ledger") {
    const rows = getDb().prepare(
      "SELECT bucket, delta_cents, reason, run_id, created_at FROM points_ledger WHERE org_id = ? ORDER BY created_at DESC, id DESC LIMIT 100")
      .all(ctx.orgId) as Array<{ bucket: string; delta_cents: number; reason: string; run_id: string | null; created_at: string }>;
    return html(res, V.ledgerPage(rows, balanceByBucket(ctx.orgId), bal()));
  }
  if (method === "POST" && path === "/ledger/topup") {
    const f = await body(req);
    const c = Math.max(1, Math.floor(Number(f["cents"] ?? 0)));
    if (Number.isFinite(c)) credit(ctx.orgId, "topup", c, "points purchase");
    return redirect(res, "/ledger");
  }

  // Author earnings
  if (method === "GET" && path === "/authors") {
    const rows = getDb().prepare(`
      SELECT p.name AS name, p.author AS author,
             COUNT(DISTINCT ae.run_id) AS runs,
             COALESCE(SUM(ae.points_millicents), 0) AS millicents
      FROM packs p LEFT JOIN author_earnings ae ON ae.pack_id = p.id
      GROUP BY p.id ORDER BY millicents DESC`)
      .all() as Array<{ name: string; author: string; runs: number; millicents: number }>;
    return html(res, V.authorsPage(rows, bal()));
  }

  // Adjustable limits
  if (method === "GET" && path === "/settings") return html(res, V.settingsPage(allSettings(), bal()));
  if (method === "POST" && path === "/settings") {
    const f = await body(req);
    if (f["key"]) putSetting(f["key"], f["value"] ?? "");
    return redirect(res, "/settings");
  }

  if (method === "GET" && path === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    return void res.end(JSON.stringify({ ok: true, balance: fmt(bal()) }));
  }

  return html(res, V.layout("Not found", `<h1>Not found</h1><p class="lede"><a href="/">Back to the catalog</a></p>`), 404);
}

const msg = (e: unknown): string => String((e as Error)?.message ?? e);

// ---------------------------------------------------------------- bootstrap

const ctx = P.ensureDemoOrg();
const seeded = P.seedCatalog();

const server = http.createServer((req, res) => {
  route(req, res, ctx).catch((e) => {
    console.error("[error]", msg(e));
    if (!res.headersSent) html(res, V.layout("Error", `<h1>Something broke</h1><div class="note bad">${V.esc(msg(e))}</div><p><a href="/">Back</a></p>`), 500);
    else res.end();
  });
});

server.listen(PORT, () => {
  console.log(`agents.alphaceo.ai — listening on http://localhost:${PORT}`);
  console.log(`  org ${ctx.orgId} · balance ${fmt(balanceCents(ctx.orgId))} · ${seeded} pack(s) seeded`);
  console.log(`  packs must be published to the runtime before they can run (button on each pack page)`);
});
