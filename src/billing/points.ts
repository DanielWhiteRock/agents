import { id, now, settingInt } from "../app/db.js";
import { sql } from "../app/sql.js";

/**
 * The points ledger.
 *
 * Earned points are cashable, so this is an accounting system rather than a
 * counter: every credit traces to the run that earned it and every debit to
 * what it bought, and a balance is always derived from the rows, never stored.
 * Amounts are cents of compute.
 */
export type Bucket = "grant" | "topup" | "earning";

const num = (v: unknown): number => Number(v ?? 0);

export async function balanceCents(orgId: string): Promise<number> {
  const s = await sql();
  const row = await s.one<{ bal: unknown }>(
    `SELECT COALESCE(SUM(delta_cents), 0) AS bal FROM points_ledger
     WHERE org_id = $1 AND (expires_at IS NULL OR expires_at > $2)`, [orgId, now()]);
  return num(row?.bal);
}

export async function balanceByBucket(orgId: string): Promise<Record<Bucket, number>> {
  const s = await sql();
  const rows = await s.query<{ bucket: Bucket; bal: unknown }>(
    `SELECT bucket, COALESCE(SUM(delta_cents), 0) AS bal FROM points_ledger
     WHERE org_id = $1 AND (expires_at IS NULL OR expires_at > $2) GROUP BY bucket`, [orgId, now()]);
  const out: Record<Bucket, number> = { grant: 0, topup: 0, earning: 0 };
  for (const r of rows) out[r.bucket] = num(r.bal);
  return out;
}

export async function credit(
  orgId: string, bucket: Bucket, cents: number, reason: string, expiresAt?: string,
): Promise<void> {
  if (cents <= 0) throw new Error("credit must be positive");
  const s = await sql();
  await s.query(
    `INSERT INTO points_ledger (id, org_id, bucket, delta_cents, reason, expires_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id("pl"), orgId, bucket, cents, reason, expiresAt ?? null, now()]);
}

/**
 * Spend. The expiring monthly grant goes first, so a buyer never loses
 * purchased or earned points to an expiry they could have avoided. Returns what
 * was actually debited: overshoot past a budget is absorbed rather than pushing
 * a balance negative.
 */
export async function debit(orgId: string, cents: number, reason: string, runId?: string): Promise<number> {
  if (cents <= 0) return 0;
  const s = await sql();
  const bal = await balanceByBucket(orgId);
  let remaining = cents;
  for (const bucket of ["grant", "topup", "earning"] as const) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, Math.max(0, bal[bucket]));
    if (take <= 0) continue;
    await s.query(
      `INSERT INTO points_ledger (id, org_id, bucket, delta_cents, reason, run_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id("pl"), orgId, bucket, -take, reason, runId ?? null, now()]);
    remaining -= take;
  }
  return cents - remaining;
}

/**
 * The author earns on every run, as a configurable share of what it cost.
 *
 * Kept in millicents: a 20% share of a two-cent turn is four tenths of a cent,
 * which in whole cents rounds to nothing — an author doing real work on cheap
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

export const fmt = (cents: number): string => `$${(cents / 100).toFixed(2)}`;
/** Millicents, shown to the tenth of a cent so small earnings stay visible. */
export const fmtMilli = (milli: number): string => `$${(milli / 100000).toFixed(4)}`;
