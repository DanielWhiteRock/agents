import { id, now, setting, settingInt } from "../app/db.js";
import { sql } from "../app/sql.js";
import { payments, type Money } from "./provider.js";
import { balanceMillipoints, credit, debit } from "./points.js";
import { endRunsFor } from "../app/platform.js";

/**
 * Buying a pack.
 *
 * The entitlement is granted by a *paid* purchase and nothing else, so the
 * price on the page means something. A free pack skips the provider entirely
 * rather than charging zero.
 */
export type PurchaseRow = {
  id: string; org_id: string; user_id: string; kind: "pack" | "points";
  pack_version_id: string | null;
  amount_cents: number; provider: string; provider_ref: string | null;
  status: "pending" | "paid" | "failed" | "refunded";
  refundable_until: string | null; created_at: string;
  paid_at: string | null; refunded_at: string | null;
};

const usd = (amountCents: number): Money => ({ amountCents, currency: "USD" });

export async function getPurchase(purchaseId: string): Promise<PurchaseRow | undefined> {
  const s = await sql();
  return s.one<PurchaseRow>("SELECT * FROM purchases WHERE id = $1", [purchaseId]);
}

export async function purchasesFor(orgId: string): Promise<PurchaseRow[]> {
  const s = await sql();
  return s.query<PurchaseRow>("SELECT * FROM purchases WHERE org_id = $1 ORDER BY created_at DESC", [orgId]);
}

/**
 * Start a purchase. Returns either a granted entitlement (free, or a provider
 * that settles immediately) or an approval URL the buyer must visit.
 */
export async function beginPurchase(args: {
  orgId: string; userId: string; packVersionId: string; amountCents: number; description: string; baseUrl: string;
}): Promise<{ purchaseId: string | null; status: "granted" | "redirect"; approveUrl?: string }> {
  if (args.amountCents <= 0) {
    await grant(args.orgId, args.packVersionId);
    return { purchaseId: null, status: "granted" };
  }
  const s = await sql();
  const provider = payments();
  const purchaseId = id("pur");
  await s.query(
    `INSERT INTO purchases (id, org_id, user_id, kind, pack_version_id, amount_cents, provider, status, created_at)
     VALUES ($1,$2,$3,'pack',$4,$5,$6,'pending',$7)`,
    [purchaseId, args.orgId, args.userId, args.packVersionId, args.amountCents, provider.name, now()]);

  const result = await provider.charge({
    reference: purchaseId,
    amount: usd(args.amountCents),
    description: args.description,
    returnUrl: `${args.baseUrl}/purchases/${purchaseId}/return`,
    cancelUrl: `${args.baseUrl}/purchases/${purchaseId}/cancel`,
  });
  await s.query("UPDATE purchases SET provider_ref = $1 WHERE id = $2", [result.ref, purchaseId]);

  if (result.status === "paid") {
    await settle(purchaseId);
    return { purchaseId, status: "granted" };
  }
  return { purchaseId, status: "redirect", approveUrl: result.approveUrl };
}

/** Capture an approved charge, then grant. Idempotent. */
export async function completePurchase(purchaseId: string): Promise<PurchaseRow> {
  const p = await getPurchase(purchaseId);
  if (!p) throw new Error("no such purchase");
  if (p.status === "paid") return p;
  const out = await payments().capture(p.provider_ref ?? "");
  if (out.status !== "paid") {
    const s = await sql();
    await s.query("UPDATE purchases SET status = 'failed' WHERE id = $1", [purchaseId]);
    throw new Error("the payment was not completed");
  }
  await settle(purchaseId);
  return (await getPurchase(purchaseId))!;
}

async function settle(purchaseId: string): Promise<void> {
  const s = await sql();
  const days = await settingInt("refund_window_days");
  const p = (await getPurchase(purchaseId))!;
  await s.query(
    "UPDATE purchases SET status = 'paid', paid_at = $1, refundable_until = $2 WHERE id = $3",
    [now(), new Date(Date.now() + days * 86400_000).toISOString(), purchaseId]);
  if (p.kind === "points") {
    // Points bought with money do not expire; only the monthly grant does.
    await credit(p.org_id, "topup", p.amount_cents, `points purchase ${purchaseId}`);
  } else if (p.pack_version_id) {
    await grant(p.org_id, p.pack_version_id);
  }
}

/** Buying compute. Same rails, same records, different thing delivered. */
export async function beginPointsPurchase(args: {
  orgId: string; userId: string; amountCents: number; baseUrl: string;
}): Promise<{ purchaseId: string; status: "granted" | "redirect"; approveUrl?: string }> {
  if (args.amountCents <= 0) throw new Error("amount must be positive");
  const s = await sql();
  const provider = payments();
  const purchaseId = id("pur");
  await s.query(
    `INSERT INTO purchases (id, org_id, user_id, kind, amount_cents, provider, status, created_at)
     VALUES ($1,$2,$3,'points',$4,$5,'pending',$6)`,
    [purchaseId, args.orgId, args.userId, args.amountCents, provider.name, now()]);
  const result = await provider.charge({
    reference: purchaseId, amount: usd(args.amountCents),
    description: `${(args.amountCents / 100).toFixed(2)} of agent compute`,
    returnUrl: `${args.baseUrl}/purchases/${purchaseId}/return`,
    cancelUrl: `${args.baseUrl}/purchases/${purchaseId}/cancel`,
  });
  await s.query("UPDATE purchases SET provider_ref = $1 WHERE id = $2", [result.ref, purchaseId]);
  if (result.status === "paid") {
    await settle(purchaseId);
    return { purchaseId, status: "granted" };
  }
  return { purchaseId, status: "redirect", approveUrl: result.approveUrl };
}

/**
 * What a pack costs, in the only currency a buyer holds.
 *
 * The shelf used to be priced in dollars and run on points, which meant a
 * buyer read two units and had to convert between them to know what anything
 * cost. One currency: dollars now appear only where money actually moves —
 * the subscription, a top-up, an author cashing out.
 */
export function pricePoints(pack: { price_points: number }): number {
  return Math.max(0, Math.round(pack.price_points));
}

/**
 * Buy a pack with points, crediting the author their share in points too.
 *
 * §8.1 split a one-off purchase 70/30 as money. Paying the author in points
 * keeps that split while removing the second currency, and §8.6 already made
 * earned points cashable — so the author can still take it as money, they
 * just do it at cash-out rather than at every sale.
 */
export async function buyWithPoints(args: {
  orgId: string; userId: string; packVersionId: string; packId: string;
  pricePoints: number; description: string;
}): Promise<{ purchaseId: string | null; points: number }> {
  const points = args.pricePoints;
  if (points <= 0) {
    await grant(args.orgId, args.packVersionId);
    return { purchaseId: null, points: 0 };
  }
  const owed = points * 1000; // points, as thousandths
  const balance = await balanceMillipoints(args.orgId);
  if (balance < owed) {
    throw new Error(
      `${args.description} costs ${points} points; you have ${(balance / 1000).toFixed(1)}`);
  }
  const s = await sql();
  const purchaseId = id("pur");
  await debit(args.orgId, owed, `bought ${args.description}`);

  // The author's share, in points, to whoever owns the pack. A pack the
  // platform curates has no outside author, so nothing is credited.
  const share = await settingInt("author_share_bps");
  const pack = await s.one<{ author_org_id: string | null }>(
    "SELECT author_org_id FROM packs WHERE id = $1", [args.packId]);
  const authorPoints = Math.round((owed * share) / 10_000);
  if (pack?.author_org_id && pack.author_org_id !== args.orgId && authorPoints > 0) {
    await credit(pack.author_org_id, "earning", authorPoints, `sold ${args.description}`);
  }

  await s.query(
    `INSERT INTO purchases (id, org_id, user_id, kind, pack_version_id, amount_cents, provider, status, created_at)
     VALUES ($1,$2,$3,'pack',$4,$5,'points','paid',$6)`,
    [purchaseId, args.orgId, args.userId, args.packVersionId, owed, now()]);
  await grant(args.orgId, args.packVersionId);
  return { purchaseId, points };
}

async function grant(orgId: string, packVersionId: string): Promise<void> {
  const s = await sql();
  await s.query(
    `INSERT INTO entitlements (id, org_id, pack_version_id, acquired_at) VALUES ($1,$2,$3,$4)
     ON CONFLICT (org_id, pack_version_id) DO NOTHING`,
    [id("ent"), orgId, packVersionId, now()]);
}

export async function cancelPurchase(purchaseId: string): Promise<void> {
  const s = await sql();
  await s.query("UPDATE purchases SET status = 'failed' WHERE id = $1 AND status = 'pending'", [purchaseId]);
}

/**
 * Refund within the window, and take the entitlement back with it.
 *
 * Consumed points are not returned — the compute was really spent.
 */
export async function refundPurchase(purchaseId: string, orgId: string): Promise<void> {
  const p = await getPurchase(purchaseId);
  if (!p || p.org_id !== orgId) throw new Error("no such purchase");
  if (p.status !== "paid") throw new Error("that purchase is not refundable");
  if (p.kind === "points") throw new Error("compute that has been bought cannot be refunded");
  if (!p.refundable_until || p.refundable_until <= now()) {
    throw new Error(`the ${await setting("refund_window_days")}-day refund window has closed`);
  }
  await payments().refund(p.provider_ref ?? "", usd(p.amount_cents));
  const s = await sql();
  await s.query("UPDATE purchases SET status = 'refunded', refunded_at = $1 WHERE id = $2", [now(), purchaseId]);
  if (p.pack_version_id) {
    await s.query("DELETE FROM entitlements WHERE org_id = $1 AND pack_version_id = $2",
      [orgId, p.pack_version_id]);
    // Taking the money back takes the worker with it: any run still open on
    // that pack is terminated rather than left quietly usable.
    await endRunsFor(orgId, p.pack_version_id);
  }
}

// ----------------------------------------------------------------- payouts

export type DueRow = { pack_id: string; name: string; recipient: string | null; millicents: number };

/**
 * Author earnings old enough that the refund window behind them has closed.
 *
 * Paying earlier would mean clawing money back from an author because a buyer
 * changed their mind, which is exactly what the holding period avoids.
 */
export async function payoutsDue(): Promise<DueRow[]> {
  const s = await sql();
  const days = await settingInt("refund_window_days");
  const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
  const rows = await s.query<{ pack_id: string; name: string; recipient: string | null; millicents: unknown }>(
    `SELECT ae.pack_id AS pack_id, p.name AS name, p.author_payout_email AS recipient,
            COALESCE(SUM(ae.points_millicents), 0) AS millicents
     FROM author_earnings ae JOIN packs p ON p.id = ae.pack_id
     WHERE ae.payout_id IS NULL AND ae.created_at <= $1
     GROUP BY ae.pack_id, p.name, p.author_payout_email
     ORDER BY millicents DESC`, [cutoff]);
  return rows.map((r) => ({ ...r, millicents: Number(r.millicents) }));
}

/**
 * Pay one pack's due earnings. Marks the earnings first so a provider retry
 * cannot pay the same work twice.
 */
export async function payAuthor(packId: string): Promise<{ payoutId: string; millicents: number } | null> {
  const s = await sql();
  const days = await settingInt("refund_window_days");
  const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
  const pack = await s.one<{ name: string; author_payout_email: string | null }>(
    "SELECT name, author_payout_email FROM packs WHERE id = $1", [packId]);
  if (!pack) throw new Error("no such pack");
  if (!pack.author_payout_email) throw new Error(`${pack.name} has no payout address on file`);

  const rows = await s.query<{ id: string; points_millicents: unknown }>(
    "SELECT id, points_millicents FROM author_earnings WHERE pack_id = $1 AND payout_id IS NULL AND created_at <= $2",
    [packId, cutoff]);
  const millicents = rows.reduce((t, r) => t + Number(r.points_millicents), 0);
  if (millicents <= 0) return null;

  const payoutId = id("pay");
  await s.query(
    `INSERT INTO payouts (id, pack_id, recipient, millicents, provider, status, created_at)
     VALUES ($1,$2,$3,$4,$5,'pending',$6)`,
    [payoutId, packId, pack.author_payout_email, millicents, payments().name, now()]);
  for (const r of rows) {
    await s.query("UPDATE author_earnings SET payout_id = $1 WHERE id = $2", [payoutId, r.id]);
  }

  try {
    // Rounded down to the cent: providers do not move fractions of one.
    const out = await payments().payout({
      reference: payoutId, amount: usd(Math.floor(millicents / 1000)),
      recipient: pack.author_payout_email, note: `Agent earnings for ${pack.name}`,
    });
    await s.query("UPDATE payouts SET status = 'paid', provider_ref = $1, paid_at = $2 WHERE id = $3",
      [out.ref, now(), payoutId]);
  } catch (e) {
    await s.query("UPDATE payouts SET status = 'failed' WHERE id = $1", [payoutId]);
    // Release the earnings so a later attempt can pick them up again.
    await s.query("UPDATE author_earnings SET payout_id = NULL WHERE payout_id = $1", [payoutId]);
    throw e;
  }
  return { payoutId, millicents };
}
