/**
 * The service layer: everything above the runtime interface.
 *
 * It owns packs, runs, the transcript, and the metering that turns a run's
 * list_cost into a points debit and an author credit.
 */
import { getDb, id, now, setting, settingInt } from "./db.js";
import { credit, creditAuthor, debit } from "../billing/points.js";
import { ManagedAgentsRuntime } from "../runtime/managed-agents.js";
import { resumeAfterDecision, runTurn, type TurnResult } from "../runtime/run.js";
import { cents, fromCents } from "../runtime/money.js";
import { BudgetExhaustedError, type AgentRuntime, type PendingAsk, type RuntimeEvent } from "../runtime/types.js";
import type { PackDefinition } from "../packs/types.js";
import { SEED_PACKS } from "../packs/seed-packs.js";
import Anthropic from "@anthropic-ai/sdk";

export type PackRow = {
  id: string; slug: string; name: string; tagline: string; author: string;
  price_cents: number; upgrade_points: number; model: string; effort: string;
  pinned_models: string; instructions: string; status: string; created_at: string;
};
export type PackVersionRow = {
  id: string; pack_id: string; version: number; runtime_pack_id: string;
  runtime_version: string; instructions: string; created_at: string;
};
export type RunRow = {
  id: string; org_id: string; user_id: string; pack_version_id: string; session_id: string;
  model: string; status: string; stop_reason: string | null; budget_cents: number;
  input_tokens: number; output_tokens: number; active_seconds: number;
  list_cost_cents: number; billed_up_to_cents: number; billed_cents: number;
  started_at: string; ended_at: string | null;
};

let runtimeSingleton: AgentRuntime | null = null;
export function runtime(): AgentRuntime {
  if (!runtimeSingleton) {
    runtimeSingleton = new ManagedAgentsRuntime(new Anthropic() as never);
  }
  return runtimeSingleton;
}
export function setRuntime(r: AgentRuntime): void { runtimeSingleton = r; }

let environmentId: string | null = null;
async function env(): Promise<string> {
  if (!environmentId) environmentId = await runtime().ensureEnvironment(setting("environment_name"));
  return environmentId;
}

// ---------------------------------------------------------------- bootstrap

export function ensureDemoOrg(): { orgId: string; userId: string } {
  const db = getDb();
  const existing = db.prepare("SELECT id FROM orgs LIMIT 1").get() as { id?: string } | undefined;
  if (existing?.id) {
    const u = db.prepare("SELECT id FROM users WHERE org_id = ? LIMIT 1").get(existing.id) as { id: string };
    return { orgId: existing.id, userId: u.id };
  }
  const orgId = id("org"), userId = id("usr");
  const tier = "team";
  db.prepare("INSERT INTO orgs (id, name, tier, concurrency_limit, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(orgId, "alphaCEO (demo)", tier, settingInt(`tier.${tier}.concurrency`), now());
  db.prepare("INSERT INTO users (id, org_id, email, name, role, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(userId, orgId, "dflopi@gmail.com", "Daniel", "owner", now());
  // The monthly grant expires; top-ups and earnings do not.
  const expires = new Date(Date.now() + 30 * 86400_000).toISOString();
  credit(orgId, "grant", settingInt(`tier.${tier}.points_cents`), `${tier} monthly grant`, expires);
  credit(orgId, "topup", 500, "launch credit so the demo can actually run");
  return { orgId, userId };
}

/** Some models reject `effort` entirely, so it is a per-model capability, not a default. */
export function effortFor(model: string, effort: string | null | undefined): PackDefinition["effort"] | undefined {
  if (!effort) return undefined;
  const excluded = setting("models_without_effort").split(",").map((s) => s.trim());
  return excluded.includes(model) ? undefined : (effort as PackDefinition["effort"]);
}

export function listPacks(): PackRow[] {
  return getDb().prepare("SELECT * FROM packs WHERE status = 'listed' ORDER BY price_cents DESC").all() as PackRow[];
}
export function getPack(slug: string): PackRow | undefined {
  return getDb().prepare("SELECT * FROM packs WHERE slug = ?").get(slug) as PackRow | undefined;
}
export function latestVersion(packId: string): PackVersionRow | undefined {
  return getDb().prepare("SELECT * FROM pack_versions WHERE pack_id = ? ORDER BY version DESC LIMIT 1")
    .get(packId) as PackVersionRow | undefined;
}
export function getVersion(versionId: string): PackVersionRow | undefined {
  return getDb().prepare("SELECT * FROM pack_versions WHERE id = ?").get(versionId) as PackVersionRow | undefined;
}

/** Writes the seed catalog into the database. Does not touch the runtime. */
export function seedCatalog(): number {
  const db = getDb();
  const ins = db.prepare(`INSERT OR IGNORE INTO packs
    (id, slug, name, tagline, author, price_cents, upgrade_points, model, effort, pinned_models, instructions, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'listed', ?)`);
  let n = 0;
  for (const p of SEED_PACKS) {
    const r = ins.run(id("pk"), p.slug, p.name, p.tagline, p.author, p.priceCents, p.upgradePoints,
      p.model, p.effort ?? "", JSON.stringify(p.pinnedModels ?? []), p.instructions, now());
    n += Number(r.changes);
  }
  return n;
}

/** Publishes a pack to the runtime, creating a new local version pinned to the agent version. */
export async function publishPack(slug: string): Promise<PackVersionRow> {
  const pack = getPack(slug);
  if (!pack) throw new Error(`no such pack: ${slug}`);
  const def: PackDefinition = {
    slug: pack.slug, name: pack.name, tagline: pack.tagline, author: pack.author,
    model: pack.model, effort: effortFor(pack.model, pack.effort),
    priceCents: pack.price_cents, upgradePoints: pack.upgrade_points,
    instructions: pack.instructions, pinnedModels: JSON.parse(pack.pinned_models),
  };
  const published = await runtime().publishPack(def);
  const prev = latestVersion(pack.id);
  const version = (prev?.version ?? 0) + 1;
  const vid = id("pv");
  getDb().prepare(`INSERT INTO pack_versions
    (id, pack_id, version, runtime_pack_id, runtime_version, instructions, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(vid, pack.id, version, published.runtimePackId, published.version, pack.instructions, now());
  return getVersion(vid)!;
}

export function entitled(orgId: string, packVersionId: string): boolean {
  const row = getDb().prepare("SELECT 1 AS ok FROM entitlements WHERE org_id = ? AND pack_version_id = ?")
    .get(orgId, packVersionId) as { ok?: number } | undefined;
  return Boolean(row?.ok);
}

export function grantEntitlement(orgId: string, packVersionId: string): void {
  getDb().prepare("INSERT OR IGNORE INTO entitlements (id, org_id, pack_version_id, acquired_at) VALUES (?, ?, ?, ?)")
    .run(id("ent"), orgId, packVersionId, now());
}

// ------------------------------------------------------------------- runs

export function activeRunCount(orgId: string): number {
  const row = getDb().prepare("SELECT COUNT(*) AS n FROM runs WHERE org_id = ? AND ended_at IS NULL")
    .get(orgId) as { n: number };
  return row.n;
}

export async function startRun(args: {
  orgId: string; userId: string; packVersionId: string; model?: string;
}): Promise<RunRow> {
  const db = getDb();
  const version = getVersion(args.packVersionId);
  if (!version) throw new Error("unknown pack version");
  const pack = db.prepare("SELECT * FROM packs WHERE id = ?").get(version.pack_id) as PackRow;

  const org = db.prepare("SELECT * FROM orgs WHERE id = ?").get(args.orgId) as { concurrency_limit: number };
  if (activeRunCount(args.orgId) >= org.concurrency_limit) {
    throw new Error(`concurrency limit reached (${org.concurrency_limit} running agents on this tier)`);
  }

  const pinned: string[] = JSON.parse(pack.pinned_models);
  const allowed = setting("allowed_models").split(",").map((s) => s.trim());
  const model = args.model ?? pack.model;
  if (!allowed.includes(model)) throw new Error(`model not permitted: ${model}`);
  if (pinned.length > 0 && !pinned.includes(model)) {
    throw new Error(`this pack's author restricted it to: ${pinned.join(", ")}`);
  }

  const budgetCents = settingInt("default_run_budget_cents");
  const session = await runtime().createSession({
    pack: { runtimePackId: version.runtime_pack_id, version: version.runtime_version },
    environmentId: await env(),
    budget: fromCents(BigInt(budgetCents)),
    title: `${pack.name} — ${args.orgId}`,
    // Only override when it actually differs: an override replaces the model
    // object wholesale, so a needless one would drop the pack's effort setting.
    ...(model !== pack.model ? { model, effort: effortFor(model, pack.effort) } : {}),
  });

  const runId = id("run");
  db.prepare(`INSERT INTO runs
    (id, org_id, user_id, pack_version_id, session_id, model, status, budget_cents, started_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(runId, args.orgId, args.userId, args.packVersionId, session.id, model, session.status, budgetCents, now());
  recordEvent(runId, "run.started", { session: session.id, model, budget_cents: budgetCents });
  return getRun(runId)!;
}

export function getRun(runId: string): RunRow | undefined {
  return getDb().prepare("SELECT * FROM runs WHERE id = ?").get(runId) as RunRow | undefined;
}

export function listRuns(orgId: string, limit = 30): RunRow[] {
  return getDb().prepare("SELECT * FROM runs WHERE org_id = ? ORDER BY started_at DESC LIMIT ?")
    .all(orgId, limit) as RunRow[];
}

export function recordEvent(runId: string, kind: string, payload: unknown): void {
  getDb().prepare("INSERT INTO run_events (run_id, kind, payload, created_at) VALUES (?, ?, ?, ?)")
    .run(runId, kind, JSON.stringify(payload ?? null), now());
}

export function runEvents(runId: string, afterId = 0): Array<{ id: number; kind: string; payload: string; created_at: string }> {
  return getDb().prepare("SELECT id, kind, payload, created_at FROM run_events WHERE run_id = ? AND id > ? ORDER BY id")
    .all(runId, afterId) as Array<{ id: number; kind: string; payload: string; created_at: string }>;
}

/** Runs whose event stream is currently being drained by an in-flight turn. */
const draining = new Set<string>();

export type AskRow = { event_id: string; run_id: string; name: string; input: string; decision: string | null; created_at: string };

export function openAsks(runId: string): AskRow[] {
  return getDb().prepare("SELECT * FROM pending_asks WHERE run_id = ? AND decision IS NULL ORDER BY created_at")
    .all(runId) as AskRow[];
}

function recordAsk(runId: string, a: PendingAsk): void {
  getDb().prepare(
    "INSERT OR IGNORE INTO pending_asks (event_id, run_id, name, input, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(a.eventId, runId, a.name, JSON.stringify(a.input ?? null), now());
}

/**
 * Persist what a turn reveals *as it arrives*, not when it finishes.
 *
 * Both halves of this matter. An approval recorded only at the end of a turn
 * can never be answered, because the turn cannot end until it is — a deadlock.
 * And token counts recorded only at the end mean the spend meter sits at zero
 * for the whole of a two-minute run.
 */
function observe(runId: string, e: RuntimeEvent): void {
  recordEvent(runId, e.type, e);
  if (e.type === "tool.use" && e.permission === "ask") {
    recordAsk(runId, { eventId: e.eventId, name: e.name, input: e.input });
  }
  if (e.type === "usage.snapshot") {
    // The platform's own cumulative figures, pushed mid-turn. Absolute, not
    // additive, and authoritative — we never sum per-request usage ourselves.
    getDb().prepare(`UPDATE runs SET input_tokens = ?, output_tokens = ?, active_seconds = ?,
      list_cost_cents = ?, budget_cents = COALESCE(?, budget_cents) WHERE id = ?`)
      .run(e.usage.inputTokens, e.usage.outputTokens, e.usage.activeSeconds,
        Number(cents(e.usage.listCost)), e.budget ? Number(cents(e.budget)) : null, runId);
  }
  if (e.type === "status") {
    getDb().prepare("UPDATE runs SET status = ?, stop_reason = ? WHERE id = ?")
      .run(e.status, e.stopReason, runId);
  }
}

/**
 * Turn the platform's own list_cost into a points debit and an author credit.
 *
 * Only the delta since the last reading is charged, so a run that is topped up,
 * resumed, or interrupted by an approval is never double-billed.
 */
function meter(runId: string, result: TurnResult): { billedCents: number; authorCents: number } {
  const db = getDb();
  const run = getRun(runId)!;
  const version = getVersion(run.pack_version_id)!;
  const { session } = result;

  // Charge the gap between what the run has cost and what has been charged, so
  // a turn interrupted by an approval or a top-up is never billed twice.
  const costCents = Math.max(Number(cents(session.usage.listCost)), run.list_cost_cents);
  const delta = Math.max(0, costCents - run.billed_up_to_cents);
  const billed = debit(run.org_id, delta, "agent run", runId);
  const authorMilli = creditAuthor(version.pack_id, runId, delta);

  db.prepare(`UPDATE runs SET status = ?, stop_reason = ?, input_tokens = ?, output_tokens = ?,
    active_seconds = ?, list_cost_cents = ?, billed_up_to_cents = ?, billed_cents = billed_cents + ? WHERE id = ?`)
    .run(session.status, session.stopReason, session.usage.inputTokens, session.usage.outputTokens,
      session.usage.activeSeconds, costCents, costCents, billed, runId);

  for (const a of result.pendingAsks) recordAsk(runId, a);
  recordEvent(runId, "run.metered", {
    list_cost_cents: costCents, delta_cents: delta, billed_cents: billed,
    author_millicents: authorMilli, input_tokens: session.usage.inputTokens,
    output_tokens: session.usage.outputTokens, active_seconds: session.usage.activeSeconds,
  });
  return { billedCents: billed, authorCents: authorMilli };
}

function onBudgetExhausted(runId: string, err: unknown): boolean {
  if (!(err instanceof BudgetExhaustedError)) return false;
  getDb().prepare("UPDATE runs SET stop_reason = 'budget_reached' WHERE id = ?").run(runId);
  recordEvent(runId, "run.budget_reached", { note: "detected from the 400 on event submission" });
  return true;
}

export async function sendTurn(runId: string, text: string, onEvent?: (e: RuntimeEvent) => void): Promise<{
  run: RunRow; exhausted: boolean; billedCents: number; authorCents: number;
}> {
  const run = getRun(runId);
  if (!run) throw new Error("unknown run");
  recordEvent(runId, "user.message", { text });
  draining.add(runId);
  try {
    const result = await runTurn(runtime(), run.session_id, text, (e) => {
      observe(runId, e); onEvent?.(e);
    });
    const { billedCents, authorCents } = meter(runId, result);
    return { run: getRun(runId)!, exhausted: false, billedCents, authorCents };
  } catch (err) {
    if (onBudgetExhausted(runId, err)) {
      return { run: getRun(runId)!, exhausted: true, billedCents: 0, authorCents: 0 };
    }
    recordEvent(runId, "run.error", { message: String((err as Error)?.message ?? err) });
    throw err;
  } finally {
    draining.delete(runId);
  }
}

/**
 * Answer a tool call that paused, then carry the turn on.
 *
 * A pack's destructive tools are set to always_ask precisely so that a human
 * sees the command before it runs; this is where that promise is kept.
 */
export async function decide(
  runId: string, eventId: string, allow: boolean, denyMessage?: string,
  onEvent?: (e: RuntimeEvent) => void,
): Promise<RunRow> {
  const run = getRun(runId);
  if (!run) throw new Error("unknown run");
  const ask = getDb().prepare("SELECT * FROM pending_asks WHERE event_id = ? AND run_id = ?")
    .get(eventId, runId) as AskRow | undefined;
  if (!ask) throw new Error("no such pending approval");

  getDb().prepare("UPDATE pending_asks SET decision = ?, decided_at = ? WHERE event_id = ?")
    .run(allow ? "allow" : "deny", now(), eventId);
  recordEvent(runId, "user.decision", { event_id: eventId, name: ask.name, result: allow ? "allow" : "deny", deny_message: denyMessage ?? null });

  const confirm = () => runtime().confirmTool(run.session_id, eventId, allow ? "allow" : "deny", denyMessage);
  try {
    if (draining.has(runId)) {
      // A turn is still listening on this session: confirming is enough, and
      // opening a second stream would duplicate every subsequent event.
      await confirm();
      return getRun(runId)!;
    }
    draining.add(runId);
    const result = await resumeAfterDecision(runtime(), run.session_id, confirm,
      (e) => { observe(runId, e); onEvent?.(e); });
    meter(runId, result);
  } catch (err) {
    if (!onBudgetExhausted(runId, err)) {
      recordEvent(runId, "run.error", { message: String((err as Error)?.message ?? err) });
    }
  } finally {
    draining.delete(runId);
  }
  return getRun(runId)!;
}

/** Raises a capped run's budget so it resumes in the same session. */
export async function topUp(runId: string): Promise<RunRow> {
  const run = getRun(runId);
  if (!run) throw new Error("unknown run");
  const headroom = BigInt(settingInt("topup_headroom_cents"));
  const session = await runtime().raiseBudgetTo(run.session_id, headroom);
  getDb().prepare("UPDATE runs SET budget_cents = ?, stop_reason = NULL, status = ? WHERE id = ?")
    .run(run.list_cost_cents + Number(headroom), session.status, runId);
  recordEvent(runId, "run.topped_up", { headroom_cents: Number(headroom) });
  return getRun(runId)!;
}

export async function endRun(runId: string): Promise<void> {
  const run = getRun(runId);
  if (!run) return;
  await runtime().deleteSession(run.session_id).catch(() => {});
  getDb().prepare("UPDATE runs SET ended_at = ?, status = 'terminated' WHERE id = ?").run(now(), runId);
  recordEvent(runId, "run.ended", {});
}
