/**
 * The service layer: everything above the runtime interface.
 *
 * It owns packs, runs, the transcript, and the metering that turns a run's
 * list_cost into a points debit and an author credit.
 */
import Anthropic from "@anthropic-ai/sdk";
import { id, initDb, listRoles, now, platformOrgId, putSetting, setting, settingInt } from "./db.js";
import type { Role } from "./roles.js";
import { sql } from "./sql.js";
import { balanceMillipoints, credit, creditAuthor, debit, pointsForUsage } from "../billing/points.js";
import { ManagedAgentsRuntime } from "../runtime/managed-agents.js";
import { resumeAfterDecision, runTurn, type TurnResult } from "../runtime/run.js";
import { decidePreToolUse, needsInterception, parseHooks, sessionStartContext, type Hook } from "../packs/hooks.js";
import { cents, fromCents } from "../runtime/money.js";
import { BudgetExhaustedError, type AgentRuntime, type PendingAsk, type RuntimeEvent } from "../runtime/types.js";
import { DomainError } from "./errors.js";
import type { PackDefinition } from "../packs/types.js";
import { SEED_PACKS } from "../packs/seed-packs.js";
import { composeSystemPrompt } from "../packs/wrapper.js";
import { PLATFORM_SKILLS } from "../packs/platform-skills.js";
import { redactStoredPayload } from "../transcripts/redact.js";
import { RATING_THRESHOLD } from "./social.js";
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
  price_points: number; tags: string; image: string | null; role: string; upgrade_points: number; model: string; effort: string;
  pinned_models: string; instructions: string; status: string;
  author_payout_email: string | null; extras: string; created_at: string;
  description: string; use_cases: string; limitations: string; faq: string; scenarios: string; requirements: string;
  listing_approved_at: string | null; listing_stale_at: string | null; listed_at: string | null; built_on: string | null;
  /** Set by Task 7's re-attribution; null for a pack nobody has claimed yet. */
  creator_id: string | null;
  /** Curator-set shelf position, lower first; null for every pack nobody has placed. */
  featured_rank: number | null;
};

/** The ranking inputs `rankPacks` reads beyond what's already on `PackRow`. */
export type RankingInputs = {
  /** Completed, non-trial runs — the same count `packStats` shows. */
  runs: number;
  /**
   * The pack's average rating, or `null` whenever it would not be shown —
   * below `RATING_THRESHOLD`, or with no ratings at all. Callers must resolve
   * this the same way `ratingOf` does: a rating nobody can see on the page
   * must not be able to move it on the shelf either.
   */
  rating: number | null;
  /** The sum of this pack's *positive* votes only; a downvote is not usefulness. */
  votes: number;
};

/**
 * The shelf's order, as a pure comparator over whatever rows are handed to
 * it — no I/O, so it is trivial to test with made-up rows and impossible to
 * make it do a second query per pack by accident.
 *
 * Order: `featured_rank` ascending where a curator set one (unset packs sort
 * after every set one); then runs, rating and votes, each descending, each a
 * weak signal on a catalog this new; then `created_at` descending, which is
 * also the whole ordering when a pack carries none of the above — the
 * regression this exists to fix was "most expensive first", so with no
 * signal at all the newest pack must win, not the priciest one; then `id`,
 * so two packs that tie on everything above (`now()` is millisecond
 * resolution, and a seed loop can easily hand two packs the same timestamp)
 * still compare unequal. Without that last key the result depends on
 * whatever order the database happened to return rows in — unspecified by
 * SQL without an `ORDER BY`, and not something `Array.prototype.sort`'s
 * stability can rescue when there is no query-side order to be stable
 * *about*.
 */
export function rankPacks<T extends PackRow & RankingInputs>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.featured_rank != null || b.featured_rank != null) {
      if (a.featured_rank == null) return 1;
      if (b.featured_rank == null) return -1;
      if (a.featured_rank !== b.featured_rank) return a.featured_rank - b.featured_rank;
    }
    if (a.runs !== b.runs) return b.runs - a.runs;
    const ratingA = a.rating ?? -1;
    const ratingB = b.rating ?? -1;
    if (ratingA !== ratingB) return ratingB - ratingA;
    if (a.votes !== b.votes) return b.votes - a.votes;
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
    if (a.id !== b.id) return a.id < b.id ? -1 : 1;
    return 0;
  });
}
export type PackVersionRow = {
  id: string; pack_id: string; version: number; runtime_pack_id: string;
  runtime_version: string; instructions: string; created_at: string;
  /** Measured at publish against the tokenizer, so the trace need not guess. */
  system_tokens?: number;
};
export type RunRow = {
  id: string; org_id: string; user_id: string; pack_version_id: string; session_id: string;
  model: string; status: string; stop_reason: string | null; budget_cents: number;
  points_millipoints: number;
  /** Set once the transcript has been deleted; the costs above survive it. */
  transcript_purged_at?: string | null;
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
  await credit(orgId, "grant", await settingInt(`tier.${tier}.points_millipoints`), `${tier} monthly grant`,
    new Date(Date.now() + 30 * 86400_000).toISOString());
  await credit(orgId, "topup", 500, "launch credit so the demo can actually run");
  return { orgId, userId };
}

// ------------------------------------------------------------------- packs

/**
 * The shelf, optionally narrowed by what somebody typed.
 *
 * Name, tagline and author, because those are the three things a buyer knows
 * before they know the catalog: what it is, what it does, who stands behind
 * it. Matching is case-insensitive and substring — with a curated shelf this
 * is the whole of search, and anything cleverer would be guessing at a scale
 * we do not have yet.
 */
type RankedPackRow = PackRow & { runs: number | string; rating: number | string | null; votes: number | string };

// One query, joined across every candidate pack, rather than a round trip
// per pack: `runs` from completed non-trial runs (the same count `packStats`
// shows), `rating` from `pack_reviews` but only once `RATING_THRESHOLD`
// ratings exist — the same gate `ratingOf` applies, so a rating the page
// would hide cannot move a pack on the shelf either — and `votes` summing
// only positive values, because a downvote is not usefulness.
const RANKING_COLUMNS = `p.*,
    COALESCE(rc.runs, 0) AS runs,
    CASE WHEN COALESCE(rt.cnt, 0) >= $1 THEN rt.avg_rating ELSE NULL END AS rating,
    COALESCE(vt.votes, 0) AS votes`;

const RANKING_JOINS = `
  FROM packs p
  LEFT JOIN (
    SELECT v.pack_id, COUNT(*) AS runs
    FROM runs r JOIN pack_versions v ON v.id = r.pack_version_id
    WHERE r.is_trial = 0
    GROUP BY v.pack_id
  ) rc ON rc.pack_id = p.id
  LEFT JOIN (
    SELECT pack_id, COUNT(*) AS cnt, AVG(rating) AS avg_rating
    FROM pack_reviews WHERE rating IS NOT NULL
    GROUP BY pack_id
  ) rt ON rt.pack_id = p.id
  LEFT JOIN (
    SELECT pack_id, SUM(CASE WHEN value > 0 THEN value ELSE 0 END) AS votes
    FROM pack_votes
    GROUP BY pack_id
  ) vt ON vt.pack_id = p.id`;

const RANKING_SELECT = `
  SELECT ${RANKING_COLUMNS}
  ${RANKING_JOINS}
  WHERE p.status = 'listed'`;

/**
 * The shelf as the landing page needs it, in one query.
 *
 * `listPacks` ranks rows and stops there, which left the route doing four
 * sequential round trips per pack — `latestVersion`, `entitled`, `packStats`
 * (itself three subqueries) and the creator's handle — about 280 queries for
 * seventy packs, through a pool capped at eight connections, on the first
 * page a signed-in buyer sees. After re-attribution every listed pack shares
 * one creator, so 68 of those were fetching the same string.
 *
 * So the four extra facts join here: the latest version (and therefore
 * whether the pack is published at all), whether *this* organisation is
 * entitled to that exact version — the same question `entitled` asks, so an
 * org holding only an older version is not shown as owning the current one —
 * the owning-organisation count, and the creator's handle.
 */
const CATALOG_SELECT = `
  SELECT ${RANKING_COLUMNS},
    COALESCE(ent.buyers, 0) AS buyers,
    COALESCE(lv.version, 0) AS version,
    lv.id AS latest_version_id,
    CASE WHEN mine.org_id IS NULL THEN 0 ELSE 1 END AS owned,
    c.handle AS creator_handle
  ${RANKING_JOINS}
  LEFT JOIN (
    SELECT v.pack_id, COUNT(DISTINCT e.org_id) AS buyers
    FROM entitlements e JOIN pack_versions v ON v.id = e.pack_version_id
    GROUP BY v.pack_id
  ) ent ON ent.pack_id = p.id
  LEFT JOIN (
    SELECT pack_id, MAX(version) AS version FROM pack_versions GROUP BY pack_id
  ) mv ON mv.pack_id = p.id
  LEFT JOIN pack_versions lv ON lv.pack_id = p.id AND lv.version = mv.version
  LEFT JOIN entitlements mine ON mine.pack_version_id = lv.id AND mine.org_id = $2
  LEFT JOIN creators c ON c.id = p.creator_id
  WHERE p.status = 'listed'`;

/** The text filter, shared by both queries so the shelf and a search agree. */
const matchClause = (packParam: number, roleParam: number): string =>
  ` AND (LOWER(p.name) LIKE $${packParam} OR LOWER(p.tagline) LIKE $${packParam}`
  + ` OR LOWER(p.author) LIKE $${packParam} OR LOWER(p.tags) LIKE $${packParam}`
  + ` OR LOWER(p.role) = $${roleParam})`;

/** A listed pack with everything the shelf's card says about it. */
export type CatalogPack = PackRow & RankingInputs & {
  /** Organisations that own some version of this pack — `packStats().buyers`. */
  buyers: number;
  /** The latest published version number, or 0 for a pack with none. */
  version: number;
  /** The latest version's id, or null for a pack that has never been published. */
  latestVersionId: string | null;
  /** Whether the viewing organisation is entitled to that latest version. */
  owned: boolean;
  /** The handle behind `creator_id`, or null for a pack nobody has claimed. */
  creatorHandle: string | null;
};

type CatalogSqlRow = RankedPackRow & {
  buyers: number | string; version: number | string;
  latest_version_id: string | null; owned: number | string; creator_handle: string | null;
};

export async function catalogFor(orgId: string, query = ""): Promise<CatalogPack[]> {
  const s = await sql();
  const q = query.trim();
  const rows = q
    ? await s.query<CatalogSqlRow>(
      `${CATALOG_SELECT}${matchClause(3, 4)}`,
      [RATING_THRESHOLD, orgId, `%${q.toLowerCase()}%`, q.toLowerCase()])
    : await s.query<CatalogSqlRow>(CATALOG_SELECT, [RATING_THRESHOLD, orgId]);
  return rankPacks(rows.map((r) => ({
    ...r,
    runs: Number(r.runs),
    rating: r.rating == null ? null : Number(r.rating),
    votes: Number(r.votes),
    buyers: Number(r.buyers),
    version: Number(r.version),
    latestVersionId: r.latest_version_id,
    owned: Boolean(Number(r.owned)),
    creatorHandle: r.creator_handle,
  })));
}

export async function listPacks(query = ""): Promise<PackRow[]> {
  const s = await sql();
  const q = query.trim();
  let rows: RankedPackRow[];
  if (!q) {
    rows = await s.query<RankedPackRow>(RANKING_SELECT, [RATING_THRESHOLD]);
  } else {
    rows = await s.query<RankedPackRow>(
      `${RANKING_SELECT}${matchClause(2, 3)}`,
      [RATING_THRESHOLD, `%${q.toLowerCase()}%`, q.toLowerCase()]);
  }
  return rankPacks(rows.map((r) => ({
    ...r,
    runs: Number(r.runs),
    rating: r.rating == null ? null : Number(r.rating),
    votes: Number(r.votes),
  })));
}
/**
 * What the shelf can honestly say about a pack.
 *
 * Marketplaces sell on social proof, and the temptation is to show stars
 * before anybody has given any. These are counted from our own tables: runs
 * actually completed, organisations that actually bought, the version it is
 * on. A pack nobody has used says so by showing nothing, which is the honest
 * version of a new listing and the thing a rating out of five would hide.
 */
export async function packStats(packId: string): Promise<{ runs: number; buyers: number; version: number }> {
  const s = await sql();
  const row = await s.one<{ runs: string | number; buyers: string | number; version: string | number }>(
    `SELECT
       (SELECT COUNT(*) FROM runs r JOIN pack_versions v ON v.id = r.pack_version_id
         WHERE v.pack_id = $1 AND r.is_trial = 0) AS runs,
       (SELECT COUNT(DISTINCT e.org_id) FROM entitlements e JOIN pack_versions v ON v.id = e.pack_version_id
         WHERE v.pack_id = $1) AS buyers,
       (SELECT COALESCE(MAX(version), 0) FROM pack_versions WHERE pack_id = $1) AS version`,
    [packId]);
  return {
    runs: Number(row?.runs ?? 0),
    buyers: Number(row?.buyers ?? 0),
    version: Number(row?.version ?? 0),
  };
}

/**
 * The shelf's categories, counted from what authors actually tagged.
 *
 * Not a fixed list in a settings row: a category exists because packs are in
 * it, and stops existing when they are not. A taxonomy maintained separately
 * from the things it classifies drifts out of step within a month, and the
 * first symptom is an empty category that still appears in the navigation.
 */
/**
 * The jobs we list, and how many workers do each.
 *
 * The taxonomy is the `roles` table, read in display order, so changing the
 * roles is a row and not a deploy. `./roles.ts` holds the seed that fills a
 * fresh database and the fallback an empty table renders from; it imports
 * nothing, because `views.ts` needs it for the breadcrumb and the shelf's
 * role strip, and reading it off this module dragged the Anthropic SDK and
 * the runtime into the pure render module's import graph. Re-exported here so
 * `P.ROLES` keeps working.
 *
 * A role with nothing in it is not shown, because advertising a job we cannot
 * fill is worse than not advertising it. A retired role (`listed = 0`) is not
 * shown either, however many packs still carry its id.
 */
export { ROLES, type Role, type RoleRow } from "./roles.js";

export async function roles(): Promise<Array<{ id: string; name: string; blurb: string; icon: string; count: number }>> {
  const s = await sql();
  const rows = await s.query<{ role: string; n: string | number }>(
    "SELECT role, COUNT(*) AS n FROM packs WHERE status = 'listed' AND role <> '' GROUP BY role");
  const counts = new Map(rows.map((r) => [r.role, Number(r.n)]));
  return (await listRoles())
    .filter((r) => r.listed)
    .map((r) => ({ id: r.id, name: r.name, blurb: r.blurb, icon: r.icon, count: counts.get(r.id) ?? 0 }))
    .filter((r) => r.count > 0);
}

/**
 * The single row a pack's `role` column names, for the breadcrumb.
 *
 * Reads `listRoles()` — the same table `roles()` counts against, not the
 * `ROLES` seed — so renaming a role here is what the breadcrumb shows too,
 * which is the gap `views.ts`'s own doc comment flagged: a pure render
 * module cannot read this table itself, so the route resolves it and hands
 * it in. `null` for a role id matching no row, retired or never one; the
 * breadcrumb drops the segment rather than guessing.
 */
export async function roleOf(roleId: string): Promise<Role | null> {
  if (!roleId) return null;
  const r = (await listRoles()).find((row) => row.id === roleId);
  return r ? { id: r.id, name: r.name, blurb: r.blurb, icon: r.icon } : null;
}

/** The tags actually present on a set of packs, counted. */
export function tagsOf(packs: Array<{ tags: string }>): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();
  for (const p of packs) {
    for (const raw of (p.tags ?? "").split(",")) {
      const tag = raw.trim().toLowerCase();
      if (tag) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts].map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export async function categories(): Promise<Array<{ tag: string; count: number }>> {
  const s = await sql();
  const rows = await s.query<{ tags: string }>(
    "SELECT tags FROM packs WHERE status = 'listed' AND tags <> ''");
  const counts = new Map<string, number>();
  for (const r of rows) {
    for (const raw of r.tags.split(",")) {
      const tag = raw.trim().toLowerCase();
      if (tag) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts].map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
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
export type ChangelogEntry = { version: number; note: string; createdAt: string };

/**
 * Notes an author actually wrote, newest version first. Most packs have
 * none — the 68 already on the shelf before this table existed have no
 * honest way to say what their old versions changed, so nothing is
 * backfilled and none of them will ever have a row here.
 */
export async function changelogOf(packId: string): Promise<ChangelogEntry[]> {
  const s = await sql();
  const rows = await s.query<{ version: number; note: string; created_at: string }>(
    "SELECT version, note, created_at FROM pack_changelog WHERE pack_id = $1 ORDER BY version DESC", [packId]);
  return rows.map((r) => ({ version: r.version, note: r.note, createdAt: r.created_at }));
}

export async function getVersion(versionId: string): Promise<PackVersionRow | undefined> {
  const s = await sql();
  return s.one<PackVersionRow>("SELECT * FROM pack_versions WHERE id = $1", [versionId]);
}

export type PackExtras = {
  anthropicSkills?: string[];
  advisorModel?: string;
  web?: { allowedDomains?: string[]; blockedDomains?: string[] };
};

/** Runtime capabilities a pack asked for in its front matter. */
export function packExtras(pack: Pick<PackRow, "extras">): PackExtras {
  try {
    const parsed = JSON.parse(pack.extras || "{}") as PackExtras;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch { return {}; }
}

/** Some models reject `effort` entirely, so it is a capability, not a default. */
export type DestructivePolicy = "always_ask" | "always_allow" | "auto";

/** Platform-wide posture for tools that change the world. A settings row. */
export async function destructivePolicy(): Promise<DestructivePolicy> {
  const raw = await setting("destructive_tool_policy");
  return raw === "always_ask" || raw === "auto" ? raw : "always_allow";
}

/**
 * The policy a run is configured with, which is not the one a pack declared.
 *
 * `publishPack` builds every agent config from the platform-wide setting and
 * forces `always_ask` where the pack ships PreToolUse hooks, because a hook
 * can only bind if the call pauses. So `pack_tools.policy` — the author's own
 * `agent.md` text — never reaches the runtime, and the permissions rail must
 * not render it: a pack declaring `always_allow` next to a hook runs with
 * `always_ask`. Both the publish path and the rail go through this, so the
 * page and the run cannot drift apart.
 */
export function policyWithHooks(global: DestructivePolicy, hooks: Hook[]): DestructivePolicy {
  return needsInterception(hooks) ? "always_ask" : global;
}

/**
 * The same thing for a published version, read from that version's own
 * snapshot of the folder — so the rail describes what a buyer would actually
 * run, not what the author's working copy says today. An unpublished pack has
 * no baked configuration yet, so it gets the platform policy.
 */
export async function effectivePolicy(packVersionId: string | null | undefined): Promise<DestructivePolicy> {
  const global = await destructivePolicy();
  if (!packVersionId) return global;
  return policyWithHooks(global, await runHooks(packVersionId));
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
    // `price_cents` is written explicitly, and the value is 0.
    //
    // It has to be written at all because it is NOT NULL and, on a database
    // that predates the millipoints rename, has no DEFAULT — `CREATE TABLE IF
    // NOT EXISTS` cannot add one to a table that already exists. Leaving it
    // out booted fine on a fresh database and killed the process on a real
    // one, which is why the live service stopped deploying.
    //
    // 0 rather than `pricePoints * 400`, which is what the one-time migration
    // `price_points = price_cents / 400` implies the old rate was. Two
    // reasons. Nothing reads this column: it is not on `PackRow`, so no query
    // in the app can even see it, and every price a buyer meets — the pack
    // page, the buy button, `purchases.pricePoints`, the curate queue — reads
    // `price_points`. And its one reader is that migration, which is recorded
    // in `schema_migrations` and will never run again on a database that has
    // packs in it. So a converted value would be read by nobody, in the unit
    // 8101fd6 established was wrong — writing 24000 here claims a $240 price
    // no code path honours and no payment would ever charge. 0 says the true
    // thing: this pack has no price in cents, it has a price in points.
    //
    // The honest end state is to drop the column. That is a destructive
    // migration on a live database and a table rebuild on SQLite, so it is
    // not what belongs in a fix for an outage.
    const rows = await s.query(
      `INSERT INTO packs (id, slug, name, tagline, author, price_cents, price_points, upgrade_points,
         model, effort, pinned_models, instructions, tags, image, status, created_at)
       VALUES ($1,$2,$3,$4,$5,0,$6,$7,$8,$9,$10,$11,$13,$14,'listed',$12)
       ON CONFLICT (slug) DO NOTHING RETURNING id`,
      [id("pk"), p.slug, p.name, p.tagline, p.author, p.pricePoints, p.upgradePoints, p.model,
        p.effort ?? "", JSON.stringify(p.pinnedModels ?? []), p.instructions, now(),
        p.tags ?? "", p.image ?? null]);
    n += rows.length;
  }
  return n;
}

/**
 * The platform's own skills, uploaded once and reused by id.
 *
 * Every pack gets them, so a capability no author should have to write — such
 * as turning a page into an image — is simply there. Uploading per pack would
 * make a hundred copies of the same thing.
 */
export async function ensurePlatformSkills(): Promise<string[]> {
  const ids: string[] = [];
  for (const skill of PLATFORM_SKILLS) {
    const key = `platform_skill.${skill.name}`;
    const s = await sql();
    const row = await s.one<{ value: string }>("SELECT value FROM settings WHERE key = $1", [key]);
    if (row?.value) { ids.push(row.value); continue; }
    const uploaded = await runtime().uploadSkill(skill);
    await putSetting(key, uploaded.skillId);
    ids.push(uploaded.skillId);
  }
  return ids;
}

/**
 * Publishes to the runtime, creating a local version pinned to the agent
 * version.
 *
 * `note` is optional and, when given, is captured once against the new
 * version — the one exception to listing metadata attaching to the pack
 * rather than the version. Most publishes have nothing to say, so leaving it
 * out must succeed exactly as it always has for every existing caller.
 */
export async function publishPack(slug: string, note?: string): Promise<PackVersionRow> {
  const pack = await getPack(slug);
  if (!pack) throw new Error(`no such pack: ${slug}`);
  const def: PackDefinition = {
    slug: pack.slug, name: pack.name, tagline: pack.tagline, author: pack.author,
    model: pack.model, effort: await effortFor(pack.model, pack.effort),
    pricePoints: pack.price_points, upgradePoints: pack.upgrade_points,
    instructions: pack.instructions, pinnedModels: JSON.parse(pack.pinned_models),
    destructivePolicy: await destructivePolicy(),
    attachSkillIds: await ensurePlatformSkills(),
    ...packExtras(pack),
  };

  // The folder, if the author uploaded one. Its skills/ become real platform
  // skills; a pack with no folder still publishes from its instructions alone.
  const tree = await packTree(pack.id);
  const parsed = tree.length > 0 ? validateTree(tree) : null;
  // A hook can only bind if the call pauses, so a pack declaring PreToolUse
  // hooks is published with always_ask whatever the platform default is. The
  // server answers those pauses itself, so nobody is blocked by it. Through
  // `policyWithHooks` rather than inline, because the permissions rail has to
  // reach the identical answer for a published version.
  const hooks = tree.length > 0 ? parseHooks(tree) : [];
  def.destructivePolicy = policyWithHooks(def.destructivePolicy ?? await destructivePolicy(), hooks);
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

  // Price the prompt once, here, so every run page can show where its context
  // went without another API call. A failure to count must not fail a publish.
  const systemTokens = await runtime()
    .countSystemTokens(def.model, composeSystemPrompt(def, tree.length > 0 ? folderBrief(tree) : undefined))
    .catch(() => 0);

  const prev = await latestVersion(pack.id);
  const vid = id("pv");
  const version = (prev?.version ?? 0) + 1;
  const s = await sql();
  await s.query(
    `INSERT INTO pack_versions (id, pack_id, version, runtime_pack_id, runtime_version, instructions, system_tokens, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [vid, pack.id, version, published.runtimePackId, published.version, pack.instructions,
      systemTokens, now()]);
  // Optional, and captured once, here, because the version it describes is
  // immutable and this is the only moment that version exists to describe.
  // Most publishes have nothing to say, so a blank or missing note writes
  // nothing rather than a row with an empty string in it.
  const trimmedNote = note?.trim();
  if (trimmedNote) {
    // `ON CONFLICT DO NOTHING` on the primary key, as defence in depth: two
    // publishes racing both compute the same `version`, because the read of
    // the previous one is not serialised with these inserts. Today the loser
    // is stopped earlier, by `pack_versions`' own UNIQUE (pack_id, version),
    // so it never reaches this statement — but that is the only thing
    // standing between a duplicate key here and a publish that has already
    // written its version row and then throws. A note describes an immutable
    // version, so the one already recorded for it is the one that stands.
    await s.query(
      `INSERT INTO pack_changelog (pack_id, version, note, created_at) VALUES ($1,$2,$3,$4)
       ON CONFLICT (pack_id, version) DO NOTHING`,
      [pack.id, version, trimmedNote, now()]);
  }
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
  // The platform's own skills are attached to every pack and are just as much
  // a part of what the agent can do, so they belong in the record a buyer
  // reads. Recording only the author's would have made the trace say a pack
  // had no skills while it was busy rendering a page with one.
  for (const [i, skillId] of (def.attachSkillIds ?? []).entries()) {
    const name = PLATFORM_SKILLS[i]?.name ?? "platform skill";
    await s.query(
      "INSERT INTO pack_version_skills (pack_version_id, name, skill_id, skill_version) VALUES ($1,$2,$3,$4)",
      [vid, name, skillId, "latest"]);
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

/**
 * What is in the folder, without reading the folder.
 *
 * The pack page says how many files and how many skills a buyer is getting,
 * so it needs the manifest and not the contents — a pack's files are its
 * product, and loading every one of them to count them would mean holding the
 * whole thing in memory to render a number. Paths only, from the version a
 * buyer would actually get.
 *
 * A skill is a directory under `skills/`, the same identity `findSkillDirs`
 * gives it, so two files in one skill count as one skill.
 */
export async function packFileSummary(packId: string): Promise<{ files: number; skills: number; tree: string[] }> {
  const version = await latestVersion(packId);
  if (!version) return { files: 0, skills: 0, tree: [] };
  const s = await sql();
  const rows = await s.query<{ path: string }>(
    "SELECT path FROM pack_version_files WHERE pack_version_id = $1 ORDER BY path", [version.id]);
  const skills = new Set<string>();
  for (const row of rows) {
    const m = /^skills\/([^/]+)\//.exec(row.path);
    if (m) skills.add(m[1]!);
  }
  return { files: rows.length, skills: skills.size, tree: rows.map((r) => r.path) };
}

/**
 * The `tools:` block a pack's agent.md declared.
 *
 * Alphabetical, because `pack_tools` keys on `(pack_id, name)` and keeps no
 * ordinal — declaration order is not recoverable, and a stable order beats an
 * arbitrary one for a line of prose a buyer reads twice.
 */
export async function packTools(packId: string): Promise<Array<{ name: string; policy: string }>> {
  const s = await sql();
  return s.query<{ name: string; policy: string }>(
    "SELECT name, policy FROM pack_tools WHERE pack_id = $1 ORDER BY name", [packId]);
}

/** The MCP servers a pack wires up, so the rail can name what it connects to. */
export async function packMcpServers(packId: string): Promise<Array<{ name: string; url: string }>> {
  const s = await sql();
  return s.query<{ name: string; url: string }>(
    "SELECT name, url FROM pack_mcp_servers WHERE pack_id = $1 ORDER BY name", [packId]);
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

/**
 * The hooks a run's pack version declares.
 *
 * Read from the version's own snapshot, so changing a pack's hooks does not
 * silently change the rules a buyer is already running under.
 */
export async function runHooks(packVersionId: string): Promise<Hook[]> {
  const tree = await versionTree(packVersionId);
  if (tree.length === 0) return [];
  try { return parseHooks(tree); }
  catch { return []; }
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
  /**
   * A repository for the worker to read. The token reaches the provider and
   * stops there: it is not stored on the run, not put in an event, and not
   * logged. What is kept is that a repository was attached and which one,
   * because a buyer reading a trace later should be able to see what the
   * agent could see.
   */
  repo?: { url: string; token?: string };
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
  if ((await balanceMillipoints(args.orgId)) <= 0) throw new OutOfPointsError();

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
    ...(args.repo ? { repo: args.repo } : {}),
  });

  const runId = id("run");
  await s.query(
    `INSERT INTO runs (id, org_id, user_id, pack_version_id, session_id, model, status, budget_cents, is_trial, started_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [runId, args.orgId, args.userId, version.id, session.id, model, session.status, budgetCents,
      args.trial ? 1 : 0, now()]);
  await recordEvent(runId, "run.started", {
    session: session.id, model, budget_cents: budgetCents, trial: Boolean(args.trial),
    // The URL and branch, never the token. A trace is read by the buyer, by
    // us when something goes wrong, and by anyone they export it to.
    ...(args.repo ? { repo: args.repo.url } : {}),
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
function observe(runId: string, e: RuntimeEvent, recordAsks = true): void {
  serial(runId, async () => {
    const s = await sql();
    await recordEvent(runId, e.type, e);
    // With hooks enforcing, the turn loop answers every pause itself, so
    // recording one here would show the buyer a prompt for a decision already
    // made.
    if (recordAsks && e.type === "tool.use" && e.permission === "ask") {
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

  // Two numbers, deliberately separate. What the run cost *us* is dollars we
  // owe the provider; what it costs the *buyer* is points off a token
  // allowance. Keeping both is the only way the subsidy in §8.3 is visible
  // rather than assumed — and the buyer is charged on tokens, so the model
  // they pick cannot change what they are billed.
  const costCents = Math.max(Number(cents(session.usage.listCost)), run.list_cost_cents);
  const pointsSoFar = await pointsForUsage(session.usage.inputTokens, session.usage.outputTokens);
  const delta = Math.max(0, pointsSoFar - run.points_millipoints);
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
       points_millipoints = $8, billed_cents = billed_cents + $9 WHERE id = $10`,
    [session.status, stopReason, session.usage.inputTokens, session.usage.outputTokens,
      session.usage.activeSeconds, costCents, costCents, pointsSoFar, billed, runId]);

  for (const a of result.pendingAsks) await recordAsk(runId, a);
  await collectOutputs(runId, run.session_id);
  await recordEvent(runId, "run.metered", {
    list_cost_cents: costCents, points_millipoints: pointsSoFar,
    delta_millipoints: delta, billed_millipoints: billed,
    author_millicents: authorMilli, input_tokens: session.usage.inputTokens,
    output_tokens: session.usage.outputTokens, active_seconds: session.usage.activeSeconds,
  });
  return { billedCents: billed, authorCents: authorMilli };
}

/**
 * Enforcement, wired into the turn loop.
 *
 * With PreToolUse hooks a pack is published with always_ask, so every tool call
 * pauses. The server answers each pause from the hooks — denying what they
 * forbid and allowing everything else at once — so the rules bind without a
 * person waiting on anything. Each decision is written to the transcript naming
 * the hook that made it, because a denial the buyer cannot explain is worse
 * than no denial.
 */
function interception(runId: string, hooks: Hook[]): {
  intercept?: (ask: PendingAsk) => Promise<{ result: "allow" | "deny"; reason?: string } | null>;
  onIntercepted?: (ask: PendingAsk, d: { result: "allow" | "deny"; reason?: string }) => void;
} {
  if (!needsInterception(hooks)) return {};
  return {
    intercept: async (ask) => decidePreToolUse(hooks, { tool: ask.name, input: ask.input }),
    onIntercepted: (ask, decision) => {
      serial(runId, async () => {
        await recordEvent(runId, "hook.decision", {
          tool: ask.name, result: decision.result,
          ...(decision.reason ? { reason: decision.reason } : {}),
        });
      });
    },
  };
}

export type OutputRow = { run_id: string; file_id: string; filename: string; size_bytes: number; created_at: string };

export async function runOutputs(runId: string): Promise<OutputRow[]> {
  const s = await sql();
  return s.query<OutputRow>(
    "SELECT * FROM run_outputs WHERE run_id = $1 ORDER BY created_at, filename", [runId]);
}

/**
 * Record what a turn produced.
 *
 * Deliverables are listed after each turn rather than at the end of a run,
 * because a run can go on for hours and a file nobody knows about is the same
 * as no file.
 */
async function collectOutputs(runId: string, sessionId: string): Promise<void> {
  let files: Awaited<ReturnType<AgentRuntime["listOutputs"]>>;
  try { files = await runtime().listOutputs(sessionId); }
  catch { return; }
  if (files.length === 0) return;

  const s = await sql();
  for (const f of files) {
    await s.query(
      `INSERT INTO run_outputs (run_id, file_id, filename, size_bytes, created_at)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (run_id, file_id) DO NOTHING`,
      [runId, f.fileId, f.filename, f.sizeBytes, now()]);
  }
  await recordEvent(runId, "run.outputs", { files: files.map((f) => ({ name: f.filename, bytes: f.sizeBytes })) });
}

export async function downloadOutput(runId: string, fileId: string, orgId: string): Promise<{
  bytes: Buffer; filename: string;
}> {
  const run = await getRun(runId);
  if (!run || run.org_id !== orgId) throw new Error("no such run");
  const s = await sql();
  const row = await s.one<OutputRow>(
    "SELECT * FROM run_outputs WHERE run_id = $1 AND file_id = $2", [runId, fileId]);
  if (!row) throw new Error("no such output");
  const out = await runtime().downloadOutput(fileId);
  return { bytes: out.bytes, filename: row.filename };
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
  if ((await balanceMillipoints(run.org_id)) <= 0) throw new OutOfPointsError();
  const s0 = await sql();
  await s0.query("UPDATE runs SET turn_count = turn_count + 1 WHERE id = $1", [runId]);
  await recordEvent(runId, "user.message", { text });
  draining.add(runId);
  try {
    const hooks = await runHooks(run.pack_version_id);
    // SessionStart context goes with the first turn only: it is appended as
    // privileged context and persists for every turn after it.
    const context = run.turn_count === 0 ? sessionStartContext(hooks) : null;

    const enforcing = needsInterception(hooks);
    const result = await runTurn(runtime(), run.session_id, text, {
      onEvent: (e) => { observe(runId, e, !enforcing); onEvent?.(e); },
      ...(context ? { systemContext: context } : {}),
      ...interception(runId, hooks),
    });
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
    const resumeHooks = await runHooks(run.pack_version_id);
    const result = await resumeAfterDecision(runtime(), run.session_id, confirm, {
      onEvent: (e) => { observe(runId, e, !needsInterception(resumeHooks)); onEvent?.(e); },
      ...interception(runId, resumeHooks),
    });
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
 *
 * The boolean form a caller can check *before* deciding to charge anyone —
 * an author or the platform org already has access via the clauses below
 * with no `entitlements` row ever written for them, so a bare `entitled`
 * probe reads `false` for them and would otherwise let a purchase path
 * charge them for what they already have for free.
 */
export async function mayExport(orgId: string, pack: PackRow, packVersionId: string): Promise<boolean> {
  if (pack.author_org_id === orgId) return true;
  if ((await platformOrgId()) === orgId) return true;
  return entitled(orgId, packVersionId);
}

export async function assertMayExport(orgId: string, pack: PackRow, packVersionId: string): Promise<void> {
  if (!(await mayExport(orgId, pack, packVersionId))) throw new NotEntitledError();
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
    pricePoints: pack.price_points, upgradePoints: pack.upgrade_points,
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

export type RunUsage = {
  window: number; used: number; systemTokens: number; conversation: number;
  cacheRead: number; cacheCreation: number; outputTokens: number;
  skills: Array<{ name: string }>; tools: Array<{ name: string; calls: number }>;
  requests: number;
};

/**
 * Where a run's context and money went, decomposed only as far as honesty allows.
 *
 * Three of these are exact because the provider reports them per request:
 * input, cache read and cache write. The pack's own prompt is exact too — it
 * was counted against the tokenizer at publish time, not estimated from
 * characters. What is left over after subtracting the prompt is the tool and
 * skill definitions plus the conversation, and it is labelled as that rather
 * than split further, because splitting it further would mean guessing.
 *
 * The context figure is the last request's, not a running total: context is
 * what the model was holding when it last answered, and summing it across
 * requests would produce a number that means nothing.
 */
export async function runUsage(runId: string): Promise<RunUsage> {
  const s = await sql();
  const run = await getRun(runId);
  if (!run) throw new DomainError("no such run", 404, "NotFoundError");
  const version = await getVersion(run.pack_version_id);

  const windows = new Map((await setting("model_context_windows"))
    .split(",").map((pair) => pair.split("=") as [string, string])
    .filter((kv) => kv.length === 2)
    .map(([m, n]) => [m.trim(), Number(n)] as const));

  const rows = await s.query<{ kind: string; payload: string }>(
    "SELECT kind, payload FROM run_events WHERE run_id = $1 ORDER BY id", [runId]);

  let cacheRead = 0, cacheCreation = 0, inputTokens = 0, requests = 0;
  const tools = new Map<string, number>();
  for (const r of rows) {
    let p: Record<string, unknown>;
    try { p = JSON.parse(r.payload) as Record<string, unknown>; } catch { continue; }
    if (r.kind === "model.usage") {
      // The last request's figures, because that is what the model was holding.
      requests += 1;
      cacheRead = Number(p["cacheReadTokens"] ?? 0);
      cacheCreation = Number(p["cacheCreationTokens"] ?? 0);
      inputTokens = Number(p["inputTokens"] ?? 0);
    }
    if (r.kind === "tool.use") {
      const name = String(p["name"] ?? "tool");
      tools.set(name, (tools.get(name) ?? 0) + 1);
    }
  }

  const skills = await s.query<{ name: string }>(
    "SELECT name FROM pack_version_skills WHERE pack_version_id = $1 ORDER BY name",
    [run.pack_version_id]);

  const used = inputTokens + cacheRead + cacheCreation;
  const systemTokens = Math.min(Number(version?.system_tokens ?? 0), used);
  return {
    window: windows.get(run.model) ?? 200000,
    used, systemTokens,
    conversation: Math.max(0, used - systemTokens),
    cacheRead, cacheCreation, outputTokens: run.output_tokens,
    skills, tools: [...tools].map(([name, calls]) => ({ name, calls }))
      .sort((a, b) => b.calls - a.calls),
    requests,
  };
}

/**
 * Runs that were in flight when the process stopped.
 *
 * A turn is driven by a loop inside this process, so a restart — a deploy, a
 * crash, the host moving the container — leaves the run row open with nobody
 * reading its stream. That is not cosmetic. `ended_at IS NULL` is exactly what
 * the concurrency limit counts, so each restart mid-turn costs the organisation
 * one of its slots permanently, and after five deploys a personal tier cannot
 * start anything at all. Meanwhile the session is still live at the provider,
 * spending against a budget whose events are going nowhere.
 *
 * So each open run is metered once more — the provider still knows what it
 * cost, even though we stopped listening — and then closed and its session
 * terminated. The buyer sees a run that says it was interrupted, which is true,
 * instead of one that looks like it is still working.
 */
export async function reconcileOpenRuns(): Promise<number> {
  const s = await sql();
  const rows = await s.query<{ id: string }>("SELECT id FROM runs WHERE ended_at IS NULL");
  for (const r of rows) {
    // One unreachable session must not stop the rest being freed.
    try {
      const run = await getRun(r.id);
      if (run) {
        const session = await runtime().readSession(run.session_id);
        await meter(r.id, { events: [], session, pendingAsks: [] });
      }
    } catch { /* session gone, or the provider is unreachable: close it anyway */ }
    await recordEvent(r.id, "run.interrupted", {
      message: "the server restarted while this run was in flight",
    }).catch(() => {});
    await endRun(r.id).catch(() => {});
  }
  return rows.length;
}

/**
 * Delete a run's transcript, here and at the provider, keeping the receipt.
 *
 * The split is the whole policy: what it cost is a billing record and has to
 * survive, what was said is the buyer's content and should not outlive its
 * purpose. So the run row stays — tokens, cost, who ran it, when — and the
 * events go, along with the session at the provider, which keeps its own copy
 * until something tells it not to.
 *
 * It is written down on the run itself rather than silently leaving a gap,
 * because a trace that is empty and a trace that was deleted are different
 * facts and a buyer asking "where did my transcript go" deserves the second.
 */
export async function forgetTranscript(runId: string): Promise<void> {
  const s = await sql();
  const run = await getRun(runId);
  if (!run || run.transcript_purged_at) return;
  // The provider holds the only other copy; a failure there must not leave us
  // believing we deleted something we did not.
  await runtime().deleteSession(run.session_id).catch(() => {});
  await s.query("DELETE FROM run_events WHERE run_id = $1", [runId]);
  const at = now();
  await s.query(
    "UPDATE runs SET transcript_purged_at = $1, ended_at = COALESCE(ended_at, $1) WHERE id = $2",
    [at, runId]);
  await recordEvent(runId, "transcript.purged", { at });
}

/**
 * Every transcript past its retention window, deleted.
 *
 * Only finished runs: deleting out from under a live one would make the trace
 * blank while the agent was still working. A retention of 0 means keep
 * forever, which is a choice somebody can make rather than the default that
 * happens when nobody implements this.
 */
export async function purgeExpiredTranscripts(at = new Date()): Promise<number> {
  const days = Number(await setting("transcript_retention_days"));
  if (!Number.isFinite(days) || days <= 0) return 0;
  const cutoff = new Date(at.getTime() - days * 86_400_000).toISOString();
  const s = await sql();
  const rows = await s.query<{ id: string }>(
    `SELECT id FROM runs
      WHERE ended_at IS NOT NULL AND ended_at < $1 AND transcript_purged_at IS NULL`, [cutoff]);
  for (const r of rows) await forgetTranscript(r.id).catch(() => {});
  return rows.length;
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
