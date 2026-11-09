import { getDb, id, now, settingInt } from "../app/db.js";

/**
 * The points ledger.
 *
 * Earned points are cashable, which makes this an accounting system rather than
 * a counter: every credit traces to the run that earned it and every debit to
 * what it bought, and a balance is always derived from the rows rather than
 * stored. Amounts are cents of compute.
 */
export type Bucket = "grant" | "topup" | "earning";

export function balanceCents(orgId: string): number {
  const row = getDb()
    .prepare(`SELECT COALESCE(SUM(delta_cents), 0) AS bal FROM points_ledger
              WHERE org_id = ? AND (expires_at IS NULL OR expires_at > ?)`)
    .get(orgId, now()) as { bal: number };
  return row.bal;
}

export function balanceByBucket(orgId: string): Record<Bucket, number> {
  const rows = getDb()
    .prepare(`SELECT bucket, COALESCE(SUM(delta_cents), 0) AS bal FROM points_ledger
              WHERE org_id = ? AND (expires_at IS NULL OR expires_at > ?) GROUP BY bucket`)
    .all(orgId, now()) as Array<{ bucket: Bucket; bal: number }>;
  const out: Record<Bucket, number> = { grant: 0, topup: 0, earning: 0 };
  for (const r of rows) out[r.bucket] = r.bal;
  return out;
}

export function credit(orgId: string, bucket: Bucket, cents: number, reason: string, expiresAt?: string): void {
  if (cents <= 0) throw new Error("credit must be positive");
  getDb()
    .prepare(`INSERT INTO points_ledger (id, org_id, bucket, delta_cents, reason, expires_at, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id("pl"), orgId, bucket, cents, reason, expiresAt ?? null, now());
}

/**
 * Spend. The monthly grant is consumed before anything that does not expire, so
 * a buyer never loses purchased or earned points to an expiry they could have
 * avoided. Returns what was actually debited.
 */
export function debit(orgId: string, cents: number, reason: string, runId?: string): number {
  if (cents <= 0) return 0;
  const bal = balanceByBucket(orgId);
  let remaining = cents;
  const order: Bucket[] = ["grant", "topup", "earning"];
  const d = getDb().prepare(
    `INSERT INTO points_ledger (id, org_id, bucket, delta_cents, reason, run_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`);
  for (const bucket of order) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, Math.max(0, bal[bucket]));
    if (take <= 0) continue;
    d.run(id("pl"), orgId, bucket, -take, reason, runId ?? null, now());
    remaining -= take;
  }
  // Overshoot is absorbed rather than pushing a balance negative: the platform
  // eats at most one model request past a cap.
  return cents - remaining;
}

/**
 * The author earns on every run, as a configurable share of what the run cost.
 *
 * Kept in millicents: a 20% share of a two-cent turn is four tenths of a cent,
 * and in whole cents that rounds to nothing — so an author doing real work on
 * cheap turns would be paid zero forever. Returns millicents.
 */
export function creditAuthor(packId: string, runId: string, runCostCents: number): number {
  const bps = settingInt("author_share_bps");
  const millicents = Math.round((runCostCents * bps) / 10);
  if (millicents <= 0) return 0;
  getDb()
    .prepare(`INSERT INTO author_earnings (id, pack_id, run_id, points_millicents, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(id("ae"), packId, runId, millicents, now());
  return millicents;
}

export function authorEarningsTotal(packId: string): number {
  const row = getDb()
    .prepare("SELECT COALESCE(SUM(points_millicents), 0) AS total FROM author_earnings WHERE pack_id = ?")
    .get(packId) as { total: number };
  return row.total;
}

export const fmt = (cents: number): string => `$${(cents / 100).toFixed(2)}`;
/** Millicents, shown to the tenth of a cent so small earnings are visible. */
export const fmtMilli = (milli: number): string => `$${(milli / 100000).toFixed(4)}`;
