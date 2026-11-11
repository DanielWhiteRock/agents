/** Owning and getting packs out, as MCP tools. */
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as P from "../app/platform.js";
import * as Pay from "../billing/purchases.js";
import { balanceMillipoints, pts } from "../billing/points.js";
import { sql } from "../app/sql.js";
import { text, price, REASON } from "./reply.js";
import type { McpContext } from "./server.js";

/**
 * "No such pack" — the one sentence a draft, in-review, or truly missing
 * slug must all produce, byte for byte, so the response can never be used to
 * tell an unlisted pack apart from one that was never claimed at all.
 */
const notFound = (slug: string): string => `There is no pack called "${slug}". Try search_packs.`;

/**
 * Hand a pack's instructions into the calling agent's own session.
 *
 * Rules, in order: not `listed` → not found. Free → buy it for zero points
 * (which grants the entitlement) and return it. Paid → authorize it the one
 * way the platform ever authorizes an export (`P.exportPack`, via
 * `assertMayExport`): the author, the platform curator, or an entitled
 * buyer. Anyone else is refused, naming the price and `buy_pack`, with no
 * fragment of the instructions themselves.
 *
 * This deliberately does *not* pre-check `P.entitled` itself for the paid
 * branch — `assertMayExport` is the single source of truth for who may read
 * this content, and it also waves through the author and the platform org,
 * which a bare `entitled` check does not. A pre-check here previously
 * refused an author their own paid pack, telling them to buy it. Letting
 * `exportPack` authorize, and mapping its refusal, keeps that logic in one
 * place.
 *
 * `P.exportPack` always regenerates against the pack's *latest* published
 * version, and authorizes against that same version — so an organisation
 * entitled only to an older version is refused here exactly as a stranger
 * would be, even though it does own a version of this pack. That is a known
 * gap in `exportPack` itself (see the Task 7 report), not something this
 * function papers over.
 */
export async function loadPack(
  ctx: McpContext, slug: string,
): Promise<{ ok: true; markdown: string } | { ok: false; message: string }> {
  const p = await P.getPack(slug);
  // Draft or in-review packs never reach `search_packs` or `pack_details`
  // either (see `shelf.ts`) and must not become loadable just because the
  // slug leaked out.
  if (!p || p.status !== "listed") return { ok: false, message: notFound(slug) };

  const v = await P.latestVersion(p.id);
  if (!v) return { ok: false, message: `${p.name} has not been published yet, so there is nothing to load.` };

  if (p.price_points === 0) {
    // `buyWithPoints` already grants the entitlement for a zero-price
    // purchase — this is how a free pack ends up owned, not a hand-rolled
    // insert.
    await Pay.buyWithPoints({
      orgId: ctx.orgId, userId: ctx.userId, packVersionId: v.id, packId: p.id,
      pricePoints: 0, description: p.name,
    });
  }

  let markdown: string;
  try {
    markdown = await P.exportPack(ctx.orgId, slug);
  } catch (e) {
    const m = String((e as Error)?.message ?? e);
    if (m.includes("does not own")) {
      return {
        ok: false,
        message: `${p.name} costs ${price(p.price_points)} and this organisation does not own it. `
          + "Call buy_pack to buy it — load_pack will hand over its instructions once this organisation owns it.",
      };
    }
    // Anything else (a DB hiccup, a publish racing this call) must not
    // surface as a raw internal error — a neutral refusal, same as
    // `export_pack`'s own catch-all a few lines below.
    return { ok: false, message: `${p.name} could not be loaded right now. Try again shortly.` };
  }

  // Whether a newer version exists is computed, not assumed — `v` is read
  // before `exportPack` authorizes and regenerates, so a publish racing
  // this very call would otherwise make a hardcoded "this is the latest"
  // into a lie at the exact moment an agent is deciding whether to reload.
  const latestNow = await P.latestVersion(p.id);
  const versionLine = latestNow && latestNow.id !== v.id
    ? `Serving version ${v.version} of ${p.name} — version ${latestNow.version} has since been published; `
      + "call load_pack again to get it."
    : `Serving version ${v.version} of ${p.name} — the latest published; no newer version exists.`;

  return { ok: true, markdown: `${versionLine}\n\n${markdown}` };
}

/**
 * Spend this organisation's points on a pack.
 *
 * The server never saw what the agent told its user, so the only thing it
 * can enforce is an echo: `agreed_price_points` must equal the live price
 * exactly, or this refuses and restates the live price rather than charging
 * a stale quote. `confirm: true` is required by the schema itself (a
 * `z.literal(true)`, not a defaulted boolean), so a call cannot buy by
 * merely omitting the field.
 *
 * Gates on `status === "listed"` with the shared `notFound`, exactly like
 * `load_pack`, `install_pack` and `export_pack` (Ruling R17) — an unlisted
 * pack must not be purchasable, and must read as byte-identical to a missing
 * slug.
 *
 * Already owning the pack is a silent no-op, not a refusal: it skips
 * `buyWithPoints` entirely (so there is no second ledger row and no second
 * `purchases` row) and just hands back what `load_pack` would already give
 * this organisation. `buyWithPoints` is the single purchase path — this
 * function never grants the entitlement itself, so there is exactly one
 * place a double-grant bug could creep in, and it isn't here.
 */
export async function buyPack(
  ctx: McpContext, args: { slug: string; agreed_price_points: number; confirm: true },
): Promise<string> {
  const { slug, agreed_price_points } = args;
  const p = await P.getPack(slug);
  if (!p || p.status !== "listed") return notFound(slug);

  const v = await P.latestVersion(p.id);
  if (!v) return `${p.name} has not been published yet, so there is nothing to buy.`;

  const live = Pay.pricePoints(p);
  if (agreed_price_points !== live) {
    return `The price has changed: ${p.name} now costs ${price(live)}, not ${price(agreed_price_points)}. `
      + "Call buy_pack again with the current price if you still want it.";
  }

  if (!(await P.entitled(ctx.orgId, v.id))) {
    try {
      await Pay.buyWithPoints({
        orgId: ctx.orgId, userId: ctx.userId, packVersionId: v.id, packId: p.id,
        pricePoints: live, description: p.name,
      });
    } catch {
      // `buyWithPoints` only ever throws here for one reason once the price
      // has already matched and the pack is unowned: not enough balance. It
      // checks the balance before writing anything, so nothing was debited
      // or granted — safe to report the live balance back unchanged.
      const bal = await balanceMillipoints(ctx.orgId);
      return `${p.name} costs ${price(live)} and this organisation only has ${pts(bal)}. `
        + `Top up at ${ctx.baseUrl}/ledger/topup`;
    }
  }

  const result = await loadPack(ctx, slug);
  return result.ok ? result.markdown : result.message;
}

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
    // A draft or in-review pack must read exactly as a missing slug does —
    // `P.getPack` carries no status filter, so this tool enforces it itself
    // (Ruling R8, carried from Task 3's fix to `pack_details`).
    if (!p || p.status !== "listed") return text(notFound(slug));
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
    // Ruling R15: `P.getPack` carries no status filter, so without this an
    // unlisted pack answered "does not own" while a missing slug answered
    // "no such pack" — two different sentences that hand a stranger the
    // same existence oracle R8 already closed for `pack_details`,
    // `load_pack` and `install_pack`.
    const p = await P.getPack(slug);
    if (!p || p.status !== "listed") return text(notFound(slug));
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

  server.registerTool("load_pack", {
    title: "Load a pack's instructions into this session",
    description:
      "Hands a pack's full instructions straight into this session, so it can be run here instead of ending in "
      + "a URL to finish in a browser. A free pack goes to any signed-in organisation, and buying it for zero "
      + "points happens automatically. A paid pack goes only to an organisation that already owns it — buy it "
      + "first with buy_pack.",
    inputSchema: { slug: z.string().describe("The pack's slug, from search_packs."), reason: REASON },
  }, async ({ slug, reason }) => {
    const result = await loadPack(ctx, slug);
    return text(result.ok ? result.markdown : result.message, reason);
  });

  server.registerTool("buy_pack", {
    title: "Buy a pack with points",
    description:
      "Spends this organisation's points to buy a pack, then hands over its instructions the same way load_pack "
      + "does. `agreed_price_points` must equal the pack's current price exactly — pass the number you already "
      + "told the person who authorized this, in points — or the call is refused and the live price is restated "
      + "rather than charged. `confirm` must be true. Buying a pack already owned is a no-op: it is not charged "
      + "again.",
    inputSchema: {
      slug: z.string().describe("The pack's slug, from search_packs."),
      agreed_price_points: z.number().describe(
        "The price in points, exactly as told to the person who authorized this call. Must match the live price."),
      confirm: z.literal(true).describe("Must be true — confirms the person approved spending agreed_price_points."),
      reason: REASON,
    },
  }, async ({ slug, agreed_price_points, confirm, reason }) => {
    const message = await buyPack(ctx, { slug, agreed_price_points, confirm });
    return text(message, reason);
  });
}
