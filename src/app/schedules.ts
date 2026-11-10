import { id, now } from "./db.js";
import { sql } from "./sql.js";
import * as P from "./platform.js";

/**
 * Standing instructions: run this pack on this brief, on this cadence.
 *
 * Deliberately our own scheduler rather than the platform's cron deployments.
 * Those exist and are the eventual home for this, but they are a second API
 * surface and nothing here has been verified against them; a 60-second ticker
 * over our own table is small, testable, and under our control. Everything the
 * schedule does afterwards — entitlement, points, budgets, metering — is the
 * ordinary run path, so a scheduled run is billed and traced like any other.
 */
export type Cadence = "hourly" | "daily" | "weekly";

export type ScheduleRow = {
  id: string; org_id: string; user_id: string; pack_version_id: string;
  name: string; prompt: string; cadence: Cadence;
  hour: number; weekday: number; enabled: number;
  last_run_at: string | null; last_run_id: string | null; last_error: string | null;
  created_at: string;
};

const sameUtcDay = (a: Date, b: Date): boolean =>
  a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate();

/**
 * Pure, so the awkward cases are testable without waiting an hour.
 *
 * A schedule that has never run is due as soon as its window is open; one that
 * has already run inside the current window is not, which is what stops a
 * ticker firing the same daily job sixty times in an hour.
 */
export function isDue(s: Pick<ScheduleRow, "cadence" | "hour" | "weekday" | "enabled" | "last_run_at">, at: Date): boolean {
  if (!s.enabled) return false;
  const last = s.last_run_at ? new Date(s.last_run_at) : null;

  if (s.cadence === "hourly") {
    if (!last) return true;
    // A full hour of separation, so a restart cannot double-fire.
    return at.getTime() - last.getTime() >= 3_600_000 - 60_000;
  }
  if (at.getUTCHours() !== s.hour) return false;
  if (s.cadence === "weekly" && at.getUTCDay() !== s.weekday) return false;
  if (!last) return true;
  return !sameUtcDay(last, at);
}

export async function listSchedules(orgId: string): Promise<ScheduleRow[]> {
  const s = await sql();
  const rows = await s.query<ScheduleRow>(
    "SELECT * FROM schedules WHERE org_id = $1 ORDER BY created_at DESC", [orgId]);
  return rows.map(normalise);
}

function normalise(r: ScheduleRow): ScheduleRow {
  return { ...r, hour: Number(r.hour), weekday: Number(r.weekday), enabled: Number(r.enabled) };
}

export async function createSchedule(args: {
  orgId: string; userId: string; packVersionId: string; name: string; prompt: string;
  cadence: Cadence; hour: number; weekday: number;
}): Promise<ScheduleRow> {
  // A schedule is a standing commitment to spend money, so it is refused up
  // front on a pack the organisation does not own.
  await P.assertEntitled(args.orgId, args.packVersionId);
  if (!args.prompt.trim()) throw new Error("a schedule needs a brief to send");
  const s = await sql();
  const scheduleId = id("sch");
  await s.query(
    `INSERT INTO schedules (id, org_id, user_id, pack_version_id, name, prompt, cadence, hour, weekday, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [scheduleId, args.orgId, args.userId, args.packVersionId, args.name.trim() || "unnamed",
      args.prompt.trim(), args.cadence,
      Math.min(23, Math.max(0, Math.floor(args.hour))), Math.min(6, Math.max(0, Math.floor(args.weekday))), now()]);
  return (await getSchedule(scheduleId))!;
}

export async function getSchedule(scheduleId: string): Promise<ScheduleRow | undefined> {
  const s = await sql();
  const row = await s.one<ScheduleRow>("SELECT * FROM schedules WHERE id = $1", [scheduleId]);
  return row ? normalise(row) : undefined;
}

export async function setEnabled(orgId: string, scheduleId: string, enabled: boolean): Promise<void> {
  const s = await sql();
  await s.query("UPDATE schedules SET enabled = $1 WHERE org_id = $2 AND id = $3",
    [enabled ? 1 : 0, orgId, scheduleId]);
}

export async function deleteSchedule(orgId: string, scheduleId: string): Promise<void> {
  const s = await sql();
  await s.query("DELETE FROM schedules WHERE org_id = $1 AND id = $2", [orgId, scheduleId]);
}

/**
 * Fire every schedule whose window is open.
 *
 * `last_run_at` is stamped before the work starts and whatever the outcome, so
 * a schedule that fails — no points, entitlement revoked, platform down —
 * records why and waits for its next window instead of retrying in a loop.
 *
 * The stamp doubles as the claim: it is conditional on the value this instance
 * read, so the ticker is safe to run on more than one instance.
 */
export async function runDueSchedules(at = new Date()): Promise<{ fired: number; failed: number }> {
  const s = await sql();
  const rows = (await s.query<ScheduleRow>("SELECT * FROM schedules WHERE enabled = 1")).map(normalise);
  let fired = 0, failed = 0;
  for (const row of rows) {
    if (!isDue(row, at)) continue;
    // Claim the row before spending anything. The stamp only lands if
    // `last_run_at` still holds what this instance read, so when two instances
    // tick at the same second exactly one of them fires. Without this the
    // schedule runs twice and the organisation is billed twice — invisible on
    // one instance, which is precisely why it has to be written down now.
    const claimed = await s.query<{ id: string }>(
      `UPDATE schedules SET last_run_at = $1
         WHERE id = $2 AND COALESCE(last_run_at, '') = COALESCE($3, '')
       RETURNING id`,
      [at.toISOString(), row.id, row.last_run_at]);
    if (claimed.length === 0) continue;
    try {
      const run = await P.startRun({
        orgId: row.org_id, userId: row.user_id, packVersionId: row.pack_version_id,
      });
      await s.query("UPDATE schedules SET last_run_id = $1, last_error = NULL WHERE id = $2", [run.id, row.id]);
      // Not awaited: a scheduled turn can run for minutes and the ticker must
      // not be held up by it. Failures land in the run's own transcript.
      void P.sendTurn(run.id, row.prompt).catch((e) =>
        P.recordEvent(run.id, "run.error", { message: String((e as Error)?.message ?? e) }));
      fired += 1;
    } catch (e) {
      failed += 1;
      await s.query("UPDATE schedules SET last_error = $1 WHERE id = $2",
        [String((e as Error)?.message ?? e), row.id]);
    }
  }
  return { fired, failed };
}

let ticker: NodeJS.Timeout | null = null;

export function startScheduler(): void {
  if (ticker) return;
  const tick = async (): Promise<void> => {
    try {
      const out = await runDueSchedules();
      if (out.fired || out.failed) console.log(`[schedules] fired ${out.fired}, failed ${out.failed}`);
    } catch (e) { console.error("[schedules]", (e as Error)?.message ?? e); }
  };
  ticker = setInterval(() => void tick(), 60_000);
  ticker.unref?.();
  void tick();
}

export function stopScheduler(): void {
  if (ticker) clearInterval(ticker);
  ticker = null;
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function cadenceLabel(s: Pick<ScheduleRow, "cadence" | "hour" | "weekday">): string {
  const at = `${String(s.hour).padStart(2, "0")}:00 UTC`;
  if (s.cadence === "hourly") return "every hour";
  if (s.cadence === "daily") return `every day at ${at}`;
  return `every ${DAYS[s.weekday] ?? "Monday"} at ${at}`;
}
