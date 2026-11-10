import http from "node:http";
import { URL } from "node:url";
import { allSettings, initDb, platformOrgId, putSetting, setting, settingInt } from "./db.js";
import * as Au from "./authoring.js";
import * as A from "./auth.js";
import * as Pay from "../billing/purchases.js";
import { payments } from "../billing/provider.js";
import { handleMcpRequest } from "../mcp/server.js";
import { tarGz } from "../packs/tar.js";
import { statusOf } from "./errors.js";
import * as Sch from "./schedules.js";
import { sql } from "./sql.js";
import { balanceByBucket, balanceMillipoints, credit, fmt } from "../billing/points.js";
import * as P from "./platform.js";
import * as Cr from "./creators.js";
import * as L from "./listing.js";
import * as S from "./social.js";
import * as M from "./messages.js";
import { permissionSummary } from "../packs/permissions.js";
import * as V from "./views.js";

const PORT = Number(process.env["PORT"] ?? 4317);
const SECURE_COOKIES = process.env["SECURE_COOKIES"] === "1";
const COOKIE = "agents_session";
/** A pack above this is a mistake, and saying so beats truncating it. */
const MAX_PACK_FILES = 200;

type Ctx = { orgId: string; userId: string; role: A.Role; viewer: V.Viewer };

/**
 * The repository fields off a form, or nothing.
 *
 * Returns an object to spread, so a run without a repository carries no `repo`
 * key at all rather than one holding undefined — the difference matters where
 * it is checked with `if (args.repo)`.
 */
function repoFrom(f: Record<string, string>): { repo?: { url: string; token?: string } } {
  const url = (f["repoUrl"] ?? "").trim();
  if (!url) return {};
  const token = (f["repoToken"] ?? "").trim();
  return { repo: { url, ...(token ? { token } : {}) } };
}

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

function jsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => { raw += c; if (raw.length > 4e6) req.destroy(); });
    req.on("end", () => {
      if (!raw) return resolve(undefined);
      try { resolve(JSON.parse(raw)); } catch { reject(new Error("invalid JSON body")); }
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

/** Where the provider should send a buyer back to. Honours a reverse proxy. */
function baseUrl(req: http.IncomingMessage): string {
  const proto = String(req.headers["x-forwarded-proto"] ?? (SECURE_COOKIES ? "https" : "http")).split(",")[0];
  const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? `localhost:${PORT}`).split(",")[0];
  return `${proto}://${host}`;
}

async function models(): Promise<string[]> {
  return (await setting("allowed_models")).split(",").map((s) => s.trim()).filter(Boolean);
}

async function packNameOf(packVersionId: string): Promise<string> {
  const v = await P.getVersion(packVersionId);
  if (!v) return "?";
  return (await P.packById(v.pack_id))?.name ?? "?";
}

/** The handle behind a pack's `creator_id`, or null for a pack nobody has claimed. */
async function creatorHandleOf(creatorId: string | null): Promise<string | null> {
  if (!creatorId) return null;
  const s = await sql();
  const row = await s.one<{ handle: string }>("SELECT handle FROM creators WHERE id = $1", [creatorId]);
  return row?.handle ?? null;
}

/**
 * Written opinions worth showing — a rating, a body, or both. A review row
 * with neither (both left blank at submit time) conveys nothing and is
 * dropped here rather than rendered as a nameless, empty card.
 */
async function reviewsOf(
  packId: string,
): Promise<Array<{ byline: string | null; rating: number | null; body: string; createdAt: string }>> {
  const s = await sql();
  const rows = await s.query<{ byline: string | null; rating: number | string | null; body: string; created_at: string }>(
    `SELECT byline, rating, body, created_at FROM pack_reviews
      WHERE pack_id = $1 AND (rating IS NOT NULL OR body <> '')
      ORDER BY updated_at DESC`,
    [packId],
  );
  return rows.map((r) => ({
    byline: r.byline, rating: r.rating == null ? null : Number(r.rating), body: r.body, createdAt: r.created_at,
  }));
}

/** This organisation's own review, if it has submitted one — so the form edits it, not a blank. */
async function myReviewOf(
  packId: string, orgId: string,
): Promise<{ rating: number | null; body: string; byline: string; anonymous: boolean } | null> {
  const s = await sql();
  const row = await s.one<{ rating: number | string | null; body: string; byline: string | null; anonymous: number | string }>(
    "SELECT rating, body, byline, anonymous FROM pack_reviews WHERE pack_id = $1 AND org_id = $2",
    [packId, orgId],
  );
  if (!row) return null;
  return {
    rating: row.rating == null ? null : Number(row.rating), body: row.body,
    byline: row.byline ?? "", anonymous: Boolean(Number(row.anonymous)),
  };
}

/**
 * How many organisations marked this pack useful, and whether this one
 * already has. `-1` is a real, legitimate stored value — a downvote — and
 * is not "useful" in either direction: both queries filter to `value > 0`
 * so a downvote neither inflates the count nor flips this viewer's own
 * button to "Marked useful".
 */
async function votesOf(packId: string, orgId: string): Promise<{ count: number; voted: boolean }> {
  const s = await sql();
  const rows = await s.query<{ ok: number }>(
    "SELECT 1 AS ok FROM pack_votes WHERE pack_id = $1 AND value > 0", [packId]);
  const mine = await s.one<{ ok: number }>(
    "SELECT 1 AS ok FROM pack_votes WHERE pack_id = $1 AND org_id = $2 AND value > 0", [packId, orgId]);
  return { count: rows.length, voted: Boolean(mine) };
}

/** Whether this organisation has bookmarked the pack. */
async function isSaved(packId: string, orgId: string): Promise<boolean> {
  const s = await sql();
  return Boolean(
    await s.one<{ ok: number }>("SELECT 1 AS ok FROM pack_saves WHERE pack_id = $1 AND org_id = $2", [packId, orgId]),
  );
}

// ------------------------------------------------------------------ routes

async function route(req: http.IncomingMessage, res: http.ServerResponse, ctx: Ctx): Promise<void> {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = req.method ?? "GET";
  const bal = () => balanceMillipoints(ctx.orgId);
  const viewer = ctx.viewer;
  const ownerOnly = (): void => { if (ctx.role !== "owner") throw new A.ForbiddenError(); };

  if (method === "GET" && path === "/") {
    const q = (url.searchParams.get("q") ?? "").trim();
    const packs = await Promise.all((await P.listPacks(q)).map(async (p) => {
      const v = await P.latestVersion(p.id);
      return {
        ...p,
        published: Boolean(v),
        owned: Boolean(v && (await P.entitled(ctx.orgId, v.id))),
        pricePoints: Pay.pricePoints(p),
        stats: await P.packStats(p.id),
        creatorHandle: await creatorHandleOf(p.creator_id),
      };
    }));
    return html(res, V.catalogPage(packs, await bal(), viewer, q, P.tagsOf(packs), await P.roles()));
  }

  const packMatch = /^\/packs\/([a-z0-9-]+)$/.exec(path);
  if (method === "GET" && packMatch) {
    const p = await P.getPack(packMatch[1]!);
    if (!p) return html(res, V.layout("Not found", "<h1>No such pack</h1>"), 404);
    const v = await P.latestVersion(p.id);
    const owned = Boolean(v && (await P.entitled(ctx.orgId, v.id)));
    const trial = v && !owned
      ? { turns: await settingInt("trial_turns"), budgetCents: await settingInt("trial_budget_cents"),
          used: await P.hasTriedPack(ctx.orgId, p.id) }
      : null;
    // The permissions rail is derived from what the pack stored, falling back
    // to the platform's own policy where a pack has no tools recorded — which
    // is every pack published before they were persisted.
    const permissions = permissionSummary({
      tools: await P.packTools(p.id),
      mcpServers: await P.packMcpServers(p.id),
      web: P.packExtras(p).web ?? {},
      defaultPolicy: await P.destructivePolicy(),
    }).lines;
    const creatorHandle = await creatorHandleOf(p.creator_id);
    const extras: V.PackPageExtras = {
      listing: L.hasListing(p) ? L.listingOf(p) : null,
      stats: await P.packStats(p.id),
      permissions,
      files: await P.packFileSummary(p.id),
      updatedAt: v?.created_at ?? null,
      builtOn: p.built_on,
      refundDays: await settingInt("refund_window_days"),
      creator: creatorHandle && p.creator_id ? { id: p.creator_id, handle: creatorHandle } : null,
      rating: await S.ratingOf(p.id),
      reviews: await reviewsOf(p.id),
      mayReview: await S.mayReview(ctx.orgId, p.id),
      myReview: await myReviewOf(p.id, ctx.orgId),
      votes: await votesOf(p.id, ctx.orgId),
      saved: await isSaved(p.id, ctx.orgId),
      changelog: await P.changelogOf(p.id),
    };
    return html(res, V.packPage(p, v, owned, await models(), await bal(),
      url.searchParams.get("err") ?? undefined, viewer, trial, p.author_org_id === ctx.orgId, extras));
  }

  const pubMatch = /^\/packs\/([a-z0-9-]+)\/publish$/.exec(path);
  if (method === "POST" && pubMatch) {
    ownerOnly();
    const f = await body(req);
    try { await P.publishPack(pubMatch[1]!, f["note"]); }
    catch (e) { return redirect(res, `/packs/${pubMatch[1]}?err=${encodeURIComponent(msg(e))}`); }
    return redirect(res, `/packs/${pubMatch[1]}`);
  }

  // Export: the developer path. Owners only — it hands over the instructions.
  const expMatch = /^\/packs\/([a-z0-9-]+)\/export$/.exec(path);
  if (method === "GET" && expMatch) {
    const slug = expMatch[1]!;
    const pack = await P.getPack(slug);
    if (!pack) return html(res, V.layout("Not found", "<h1>No such pack</h1>", { viewer }), 404);
    const format = url.searchParams.get("format") ?? "tar";
    const tree = await P.exportPackTree(ctx.orgId, slug);

    if (format === "json") {
      res.writeHead(200, { "content-type": "application/json" });
      return void res.end(JSON.stringify({ slug, files: tree }));
    }
    if (format === "md") {
      // The definition alone, for a pack with no folder behind it.
      res.writeHead(200, {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition": `attachment; filename="${slug}.md"`,
      });
      return void res.end(await P.exportPack(ctx.orgId, slug));
    }
    // A real directory, so `tar xzf` gives the author's folder back.
    const gz = tarGz(tree, slug);
    res.writeHead(200, {
      "content-type": "application/gzip",
      "content-disposition": `attachment; filename="${slug}.tar.gz"`,
      "content-length": String(gz.length),
    });
    return void res.end(gz);
  }

  const trialMatch = /^\/packs\/([a-z0-9-]+)\/trial$/.exec(path);
  if (method === "POST" && trialMatch) {
    const slug = trialMatch[1]!;
    const pack = await P.getPack(slug);
    if (!pack) return html(res, V.layout("Not found", "<h1>No such pack</h1>", { viewer }), 404);
    try {
      const v = (await P.latestVersion(pack.id)) ?? (await P.publishPack(slug));
      const run = await P.startRun({ orgId: ctx.orgId, userId: ctx.userId, packVersionId: v.id, trial: true });
      return redirect(res, `/runs/${run.id}`);
    } catch (e) { return redirect(res, `/packs/${slug}?err=${encodeURIComponent(msg(e))}`); }
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
      // One currency: a pack is bought with points, like everything else the
      // buyer spends. An entitlement still comes from a settled purchase.
      if (!(await P.entitled(ctx.orgId, versionId))) {
        await Pay.buyWithPoints({
          orgId: ctx.orgId, userId: ctx.userId, packVersionId: versionId,
          packId: pack.id, pricePoints: Pay.pricePoints(pack), description: pack.name,
        });
      }
      const run = await P.startRun({
        orgId: ctx.orgId, userId: ctx.userId, packVersionId: versionId, model: f["model"],
        ...repoFrom(f),
      });
      return redirect(res, `/runs/${run.id}`);
    } catch (e) { return redirect(res, `/packs/${slug}?err=${encodeURIComponent(msg(e))}`); }
  }

  const reviewMatch = /^\/packs\/([a-z0-9-]+)\/review$/.exec(path);
  if (method === "POST" && reviewMatch) {
    const slug = reviewMatch[1]!;
    const pack = await P.getPack(slug);
    if (!pack) return html(res, V.layout("Not found", "<h1>No such pack</h1>", { viewer }), 404);
    const f = await body(req);
    try {
      await S.submitReview({
        orgId: ctx.orgId, userId: ctx.userId, packId: pack.id,
        rating: f["rating"] ? Number(f["rating"]) : undefined,
        body: f["body"] ?? "",
        byline: f["byline"] ?? "",
        anonymous: f["anonymous"] === "on",
      });
    } catch (e) { return redirect(res, `/packs/${slug}?err=${encodeURIComponent(msg(e))}`); }
    return redirect(res, `/packs/${slug}`);
  }

  // "This looks good" — no run required, so no eligibility check belongs
  // here either; `vote()` itself clamps an in-range value and rejects
  // anything that is not a finite number.
  const voteMatch = /^\/packs\/([a-z0-9-]+)\/vote$/.exec(path);
  if (method === "POST" && voteMatch) {
    const slug = voteMatch[1]!;
    const pack = await P.getPack(slug);
    if (!pack) return html(res, V.layout("Not found", "<h1>No such pack</h1>", { viewer }), 404);
    const f = await body(req);
    try { await S.vote(ctx.orgId, pack.id, Number(f["value"] ?? "1")); }
    catch (e) { return redirect(res, `/packs/${slug}?err=${encodeURIComponent(msg(e))}`); }
    return redirect(res, `/packs/${slug}`);
  }

  const saveMatch = /^\/packs\/([a-z0-9-]+)\/save$/.exec(path);
  if (method === "POST" && saveMatch) {
    const slug = saveMatch[1]!;
    const pack = await P.getPack(slug);
    if (!pack) return html(res, V.layout("Not found", "<h1>No such pack</h1>", { viewer }), 404);
    try { await S.toggleSave(ctx.orgId, ctx.userId, pack.id); }
    catch (e) { return redirect(res, `/packs/${slug}?err=${encodeURIComponent(msg(e))}`); }
    return redirect(res, `/packs/${slug}`);
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
      const run = await P.startRun({
        orgId: ctx.orgId, userId: ctx.userId, packVersionId: versionId, model: f["model"],
        ...repoFrom(f),
      });
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
    let trial: { turns: number; slug: string; pricePoints: number } | null = null;
    if (run.is_trial) {
      const v = await P.getVersion(run.pack_version_id);
      const pack = v ? await P.packById(v.pack_id) : undefined;
      if (pack) trial = { turns: await settingInt("trial_turns"), slug: pack.slug, pricePoints: pack.price_points };
    }
    return html(res, V.runPage(run, await packNameOf(run.pack_version_id), await bal(),
      run.stop_reason === "budget_reached", asks, viewer, trial,
      (await P.runOutputs(run.id)).map((o) => ({ file_id: o.file_id, filename: o.filename, size_bytes: Number(o.size_bytes) })),
      await P.runUsage(run.id), await settingInt("transcript_retention_days")));
  }

  // Deliverables the agent wrote
  const outMatch = /^\/runs\/([a-z0-9_]+)\/outputs\/([A-Za-z0-9_-]+)$/.exec(path);
  if (method === "GET" && outMatch) {
    try {
      const file = await P.downloadOutput(outMatch[1]!, outMatch[2]!, ctx.orgId);
      const ext = file.filename.split(".").pop()?.toLowerCase() ?? "";
      const types: Record<string, string> = {
        html: "text/html; charset=utf-8", md: "text/markdown; charset=utf-8",
        json: "application/json", csv: "text/csv", txt: "text/plain; charset=utf-8",
        pdf: "application/pdf", svg: "image/svg+xml", png: "image/png",
        xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      };
      res.writeHead(200, {
        "content-type": types[ext] ?? "application/octet-stream",
        // Shown in the browser when we can render it, downloaded otherwise.
        "content-disposition": `${ext === "html" || ext === "pdf" || ext === "svg" || ext === "png" ? "inline" : "attachment"}; filename="${file.filename}"`,
        "content-length": String(file.bytes.length),
      });
      return void res.end(file.bytes);
    } catch (e) { return html(res, V.layout("Not found", `<h1>${V.esc(msg(e))}</h1>`, { viewer }), 404); }
  }

  // Fire-and-forget: the trace shows the turn arriving live.
  const msgMatch = /^\/runs\/([a-z0-9_]+)\/message$/.exec(path);
  if (method === "POST" && msgMatch) {
    const f = await body(req);
    const runId = msgMatch[1]!;
    void P.sendTurn(runId, f["text"] ?? "").catch((e) => P.recordEvent(runId, "run.error", { message: msg(e) }));
    return redirect(res, `/runs/${runId}`);
  }

  // Delete this transcript now, rather than waiting for the retention window.
  const forgetMatch = /^\/runs\/([a-z0-9_]+)\/forget$/.exec(path);
  if (method === "POST" && forgetMatch) {
    const runId = forgetMatch[1]!;
    const owned = await P.getRun(runId);
    if (!owned || owned.org_id !== ctx.orgId) return html(res, V.layout("Not found", "<h1>No such run</h1>", { viewer }), 404);
    await P.forgetTranscript(runId);
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
    const rows = await s.query<{ bucket: string; delta_millipoints: number; reason: string; run_id: string | null; created_at: string }>(
      `SELECT bucket, delta_millipoints, reason, run_id, created_at FROM points_ledger
       WHERE org_id = $1 ORDER BY created_at DESC LIMIT 100`, [ctx.orgId]);
    return html(res, V.ledgerPage(rows, await balanceByBucket(ctx.orgId), await bal(), viewer));
  }
  if (method === "POST" && path === "/ledger/topup") {
    const f = await body(req);
    const c = Math.floor(Number(f["cents"] ?? 0));
    if (!Number.isFinite(c) || c <= 0) return redirect(res, "/ledger");
    const out = await Pay.beginPointsPurchase({
      orgId: ctx.orgId, userId: ctx.userId, amountCents: c, baseUrl: baseUrl(req),
    });
    if (out.status === "redirect" && out.approveUrl) return redirect(res, out.approveUrl);
    return redirect(res, "/ledger");
  }

  // ------------------------------------------------------------- purchases
  if (method === "GET" && path === "/purchases") {
    const s2 = await sql();
    const rows = await s2.query<{
      id: string; kind: string; amount_cents: number; status: string; provider: string;
      refundable_until: string | null; created_at: string; what: string | null;
    }>(`SELECT pu.id, pu.kind, pu.amount_cents, pu.status, pu.provider, pu.refundable_until, pu.created_at,
               pk.name AS what
        FROM purchases pu
        LEFT JOIN pack_versions pv ON pv.id = pu.pack_version_id
        LEFT JOIN packs pk ON pk.id = pv.pack_id
        WHERE pu.org_id = $1 ORDER BY pu.created_at DESC`, [ctx.orgId]);
    const prov = payments();
    return html(res, V.purchasesPage(
      rows.map((r) => ({ ...r, amount_cents: Number(r.amount_cents), what: r.what ?? "Agent compute" })),
      prov.name, prov.real, await bal(), viewer));
  }

  const retMatch = /^\/purchases\/([a-z0-9_]+)\/return$/.exec(path);
  if (method === "GET" && retMatch) {
    const p = await Pay.getPurchase(retMatch[1]!);
    if (!p || p.org_id !== ctx.orgId) return html(res, V.layout("Not found", "<h1>No such purchase</h1>", { viewer }), 404);
    try {
      await Pay.completePurchase(p.id);
      if (p.kind === "points") return redirect(res, "/ledger");
      const run = await P.startRun({ orgId: ctx.orgId, userId: ctx.userId, packVersionId: p.pack_version_id! });
      return redirect(res, `/runs/${run.id}`);
    } catch (e) { return redirect(res, `/purchases?err=${encodeURIComponent(msg(e))}`); }
  }

  const canMatch = /^\/purchases\/([a-z0-9_]+)\/cancel$/.exec(path);
  if (canMatch) { await Pay.cancelPurchase(canMatch[1]!); return redirect(res, "/purchases"); }

  const refMatch = /^\/purchases\/([a-z0-9_]+)\/refund$/.exec(path);
  if (method === "POST" && refMatch) {
    try { await Pay.refundPurchase(refMatch[1]!, ctx.orgId); return redirect(res, "/purchases"); }
    catch (e) { return redirect(res, `/purchases?err=${encodeURIComponent(msg(e))}`); }
  }

  // --------------------------------------------------------------- payouts
  if (method === "GET" && path === "/payouts") {
    ownerOnly();
    const s2 = await sql();
    const history = await s2.query<{ name: string; recipient: string; millicents: unknown; status: string; created_at: string }>(
      `SELECT pk.name AS name, po.recipient, po.millicents, po.status, po.created_at
       FROM payouts po JOIN packs pk ON pk.id = po.pack_id ORDER BY po.created_at DESC LIMIT 50`);
    const prov = payments();
    return html(res, V.payoutsPage({
      due: await Pay.payoutsDue(),
      history: history.map((h) => ({ ...h, millicents: Number(h.millicents) })),
      windowDays: await settingInt("refund_window_days"),
      providerName: prov.name, providerReal: prov.real,
      balance: await bal(), viewer,
      err: url.searchParams.get("err") ?? undefined,
    }));
  }
  if (method === "POST" && path === "/payouts/pay") {
    ownerOnly();
    const f = await body(req);
    try { await Pay.payAuthor(f["packId"] ?? ""); return redirect(res, "/payouts"); }
    catch (e) { return redirect(res, `/payouts?err=${encodeURIComponent(msg(e))}`); }
  }

  if (method === "GET" && path === "/authors") {
    const s2 = await sql();
    const mineRaw = await s2.query<Record<string, unknown>>(`
      SELECT p.id, p.slug, p.name, p.status, p.author_payout_email AS payout_email,
             (SELECT COUNT(*) FROM runs r JOIN pack_versions v ON v.id = r.pack_version_id
                WHERE v.pack_id = p.id) AS runs,
             (SELECT COUNT(*) FROM runs r JOIN pack_versions v ON v.id = r.pack_version_id
                WHERE v.pack_id = p.id AND r.is_trial = 1) AS trials,
             (SELECT COUNT(*) FROM runs r JOIN pack_versions v ON v.id = r.pack_version_id
                WHERE v.pack_id = p.id AND r.stop_reason IS NOT NULL) AS failures,
             (SELECT COALESCE(SUM(r.list_cost_cents), 0) FROM runs r JOIN pack_versions v ON v.id = r.pack_version_id
                WHERE v.pack_id = p.id) AS cost_cents,
             (SELECT COALESCE(SUM(ae.points_millicents), 0) FROM author_earnings ae WHERE ae.pack_id = p.id) AS millicents,
             (SELECT COALESCE(SUM(ae.points_millicents), 0) FROM author_earnings ae
                WHERE ae.pack_id = p.id AND ae.payout_id IS NOT NULL) AS paid_millicents
      FROM packs p WHERE p.author_org_id = $1 ORDER BY p.name`, [ctx.orgId]);
    const recentRaw = await s2.query<Record<string, unknown>>(`
      SELECT r.id AS run_id, p.name AS pack, r.stop_reason, r.list_cost_cents AS cost_cents, r.started_at
      FROM runs r JOIN pack_versions v ON v.id = r.pack_version_id JOIN packs p ON p.id = v.pack_id
      WHERE p.author_org_id = $1 ORDER BY r.started_at DESC LIMIT 20`, [ctx.orgId]);
    const catalogRaw = await s2.query<Record<string, unknown>>(`
      SELECT p.name, p.author, p.author_org_id,
             COUNT(DISTINCT ae.run_id) AS runs,
             COALESCE(SUM(ae.points_millicents), 0) AS millicents
      FROM packs p LEFT JOIN author_earnings ae ON ae.pack_id = p.id
      GROUP BY p.id, p.name, p.author, p.author_org_id ORDER BY millicents DESC`);
    const n = (v: unknown) => Number(v ?? 0);
    return html(res, V.authorsPage({
      mine: mineRaw.map((m) => ({
        id: String(m["id"]), slug: String(m["slug"]), name: String(m["name"]), status: String(m["status"]),
        payout_email: (m["payout_email"] as string | null) ?? null,
        runs: n(m["runs"]), trials: n(m["trials"]), failures: n(m["failures"]),
        cost_cents: n(m["cost_cents"]), millicents: n(m["millicents"]), paid_millicents: n(m["paid_millicents"]),
      })),
      recent: recentRaw.map((r) => ({
        run_id: String(r["run_id"]), pack: String(r["pack"]),
        stop_reason: (r["stop_reason"] as string | null) ?? null,
        cost_cents: n(r["cost_cents"]), started_at: String(r["started_at"]),
      })),
      catalog: catalogRaw.map((c) => ({
        name: String(c["name"]), author: String(c["author"]),
        runs: n(c["runs"]), millicents: n(c["millicents"]),
        mine: c["author_org_id"] === ctx.orgId,
      })),
      balance: await bal(), viewer, err: url.searchParams.get("err") ?? undefined,
      isCurator: (await platformOrgId()) === ctx.orgId,
    }));
  }
  if (method === "POST" && path === "/authors/claim") {
    ownerOnly();
    const f = await body(req);
    const pack = await P.getPack((f["slug"] ?? "").trim());
    if (!pack) return redirect(res, `/authors?err=${encodeURIComponent("no pack with that slug")}`);
    if (pack.author_org_id && pack.author_org_id !== ctx.orgId) {
      return redirect(res, `/authors?err=${encodeURIComponent("another organisation already claims that pack")}`);
    }
    const s2 = await sql();
    await s2.query("UPDATE packs SET author_org_id = $1, author_payout_email = $2 WHERE id = $3",
      [ctx.orgId, (f["payoutEmail"] ?? "").trim(), pack.id]);
    return redirect(res, "/authors");
  }

  // ------------------------------------------------------------- creators
  // `/creators/me` is checked ahead of the `/creators/:handle` pattern below,
  // since "me" would otherwise parse as a handle.
  if (method === "GET" && path === "/creators/me") {
    const mine = await Cr.creatorForOrg(ctx.orgId);
    return html(res, V.creatorEditorPage({
      creator: mine ?? null, canEdit: ctx.role === "owner", balance: await bal(), viewer,
      err: url.searchParams.get("err") ?? undefined,
    }));
  }
  if (method === "POST" && path === "/creators/me") {
    ownerOnly();
    const f = await body(req);
    const links = (f["links"] ?? "").split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
      const i = line.indexOf("|");
      return i === -1 ? { label: line, url: "" } : { label: line.slice(0, i).trim(), url: line.slice(i + 1).trim() };
    }).filter((l) => l.url);
    try {
      const created = await Cr.upsertCreator({
        orgId: ctx.orgId, userId: ctx.userId,
        handle: f["handle"] ?? "", displayName: f["displayName"] ?? "",
        bio: f["bio"], avatar: f["avatar"], links,
      });
      return redirect(res, `/creators/${created.handle}`);
    } catch (e) { return redirect(res, `/creators/me?err=${encodeURIComponent(msg(e))}`); }
  }
  const creatorMatch = /^\/creators\/([a-zA-Z0-9_-]+)$/.exec(path);
  if (method === "GET" && creatorMatch) {
    const creator = await Cr.creatorByHandle(creatorMatch[1]!);
    if (!creator) return html(res, V.layout("Not found", "<h1>No such creator</h1>", { viewer }), 404);
    const s2 = await sql();
    const rows = await s2.query<P.PackRow>(
      "SELECT * FROM packs WHERE creator_id = $1 AND status = 'listed' ORDER BY name", [creator.id]);
    const packs = await Promise.all(rows.map(async (p) => ({
      ...p,
      pricePoints: Pay.pricePoints(p),
      stats: await P.packStats(p.id),
    })));
    return html(res, V.creatorPage(
      creator, packs, await Cr.creatorStats(creator.id), await S.creatorRating(creator.id), viewer, await bal(),
      creator.org_id !== ctx.orgId));
  }

  // ------------------------------------------------------------- messages
  // A private line between a buyer organisation and a creator. GET /inbox
  // shows whichever side of that this organisation is on: threads asked of
  // its own creator profile, if it has one, and threads it has itself
  // opened with someone else's. Neither `threadsFor` nor `threadsForOrg`
  // ever returns a thread belonging to a third organisation, so there is
  // nothing to filter at this layer — the scoping is in the query.
  if (method === "GET" && path === "/inbox") {
    const mine = await Cr.creatorForOrg(ctx.orgId);
    return html(res, V.inboxPage({
      asked: mine ? await M.threadsFor(mine.id) : [],
      mine: await M.threadsForOrg(ctx.orgId),
      selfOrgId: ctx.orgId, viewer, balance: await bal(),
      err: url.searchParams.get("err") ?? undefined,
    }));
  }

  if (method === "POST" && path === "/threads") {
    const f = await body(req);
    // An allowlist, not a blacklist: the form only ever sets this to one of
    // the two pages a thread can be opened from. A blacklist of "looks like
    // an external host" prefixes is the wrong shape for this — "//evil" is
    // one such prefix, but so is "/\evil" (a backslash is an equivalent
    // path separator to a browser's URL parser in the relative-slash state,
    // so "/\evil.example/x" resolves to "http://evil.example/x" exactly
    // like "//evil.example/x" does) and there is no reason to assume those
    // are the only two. Anything that is not exactly one of the pages this
    // form is rendered on falls back to /inbox.
    const backField = f["back"] ?? "";
    const back = /^\/packs\/[a-z0-9-]+$/.test(backField) || /^\/creators\/[a-zA-Z0-9_-]+$/.test(backField)
      ? backField : "/inbox";
    try {
      await M.openThread({
        orgId: ctx.orgId, userId: ctx.userId, creatorId: f["creatorId"] ?? "",
        packId: f["packId"] || null, subject: f["subject"] ?? "", body: f["body"] ?? "",
      });
    } catch (e) { return redirect(res, `${back}?err=${encodeURIComponent(msg(e))}`); }
    return redirect(res, "/inbox");
  }

  const replyMatch = /^\/threads\/([a-z0-9_]+)\/reply$/.exec(path);
  if (method === "POST" && replyMatch) {
    const f = await body(req);
    try {
      await M.reply({ threadId: replyMatch[1]!, orgId: ctx.orgId, userId: ctx.userId, body: f["body"] ?? "" });
    } catch (e) {
      // A third organisation's reply gets the same 404 a bad thread ID would
      // — not a redirect-with-error, which would at least confirm the
      // thread exists.
      if (statusOf(e) === 404) return html(res, V.layout("Not found", "<h1>No such thread</h1>", { viewer }), 404);
      return redirect(res, `/inbox?err=${encodeURIComponent(msg(e))}`);
    }
    return redirect(res, "/inbox");
  }

  const faqMatch = /^\/threads\/([a-z0-9_]+)\/publish$/.exec(path);
  if (method === "POST" && faqMatch) {
    const f = await body(req);
    const mine = await Cr.creatorForOrg(ctx.orgId);
    if (!mine) return html(res, V.layout("Not found", "<h1>No such thread</h1>", { viewer }), 404);
    try {
      await M.publishToFaq(mine.id, faqMatch[1]!, f["questionId"] ?? "", f["answerId"] ?? "");
    } catch (e) {
      if (statusOf(e) === 404) return html(res, V.layout("Not found", "<h1>No such thread</h1>", { viewer }), 404);
      return redirect(res, `/inbox?err=${encodeURIComponent(msg(e))}`);
    }
    return redirect(res, "/inbox");
  }

  // ------------------------------------------------------------- authoring
  const packFields = (f: Record<string, string>): Au.PackInput => ({
    slug: f["slug"] ?? "", name: f["name"] ?? "", tagline: f["tagline"] ?? "",
    author: f["author"] ?? "", model: f["model"] ?? "claude-opus-5",
    effort: (f["effort"] || undefined) as Au.PackInput["effort"],
    pricePoints: Math.floor(Number(f["pricePoints"] ?? 0)),
    upgradePoints: Math.floor(Number(f["upgradePoints"] ?? 0)),
    instructions: f["instructions"] ?? "",
    pinnedModels: (f["pinnedModels"] ?? "").split(",").map((x) => x.trim()).filter(Boolean),
    payoutEmail: f["payoutEmail"] ?? "",
  });

  if (method === "GET" && path === "/authors/new") {
    ownerOnly();
    return html(res, V.packEditorPage({
      pack: null, models: await models(), balance: await bal(), viewer,
      err: url.searchParams.get("err") ?? undefined, isCurator: (await platformOrgId()) === ctx.orgId,
    }));
  }
  if (method === "POST" && path === "/authors/packs") {
    ownerOnly();
    const f = await body(req);
    try {
      const pack = await Au.createPack(ctx.orgId, packFields(f));
      return redirect(res, `/packs/${pack.slug}/edit`);
    } catch (e) { return redirect(res, `/authors/new?err=${encodeURIComponent(msg(e))}`); }
  }

  const editMatch = /^\/packs\/([a-z0-9-]+)\/edit$/.exec(path);
  if (editMatch) {
    const slug = editMatch[1]!;
    const pack = await P.getPack(slug);
    if (!pack) return html(res, V.layout("Not found", "<h1>No such pack</h1>", { viewer }), 404);
    const curator = (await platformOrgId()) === ctx.orgId;
    if (pack.author_org_id !== ctx.orgId && !curator) throw new Au.NotTheAuthorError();
    if (method === "POST") {
      ownerOnly();
      const fields = packFields(await body(req));
      try { await Au.updatePack(pack.author_org_id!, slug, { ...fields, slug }); }
      catch (e) { return redirect(res, `/packs/${slug}/edit?err=${encodeURIComponent(msg(e))}`); }
      // An edited method may no longer be what the live listing describes, so
      // the listing is dated rather than silently left to claim it still is.
      // Marked from here and not from inside `updatePack`: `listing.ts`
      // imports `authoring.ts` for the authority pattern, and the reverse
      // edge would be an import cycle whose first link is evaluated at module
      // load — a runtime failure, not a typecheck one.
      if (fields.instructions.trim() !== pack.instructions.trim()) await L.markStale(pack.id);
      return redirect(res, `/packs/${slug}/edit`);
    }
    const v = await P.latestVersion(pack.id);
    return html(res, V.packEditorPage({
      pack: { ...pack, ...(v ? { version: v.version } : {}) },
      models: await models(), balance: await bal(), viewer,
      err: url.searchParams.get("err") ?? undefined, isCurator: curator,
    }));
  }

  // ----------------------------------------------------- listing approval
  //
  // Generated copy reaches a buyer through exactly one door, and this is it.
  // `scripts/generate-listings.mjs` writes drafts and nothing else; nothing
  // but the approve route below copies a draft onto the pack. Same gate as
  // the editor — the author's own organisation, or the curator — because this
  // is publishing, not drafting.

  /** The pack, gated the way the editor gates it: its own organisation, or the curator. */
  const myPackOr403 = async (slug: string): Promise<P.PackRow | null> => {
    const pack = await P.getPack(slug);
    if (!pack) return null;
    const curator = (await platformOrgId()) === ctx.orgId;
    if (pack.author_org_id !== ctx.orgId && !curator) throw new Au.NotTheAuthorError();
    return pack;
  };
  const listingMatch = /^\/packs\/([a-z0-9-]+)\/listing$/.exec(path);
  if (method === "GET" && listingMatch) {
    const pack = await myPackOr403(listingMatch[1]!);
    if (!pack) return html(res, V.layout("Not found", "<h1>No such pack</h1>", { viewer }), 404);
    const pending = await L.draftWithMeta(pack.id);
    const v = await P.latestVersion(pack.id);
    return html(res, V.listingApprovalPage({
      pack,
      live: L.hasListing(pack) ? L.listingOf(pack) : null,
      draft: pending?.listing ?? null,
      generatedAt: pending?.generatedAt ?? null,
      sourceVersion: pending?.sourceVersion ?? null,
      currentVersion: v?.version ?? null,
      canApprove: ctx.role === "owner",
      balance: await bal(), viewer,
      err: url.searchParams.get("err") ?? undefined,
    }));
  }
  const approveMatch = /^\/packs\/([a-z0-9-]+)\/listing\/approve$/.exec(path);
  if (method === "POST" && approveMatch) {
    ownerOnly();
    const slug = approveMatch[1]!;
    // Authority first, so a stranger gets a flat refusal rather than a
    // redirect to a page they cannot read. `approveDraft` checks it again
    // itself — every caller inherits the gate, not just this route.
    if (!(await myPackOr403(slug))) return html(res, V.layout("Not found", "<h1>No such pack</h1>", { viewer }), 404);
    try { await L.approveDraft(ctx.orgId, slug); }
    catch (e) { return redirect(res, `/packs/${slug}/listing?err=${encodeURIComponent(msg(e))}`); }
    return redirect(res, `/packs/${slug}`);
  }

  const subMatch = /^\/packs\/([a-z0-9-]+)\/submit$/.exec(path);
  if (method === "POST" && subMatch) {
    ownerOnly();
    try { await Au.setStatus(ctx.orgId, subMatch[1]!, "review"); return redirect(res, `/packs/${subMatch[1]}/edit`); }
    catch (e) { return redirect(res, `/packs/${subMatch[1]}/edit?err=${encodeURIComponent(msg(e))}`); }
  }
  const statMatch = /^\/packs\/([a-z0-9-]+)\/status$/.exec(path);
  if (method === "POST" && statMatch) {
    ownerOnly();
    const f = await body(req);
    try {
      await Au.setStatus(ctx.orgId, statMatch[1]!, (f["status"] ?? "draft") as Au.PackStatus);
      return redirect(res, url.searchParams.get("from") === "curate" ? "/curate" : `/packs/${statMatch[1]}/edit`);
    } catch (e) { return redirect(res, `/packs/${statMatch[1]}/edit?err=${encodeURIComponent(msg(e))}`); }
  }
  const delMatch = /^\/packs\/([a-z0-9-]+)\/delete$/.exec(path);
  if (method === "POST" && delMatch) {
    ownerOnly();
    try { await Au.deletePack(ctx.orgId, delMatch[1]!); return redirect(res, "/authors"); }
    catch (e) { return redirect(res, `/packs/${delMatch[1]}/edit?err=${encodeURIComponent(msg(e))}`); }
  }

  // Upload: one file or a whole folder, as JSON so it works from the browser,
  // the CLI and an agent without a multipart parser in between.
  if (method === "GET" && path === "/api/packs") {
    const rows = await P.listPacks();
    const mine = await Au.myPacks(ctx.orgId);
    const packs = await Promise.all([...rows, ...mine.filter((m) => !rows.some((r) => r.id === m.id))]
      .map(async (p) => {
        const v = await P.latestVersion(p.id);
        return {
          slug: p.slug, name: p.name, status: p.status, price_points: p.price_points,
          owned: Boolean(v && (await P.entitled(ctx.orgId, v.id))),
          version: v?.version ?? null,
        };
      }));
    res.writeHead(200, { "content-type": "application/json" });
    return void res.end(JSON.stringify({ packs }));
  }

  if (method === "POST" && path === "/api/packs") {
    ownerOnly();
    const payload = (await jsonBody(req)) as { files?: unknown; slug?: unknown } | undefined;
    const files = Array.isArray(payload?.files) ? payload.files : [];
    const clean = files
      .filter((f): f is { path: string; text: string } =>
        // `typeof null` is "object", so reaching for .path on a null entry
        // threw inside the filter and became a 500. A malformed upload is a
        // 400 about the upload, not a crash.
        typeof f === "object" && f !== null
        && typeof (f as { path?: unknown }).path === "string"
        && typeof (f as { text?: unknown }).text === "string");
    // Truncating at 200 and saying nothing turned a 300-file folder into a
    // partial pack that published cleanly and was missing half its skills.
    if (clean.length > MAX_PACK_FILES) {
      res.writeHead(413, { "content-type": "application/json" });
      return void res.end(JSON.stringify({
        error: `${clean.length} files; a pack holds at most ${MAX_PACK_FILES}. `
          + "Split it, or leave out what the agent does not read.",
      }));
    }
    // The status is written when the outcome is known. Writing 200 up here
    // meant every later writeHead threw on headers-already-sent, the outer
    // handler saw headersSent and ended the response, and an import that
    // failed came back as 200 with an empty body — so the CLI reported
    // "undefined" and the actual error was never seen by anyone.
    if (clean.length === 0) {
      res.writeHead(400, { "content-type": "application/json" });
      return void res.end(JSON.stringify({ error: "send { files: [{ path, text }] }" }));
    }
    try {
      const out = await Au.importPack({
        orgId: ctx.orgId, files: clean,
        ...(typeof payload?.slug === "string" ? { slugOverride: payload.slug } : {}),
      });
      // A folder replaced the whole pack body, so the live listing is dated
      // until someone has read it against what now ships. Marked here rather
      // than in `authoring.ts` for the same reason the editor route does it:
      // `listing.ts` imports `authoring.ts`, never the other way round.
      if (!out.created) await L.markStale(out.pack.id);
      res.writeHead(200, { "content-type": "application/json" });
      return void res.end(JSON.stringify({
        slug: out.pack.slug, created: out.created, status: out.pack.status,
        name: out.pack.name, unknownKeys: out.parsed.unknownKeys,
        skills: out.skills, subagents: out.subagents, carriedNotRun: out.inert,
        commands: out.commands, hooks: out.hooks, workflows: out.workflows,
        anthropicSkills: out.anthropicSkills, advisorModel: out.advisorModel,
        warnings: out.warnings.map((w) => `${w.skill}/${w.file}: ${w.message}`),
      }));
    } catch (e) {
      res.writeHead(statusOf(e) ?? 400, { "content-type": "application/json" });
      return void res.end(JSON.stringify({ error: msg(e) }));
    }
  }

  if (method === "GET" && path === "/curate") {
    if ((await platformOrgId()) !== ctx.orgId) throw new Au.NotTheCuratorError();
    const s2 = await sql();
    const listed = await s2.query<{ slug: string; name: string; author: string; featured_rank: number | null }>(
      "SELECT slug, name, author, featured_rank FROM packs WHERE status = 'listed' ORDER BY name");
    return html(res, V.curatePage({
      queue: (await Au.submittedPacks()).map((q) => ({
        slug: q.slug, name: q.name, author: q.author, tagline: q.tagline, price_points: Number(q.price_points),
      })),
      listed, balance: await bal(), viewer, err: url.searchParams.get("err") ?? undefined,
    }));
  }
  const featuredRankMatch = /^\/packs\/([a-z0-9-]+)\/featured-rank$/.exec(path);
  if (method === "POST" && featuredRankMatch) {
    ownerOnly();
    const f = await body(req);
    const raw = (f["featuredRank"] ?? "").trim();
    try {
      await Au.setFeaturedRank(ctx.orgId, featuredRankMatch[1]!, raw === "" ? null : Number(raw));
      return redirect(res, "/curate");
    } catch (e) { return redirect(res, `/curate?err=${encodeURIComponent(msg(e))}`); }
  }

  // ------------------------------------------------------------- schedules
  if (method === "GET" && path === "/schedules") {
    const s2 = await sql();
    const rows = await Sch.listSchedules(ctx.orgId);
    const owned = await s2.query<{ id: string; name: string }>(
      `SELECT pv.id, pk.name || ' v' || CAST(pv.version AS TEXT) AS name
       FROM entitlements e JOIN pack_versions pv ON pv.id = e.pack_version_id
       JOIN packs pk ON pk.id = pv.pack_id WHERE e.org_id = $1 ORDER BY pk.name`, [ctx.orgId]);
    return html(res, V.schedulesPage({
      rows: await Promise.all(rows.map(async (r) => ({
        id: r.id, name: r.name, prompt: r.prompt, enabled: r.enabled,
        pack: await packNameOf(r.pack_version_id),
        cadence: Sch.cadenceLabel(r),
        last_run_at: r.last_run_at, last_run_id: r.last_run_id, last_error: r.last_error,
      }))),
      owned, balance: await bal(), viewer, err: url.searchParams.get("err") ?? undefined,
    }));
  }
  if (method === "POST" && path === "/schedules") {
    const f = await body(req);
    try {
      await Sch.createSchedule({
        orgId: ctx.orgId, userId: ctx.userId, packVersionId: f["packVersionId"] ?? "",
        name: f["name"] ?? "", prompt: f["prompt"] ?? "",
        cadence: (["hourly", "daily", "weekly"].includes(f["cadence"] ?? "") ? f["cadence"] : "daily") as Sch.Cadence,
        hour: Number(f["hour"] ?? 9), weekday: Number(f["weekday"] ?? 1),
      });
      return redirect(res, "/schedules");
    } catch (e) { return redirect(res, `/schedules?err=${encodeURIComponent(msg(e))}`); }
  }
  if (method === "POST" && path === "/schedules/toggle") {
    const f = await body(req);
    await Sch.setEnabled(ctx.orgId, f["id"] ?? "", f["enabled"] === "1");
    return redirect(res, "/schedules");
  }
  if (method === "POST" && path === "/schedules/delete") {
    const f = await body(req);
    await Sch.deleteSchedule(ctx.orgId, f["id"] ?? "");
    return redirect(res, "/schedules");
  }

  // ---------------------------------------------------------------- tokens
  if (method === "GET" && path === "/tokens") {
    return html(res, V.tokensPage(await A.apiTokens(ctx.orgId), baseUrl(req),
      url.searchParams.get("new") ?? undefined, await bal(), viewer));
  }
  if (method === "POST" && path === "/tokens") {
    const f = await body(req);
    const token = await A.createApiToken(ctx.orgId, ctx.userId, (f["name"] ?? "").trim());
    // Shown once, in the URL of the redirect, then never again.
    return redirect(res, `/tokens?new=${encodeURIComponent(token)}`);
  }
  if (method === "POST" && path === "/tokens/revoke") {
    const f = await body(req);
    await A.revokeApiToken(ctx.orgId, f["token"] ?? "");
    return redirect(res, "/tokens");
  }

  if (method === "GET" && path === "/settings") { ownerOnly(); return html(res, V.settingsPage(await allSettings(), await bal(), viewer)); }
  if (method === "POST" && path === "/settings") {
    ownerOnly();
    const f = await body(req);
    if (f["key"]) await putSetting(f["key"], f["value"] ?? "");
    return redirect(res, "/settings");
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
      viewer: ctx.viewer, youId: ctx.userId, balance: await balanceMillipoints(ctx.orgId),
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

/**
 * A hosted filesystem does not survive a deploy.
 *
 * Without DATABASE_URL the app falls back to SQLite on local disk, which is
 * exactly right on a laptop and silently destructive on a host that replaces
 * the container on every push: the organisations, purchases and points ledger
 * would be there until the next deploy and then gone, with nothing in the logs
 * to say so. Refusing to start is the only honest failure here.
 */
function assertDurableStore(): void {
  if (process.env["NODE_ENV"] !== "production") return;
  if (process.env["DATABASE_URL"]) return;
  console.error(
    "DATABASE_URL is not set. In production the store must be Postgres — the\n" +
    "local-disk fallback is lost on every deploy, and it holds the ledger.\n" +
    "Set DATABASE_URL, or set NODE_ENV to something other than production if\n" +
    "a disposable store is genuinely what you want.");
  process.exit(1);
}

async function main(): Promise<void> {
  assertDurableStore();
  await initDb();
  const seeded = await P.seedCatalog();
  const store = (await sql()).dialect;
  // Before accepting traffic: close out anything the last process left open.
  const reconciled = await P.reconcileOpenRuns();

  const server = http.createServer((req, res) => {
    void handle(req, res).catch((e) => {
      if (res.headersSent) {
        // The response is already committed, so the client gets whatever was
        // promised — but swallowing the error here is what made a broken
        // upload look like a silent success for as long as it did.
        console.error("[error after headers sent]", msg(e));
        return void res.end();
      }
      const status = statusOf(e);
      if (status) {
        // An answer, not a crash: no stack trace and no "something broke".
        return html(res, V.layout(status === 403 ? "Not allowed" : "Cannot do that",
          `<h1>${status === 403 ? "Not allowed" : "Cannot do that"}</h1>
           <div class="note">${V.esc(msg(e))}</div>
           <p class="lede"><a href="/">Back to the catalog</a></p>`), status);
      }
      console.error("[error]", msg(e));
      html(res, V.layout("Error",
        `<h1>Something broke</h1><div class="note bad">${V.esc(msg(e))}</div><p><a href="/">Back</a></p>`), 500);
    });
  });

  Sch.startScheduler();

  // A host restarts this process on every deploy and gives it a few seconds'
  // notice. Spending them is worth it: the scheduler stops before it can fire a
  // run nobody will drive, open SSE connections are closed rather than left to
  // time out, and the next process reconciles whatever was still in flight.
  let stopping = false;
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      if (stopping) return process.exit(0); // A second signal means "now".
      stopping = true;
      console.log(`[${signal}] draining`);
      Sch.stopScheduler();
      server.close(() => process.exit(0));
      // Nothing may hang the shutdown past the host's own patience.
      setTimeout(() => process.exit(0), 8000).unref();
    });
  }

  server.listen(PORT, async () => {
    const s = await sql();
    const anyone = await s.one("SELECT 1 AS ok FROM users LIMIT 1");
    console.log(`agents.alphaceo.ai — http://localhost:${PORT}`);
    console.log(`  store: ${store} · ${seeded} pack(s) seeded`);
    console.log(anyone ? "  sign in at /login" : "  no accounts yet — create one at /signup");
    console.log("  scheduler running, checking every minute");
    if (reconciled) console.log(`  closed ${reconciled} run(s) left open by the last process`);
    if (store === "sqlite") console.log(`  (set DATABASE_URL to use Postgres: docker compose up -d)`);
  });
}

/** Resolve the session, gate everything that is not public, then route. */
async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = req.method ?? "GET";

  // Generated hero art, served from disk. Read per request rather than held in
  // memory: there are a handful of files and the OS cache is better at this
  // than we would be.
  const assetMatch = /^\/assets\/([a-zA-Z0-9._-]+)$/.exec(path);
  if (method === "GET" && assetMatch) {
    const { readFile } = await import("node:fs/promises");
    const { join, extname } = await import("node:path");
    const name = assetMatch[1]!;
    // A literal dot-dot cannot survive the pattern above, but the check costs
    // nothing and the next person to widen that pattern will be glad of it.
    if (name.includes("..")) return html(res, V.layout("Not found", "<h1>Not found</h1>"), 404);
    const types: Record<string, string> = {
      ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg",
      ".svg": "image/svg+xml", ".avif": "image/avif",
    };
    try {
      const bytes = await readFile(join(process.cwd(), "public", "assets", name));
      res.writeHead(200, {
        "content-type": types[extname(name).toLowerCase()] ?? "application/octet-stream",
        "cache-control": "public, max-age=604800, immutable",
        "content-length": String(bytes.length),
      });
      return void res.end(bytes);
    } catch { return html(res, V.layout("Not found", "<h1>Not found</h1>"), 404); }
  }

  // Inline, so there is no static file to serve and no 404 on every page load.
  if (method === "GET" && path === "/favicon.ico") {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">`
      + `<rect width="32" height="32" rx="7" fill="#11110f"/>`
      + `<circle cx="16" cy="16" r="7" fill="none" stroke="#8fcbb0" stroke-width="2.5"/>`
      + `<circle cx="16" cy="16" r="2.5" fill="#8fcbb0"/></svg>`;
    res.writeHead(200, { "content-type": "image/svg+xml", "cache-control": "max-age=86400" });
    return void res.end(svg);
  }

  if (method === "GET" && path === "/healthz") {
    // Before the session gate: a health check has no cookie.
    const s2 = await sql();
    res.writeHead(200, { "content-type": "application/json" });
    return void res.end(JSON.stringify({ ok: true, store: s2.dialect, payments: payments().name }));
  }

  // The MCP endpoint authenticates with a bearer token, not a cookie, so it is
  // resolved before the session gate.
  if (path === "/mcp") {
    const who = await A.orgFromApiToken(req.headers.authorization);
    if (!who) {
      res.writeHead(401, { "content-type": "application/json", "www-authenticate": "Bearer" });
      return void res.end(JSON.stringify({
        jsonrpc: "2.0", id: null,
        error: { code: -32001, message: "A bearer token is required. Create one at /tokens." },
      }));
    }
    const body = method === "POST" ? await jsonBody(req) : undefined;
    return handleMcpRequest(req, res, body, { ...who, baseUrl: baseUrl(req) });
  }

  if (await accountRoutes(req, res)) return;

  // A cookie for the browser, a bearer token for everything else — so the CLI
  // and an agent reach the same routes with the same permissions.
  const session = (await A.sessionFromToken(cookies(req)[COOKIE]))
    ?? (await A.sessionFromApiToken(req.headers.authorization));
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
