/** The catalog, as MCP tools: search and look at one pack. */
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as P from "../app/platform.js";
import { sql } from "../app/sql.js";
import { stringsFromJson } from "../packs/listing-shape.js";
import { permissionSummary } from "../packs/permissions.js";
import { creatorByHandle, creatorHandleOf, creatorStats } from "../app/creators.js";
import { creatorRating, ratingOf } from "../app/social.js";
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

/**
 * The permissions rail for one pack, in the agent's own words — the same
 * `permissionSummary` the website's pack page renders, fed the same inputs:
 * tool and MCP server *names* (never the author's declared policy, which
 * never reaches the runtime — see `permissions.ts`), the web config out of
 * `extras`, and the policy the run is actually configured with.
 *
 * Takes the whole `PackRow` rather than an id because `packExtras` needs
 * `extras`, which `pack_tools`/`pack_mcp_servers` do not carry.
 */
export async function touches(pack: P.PackRow): Promise<string[]> {
  const [tools, mcpServers, v] = await Promise.all([
    P.packTools(pack.id),
    P.packMcpServers(pack.id),
    P.latestVersion(pack.id),
  ]);
  const policy = await P.effectivePolicy(v?.id ?? null);
  return permissionSummary({
    tools: tools.map((t) => t.name),
    mcpServers,
    web: P.packExtras(pack).web ?? {},
    policy,
  }).lines;
}

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
        useCases: stringsFromJson(p.use_cases), tags: p.tags, tools, slug: p.slug,
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

/** A trailing window, in days, for the two bounded `get_popular` timeframes. */
const POPULAR_WINDOW_DAYS: Record<"week" | "month", number> = { week: 7, month: 30 };

/**
 * Completed, non-trial runs within a trailing window, grouped by pack — one
 * query, not one per candidate pack. `catalogFor`'s own `runs` column is
 * all-time and unconditional; this is the same count narrowed to
 * `started_at >= cutoff`, which is the one piece `catalogFor` cannot give
 * `get_popular` without a second query of its own.
 */
async function windowedRuns(days: number): Promise<Map<string, number>> {
  const s = await sql();
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const rows = await s.query<{ pack_id: string; runs: string | number }>(
    `SELECT v.pack_id, COUNT(*) AS runs FROM runs r JOIN pack_versions v ON v.id = r.pack_version_id
     WHERE r.is_trial = 0 AND r.started_at >= $1 GROUP BY v.pack_id`,
    [cutoff]);
  return new Map(rows.map((r) => [r.pack_id, Number(r.runs)]));
}

/**
 * `get_popular`'s own ordering: the shelf's order (`rankPacks`), restricted
 * to packs that actually ran in the window asked about.
 *
 * "Popular" has no honest meaning for a pack nobody has run — and without
 * this filter, a pack with zero runs this week would still surface via
 * `rankPacks`' own newest-first tie-break, which is exactly right for
 * browsing the whole shelf (`search_packs`'s `trending` sort) but wrong here:
 * a brand-new, never-run pack is not "popular this week" just because it is
 * new.
 */
async function popularPacks(ctx: McpContext, timeframe: "week" | "month" | "all_time"): Promise<P.CatalogPack[]> {
  const catalog = await P.catalogFor(ctx.orgId);
  if (timeframe === "all_time") return P.rankPacks(catalog.filter((p) => p.runs > 0));
  const windowed = await windowedRuns(POPULAR_WINDOW_DAYS[timeframe]);
  const withWindow = catalog
    .map((p) => ({ ...p, runs: windowed.get(p.id) ?? 0 }))
    .filter((p) => p.runs > 0);
  return P.rankPacks(withWindow);
}

/**
 * Every tool and MCP server name declared by a `listed` pack, grouped by
 * `(kind, name)` — a different query for a different job than
 * `packIdsForTool` (a filter) or `toolNamesByPack` (a per-pack lookup); see
 * Ruling R2. `query`, when given, narrows both tables by a case-insensitive
 * substring before grouping, so a miss never grouped a row only to discard
 * it.
 */
async function toolIndex(query?: string): Promise<Array<{
  tool: string; kind: "tool" | "mcp"; packs: Array<{ slug: string; name: string }>;
}>> {
  const s = await sql();
  const needle = query?.trim().toLowerCase();
  const likeClause = needle ? " AND LOWER(x.name) LIKE $1" : "";
  const params = needle ? [`%${needle}%`] : [];

  const [toolRows, mcpRows] = await Promise.all([
    s.query<{ name: string; slug: string; pack_name: string }>(
      `SELECT x.name, p.slug, p.name AS pack_name FROM pack_tools x JOIN packs p ON p.id = x.pack_id
       WHERE p.status = 'listed'${likeClause}`, params),
    s.query<{ name: string; slug: string; pack_name: string }>(
      `SELECT x.name, p.slug, p.name AS pack_name FROM pack_mcp_servers x JOIN packs p ON p.id = x.pack_id
       WHERE p.status = 'listed'${likeClause}`, params),
  ]);

  const entries = new Map<string, { tool: string; kind: "tool" | "mcp"; packs: Array<{ slug: string; name: string }> }>();
  const add = (rows: typeof toolRows, kind: "tool" | "mcp") => {
    for (const r of rows) {
      const key = `${kind}:${r.name.toLowerCase()}`;
      const entry = entries.get(key) ?? { tool: r.name, kind, packs: [] };
      if (!entry.packs.some((p) => p.slug === r.slug)) entry.packs.push({ slug: r.slug, name: r.pack_name });
      entries.set(key, entry);
    }
  };
  add(toolRows, "tool");
  add(mcpRows, "mcp");

  return [...entries.values()].sort((a, b) => a.tool.localeCompare(b.tool) || a.kind.localeCompare(b.kind));
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
      "Everything known about one pack: the full listing, its permissions rail, who wrote it, what it costs, "
      + "which models its author permits, its creator and rating, and whether this organisation owns it. Does "
      + "not return the pack's instructions directly — call load_pack for those.",
    inputSchema: { slug: z.string().describe("The pack's slug, from search_packs."), reason: REASON },
  }, async ({ slug, reason }) => {
    const p = await P.getPack(slug);
    // A pack in draft or in the review queue never reaches `search_packs`
    // (`catalogFor` filters `status = 'listed'`) and must not become
    // reachable just because its slug leaked out — so this answers exactly
    // as it would for a slug nobody ever used.
    if (!p || p.status !== "listed") return text(`There is no pack called "${slug}". Try search_packs.`, reason);

    const v = await P.latestVersion(p.id);
    // `P.mayExport`, not a bare `P.entitled` probe — the author and the
    // platform curator can read and run their own pack with no
    // `entitlements` row at all (see `assertMayExport`), and `load_pack`/
    // `buy_pack` already decide "does this organisation own it" the same
    // way. A bare `entitled` check here told an author "Owned by you: no"
    // and "To buy it, call buy_pack" for a pack they wrote — the same class
    // of bug `buy_pack` was fixed for one task ago, just reached through a
    // different tool.
    const [owned, creatorHandle, stats, rating, rail] = await Promise.all([
      v ? P.mayExport(ctx.orgId, p, v.id) : Promise.resolve(false),
      creatorHandleOf(p.creator_id),
      P.packStats(p.id),
      ratingOf(p.id),
      touches(p),
    ]);
    const pinned: string[] = JSON.parse(p.pinned_models);

    const description = p.description.trim();
    const useCases = stringsFromJson(p.use_cases);
    const limitations = stringsFromJson(p.limitations);
    const requirements = stringsFromJson(p.requirements);
    const section = (label: string, items: string[]): string[] =>
      items.length ? ["", `${label}:`, ...items.map((i) => `- ${i}`)] : [];

    return text([
      `${p.name} (${p.slug})`,
      p.tagline,
      "",
      `Author: ${p.author}${creatorHandle ? ` (creator: @${creatorHandle})` : ""}`,
      `Price: ${p.price_points === 0 ? "free" : `${price(p.price_points)} one-off`}`,
      ...(p.upgrade_points > 0 ? [`Updates: ${price(p.upgrade_points)}`] : []),
      `Default model: ${p.model}${p.effort ? ` at ${p.effort} effort` : ""}`,
      pinned.length ? `Author restricted it to: ${pinned.join(", ")}` : "Runs on any permitted model",
      v ? `Published version: ${v.version}` : "Not yet published — it cannot be run",
      `Owned by you: ${owned ? "yes" : "no"}`,
      ...(description ? ["", description] : []),
      ...section("Use cases", useCases),
      ...section("Limitations", limitations),
      ...section("Requirements", requirements),
      "",
      "What it touches:",
      ...rail.map((l) => `- ${l}`),
      "",
      `${stats.runs} run${stats.runs === 1 ? "" : "s"} · ${stats.buyers} buyer${stats.buyers === 1 ? "" : "s"}`
      + (rating.average != null ? ` · ${rating.average.toFixed(1)}/5 (${rating.count} ratings)` : ""),
      "",
      owned
        ? `Start a run at ${ctx.baseUrl}/packs/${p.slug}`
        : p.price_points === 0
          // I6: a free pack's shortest correct route is load_pack — it hands
          // the instructions over immediately, for nothing. Naming buy_pack
          // first for something with nothing to buy sent every free-pack
          // caller the long way round.
          ? "This pack is free — call load_pack to get its instructions right now, no purchase needed."
          : `To buy it, call buy_pack — or open ${ctx.baseUrl}/packs/${p.slug} to buy it in a browser instead.`,
      "Instructions are not shown here, but load_pack returns them — free packs get them immediately, "
      + "paid packs once this organisation owns them.",
    ].join("\n"), reason);
  });

  server.registerTool("list_categories", {
    title: "Browse by category",
    description:
      "Every tag at least one listed pack carries, with how many packs carry it. Pass one of these as "
      + "search_packs's `category` to narrow the shelf.",
    inputSchema: { reason: REASON },
  }, async ({ reason }) => {
    const cats = await P.categories();
    if (cats.length === 0) return text("No categories yet.", reason);
    const lines = cats.map((c) => `${c.tag} · ${c.count} pack${c.count === 1 ? "" : "s"}`);
    return text(lines.join("\n"), reason);
  });

  server.registerTool("get_popular", {
    title: "What's popular right now",
    description:
      "Packs that have actually been run, ranked the same way the shelf itself ranks, over a trailing window. "
      + "Empty for a timeframe nothing has run in yet — that is itself information, not an error.",
    inputSchema: {
      timeframe: z.enum(["week", "month", "all_time"]).optional().describe(
        "The window runs are counted over. Defaults to all_time."),
      limit: z.number().int().min(1).max(50).optional().describe("Maximum packs to return. Defaults to 10."),
      reason: REASON,
    },
  }, async ({ timeframe, limit, reason }) => {
    const tf = timeframe ?? "all_time";
    const lim = Math.min(Math.max(limit ?? 10, 1), 50);
    const ranked = await popularPacks(ctx, tf);
    if (ranked.length === 0) {
      return text(`Nothing has run ${tf === "all_time" ? "yet" : `in the last ${tf}`}.`, reason);
    }
    const lines = ranked.slice(0, lim).map((p) => packLine(p, p.owned));
    return text(lines.join("\n\n"), reason);
  });

  server.registerTool("get_author", {
    title: "Look up a creator",
    description:
      "A creator's profile: name, bio, links, how many packs/runs/organisations stand behind them, their "
      + "rating where shown, and their listed packs.",
    inputSchema: {
      handle: z.string().describe("A creator's handle, as shown in pack_details (after the @)."),
      reason: REASON,
    },
  }, async ({ handle, reason }) => {
    const creator = await creatorByHandle(handle.trim());
    // An unknown handle must read as "not found", not as an empty profile —
    // the same shape of answer pack_details gives an unlisted slug.
    if (!creator) return text(`There is no such creator as "${handle}". Try search_packs or pack_details.`, reason);

    const [stats, rating, packs] = await Promise.all([
      creatorStats(creator.id),
      creatorRating(creator.id),
      listedPacksByCreator(creator.id),
    ]);
    let links: Array<{ label: string; url: string }> = [];
    try { links = JSON.parse(creator.links || "[]"); } catch { /* malformed links never block the profile */ }

    return text([
      `${creator.display_name} (@${creator.handle})`,
      ...(creator.bio.trim() ? ["", creator.bio.trim()] : []),
      ...(links.length ? ["", "Links:", ...links.map((l) => `- ${l.label}: ${l.url}`)] : []),
      "",
      // M6: `creatorStats().packs` counts packs of any status; `packs` here
      // is already listed-only (`listedPacksByCreator`), and the list
      // printed just below must agree with the count printed here — so the
      // count is the rendered list's own length, not the stats row's.
      // `runs` and `orgs` still come from `creatorStats`, which the
      // website's creator page shares and which this does not touch.
      `${packs.length} pack${packs.length === 1 ? "" : "s"} · ${stats.runs} run${stats.runs === 1 ? "" : "s"}`
      + ` · ${stats.orgs} org${stats.orgs === 1 ? "" : "s"}`
      + (rating.average != null ? ` · ${rating.average.toFixed(1)}/5 (${rating.count} ratings)` : ""),
      "",
      ...(packs.length ? ["Packs:", ...packs.map((p) => `- ${p.name} (${p.slug})`)] : ["No listed packs yet."]),
    ].join("\n"), reason);
  });

  server.registerTool("find_tools", {
    title: "Find a worker by the tool it uses",
    description:
      "Which packs declare a given tool or MCP server, by name — the routing index for 'I already use Kling, "
      + "which pack can reach it'. Discovery only: this does not run or quote a tool. Call pack_details and "
      + "load_pack once you've found the pack you want.",
    inputSchema: {
      query: z.string().optional().describe(
        "Match tool or MCP server names containing this text, case-insensitively. Omit to list the whole index."),
      reason: REASON,
    },
  }, async ({ query, reason }) => {
    const index = await toolIndex(query);
    if (index.length === 0) {
      return text(
        query ? `Nothing in the catalog declares a tool matching "${query}".` : "No pack declares any tool yet.",
        reason);
    }
    const lines = index.map((e) =>
      `${e.tool} (${e.kind}) · ${e.packs.length} pack${e.packs.length === 1 ? "" : "s"}: `
      + e.packs.map((p) => `${p.name} (${p.slug})`).join(", "));
    return text(lines.join("\n"), reason);
  });
}

/** A creator's `listed` packs — never an unlisted one, however it was claimed. */
async function listedPacksByCreator(creatorId: string): Promise<Array<{ slug: string; name: string }>> {
  const s = await sql();
  return s.query<{ slug: string; name: string }>(
    "SELECT slug, name FROM packs WHERE creator_id = $1 AND status = 'listed' ORDER BY name", [creatorId]);
}
