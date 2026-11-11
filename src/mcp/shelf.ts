/** The catalog, as MCP tools: search and look at one pack. */
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as P from "../app/platform.js";
import { sql } from "../app/sql.js";
import { stringsFromJson } from "../packs/listing-shape.js";
import { text, price, REASON } from "./reply.js";
import { score } from "./relevance.js";
import type { McpContext } from "./server.js";

export function packLine(p: {
  slug: string; name: string; tagline: string; author: string; price_points: number; model: string;
  runs: number; rating: number | null;
}, owned: boolean): string {
  return `${p.name} (${p.slug})\n  ${p.tagline}\n  by ${p.author} · ${price(p.price_points)}`
    + ` · runs on ${p.model} · ${p.runs} run${p.runs === 1 ? "" : "s"}`
    + (p.rating != null ? ` · ${p.rating.toFixed(1)}/5` : "")
    + (owned ? " · OWNED" : "");
}

export type SearchArgs = {
  query?: string;
  sort?: "relevance" | "trending" | "newest" | "most_used" | "best_rated";
  category?: string;
  tool?: string;
  limit?: number;
};

export type ScoredPack = P.PackRow & P.RankingInputs & { score: number; owned: boolean; tools: string[] };

/**
 * The pack ids that declare a given tool name or MCP server name — a plain
 * `WHERE` over `pack_tools` and `pack_mcp_servers`, nothing grouped or
 * indexed. A later task builds a grouped tool index for a different tool;
 * this one just answers "which packs declare exactly this", once per call.
 */
async function packIdsForTool(tool: string): Promise<Set<string>> {
  const s = await sql();
  const t = tool.trim().toLowerCase();
  const rows = await s.query<{ pack_id: string }>(
    `SELECT pack_id FROM pack_tools WHERE LOWER(name) = $1
     UNION
     SELECT pack_id FROM pack_mcp_servers WHERE LOWER(name) = $1`,
    [t]);
  return new Set(rows.map((r) => r.pack_id));
}

/**
 * Every declared tool and MCP server name, by pack — one bulk read of each
 * (small) table rather than two per candidate pack, so scoring the "tools"
 * field never turns into a round trip per row.
 */
async function toolNamesByPack(): Promise<Map<string, string[]>> {
  const s = await sql();
  const [tools, servers] = await Promise.all([
    s.query<{ pack_id: string; name: string }>("SELECT pack_id, name FROM pack_tools"),
    s.query<{ pack_id: string; name: string }>("SELECT pack_id, name FROM pack_mcp_servers"),
  ]);
  const map = new Map<string, string[]>();
  for (const r of [...tools, ...servers]) {
    const names = map.get(r.pack_id);
    if (names) names.push(r.name); else map.set(r.pack_id, [r.name]);
  }
  return map;
}

/** A pack's tags, as the lowercase tokens `category` is matched against. */
const tagTokens = (tags: string): string[] => tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);

function orderBy(rows: ScoredPack[], sort: NonNullable<SearchArgs["sort"]>): ScoredPack[] {
  switch (sort) {
    case "trending":
      // `catalogFor` already ran `rankPacks`; filtering above preserved that order.
      return rows;
    case "newest":
      return [...rows].sort((a, b) =>
        a.created_at !== b.created_at ? (a.created_at < b.created_at ? 1 : -1) : (a.id < b.id ? -1 : 1));
    case "most_used":
      return [...rows].sort((a, b) => (b.runs !== a.runs ? b.runs - a.runs : (a.id < b.id ? -1 : 1)));
    case "best_rated":
      return [...rows].sort((a, b) => {
        const ra = a.rating ?? -1, rb = b.rating ?? -1;
        if (ra !== rb) return rb - ra;
        if (a.votes !== b.votes) return b.votes - a.votes;
        return a.id < b.id ? -1 : 1;
      });
    case "relevance":
    default:
      // A stable sort on score alone: ties keep `catalogFor`'s own order
      // rather than depending on whatever order the database returned rows in.
      return [...rows].sort((a, b) => b.score - a.score);
  }
}

/**
 * The shelf, scored and filtered — everything `search_packs` needs, as data.
 *
 * `catalogFor` already does the one-query join for `RankingInputs` and
 * `owned`, ranked the way the shelf page itself ranks; this only adds the
 * category/tool filters and the relevance score on top, never a second query
 * per pack.
 */
export async function searchRows(ctx: McpContext, args: SearchArgs): Promise<{ rows: ScoredPack[]; matched: number }> {
  const query = (args.query ?? "").trim();
  const sort = args.sort ?? (query ? "relevance" : "trending");
  const limit = Math.min(Math.max(args.limit ?? 20, 1), 50);

  const catalog = await P.catalogFor(ctx.orgId);
  const toolsByPack = await toolNamesByPack();

  let candidates = catalog;
  if (args.category) {
    const want = args.category.trim().toLowerCase();
    candidates = candidates.filter((p) => tagTokens(p.tags).includes(want));
  }
  if (args.tool) {
    const ids = await packIdsForTool(args.tool);
    candidates = candidates.filter((p) => ids.has(p.id));
  }

  const scoredAll: ScoredPack[] = candidates.map((p) => {
    const tools = toolsByPack.get(p.id) ?? [];
    return {
      ...p,
      tools,
      score: score(query, {
        name: p.name, tagline: p.tagline, author: p.author, description: p.description,
        useCases: stringsFromJson(p.use_cases), tags: p.tags, tools,
      }),
    };
  });
  // A query is a filter as much as a sort: a pack that matched nothing must
  // not fill a page just because the catalog ran short. No query, as before,
  // means every listed pack (after category/tool) is a "match".
  const scored = query ? scoredAll.filter((p) => p.score > 0) : scoredAll;

  const ordered = orderBy(scored, sort);
  return { rows: ordered.slice(0, limit), matched: ordered.length };
}

export function registerShelf(server: McpServer, ctx: McpContext): void {
  server.registerTool("search_packs", {
    title: "Search the pack catalog",
    description:
      "Search hireable agent packs. Each pack is one expert's method, packaged as a worker: skills, tools and "
      + "MCP servers chosen by the author. Returns name, slug, tagline, author, price, run count, rating (where "
      + "shown) and whether this organisation already owns it. Call this before pack_details when you do not "
      + "know the slug.",
    inputSchema: {
      query: z.string().optional().describe(
        "Free text matched against name, tagline, author, description, use cases, tags and declared tools. "
        + "Omit to browse by sort order instead."),
      sort: z.enum(["relevance", "trending", "newest", "most_used", "best_rated"]).optional().describe(
        "Defaults to relevance when a query is given, trending otherwise."),
      category: z.string().optional().describe("Restrict to packs tagged with this category."),
      tool: z.string().optional().describe("Restrict to packs that declare this tool or MCP server by name."),
      limit: z.number().int().min(1).max(50).optional().describe("Maximum packs to return. Defaults to 20."),
      reason: REASON,
    },
  }, async ({ query, sort, category, tool, limit, reason }) => {
    const { rows, matched } = await searchRows(ctx, { query, sort, category, tool, limit });
    if (rows.length === 0) {
      const clauses = [
        query ? `"${query}"` : null,
        category ? `category "${category}"` : null,
        tool ? `tool "${tool}"` : null,
      ].filter((c): c is string => c !== null);
      return text(clauses.length ? `Nothing in the catalog matches ${clauses.join(" and ")}.` : "The catalog is empty.", reason);
    }
    const lines = rows.map((p) => packLine(p, p.owned));
    return text(`${rows.length} of ${matched} match:\n\n${lines.join("\n\n")}`, reason);
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
