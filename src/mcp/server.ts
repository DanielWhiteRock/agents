/**
 * The marketplace, as an MCP server.
 *
 * This is the in-DAW browser: instead of coming to the website, a buyer adds
 * one endpoint to whatever agent they already run and shops from inside it.
 * Release-one scope is read-and-library — nothing here charges money, because a
 * card flow needs a browser, so buying returns the URL to finish it.
 */
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import * as P from "../app/platform.js";
import { sql } from "../app/sql.js";
import { fmt } from "../billing/points.js";

export type McpContext = { orgId: string; userId: string; baseUrl: string };

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });

function packLine(p: {
  slug: string; name: string; tagline: string; author: string; price_cents: number; model: string;
}, owned: boolean): string {
  return `${p.name} (${p.slug})\n  ${p.tagline}\n  by ${p.author} · ${p.price_cents === 0 ? "free" : fmt(p.price_cents)}`
    + ` · runs on ${p.model}${owned ? " · OWNED" : ""}`;
}

export function buildServer(ctx: McpContext): McpServer {
  const server = new McpServer(
    { name: "agents.alphaceo.ai", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  server.registerTool("search_packs", {
    title: "Search the pack catalog",
    description:
      "Search hireable agent packs. Each pack is one expert's method, packaged as a worker: skills, tools and "
      + "MCP servers chosen by the author. Returns name, slug, tagline, author, price, and whether this "
      + "organisation already owns it. Call this before pack_details when you do not know the slug.",
    inputSchema: {
      query: z.string().optional().describe("Free text matched against name, tagline and author. Omit to list everything."),
      limit: z.number().int().min(1).max(50).optional().describe("Maximum packs to return. Defaults to 20."),
    },
  }, async ({ query, limit }) => {
    const all = await P.listPacks();
    const q = (query ?? "").trim().toLowerCase();
    const matched = q
      ? all.filter((p) => `${p.name} ${p.tagline} ${p.author} ${p.slug}`.toLowerCase().includes(q))
      : all;
    const rows = matched.slice(0, limit ?? 20);
    if (rows.length === 0) return text(q ? `Nothing in the catalog matches "${query}".` : "The catalog is empty.");
    const lines = await Promise.all(rows.map(async (p) => {
      const v = await P.latestVersion(p.id);
      return packLine(p, Boolean(v && (await P.entitled(ctx.orgId, v.id))));
    }));
    return text(`${rows.length} of ${matched.length} match:\n\n${lines.join("\n\n")}`);
  });

  server.registerTool("pack_details", {
    title: "Look at one pack",
    description:
      "Everything known about one pack: what it does, who wrote it, what it costs, which models its author "
      + "permits, and whether this organisation owns it. Never returns the pack's instructions — those are the "
      + "author's property and are not available through any tool.",
    inputSchema: { slug: z.string().describe("The pack's slug, from search_packs.") },
  }, async ({ slug }) => {
    const p = await P.getPack(slug);
    if (!p) return text(`There is no pack called "${slug}". Try search_packs.`);
    const v = await P.latestVersion(p.id);
    const owned = Boolean(v && (await P.entitled(ctx.orgId, v.id)));
    const pinned: string[] = JSON.parse(p.pinned_models);
    return text([
      `${p.name} (${p.slug})`,
      p.tagline,
      "",
      `Author: ${p.author}`,
      `Price: ${p.price_cents === 0 ? "free" : `${fmt(p.price_cents)} one-off`}`,
      `Updates: ${p.upgrade_points} points`,
      `Default model: ${p.model}${p.effort ? ` at ${p.effort} effort` : ""}`,
      pinned.length ? `Author restricted it to: ${pinned.join(", ")}` : "Runs on any permitted model",
      v ? `Published version: ${v.version}` : "Not yet published — it cannot be run",
      `Owned by you: ${owned ? "yes" : "no"}`,
      "",
      owned
        ? `Start a run at ${ctx.baseUrl}/packs/${p.slug}`
        : `To buy it, open ${ctx.baseUrl}/packs/${p.slug} — payment needs a browser, so it cannot be completed here.`,
    ].join("\n"));
  });

  server.registerTool("my_library", {
    title: "What this organisation owns",
    description:
      "The packs this organisation has bought, with the version each entitlement is pinned to. A pack bought at "
      + "version 2 keeps running version 2 until it is deliberately upgraded.",
    inputSchema: {},
  }, async () => {
    const s = await sql();
    const rows = await s.query<{ name: string; slug: string; version: number; acquired_at: string }>(
      `SELECT pk.name, pk.slug, pv.version, e.acquired_at
       FROM entitlements e
       JOIN pack_versions pv ON pv.id = e.pack_version_id
       JOIN packs pk ON pk.id = pv.pack_id
       WHERE e.org_id = $1 ORDER BY e.acquired_at DESC`, [ctx.orgId]);
    if (rows.length === 0) return text("This organisation does not own any packs yet. Use search_packs to look.");
    return text(rows.map((r) => `${r.name} (${r.slug}) · version ${r.version} · since ${r.acquired_at.slice(0, 10)}`).join("\n"));
  });

  server.registerTool("install_pack", {
    title: "Add a pack to the library",
    description:
      "Point this organisation's library at a pack's newest published version. It does not buy anything: if the "
      + "pack is not already owned, this returns the URL to complete the purchase in a browser.",
    inputSchema: { slug: z.string().describe("The pack's slug.") },
  }, async ({ slug }) => {
    const p = await P.getPack(slug);
    if (!p) return text(`There is no pack called "${slug}".`);
    const v = await P.latestVersion(p.id);
    if (!v) return text(`${p.name} has not been published yet, so there is nothing to install.`);
    if (await P.entitled(ctx.orgId, v.id)) {
      return text(`${p.name} version ${v.version} is already in your library. Run it at ${ctx.baseUrl}/packs/${p.slug}`);
    }
    return text(
      `${p.name} is not owned by this organisation. ${p.price_cents === 0 ? "It is free" : `It costs ${fmt(p.price_cents)}`}`
      + ` — finish at ${ctx.baseUrl}/packs/${p.slug}. Payment needs a browser, so it cannot be done from here.`);
  });

  server.registerTool("list_runs", {
    title: "Recent runs and what they cost",
    description:
      "This organisation's recent runs with tokens, active time and cost. Cost is the platform's own figure at "
      + "public list rates, not an estimate.",
    inputSchema: { limit: z.number().int().min(1).max(50).optional().describe("How many runs. Defaults to 10.") },
  }, async ({ limit }) => {
    const runs = await P.listRuns(ctx.orgId, limit ?? 10);
    if (runs.length === 0) return text("No runs yet.");
    const lines = await Promise.all(runs.map(async (r) => {
      const v = await P.getVersion(r.pack_version_id);
      const pack = v ? await P.packById(v.pack_id) : undefined;
      return `${r.started_at.slice(0, 16).replace("T", " ")} · ${pack?.name ?? "?"} · ${r.model}`
        + ` · ${r.output_tokens} out · ${r.active_seconds.toFixed(1)}s · ${fmt(r.list_cost_cents)}`
        + ` · ${r.stop_reason ?? r.status} · ${r.id}`;
    }));
    return text(lines.join("\n"));
  });

  server.registerTool("run_trace", {
    title: "Read a run's transcript",
    description:
      "The full transcript of one run: messages, tool calls, approvals, token counts and cost per step. Redacted "
      + "against the pack's own instructions, so it never reveals the author's method.",
    inputSchema: {
      run_id: z.string().describe("A run id from list_runs."),
      limit: z.number().int().min(1).max(500).optional().describe("Most recent N events. Defaults to 100."),
    },
  }, async ({ run_id, limit }) => {
    const run = await P.getRun(run_id);
    // Another organisation's run is simply not found: confirming it exists leaks.
    if (!run || run.org_id !== ctx.orgId) return text(`There is no run called "${run_id}" in this organisation.`);
    const all = await P.transcriptFor(run_id, ctx.orgId);
    const rows = all.slice(-(limit ?? 100));
    const lines = rows.map((e) => `${e.created_at.slice(11, 19)} ${e.kind} ${e.payload.slice(0, 400)}`);
    return text([
      `Run ${run.id} · ${run.model} · ${run.output_tokens} output tokens`
      + ` · ${run.active_seconds.toFixed(1)}s · cost ${fmt(run.list_cost_cents)} of ${fmt(run.budget_cents)}`,
      "",
      ...lines,
    ].join("\n"));
  });

  return server;
}

/**
 * One MCP request. Stateless: a fresh server and transport per request, which
 * is the documented pattern for an HTTP deployment and keeps no per-connection
 * state to leak between organisations.
 */
export async function handleMcpRequest(
  req: IncomingMessage, res: ServerResponse, body: unknown, ctx: McpContext,
): Promise<void> {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => { void transport.close(); });
  const server = buildServer(ctx);
  await server.connect(transport);
  await transport.handleRequest(req as IncomingMessage & { body?: unknown }, res, body);
}
