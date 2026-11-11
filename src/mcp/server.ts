/**
 * The marketplace, as an MCP server.
 *
 * This is the in-DAW browser: instead of coming to the website, a buyer adds
 * one endpoint to whatever agent they already run, and shops, reads and runs
 * packs from inside it. Browsing, inspecting a pack, loading its instructions
 * into this session, and buying one with points already on the balance all
 * happen right here — `buy_pack` spends from that balance directly, no card
 * involved. The one thing that still needs a browser is putting money onto
 * the balance in the first place (`top_up`), because a card flow needs one.
 */
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import * as P from "../app/platform.js";
import { pts } from "../billing/points.js";
import { text, REASON } from "./reply.js";
import { registerShelf } from "./shelf.js";
import { registerAcquire } from "./acquire.js";

export type McpContext = { orgId: string; userId: string; baseUrl: string };

export function buildServer(ctx: McpContext): McpServer {
  const server = new McpServer(
    { name: "agents.alphaceo.ai", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  registerShelf(server, ctx);
  registerAcquire(server, ctx);

  server.registerTool("list_runs", {
    title: "Recent runs and what they cost",
    description:
      "This organisation's recent runs with tokens, active time and cost. Cost is the platform's own figure at "
      + "public list rates, not an estimate.",
    inputSchema: {
      limit: z.number().int().min(1).max(50).optional().describe("How many runs. Defaults to 10."),
      reason: REASON,
    },
  }, async ({ limit, reason }) => {
    const runs = await P.listRuns(ctx.orgId, limit ?? 10);
    if (runs.length === 0) return text("No runs yet.", reason);
    const lines = await Promise.all(runs.map(async (r) => {
      const v = await P.getVersion(r.pack_version_id);
      const pack = v ? await P.packById(v.pack_id) : undefined;
      return `${r.started_at.slice(0, 16).replace("T", " ")} · ${pack?.name ?? "?"} · ${r.model}`
        + ` · ${r.output_tokens} out · ${r.active_seconds.toFixed(1)}s · ${pts(r.list_cost_cents)}`
        + ` · ${r.stop_reason ?? r.status} · ${r.id}`;
    }));
    return text(lines.join("\n"), reason);
  });

  server.registerTool("run_trace", {
    title: "Read a run's transcript",
    description:
      "The full transcript of one run: messages, tool calls, approvals, token counts and cost per step. Redacted "
      + "against the pack's own instructions, so it never reveals the author's method.",
    inputSchema: {
      run_id: z.string().describe("A run id from list_runs."),
      limit: z.number().int().min(1).max(500).optional().describe("Most recent N events. Defaults to 100."),
      reason: REASON,
    },
  }, async ({ run_id, limit, reason }) => {
    const run = await P.getRun(run_id);
    // Another organisation's run is simply not found: confirming it exists leaks.
    if (!run || run.org_id !== ctx.orgId) {
      return text(`There is no run called "${run_id}" in this organisation.`, reason);
    }
    const all = await P.transcriptFor(run_id, ctx.orgId);
    const rows = all.slice(-(limit ?? 100));
    const lines = rows.map((e) => `${e.created_at.slice(11, 19)} ${e.kind} ${e.payload.slice(0, 400)}`);
    return text([
      `Run ${run.id} · ${run.model} · ${run.output_tokens} output tokens`
      + ` · ${run.active_seconds.toFixed(1)}s · cost ${pts(run.list_cost_cents)} of ${pts(run.budget_cents)}`,
      "",
      ...lines,
    ].join("\n"), reason);
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
