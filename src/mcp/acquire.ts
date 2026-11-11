/** Owning and getting packs out, as MCP tools. */
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as P from "../app/platform.js";
import { sql } from "../app/sql.js";
import { text, price } from "./reply.js";
import type { McpContext } from "./server.js";

export function registerAcquire(server: McpServer, ctx: McpContext): void {
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
      `${p.name} is not owned by this organisation. ${p.price_points === 0 ? "It is free" : `It costs ${price(p.price_points)}`}`
      + ` — finish at ${ctx.baseUrl}/packs/${p.slug}. Payment needs a browser, so it cannot be done from here.`);
  });

  server.registerTool("export_pack", {
    title: "Download a pack you own",
    description:
      "Returns a pack this organisation owns as an agent definition file — markdown with YAML front matter, the "
      + "format `ant apply` consumes — so it can be run on your own infrastructure instead of here. Only works for "
      + "packs you have bought, because the file contains the author's instructions.",
    inputSchema: { slug: z.string().describe("The pack's slug.") },
  }, async ({ slug }) => {
    try {
      const md = await P.exportPack(ctx.orgId, slug);
      return text(`Save this as ${slug}.md and apply it with \`ant apply ${slug}.md\`:\n\n${md}`);
    } catch (e) {
      const m = String((e as Error)?.message ?? e);
      return text(m.includes("does not own")
        ? `This organisation does not own ${slug}, so it cannot be exported. Buy it at ${ctx.baseUrl}/packs/${slug}`
        : m);
    }
  });
}
