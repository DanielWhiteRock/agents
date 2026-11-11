/** The catalog, as MCP tools: search and look at one pack. */
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as P from "../app/platform.js";
import { text, price } from "./reply.js";
import type { McpContext } from "./server.js";

export function packLine(p: {
  slug: string; name: string; tagline: string; author: string; price_points: number; model: string;
}, owned: boolean): string {
  return `${p.name} (${p.slug})\n  ${p.tagline}\n  by ${p.author} · ${price(p.price_points)}`
    + ` · runs on ${p.model}${owned ? " · OWNED" : ""}`;
}

export function registerShelf(server: McpServer, ctx: McpContext): void {
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
      `Price: ${p.price_points === 0 ? "free" : `${price(p.price_points)} one-off`}`,
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
}
