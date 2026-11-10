import { id, now, settingInt } from "../app/db.js";
import { sql } from "../app/sql.js";

/**
 * The points ledger.
 *
 * Earned points are cashable, so this is an accounting system rather than a
 * counter: every credit traces to the run that earned it and every debit to
 * what it bought, and a balance is always derived from the rows, never stored.
 * Amounts are millipoints of compute.
 */
export type Bucket = "grant" | "topup" | "earning";

const num = (v: unknown): number => Number(v ?? 0);

export async function balanceMillipoints(orgId: string): Promise<number> {
  const s = await sql();
  const row = await s.one<{ bal: unknown }>(
    `SELECT COALESCE(SUM(delta_millipoints), 0) AS bal FROM points_ledger
     WHERE org_id = $1 AND (expires_at IS NULL OR expires_at > $2)`, [orgId, now()]);
  return num(row?.bal);
}

export async function balanceByBucket(orgId: string): Promise<Record<Bucket, number>> {
  const s = await sql();
  const rows = await s.query<{ bucket: Bucket; bal: unknown }>(
    `SELECT bucket, COALESCE(SUM(delta_millipoints), 0) AS bal FROM points_ledger
     WHERE org_id = $1 AND (expires_at IS NULL OR expires_at > $2) GROUP BY bucket`, [orgId, now()]);
  const out: Record<Bucket, number> = { grant: 0, topup: 0, earning: 0 };
  for (const r of rows) out[r.bucket] = num(r.bal);
  return out;
}

export async function credit(
  orgId: string, bucket: Bucket, millipoints: number, reason: string, expiresAt?: string,
): Promise<void> {
  if (millipoints <= 0) throw new Error("credit must be positive");
  const s = await sql();
  await s.query(
    `INSERT INTO points_ledger (id, org_id, bucket, delta_millipoints, reason, expires_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id("pl"), orgId, bucket, millipoints, reason, expiresAt ?? null, now()]);
}

/**
 * Spend. The expiring monthly grant goes first, so a buyer never loses
 * purchased or earned points to an expiry they could have avoided. Returns what
 * was actually debited: overshoot past a budget is absorbed rather than pushing
 * a balance negative.
 */
export async function debit(orgId: string, millipoints: number, reason: string, runId?: string): Promise<number> {
  if (millipoints <= 0) return 0;
  const s = await sql();
  const bal = await balanceByBucket(orgId);
  let remaining = millipoints;
  for (const bucket of ["grant", "topup", "earning"] as const) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, Math.max(0, bal[bucket]));
    if (take <= 0) continue;
    await s.query(
      `INSERT INTO points_ledger (id, org_id, bucket, delta_millipoints, reason, run_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id("pl"), orgId, bucket, -take, reason, runId ?? null, now()]);
    remaining -= take;
  }
  return millipoints - remaining;
}

/**
 * The author earns on every run, as a configurable share of what it cost.
 *
 * Kept in millicents: a 20% share of a two-cent turn is four tenths of a cent,
 * which in whole millipoints rounds to nothing — an author doing real work on cheap
 * turns would be paid zero forever. Returns millicents.
 */
export async function creditAuthor(packId: string, runId: string, runCostCents: number): Promise<number> {
  const bps = await settingInt("author_share_bps");
  const millicents = Math.round((runCostCents * bps) / 10);
  if (millicents <= 0) return 0;
  const s = await sql();
  await s.query(
    `INSERT INTO author_earnings (id, pack_id, run_id, points_millicents, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [id("ae"), packId, runId, millicents, now()]);
  return millicents;
}

export async function authorEarningsTotal(packId: string): Promise<number> {
  const s = await sql();
  const row = await s.one<{ total: unknown }>(
    "SELECT COALESCE(SUM(points_millicents), 0) AS total FROM author_earnings WHERE pack_id = $1", [packId]);
  return num(row?.total);
}

/** Real money, in dollars. Used only where money actually moves. */
export const fmt = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

/**
 * What a run costs in points, from the tokens it actually used.
 *
 * This is the owner's tier table read backwards. Personal is 120 points for
 * 5M input and 1M output; output lists at five times input, so the only rate
 * that satisfies both is 12 points per million in and 60 per million out —
 * and Team lands on exactly 360 at the same rate without being asked to.
 *
 * Returned in thousandths of a point, because a short turn costs about a
 * hundredth of one and whole points would round every small run to nothing.
 */
export async function pointsForUsage(inputTokens: number, outputTokens: number): Promise<number> {
  const [perIn, perOut] = await Promise.all([
    settingInt("points_per_mtok_in"),
    settingInt("points_per_mtok_out"),
  ]);
  return Math.round(((inputTokens * perIn) + (outputTokens * perOut)) / 1000);
}

/**
 * Compute, in the unit the buyer actually holds.
 *
 * A point is a cent of compute, so the arithmetic is the same either way — but
 * the words are not. A tier sells 120 points for $5; rendering that balance as
 * "$1.20" tells somebody who paid five dollars that they hold one twenty, which
 * is true of the compute and false of the deal. Points are what they bought,
 * so points are what they see. Dollars stay for real money: what a pack costs,
 * what an author is paid.
 */
/**
 * Points, shown to the precision the number deserves.
 *
 * A balance of 120,000 millipoints is "120 points"; a turn that cost 13 of
 * them is "0.013 points" rather than "0". Rounding a real charge to zero is
 * how a meter stops being believed.
 */
export const pts = (millipoints: number): string => {
  const p = millipoints / 1000;
  const n = Math.abs(p) >= 10 || Number.isInteger(p)
    ? p.toLocaleString("en-US", { maximumFractionDigits: 0 })
    : p.toLocaleString("en-US", { maximumFractionDigits: 3 });
  return `${n} ${Math.abs(p) === 1 ? "point" : "points"}`;
};
/** Millicents, shown to the tenth of a cent so small earnings stay visible. */
export const fmtMilli = (milli: number): string => `$${(milli / 100000).toFixed(4)}`;
