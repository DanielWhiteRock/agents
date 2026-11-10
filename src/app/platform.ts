/**
 * The service layer: everything above the runtime interface.
 *
 * It owns packs, runs, the transcript, and the metering that turns a run's
 * list_cost into a points debit and an author credit.
 */
import Anthropic from "@anthropic-ai/sdk";
import { id, initDb, now, platformOrgId, setting, settingInt } from "./db.js";
import { sql } from "./sql.js";
import { balanceCents, credit, creditAuthor, debit } from "../billing/points.js";
import { ManagedAgentsRuntime } from "../runtime/managed-agents.js";
import { resumeAfterDecision, runTurn, type TurnResult } from "../runtime/run.js";
import { cents, fromCents } from "../runtime/money.js";
import { BudgetExhaustedError, type AgentRuntime, type PendingAsk, type RuntimeEvent } from "../runtime/types.js";
import { DomainError } from "./errors.js";
import type { PackDefinition } from "../packs/types.js";
import { SEED_PACKS } from "../packs/seed-packs.js";
import { redactStoredPayload } from "../transcripts/redact.js";
import { exportPackMarkdown } from "../packs/export.js";
import {
  type PackTree, assertWithinLimits, checkSkills, findCommands, findDocs, findHooks, findWorkflows,
  mountableFiles, normaliseTree, readFrontMatterMeta, validateTree,
} from "../packs/tree.js";
import { PACK_MOUNT } from "../runtime/managed-agents.js";
import type { FolderBrief } from "../packs/wrapper.js";
import type { MountedFile } from "../runtime/types.js";

export type PackRow = {
  id: string; slug: string; name: string; tagline: string; author: string; author_org_id: string | null;
  price_cents: number; upgrade_points: number; model: string; effort: string;
  pinned_models: string; instructions: string; status: string;
  author_payout_email: string | null; created_at: string;
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
  is_trial: number; turn_count: number;
  started_at: string; ended_at: string | null;
};
export type AskRow = {
  event_id: string; run_id: string; name: string; input: string;
  decision: string | null; created_at: string;
};

// ----------------------------------------------------------------- runtime

let runtimeSingleton: AgentRuntime | null = null;
export function runtime(): AgentRuntime {
  if (!runtimeSingleton) runtimeSingleton = new ManagedAgentsRuntime(new Anthropic() as never);
  return runtimeSingleton;
}
export function setRuntime(r: AgentRuntime): void { runtimeSingleton = r; }

let environmentId: string | null = null;
async function env(): Promise<string> {
  if (!environmentId) environmentId = await runtime().ensureEnvironment(await setting("environment_name"));
  return environmentId;
}

/** Runs whose event stream is currently being drained by an in-flight turn. */
const draining = new Set<string>();

/**
 * Transcript writes are now asynchronous, but a transcript out of order is
 * useless as evidence — so each run gets a serial chain and events are written
 * strictly in arrival order.
 */
const writeChains = new Map<string, Promise<void>>();

function serial(runId: string, work: () => Promise<void>): void {
  const prev = writeChains.get(runId) ?? Promise.resolve();
  writeChains.set(runId, prev.catch(() => {}).then(work).catch((e) => {
    console.error("[transcript]", (e as Error)?.message ?? e);
  }));
}

/** Wait for every queued write for this run to land. */
export async function flushWrites(runId: string): Promise<void> {
  await (writeChains.get(runId) ?? Promise.resolve());
}

// --------------------------------------------------------------- bootstrap

export async function ensureDemoOrg(): Promise<{ orgId: string; userId: string }> {
  await initDb();
  const s = await sql();
  const existing = await s.one<{ id: string }>("SELECT id FROM orgs ORDER BY created_at LIMIT 1");
  if (existing) {
    const u = await s.one<{ id: string }>("SELECT id FROM users WHERE org_id = $1 LIMIT 1", [existing.id]);
    return { orgId: existing.id, userId: u!.id };
  }
  const orgId = id("org"), userId = id("usr"), tier = "team";
  await s.query("INSERT INTO orgs (id, name, tier, concurrency_limit, created_at) VALUES ($1, $2, $3, $4, $5)",
    [orgId, "alphaCEO (demo)", tier, await settingInt(`tier.${tier}.concurrency`), now()]);
  await s.query("INSERT INTO users (id, org_id, email, name, role, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
    [userId, orgId, "dflopi@gmail.com", "Daniel", "owner", now()]);
  // The monthly grant expires; top-ups and earnings do not.
  await credit(orgId, "grant", await settingInt(`tier.${tier}.points_cents`), `${tier} monthly grant`,
    new Date(Date.now() + 30 * 86400_000).toISOString());
  await credit(orgId, "topup", 500, "launch credit so the demo can actually run");
  return { orgId, userId };
}

// ------------------------------------------------------------------- packs

export async function listPacks(): Promise<PackRow[]> {
  const s = await sql();
  return s.query<PackRow>("SELECT * FROM packs WHERE status = 'listed' ORDER BY price_cents DESC");
}
export async function getPack(slug: string): Promise<PackRow | undefined> {
  const s = await sql();
  return s.one<PackRow>("SELECT * FROM packs WHERE slug = $1", [slug]);
}
export async function packById(packId: string): Promise<PackRow | undefined> {
  const s = await sql();
  return s.one<PackRow>("SELECT * FROM packs WHERE id = $1", [packId]);
}
export async function latestVersion(packId: string): Promise<PackVersionRow | undefined> {
  const s = await sql();
  return s.one<PackVersionRow>("SELECT * FROM pack_versions WHERE pack_id = $1 ORDER BY version DESC LIMIT 1", [packId]);
}
export async function getVersion(versionId: string): Promise<PackVersionRow | undefined> {
  const s = await sql();
  return s.one<PackVersionRow>("SELECT * FROM pack_versions WHERE id = $1", [versionId]);
}

/** Some models reject `effort` entirely, so it is a capability, not a default. */
export type DestructivePolicy = "always_ask" | "always_allow" | "auto";

/** Platform-wide posture for tools that change the world. A settings row. */
export async function destructivePolicy(): Promise<DestructivePolicy> {
  const raw = await setting("destructive_tool_policy");
  return raw === "always_ask" || raw === "auto" ? raw : "always_allow";
}

export async function effortFor(model: string, effort: string | null | undefined): Promise<PackDefinition["effort"] | undefined> {
  if (!effort) return undefined;
  const excluded = (await setting("models_without_effort")).split(",").map((x) => x.trim());
  return excluded.includes(model) ? undefined : (effort as PackDefinition["effort"]);
}

export async function seedCatalog(): Promise<number> {
  const s = await sql();
  let n = 0;
  for (const p of SEED_PACKS) {
    const rows = await s.query(
      `INSERT INTO packs (id, slug, name, tagline, author, price_cents, upgrade_points, model, effort,
         pinned_models, instructions, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'listed',$12)
       ON CONFLICT (slug) DO NOTHING RETURNING id`,
      [id("pk"), p.slug, p.name, p.tagline, p.author, p.priceCents, p.upgradePoints, p.model,
        p.effort ?? "", JSON.stringify(p.pinnedModels ?? []), p.instructions, now()]);
    n += rows.length;
  }
  return n;
}

/** Publishes to the runtime, creating a local version pinned to the agent version. */
export async function publishPack(slug: string): Promise<PackVersionRow> {
  const pack = await getPack(slug);
  if (!pack) throw new Error(`no such pack: ${slug}`);
  const def: PackDefinition = {
    slug: pack.slug, name: pack.name, tagline: pack.tagline, author: pack.author,
    model: pack.model, effort: await effortFor(pack.model, pack.effort),
    priceCents: pack.price_cents, upgradePoints: pack.upgrade_points,
    instructions: pack.instructions, pinnedModels: JSON.parse(pack.pinned_models),
    destructivePolicy: await destructivePolicy(),
  };
  // The folder, if the author uploaded one. Its skills/ become real platform
  // skills; a pack with no folder still publishes from its instructions alone.
  const tree = await packTree(pack.id);
  const parsed = tree.length > 0 ? validateTree(tree) : null;
  const skills = parsed?.skills ?? [];
  const subagents = (parsed?.subagents ?? []).map((sa) => {
    const meta = readFrontMatterMeta(sa.file.content);
    const body = sa.file.content.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
    return {
      name: meta.name ?? sa.name,
      ...(meta.description ? { description: meta.description } : {}),
      system: body || `You are the ${sa.name} specialist for ${pack.name}.`,
    };
  });

  // Everything that is not a skill is uploaded and mounted, so commands,
  // hooks, workflows and docs are actually on the machine.
  const toMount = tree.length > 0 ? mountableFiles(tree) : [];

  const published = await runtime().publishPack(
    { ...def, folder: tree.length > 0 ? folderBrief(tree) : undefined },
    skills.map((sk) => ({ name: sk.name, files: sk.files.map((f) => ({ path: f.path, content: f.content })) })),
    subagents,
    toMount,
  );

  const prev = await latestVersion(pack.id);
  const vid = id("pv");
  const s = await sql();
  await s.query(
    `INSERT INTO pack_versions (id, pack_id, version, runtime_pack_id, runtime_version, instructions, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [vid, pack.id, (prev?.version ?? 0) + 1, published.runtimePackId, published.version, pack.instructions, now()]);
  // Snapshot the folder and the uploaded skills, so a buyer exports what they
  // bought however the author edits it afterwards.
  for (const f of tree) {
    await s.query("INSERT INTO pack_version_files (pack_version_id, path, content) VALUES ($1,$2,$3)",
      [vid, f.path, f.content]);
  }
  for (const sk of published.skills ?? []) {
    await s.query(
      "INSERT INTO pack_version_skills (pack_version_id, name, skill_id, skill_version) VALUES ($1,$2,$3,$4)",
      [vid, sk.name, sk.skillId, sk.skillVersion]);
  }
  for (const m of published.mounts ?? []) {
    await s.query(
      "INSERT INTO pack_version_mounts (pack_version_id, path, file_id, mount_path) VALUES ($1,$2,$3,$4)",
      [vid, m.path, m.fileId, m.mountPath]);
  }
  for (const sa of published.subagents ?? []) {
    await s.query(
      "INSERT INTO pack_version_skills (pack_version_id, name, skill_id, skill_version) VALUES ($1,$2,$3,$4)",
      [vid, `agent:${sa.name}`, sa.agentId, sa.version]);
  }
  return (await getVersion(vid))!;
}

// ------------------------------------------------------------- pack folders

export async function packTree(packId: string): Promise<PackTree> {
  const s = await sql();
  return s.query<{ path: string; content: string }>(
    "SELECT path, content FROM pack_files WHERE pack_id = $1 ORDER BY path", [packId]);
}

export async function versionTree(packVersionId: string): Promise<PackTree> {
  const s = await sql();
  return s.query<{ path: string; content: string }>(
    "SELECT path, content FROM pack_version_files WHERE pack_version_id = $1 ORDER BY path", [packVersionId]);
}

/** Replace a pack's folder wholesale, after checking it is publishable. */
export async function savePackTree(packId: string, files: PackTree): Promise<{
  warnings: ReturnType<typeof checkSkills>["warnings"];
}> {
  const tree = normaliseTree(files);
  assertWithinLimits(tree);
  const { skills } = validateTree(tree);
  const check = checkSkills(skills);
  if (check.errors.length > 0) {
    throw new PackTreeRejected(check.errors.map((e) => `${e.skill}/${e.file}: ${e.message}`));
  }
  const s = await sql();
  await s.query("DELETE FROM pack_files WHERE pack_id = $1", [packId]);
  for (const f of tree) {
    await s.query("INSERT INTO pack_files (pack_id, path, content) VALUES ($1,$2,$3)", [packId, f.path, f.content]);
  }
  return { warnings: check.warnings };
}

export class PackTreeRejected extends DomainError {
  constructor(readonly problems: string[]) {
    super(`that pack is not publishable yet:\n- ${problems.join("\n- ")}`, 409, "PackTreeRejected");
  }
}

export async function versionMounts(packVersionId: string): Promise<MountedFile[]> {
  const s = await sql();
  const rows = await s.query<{ path: string; file_id: string; mount_path: string }>(
    "SELECT path, file_id, mount_path FROM pack_version_mounts WHERE pack_version_id = $1 ORDER BY path",
    [packVersionId]);
  return rows.map((r) => ({ path: r.path, fileId: r.file_id, mountPath: r.mount_path }));
}

/** What this pack brought beyond its skills, for the agent's own briefing. */
export function folderBrief(tree: PackTree): FolderBrief {
  return {
    root: PACK_MOUNT,
    commands: findCommands(tree),
    hooks: findHooks(tree),
    workflows: findWorkflows(tree),
    docs: findDocs(tree),
  };
}

export async function versionSkills(packVersionId: string): Promise<Array<{
  name: string; skill_id: string; skill_version: string;
}>> {
  const s = await sql();
  return s.query("SELECT name, skill_id, skill_version FROM pack_version_skills WHERE pack_version_id = $1 ORDER BY name",
    [packVersionId]);
}

export async function entitled(orgId: string, packVersionId: string): Promise<boolean> {
  const s = await sql();
  const row = await s.one("SELECT 1 AS ok FROM entitlements WHERE org_id = $1 AND pack_version_id = $2",
    [orgId, packVersionId]);
  return Boolean(row);
}

/** Thrown when a run is attempted on a pack the organisation does not own. */
/** Thrown when an organisation has no compute left to spend. */
export class OutOfPointsError extends DomainError {
  constructor() {
    // 402: the request is fine, there is simply nothing left to spend.
    super("no points left — buy more compute to keep running agents", 402, "OutOfPointsError");
  }
}

export class NotEntitledError extends DomainError {
  constructor() {
    super("this organisation does not own that pack version", 403, "NotEntitledError");
  }
}

/** Thrown when a trial has used up its turns. */
export class TrialExhaustedError extends DomainError {
  constructor(turns: number) {
    super(`a trial is ${turns} turns; buy the pack to keep going`, 409, "TrialExhaustedError");
  }
}

export class TrialAlreadyUsedError extends DomainError {
  constructor() {
    super("this organisation has already tried that pack", 409, "TrialAlreadyUsedError");
  }
}

/**
 * Checked here rather than only at the route, so a refund, a revoked
 * entitlement or a new code path cannot quietly let a run continue on a pack
 * nobody owns.
 */
export async function assertEntitled(orgId: string, packVersionId: string): Promise<void> {
  if (!(await entitled(orgId, packVersionId))) throw new NotEntitledError();
}

export async function grantEntitlement(orgId: string, packVersionId: string): Promise<void> {
  const s = await sql();
  await s.query(
    `INSERT INTO entitlements (id, org_id, pack_version_id, acquired_at) VALUES ($1,$2,$3,$4)
     ON CONFLICT (org_id, pack_version_id) DO NOTHING`,
    [id("ent"), orgId, packVersionId, now()]);
}

// -------------------------------------------------------------------- runs

export async function activeRunCount(orgId: string): Promise<number> {
  const s = await sql();
  const row = await s.one<{ n: unknown }>(
    "SELECT COUNT(*) AS n FROM runs WHERE org_id = $1 AND ended_at IS NULL", [orgId]);
  return Number(row?.n ?? 0);
}

export async function startRun(args: {
  orgId: string; userId: string; packVersionId: string; model?: string;
  /** A capped run on a pack this organisation does not own. */
  trial?: boolean;
}): Promise<RunRow> {
  const s = await sql();
  const version = await getVersion(args.packVersionId);
  if (!version) throw new Error("unknown pack version");
  const pack = (await packById(version.pack_id))!;

  if (args.trial) {
    if (await entitled(args.orgId, args.packVersionId)) {
      // Owning it is better than trying it; fall through as a normal run.
      args.trial = false;
    } else if (await hasTriedPack(args.orgId, version.pack_id)) {
      throw new TrialAlreadyUsedError();
    }
  }
  if (!args.trial) await assertEntitled(args.orgId, args.packVersionId);
  // Points are the fuel. Starting a run with an empty balance would make the
  // subsidy unbounded, so it is refused rather than quietly absorbed.
  if ((await balanceCents(args.orgId)) <= 0) throw new OutOfPointsError();

  const org = await s.one<{ concurrency_limit: number }>("SELECT * FROM orgs WHERE id = $1", [args.orgId]);
  if ((await activeRunCount(args.orgId)) >= Number(org!.concurrency_limit)) {
    throw new Error(`concurrency limit reached (${org!.concurrency_limit} running agents on this tier)`);
  }

  const pinned: string[] = JSON.parse(pack.pinned_models);
  const allowed = (await setting("allowed_models")).split(",").map((x) => x.trim());
  const model = args.model ?? pack.model;
  if (!allowed.includes(model)) throw new Error(`model not permitted: ${model}`);
  if (pinned.length > 0 && !pinned.includes(model)) {
    throw new Error(`this pack's author restricted it to: ${pinned.join(", ")}`);
  }

  const budgetCents = await settingInt(args.trial ? "trial_budget_cents" : "default_run_budget_cents");
  const effort = await effortFor(model, pack.effort);
  const mounts = await versionMounts(version.id);
  const session = await runtime().createSession({
    pack: { runtimePackId: version.runtime_pack_id, version: version.runtime_version },
    environmentId: await env(),
    ...(mounts.length > 0 ? { mounts } : {}),
    budget: fromCents(BigInt(budgetCents)),
    title: `${pack.name} — ${args.orgId}`,
    // Only override when it differs: an override replaces the model object in
    // full, so a needless one would drop the pack's own effort setting.
    ...(model !== pack.model ? { model, ...(effort ? { effort } : {}) } : {}),
  });

  const runId = id("run");
  await s.query(
    `INSERT INTO runs (id, org_id, user_id, pack_version_id, session_id, model, status, budget_cents, is_trial, started_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [runId, args.orgId, args.userId, version.id, session.id, model, session.status, budgetCents,
      args.trial ? 1 : 0, now()]);
  await recordEvent(runId, "run.started", {
    session: session.id, model, budget_cents: budgetCents, trial: Boolean(args.trial),
  });
  return (await getRun(runId))!;
}

export async function getRun(runId: string): Promise<RunRow | undefined> {
  const s = await sql();
  return s.one<RunRow>("SELECT * FROM runs WHERE id = $1", [runId]);
}

export async function listRuns(orgId: string, limit = 30): Promise<RunRow[]> {
  const s = await sql();
  return s.query<RunRow>("SELECT * FROM runs WHERE org_id = $1 ORDER BY started_at DESC LIMIT $2", [orgId, limit]);
}

export async function recordEvent(runId: string, kind: string, payload: unknown): Promise<void> {
  const s = await sql();
  await s.query("INSERT INTO run_events (run_id, kind, payload, created_at) VALUES ($1,$2,$3,$4)",
    [runId, kind, JSON.stringify(payload ?? null), now()]);
}

export async function runEvents(runId: string, afterId = 0): Promise<Array<{
  id: number; kind: string; payload: string; created_at: string;
}>> {
  const s = await sql();
  const rows = await s.query<{ id: unknown; kind: string; payload: string; created_at: string }>(
    "SELECT id, kind, payload, created_at FROM run_events WHERE run_id = $1 AND id > $2 ORDER BY id", [runId, afterId]);
  return rows.map((r) => ({ ...r, id: Number(r.id) }));
}

/**
 * The transcript as a buyer may see it.
 *
 * Everything buyer-facing goes through here. The raw rows stay in the database
 * for the author and the platform; what leaves the server is redacted against
 * the exact instructions of the pack version this run is pinned to.
 */
export async function buyerEvents(runId: string, afterId = 0): Promise<Array<{
  id: number; kind: string; payload: string; created_at: string;
}>> {
  return transcriptFor(runId, null, afterId);
}

/**
 * The transcript as a given viewer may see it.
 *
 * The author of a pack sees their own runs raw — that is their feedback channel
 * and the whole reason the design keeps transcripts at all. Everyone else gets
 * it redacted against the exact instructions of the pinned version.
 */
export async function transcriptFor(
  runId: string, viewerOrgId: string | null, afterId = 0,
): Promise<Array<{ id: number; kind: string; payload: string; created_at: string }>> {
  const rows = await runEvents(runId, afterId);
  if (rows.length === 0) return rows;
  const run = await getRun(runId);
  const version = run ? await getVersion(run.pack_version_id) : undefined;
  if (!version) return rows;
  const pack = await packById(version.pack_id);
  if (viewerOrgId && pack?.author_org_id && pack.author_org_id === viewerOrgId) return rows;
  return rows.map((r) => ({ ...r, payload: redactStoredPayload(r.kind, r.payload, version.instructions) }));
}

export async function openAsks(runId: string): Promise<AskRow[]> {
  const s = await sql();
  return s.query<AskRow>(
    "SELECT * FROM pending_asks WHERE run_id = $1 AND decision IS NULL ORDER BY created_at", [runId]);
}

async function recordAsk(runId: string, a: PendingAsk): Promise<void> {
  const s = await sql();
  await s.query(
    `INSERT INTO pending_asks (event_id, run_id, name, input, created_at) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (event_id) DO NOTHING`,
    [a.eventId, runId, a.name, JSON.stringify(a.input ?? null), now()]);
}

/**
 * Persist what a turn reveals *as it arrives*, not when it finishes.
 *
 * Both halves matter. An approval recorded only at the end of a turn can never
 * be answered, because the turn cannot end until it is — a deadlock. And token
 * counts recorded only at the end leave the spend meter at zero for the whole
 * of a two-minute run.
 */
function observe(runId: string, e: RuntimeEvent): void {
  serial(runId, async () => {
    const s = await sql();
    await recordEvent(runId, e.type, e);
    if (e.type === "tool.use" && e.permission === "ask") {
      await recordAsk(runId, { eventId: e.eventId, name: e.name, input: e.input });
    }
    if (e.type === "usage.snapshot") {
      // The platform's own cumulative figures, pushed mid-turn: absolute, not
      // additive, and authoritative. We never sum per-request usage ourselves.
      await s.query(
        `UPDATE runs SET input_tokens = $1, output_tokens = $2, active_seconds = $3,
           list_cost_cents = $4, budget_cents = COALESCE($5, budget_cents) WHERE id = $6`,
        [e.usage.inputTokens, e.usage.outputTokens, e.usage.activeSeconds,
          Number(cents(e.usage.listCost)), e.budget ? Number(cents(e.budget)) : null, runId]);
    }
    if (e.type === "status") {
      await s.query("UPDATE runs SET status = $1, stop_reason = $2 WHERE id = $3", [e.status, e.stopReason, runId]);
    }
  });
}

/**
 * Turn the platform's own list_cost into a points debit and an author credit.
 *
 * Charges the gap between what the run has cost and what has been charged, so
 * a turn interrupted by an approval or resumed after a top-up is never billed
 * twice.
 */
async function meter(runId: string, result: TurnResult): Promise<{ billedCents: number; authorCents: number }> {
  await flushWrites(runId);
  const s = await sql();
  const run = (await getRun(runId))!;
  const version = (await getVersion(run.pack_version_id))!;
  const { session } = result;

  const costCents = Math.max(Number(cents(session.usage.listCost)), run.list_cost_cents);
  const delta = Math.max(0, costCents - run.billed_up_to_cents);
  const billed = await debit(run.org_id, delta, "agent run", runId);
  // The author is credited on the work done, not on what we managed to collect:
  // if a balance ran dry mid-turn the platform ate the difference, which is the
  // subsidy the owner chose, not the author's problem.
  const authorMilli = await creditAuthor(version.pack_id, runId, delta);

  // The session object reports stop_reason as null even at its cap, while the
  // event stream says budget_reached. Taking the session's null here would wipe
  // the one signal the UI needs to offer a top-up, so a reason already recorded
  // from the stream wins over an empty one.
  const stopReason = session.stopReason ?? run.stop_reason;

  await s.query(
    `UPDATE runs SET status = $1, stop_reason = $2, input_tokens = $3, output_tokens = $4,
       active_seconds = $5, list_cost_cents = $6, billed_up_to_cents = $7,
       billed_cents = billed_cents + $8 WHERE id = $9`,
    [session.status, stopReason, session.usage.inputTokens, session.usage.outputTokens,
      session.usage.activeSeconds, costCents, costCents, billed, runId]);

  for (const a of result.pendingAsks) await recordAsk(runId, a);
  await recordEvent(runId, "run.metered", {
    list_cost_cents: costCents, delta_cents: delta, billed_cents: billed,
    author_millicents: authorMilli, input_tokens: session.usage.inputTokens,
    output_tokens: session.usage.outputTokens, active_seconds: session.usage.activeSeconds,
  });
  return { billedCents: billed, authorCents: authorMilli };
}

async function onBudgetExhausted(runId: string, err: unknown): Promise<boolean> {
  if (!(err instanceof BudgetExhaustedError)) return false;
  const s = await sql();
  await s.query("UPDATE runs SET stop_reason = 'budget_reached' WHERE id = $1", [runId]);
  await recordEvent(runId, "run.budget_reached", { note: "detected from the 400 on event submission" });
  return true;
}

export async function sendTurn(runId: string, text: string, onEvent?: (e: RuntimeEvent) => void): Promise<{
  run: RunRow; exhausted: boolean; billedCents: number; authorCents: number;
}> {
  const run = await getRun(runId);
  if (!run) throw new Error("unknown run");
  if (run.is_trial) {
    const cap = await settingInt("trial_turns");
    if (run.turn_count >= cap) throw new TrialExhaustedError(cap);
  } else {
    // A refund revokes the entitlement; the run must not keep working afterwards.
    await assertEntitled(run.org_id, run.pack_version_id);
  }
  if ((await balanceCents(run.org_id)) <= 0) throw new OutOfPointsError();
  const s0 = await sql();
  await s0.query("UPDATE runs SET turn_count = turn_count + 1 WHERE id = $1", [runId]);
  await recordEvent(runId, "user.message", { text });
  draining.add(runId);
  try {
    const result = await runTurn(runtime(), run.session_id, text, (e) => { observe(runId, e); onEvent?.(e); });
    const { billedCents, authorCents } = await meter(runId, result);
    return { run: (await getRun(runId))!, exhausted: false, billedCents, authorCents };
  } catch (err) {
    if (await onBudgetExhausted(runId, err)) {
      return { run: (await getRun(runId))!, exhausted: true, billedCents: 0, authorCents: 0 };
    }
    await recordEvent(runId, "run.error", { message: String((err as Error)?.message ?? err) });
    throw err;
  } finally {
    draining.delete(runId);
  }
}

/**
 * Answer a tool call that paused, then carry the turn on. A pack's destructive
 * tools are always_ask precisely so a human sees the command first; this is
 * where that promise is kept.
 */
export async function decide(
  runId: string, eventId: string, allow: boolean, denyMessage?: string,
  onEvent?: (e: RuntimeEvent) => void,
): Promise<RunRow> {
  const run = await getRun(runId);
  if (!run) throw new Error("unknown run");
  if (!run.is_trial) await assertEntitled(run.org_id, run.pack_version_id);
  const s = await sql();
  const ask = await s.one<AskRow>("SELECT * FROM pending_asks WHERE event_id = $1 AND run_id = $2", [eventId, runId]);
  if (!ask) throw new Error("no such pending approval");

  await s.query("UPDATE pending_asks SET decision = $1, decided_at = $2 WHERE event_id = $3",
    [allow ? "allow" : "deny", now(), eventId]);
  await recordEvent(runId, "user.decision", {
    event_id: eventId, name: ask.name, result: allow ? "allow" : "deny", deny_message: denyMessage ?? null,
  });

  const confirm = () => runtime().confirmTool(run.session_id, eventId, allow ? "allow" : "deny", denyMessage);
  try {
    if (draining.has(runId)) {
      // A turn is still listening on this session: confirming is enough, and a
      // second stream would duplicate every subsequent event.
      await confirm();
      return (await getRun(runId))!;
    }
    draining.add(runId);
    const result = await resumeAfterDecision(runtime(), run.session_id, confirm,
      (e) => { observe(runId, e); onEvent?.(e); });
    await meter(runId, result);
  } catch (err) {
    if (!(await onBudgetExhausted(runId, err))) {
      await recordEvent(runId, "run.error", { message: String((err as Error)?.message ?? err) });
    }
  } finally {
    draining.delete(runId);
  }
  return (await getRun(runId))!;
}

/** Raises a capped run's budget so it resumes in the same session. */
export async function topUp(runId: string): Promise<RunRow> {
  const run = await getRun(runId);
  if (!run) throw new Error("unknown run");
  if (run.is_trial) throw new TrialExhaustedError(await settingInt("trial_turns"));
  await assertEntitled(run.org_id, run.pack_version_id);
  const headroom = BigInt(await settingInt("topup_headroom_cents"));
  const session = await runtime().raiseBudgetTo(run.session_id, headroom);
  const s = await sql();
  await s.query("UPDATE runs SET budget_cents = $1, stop_reason = NULL, status = $2 WHERE id = $3",
    [run.list_cost_cents + Number(headroom), session.status, runId]);
  await recordEvent(runId, "run.topped_up", { headroom_cents: Number(headroom) });
  return (await getRun(runId))!;
}

/**
 * Who may take a copy of a pack: anyone who bought it, the organisation that
 * wrote it, and the curator. An author being unable to pull back their own work
 * would make the folder a one-way trip.
 */
export async function assertMayExport(orgId: string, pack: PackRow, packVersionId: string): Promise<void> {
  if (pack.author_org_id === orgId) return;
  if ((await platformOrgId()) === orgId) return;
  await assertEntitled(orgId, packVersionId);
}

/**
 * A pack as a file its owner can run themselves.
 *
 * This is the one path that hands over the author's instructions — which is
 * exactly what authors are told plainly can happen, rather than promised
 * against.
 */
/**
 * A bought pack as a folder.
 *
 * The version's own snapshot, so a buyer gets what they bought however the
 * author edits it afterwards. A pack with no uploaded folder still exports as a
 * single agent.md, which is what every pack written in the browser is.
 */
export async function exportPackTree(orgId: string, slug: string): Promise<PackTree> {
  const pack = await getPack(slug);
  if (!pack) throw new Error(`no such pack: ${slug}`);
  const version = await latestVersion(pack.id);
  if (!version) throw new Error(`${pack.name} has not been published yet`);
  await assertMayExport(orgId, pack, version.id);

  const snapshot = await versionTree(version.id);
  const isAuthor = pack.author_org_id === orgId || (await platformOrgId()) === orgId;

  // The author gets their own agent.md back, byte for byte, so a pull then a
  // sync is a no-op and `status` tells the truth. A buyer gets it regenerated,
  // carrying the platform wrapper and the licence notice — that is the file
  // they should actually run.
  const definition = isAuthor
    ? snapshot.find((f) => f.path.toLowerCase() === "agent.md" || f.path.toLowerCase() === "pack.md")?.content
      ?? (await exportPack(orgId, slug))
    : await exportPack(orgId, slug);

  if (snapshot.length === 0) return [{ path: "agent.md", content: definition }];
  return [
    { path: "agent.md", content: definition },
    ...snapshot.filter((f) => f.path.toLowerCase() !== "agent.md" && f.path.toLowerCase() !== "pack.md"),
  ].sort((a, b) => a.path.localeCompare(b.path));
}

export async function exportPack(orgId: string, slug: string): Promise<string> {
  const pack = await getPack(slug);
  if (!pack) throw new Error(`no such pack: ${slug}`);
  const version = await latestVersion(pack.id);
  if (!version) throw new Error(`${pack.name} has not been published yet`);
  await assertMayExport(orgId, pack, version.id);
  return exportPackMarkdown({
    slug: pack.slug, name: pack.name, tagline: pack.tagline, author: pack.author,
    model: pack.model, effort: await effortFor(pack.model, pack.effort),
    priceCents: pack.price_cents, upgradePoints: pack.upgrade_points,
    // The version's own instructions, not the pack's current ones: a buyer gets
    // what they bought, even after the author ships a newer version.
    instructions: version.instructions,
    pinnedModels: JSON.parse(pack.pinned_models),
  }, version.version);
}

/** Has this organisation already spent its one trial on this pack? */
export async function hasTriedPack(orgId: string, packId: string): Promise<boolean> {
  const s = await sql();
  const row = await s.one(
    `SELECT 1 AS ok FROM runs r JOIN pack_versions pv ON pv.id = r.pack_version_id
     WHERE r.org_id = $1 AND pv.pack_id = $2 AND r.is_trial = 1 LIMIT 1`, [orgId, packId]);
  return Boolean(row);
}

/** Every run on a pack version that is still open. Used when a refund lands. */
export async function endRunsFor(orgId: string, packVersionId: string): Promise<number> {
  const s = await sql();
  const rows = await s.query<{ id: string }>(
    "SELECT id FROM runs WHERE org_id = $1 AND pack_version_id = $2 AND ended_at IS NULL",
    [orgId, packVersionId]);
  for (const r of rows) await endRun(r.id);
  return rows.length;
}

export async function endRun(runId: string): Promise<void> {
  const run = await getRun(runId);
  if (!run) return;
  await runtime().deleteSession(run.session_id).catch(() => {});
  const s = await sql();
  await s.query("UPDATE runs SET ended_at = $1, status = 'terminated' WHERE id = $2", [now(), runId]);
  await recordEvent(runId, "run.ended", {});
}
