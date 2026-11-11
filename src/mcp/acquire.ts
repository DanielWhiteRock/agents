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
 * Already having access is a silent no-op, not a refusal — but "already
 * having access" is `P.mayExport`, not a bare `P.entitled` probe. An author
 * or the platform curator org can read a pack with *no* `entitlements` row
 * at all (`assertMayExport`'s first two clauses), so checking `entitled`
 * alone would miss them and send them through `buyWithPoints` to be charged
 * full price for something they already have free — worse, `buyWithPoints`
 * skips the author-share credit precisely when the buyer *is* the author,
 * so that charge would not even circulate back to them. `P.mayExport` is
 * the one boolean form of that same decision (`assertMayExport` is now a
 * thin wrapper over it), so this file never re-implements the author/curator
 * clauses itself.
 *
 * Skipping `buyWithPoints` whenever `mayExport` is already true also means
 * there is no second ledger row and no second `purchases` row on a repeat
 * call — `buyWithPoints` is the single purchase path (it does not
 * short-circuit for an org that already has an entitlement: it would debit,
 * credit the author's share, and insert a second `purchases` row all over
 * again, only the `entitlements` insert itself is idempotent) — and this
 * function never grants the entitlement itself either, so there is exactly
 * one place a double-grant bug could creep in, and it isn't here.
 *
 * The balance is checked *before* calling `buyWithPoints`, not inferred from
 * whatever it throws: `buyWithPoints` does `debit`, `credit`, an INSERT, and
 * `grant` as four separate statements with no transaction wrapping them, so
 * a failure partway through could leave points spent with nothing granted —
 * and that failure must not be reported as "insufficient balance" when the
 * balance was actually fine a moment ago. Checking first makes "insufficient
 * balance" a claim this function can stand behind; anything `buyWithPoints`
 * still throws after that is reported as an unexplained failure that may
 * have partially applied, not misdiagnosed as a shortfall.
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

  let receipt: string;
  if (await P.mayExport(ctx.orgId, p, v.id)) {
    receipt = `Nothing was charged — this organisation already has access to ${p.name}.`;
  } else {
    const owed = live * 1000;
    const bal = await balanceMillipoints(ctx.orgId);
    if (bal < owed) {
      return `${p.name} costs ${price(live)} and this organisation only has ${pts(bal)}. `
        + `Top up at ${ctx.baseUrl}/ledger/topup`;
    }
    try {
      await Pay.buyWithPoints({
        orgId: ctx.orgId, userId: ctx.userId, packVersionId: v.id, packId: p.id,
        pricePoints: live, description: p.name,
      });
    } catch {
      // The balance was just confirmed sufficient, so this is not a
      // shortfall — it is an unexplained failure partway through a
      // non-atomic sequence of writes, and may have already moved points
      // without granting anything. Say so plainly rather than guessing.
      return `${p.name} could not be bought right now. Check ${ctx.baseUrl}/ledger before trying again — `
        + "points may have moved even though the pack was not granted.";
    }
    const newBal = await balanceMillipoints(ctx.orgId);
    receipt = `Bought ${p.name} for ${price(live)}. New balance: ${pts(newBal)}.`;
  }

  const result = await loadPack(ctx, slug);
  return `${receipt}\n\n${result.ok ? result.markdown : result.message}`;
}

export function registerAcquire(server: McpServer, ctx: McpContext): void {
  server.registerTool("my_library", {
    title: "What this organisation owns",
    description:
      "The packs this organisation has bought, with the version each entitlement is pinned to. A pack bought at "
      + "version 2 keeps running version 2 until it is deliberately upgraded — and a row is marked when a newer "
      + "version has since been published, so that staleness is never silent.",
    inputSchema: { reason: REASON },
  }, async ({ reason }) => {
    const s = await sql();
    const rows = await s.query<{ pack_id: string; name: string; slug: string; version: number; acquired_at: string }>(
      `SELECT pk.id AS pack_id, pk.name, pk.slug, pv.version, e.acquired_at
       FROM entitlements e
       JOIN pack_versions pv ON pv.id = e.pack_version_id
       JOIN packs pk ON pk.id = pv.pack_id
       WHERE e.org_id = $1 ORDER BY e.acquired_at DESC`, [ctx.orgId]);
    if (rows.length === 0) {
      return text("This organisation does not own any packs yet. Use search_packs to look.", reason);
    }
    // The entitled version is read from the row itself; the latest is a
    // fresh lookup per pack, never assumed — a publish that happened after
    // the entitlement was granted is exactly what this marker exists to
    // surface, so it must be computed now, not cached on the row.
    const lines = await Promise.all(rows.map(async (r) => {
      const latest = await P.latestVersion(r.pack_id);
      const behind = latest && latest.version !== r.version ? ` · behind latest (version ${latest.version})` : "";
      return `${r.name} (${r.slug}) · version ${r.version} · since ${r.acquired_at.slice(0, 10)}${behind}`;
    }));
    return text(lines.join("\n"), reason);
  });

  server.registerTool("my_balance", {
    title: "What this organisation can spend",
    description:
      "This organisation's points balance, with its most recent ledger activity — grants, top-ups, earnings and "
      + "what has been spent, each in points. Call top_up to add more.",
    inputSchema: { reason: REASON },
  }, async ({ reason }) => {
    const bal = await balanceMillipoints(ctx.orgId);
    const s = await sql();
    const rows = await s.query<{ bucket: string; delta_millipoints: number; reason: string; created_at: string }>(
      `SELECT bucket, delta_millipoints, reason, created_at FROM points_ledger
       WHERE org_id = $1 ORDER BY created_at DESC LIMIT 10`, [ctx.orgId]);
    const lines = rows.map((r) =>
      `${r.created_at.slice(0, 10)} · ${r.bucket} · ${pts(r.delta_millipoints)} · ${r.reason}`);
    return text([
      `Balance: ${pts(bal)}`,
      "",
      ...(lines.length ? ["Recent activity:", ...lines] : ["No ledger activity yet."]),
    ].join("\n"), reason);
  });

  server.registerTool("top_up", {
    title: "Add points to the balance",
    description:
      "Points are bought with a card, which this server cannot take — this returns the link to top up in a "
      + "browser. Nothing is charged here; this call never moves money or points by itself.",
    inputSchema: {
      amount_points: z.number().int().positive().describe("How many points you intend to add, so the top-up page can be opened pre-filled."),
      reason: REASON,
    },
  }, async ({ amount_points, reason }) => {
    return text(
      `To add ${price(amount_points)} to this organisation's balance, open ${ctx.baseUrl}/ledger/topup — `
      + "this server cannot charge a card itself.", reason);
  });

  server.registerTool("install_pack", {
    title: "Add a pack to the library",
    description:
      "Point this organisation's library at a pack's newest published version. It does not buy anything itself: "
      + "if the pack is not already owned, the reply says what it costs and that buy_pack can purchase it from "
      + "this organisation's points balance right here, in this session.",
    inputSchema: { slug: z.string().describe("The pack's slug."), reason: REASON },
  }, async ({ slug, reason }) => {
    const p = await P.getPack(slug);
    // A draft or in-review pack must read exactly as a missing slug does —
    // `P.getPack` carries no status filter, so this tool enforces it itself
    // (Ruling R8, carried from Task 3's fix to `pack_details`).
    if (!p || p.status !== "listed") return text(notFound(slug), reason);
    const v = await P.latestVersion(p.id);
    if (!v) return text(`${p.name} has not been published yet, so there is nothing to install.`, reason);
    if (await P.entitled(ctx.orgId, v.id)) {
      return text(`${p.name} version ${v.version} is already in your library. Run it at ${ctx.baseUrl}/packs/${p.slug}`, reason);
    }
    return text(
      `${p.name} is not owned by this organisation. ${p.price_points === 0 ? "It is free" : `It costs ${price(p.price_points)}`}`
      + " — call buy_pack to buy it with points, right here, or open "
      + `${ctx.baseUrl}/packs/${p.slug} to buy it in a browser instead.`, reason);
  });

  server.registerTool("export_pack", {
    title: "Download a pack you own",
    description:
      "Returns a pack this organisation may read as an agent definition file — markdown with YAML front matter, "
      + "the format `ant apply` consumes — so it can be run on your own infrastructure instead of here. To run it "
      + "in this session instead, call load_pack. Works for any pack this organisation owns, authored, or that "
      + "the platform curates — the same rule load_pack and pack_details use.",
    inputSchema: { slug: z.string().describe("The pack's slug."), reason: REASON },
  }, async ({ slug, reason }) => {
    // Ruling R15: `P.getPack` carries no status filter, so without this an
    // unlisted pack answered "does not own" while a missing slug answered
    // "no such pack" — two different sentences that hand a stranger the
    // same existence oracle R8 already closed for `pack_details`,
    // `load_pack` and `install_pack`.
    const p = await P.getPack(slug);
    if (!p || p.status !== "listed") return text(notFound(slug), reason);
    try {
      const md = await P.exportPack(ctx.orgId, slug);
      return text(`Save this as ${slug}.md and apply it with \`ant apply ${slug}.md\`:\n\n${md}`, reason);
    } catch (e) {
      const m = String((e as Error)?.message ?? e);
      return text(m.includes("does not own")
        ? `This organisation does not own ${slug}, so it cannot be exported. Call buy_pack to buy it, or open `
          + `${ctx.baseUrl}/packs/${slug}`
        : m, reason);
    }
  });

  server.registerTool("load_pack", {
    title: "Load a pack's instructions into this session",
    description:
      "Hands a pack's full instructions straight into this session, so it can be run right here. A free pack "
      + "goes to any signed-in organisation, and buying it for zero points happens automatically. A paid pack "
      + "goes only to an organisation that already owns it — buy it first with buy_pack.",
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
      + "rather than charged. `confirm` must be true. Calling this for a pack the organisation can already read — "
      + "already bought, authored, or curated by the platform — is a no-op: nothing is charged, and the reply says "
      + "so. The reply always states whether anything was charged and, if so, the new balance.",
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
