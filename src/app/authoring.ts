import { id, now, platformOrgId } from "./db.js";
import { sql } from "./sql.js";
import { DomainError } from "./errors.js";
import * as P from "./platform.js";
import type { PackDefinition } from "../packs/types.js";
import { parsePackMarkdown, type ParsedPack } from "../packs/import.js";
import {
  findCommands, findHooks, findWorkflows, normaliseTree, validateTree, type PackTree,
} from "../packs/tree.js";

/**
 * Creating, editing, withdrawing and deleting packs — the supply side.
 *
 * It had no interface at all until now: packs came from a hardcoded array and
 * an author could not get one in. This is that interface.
 *
 * One rule shapes everything here: editing a pack never changes what an
 * existing buyer runs. Versions keep their own copy of the instructions and a
 * session is pinned to a version, so an edit only affects the *next* published
 * version. That is what lets an author fix a mistake without silently altering
 * work someone already paid for.
 */
export type PackStatus = "draft" | "review" | "listed" | "unlisted";

export class PackConflictError extends DomainError {
  constructor(message: string) { super(message, 409, "PackConflictError"); }
}
export class NotTheAuthorError extends DomainError {
  constructor() { super("only the organisation that owns this pack can change it", 403, "NotTheAuthorError"); }
}
export class NotTheCuratorError extends DomainError {
  constructor() { super("only the curating organisation can change what is listed", 403, "NotTheCuratorError"); }
}

export type PackInput = {
  slug: string; name: string; tagline: string; author: string;
  model: string; effort?: PackDefinition["effort"];
  priceCents: number; upgradePoints: number;
  instructions: string;
  pinnedModels?: string[];
  mcpServers?: Array<{ name: string; url: string }>;
  payoutEmail?: string;
};

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function normaliseSlug(raw: string): string {
  const slug = raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!slug) throw new PackConflictError("that name does not make a usable address");
  if (!SLUG.test(slug)) throw new PackConflictError(`"${raw}" is not a usable address`);
  if (slug.length > 64) throw new PackConflictError("that address is too long");
  return slug;
}

function validate(input: PackInput): void {
  if (!input.name.trim()) throw new PackConflictError("a pack needs a name");
  if (!input.instructions.trim()) throw new PackConflictError("a pack needs instructions — that is the product");
  if (!input.model.trim()) throw new PackConflictError("a pack needs a default model");
  if (!Number.isInteger(input.priceCents) || input.priceCents < 0) {
    throw new PackConflictError("the price must be a whole number of cents, or zero");
  }
  if (!Number.isInteger(input.upgradePoints) || input.upgradePoints < 0) {
    throw new PackConflictError("update points must be a whole number, or zero");
  }
}

export async function createPack(orgId: string, input: PackInput): Promise<P.PackRow> {
  validate(input);
  const slug = normaliseSlug(input.slug || input.name);
  if (await P.getPack(slug)) throw new PackConflictError(`there is already a pack at /packs/${slug}`);
  const s = await sql();
  await s.query(
    `INSERT INTO packs (id, slug, name, tagline, author, author_org_id, price_cents, upgrade_points,
       model, effort, pinned_models, instructions, status, author_payout_email, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'draft',$13,$14)`,
    [id("pk"), slug, input.name.trim(), input.tagline.trim(), input.author.trim() || "unattributed",
      orgId, input.priceCents, input.upgradePoints, input.model.trim(), input.effort ?? "",
      JSON.stringify(input.pinnedModels ?? []), input.instructions.trim(),
      input.payoutEmail?.trim() || null, now()]);
  return (await P.getPack(slug))!;
}

/** Only the author's organisation may edit, and a slug never changes. */
export async function updatePack(orgId: string, slug: string, input: PackInput): Promise<P.PackRow> {
  const pack = await P.getPack(slug);
  if (!pack) throw new PackConflictError(`no pack at /packs/${slug}`);
  if (pack.author_org_id !== orgId) throw new NotTheAuthorError();
  validate(input);
  const s = await sql();
  await s.query(
    `UPDATE packs SET name = $1, tagline = $2, author = $3, price_cents = $4, upgrade_points = $5,
       model = $6, effort = $7, pinned_models = $8, instructions = $9, author_payout_email = $10
     WHERE id = $11`,
    [input.name.trim(), input.tagline.trim(), input.author.trim() || pack.author,
      input.priceCents, input.upgradePoints, input.model.trim(), input.effort ?? "",
      JSON.stringify(input.pinnedModels ?? []), input.instructions.trim(),
      input.payoutEmail?.trim() || null, pack.id]);
  return (await P.getPack(slug))!;
}

/**
 * An author submits; the curator lists or withdraws.
 *
 * Withdrawing takes a pack out of the catalog and leaves every existing buyer
 * exactly as they were: they own a version, and a version does not stop working
 * because the shelf changed.
 */
export async function setStatus(actorOrgId: string, slug: string, status: PackStatus): Promise<void> {
  const pack = await P.getPack(slug);
  if (!pack) throw new PackConflictError(`no pack at /packs/${slug}`);
  const curator = await platformOrgId();
  const isAuthor = pack.author_org_id === actorOrgId;
  const isCurator = curator !== null && curator === actorOrgId;

  if (status === "review") {
    if (!isAuthor && !isCurator) throw new NotTheAuthorError();
    if (!(await P.latestVersion(pack.id))) {
      throw new PackConflictError("publish the pack to the runtime before submitting it — an unpublished pack cannot run");
    }
  } else if (status === "draft") {
    if (!isAuthor && !isCurator) throw new NotTheAuthorError();
  } else if (!isCurator) {
    throw new NotTheCuratorError();
  }
  const s = await sql();
  await s.query("UPDATE packs SET status = $1 WHERE id = $2", [status, pack.id]);
}

/**
 * Deleting is only for packs nobody has. Once a pack has been bought or run it
 * is part of someone else's history, so it is withdrawn rather than erased.
 */
export async function deletePack(orgId: string, slug: string): Promise<void> {
  const pack = await P.getPack(slug);
  if (!pack) throw new PackConflictError(`no pack at /packs/${slug}`);
  const curator = await platformOrgId();
  if (pack.author_org_id !== orgId && curator !== orgId) throw new NotTheAuthorError();

  const s = await sql();
  const sold = await s.one(
    `SELECT 1 AS ok FROM entitlements e JOIN pack_versions pv ON pv.id = e.pack_version_id
     WHERE pv.pack_id = $1 LIMIT 1`, [pack.id]);
  if (sold) throw new PackConflictError("someone owns this pack — withdraw it instead of deleting it");
  const ran = await s.one(
    `SELECT 1 AS ok FROM runs r JOIN pack_versions pv ON pv.id = r.pack_version_id
     WHERE pv.pack_id = $1 LIMIT 1`, [pack.id]);
  if (ran) throw new PackConflictError("this pack has been run and its traces are someone's record — withdraw it instead");

  await s.query("DELETE FROM pack_versions WHERE pack_id = $1", [pack.id]);
  await s.query("DELETE FROM packs WHERE id = $1", [pack.id]);
}

/** Packs this organisation authored, whatever their status. */
export async function myPacks(orgId: string): Promise<P.PackRow[]> {
  const s = await sql();
  return s.query<P.PackRow>(
    "SELECT * FROM packs WHERE author_org_id = $1 ORDER BY created_at DESC", [orgId]);
}

/** The curator's queue. */
export async function submittedPacks(): Promise<P.PackRow[]> {
  const s = await sql();
  return s.query<P.PackRow>("SELECT * FROM packs WHERE status = 'review' ORDER BY created_at");
}

// ------------------------------------------------------------------ import

export type UploadFile = { path: string; text: string };

/**
 * Create or update a pack from uploaded files.
 *
 * Fields the file does not carry keep whatever the existing pack has, or take a
 * sensible default on a new one — so an author can push just their method and
 * fill in the commercial details in the browser.
 */
export async function importPack(args: {
  orgId: string; files: UploadFile[]; slugOverride?: string; defaults?: Partial<PackInput>;
}): Promise<{
  pack: P.PackRow; created: boolean; parsed: ParsedPack;
  skills: string[]; subagents: string[]; inert: string[];
  commands: string[]; hooks: string[]; workflows: string[];
  warnings: Array<{ skill: string; file: string; message: string }>;
}> {
  // The folder is stored as a folder. Only agent.md's body becomes the system
  // prompt; skills stay separate files so the model can read one at a time.
  const tree: PackTree = normaliseTree(args.files.map((f) => ({ path: f.path, content: f.text })));
  const { definition, skills, subagents, inert } = validateTree(tree);
  const parsed = parsePackMarkdown(definition.content);

  const slug = normaliseSlug(args.slugOverride || parsed.slug || parsed.name || "");
  const existing = await P.getPack(slug);

  const input: PackInput = {
    slug,
    name: parsed.name ?? existing?.name ?? slug,
    tagline: parsed.tagline ?? existing?.tagline ?? "",
    author: parsed.author ?? existing?.author ?? args.defaults?.author ?? "unattributed",
    model: parsed.model ?? existing?.model ?? args.defaults?.model ?? "claude-opus-5",
    effort: parsed.effort ?? (existing?.effort as PackInput["effort"]) ?? args.defaults?.effort,
    priceCents: args.defaults?.priceCents ?? existing?.price_cents ?? 0,
    upgradePoints: args.defaults?.upgradePoints ?? existing?.upgrade_points ?? 0,
    instructions: parsed.instructions,
    pinnedModels: parsed.pinnedModels.length
      ? parsed.pinnedModels
      : existing ? JSON.parse(existing.pinned_models) : args.defaults?.pinnedModels ?? [],
    mcpServers: parsed.mcpServers,
    payoutEmail: args.defaults?.payoutEmail ?? existing?.author_payout_email ?? undefined,
  };

  const created = !existing;
  if (existing && existing.author_org_id !== args.orgId) throw new NotTheAuthorError();
  const pack = existing
    ? await updatePack(args.orgId, slug, input)
    : await createPack(args.orgId, input);

  const { warnings } = await P.savePackTree(pack.id, tree);
  return {
    pack: (await P.getPack(slug))!, created, parsed,
    skills: skills.map((sk) => sk.name),
    subagents: subagents.map((sa) => sa.name),
    commands: findCommands(tree).map((c) => c.name),
    hooks: findHooks(tree),
    workflows: findWorkflows(tree),
    inert, warnings,
  };
}
