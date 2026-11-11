import { id, now, platformOrgId } from "./db.js";
import { sql } from "./sql.js";
import { DomainError, FAQ_WRITE_ATTEMPTS, FaqContendedError } from "./errors.js";
import * as P from "./platform.js";
import type { PackDefinition } from "../packs/types.js";
import { parsePackMarkdown, type ParsedPack } from "../packs/import.js";
import {
  findCommands, findHooks, findWorkflows, normaliseTree, validateTree, type PackTree,
} from "../packs/tree.js";
import {
  faqFromJson, mergeFaq, scenariosFromJson, stringsFromJson, type FaqEntry,
} from "../packs/listing-shape.js";

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
  pricePoints: number; upgradePoints: number;
  instructions: string;
  /** What it is for; the shelf's categories are these, counted. */
  tags?: string;
  /** A hero image: a filename under /assets, or an absolute URL. */
  image?: string;
  /** The job this worker does, from P.ROLES. */
  role?: string;
  pinnedModels?: string[];
  mcpServers?: Array<{ name: string; url: string }>;
  /** What the pack's `tools:` block declared — a name and its permission
   *  policy per tool. Undefined leaves the stored set alone on an update
   *  (a plain details-form save does not carry this); an explicit array,
   *  including an empty one, replaces it — the same rule `importPack` already
   *  gives mcpServers. */
  tools?: Array<{ name: string; policy: string }>;
  payoutEmail?: string;
  extras?: P.PackExtras;
  /** The listing a buyer reads before they buy, carried in from a folder or
   *  written in the browser. Plain fields rather than `Listing` itself —
   *  `listing.ts` imports `authoring.ts`, not the other way round. */
  descriptionLong?: string;
  useCases?: string[];
  limitations?: string[];
  faq?: Array<{ q: string; a: string }>;
  /** Written examples of a session — never a recorded run, never a buyer's brief. */
  scenarios?: Array<{ brief: string; reached: string[]; output: string }>;
  requirements?: string[];
  builtOn?: string;
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
  if (!Number.isInteger(input.pricePoints) || input.pricePoints < 0) {
    throw new PackConflictError("the price must be a whole number of points, or zero");
  }
  if (!Number.isInteger(input.upgradePoints) || input.upgradePoints < 0) {
    throw new PackConflictError("update points must be a whole number, or zero");
  }
  for (const tool of input.tools ?? []) {
    if (!TOOL_POLICIES.has(tool.policy)) {
      throw new PackConflictError(
        `tools: "${tool.name}" declares permission_policy "${tool.policy}", which is not one of `
        + `${[...TOOL_POLICIES].join(", ")}`);
    }
  }
}

/**
 * The three policies the platform's agent config actually has.
 *
 * A pack's `tools:` block is author-supplied text parsed out of their own
 * `agent.md`, and this is the one field of it with a closed set of values —
 * so it is checked before it becomes a stored fact, alongside every other
 * reason a pack is refused. A typo reaching `pack_tools` is a word the
 * runtime has never heard of, recorded as what a worker may do; refusing it
 * with the author's own spelling in the message is the only useful answer.
 */
const TOOL_POLICIES = new Set(["always_allow", "always_ask", "auto"]);

/**
 * Tools and MCP servers are child rows, not columns — written after the pack
 * row exists rather than threaded into the hand-built INSERT/UPDATE above,
 * which is already long enough that one more positional placeholder is a
 * transposition waiting to happen. Replace-all: delete what is there, insert
 * the current set.
 */
async function saveTools(s: Awaited<ReturnType<typeof sql>>, packId: string,
  tools: Array<{ name: string; policy: string }>): Promise<void> {
  await s.query("DELETE FROM pack_tools WHERE pack_id = $1", [packId]);
  for (const t of tools) {
    await s.query("INSERT INTO pack_tools (pack_id, name, policy) VALUES ($1,$2,$3)", [packId, t.name, t.policy]);
  }
}

async function saveMcpServers(s: Awaited<ReturnType<typeof sql>>, packId: string,
  servers: Array<{ name: string; url: string }>): Promise<void> {
  await s.query("DELETE FROM pack_mcp_servers WHERE pack_id = $1", [packId]);
  for (const m of servers) {
    await s.query("INSERT INTO pack_mcp_servers (pack_id, name, url) VALUES ($1,$2,$3)", [packId, m.name, m.url]);
  }
}

export async function createPack(orgId: string, input: PackInput): Promise<P.PackRow> {
  validate(input);
  const slug = normaliseSlug(input.slug || input.name);
  if (await P.getPack(slug)) throw new PackConflictError(`there is already a pack at /packs/${slug}`);
  const s = await sql();
  const packId = id("pk");
  await s.query(
    // `price_cents` is written explicitly, as 0 — see `seedCatalog`. It is the
    // dead half of the old money model, but it is NOT NULL and has no DEFAULT
    // on any database that predates the millipoints rename.
    `INSERT INTO packs (id, slug, name, tagline, author, author_org_id, price_cents, price_points,
       upgrade_points, model, effort, pinned_models, extras, instructions, tags, image, role, status,
       author_payout_email, created_at, description, use_cases, limitations, faq, requirements, built_on,
       scenarios)
     VALUES ($1,$2,$3,$4,$5,$6,0,$7,$8,$9,$10,$11,$12,$13,$16,$17,$18,'draft',$14,$15,$19,$20,$21,$22,$23,$24,$25)`,
    [packId, slug, input.name.trim(), input.tagline.trim(), input.author.trim() || "unattributed",
      orgId, input.pricePoints, input.upgradePoints, input.model.trim(), input.effort ?? "",
      JSON.stringify(input.pinnedModels ?? []), JSON.stringify(input.extras ?? {}),
      input.instructions.trim(), input.payoutEmail?.trim() || null, now(),
      input.tags?.trim() ?? "", input.image?.trim() || null, input.role?.trim() ?? "",
      input.descriptionLong?.trim() ?? "", JSON.stringify(input.useCases ?? []),
      JSON.stringify(input.limitations ?? []), JSON.stringify(input.faq ?? []),
      JSON.stringify(input.requirements ?? []), input.builtOn?.trim() ?? "",
      JSON.stringify(input.scenarios ?? [])]);
  await saveTools(s, packId, input.tools ?? []);
  await saveMcpServers(s, packId, input.mcpServers ?? []);
  return (await P.getPack(slug))!;
}

/**
 * Only the author's organisation may edit, and a slug never changes.
 *
 * Every absent listing field is written back as the value this function just
 * read, so that a caller which never mentions one cannot wipe it. For five of
 * the six that is harmless — they are prose only the author writes, so
 * nobody else's value can be in flight. `faq` is the exception: `publishToFaq`
 * writes it too, from a creator's inbox, so writing back a value read two
 * awaits ago erases an answer that landed in between. A plain details-form
 * save mentions no listing field at all, and that was enough to lose one.
 *
 * So `faq` is left out of the SET list entirely unless the caller states it.
 * Not a guard, not a merge — no write, so there is nothing to race with, and
 * `packs.faq`'s writers stay the three that mean to write it.
 *
 * `expect.faq` is for the caller that does state it: it makes the whole
 * statement conditional on the column still holding the value that caller
 * computed from, and raises `FaqContendedError` when it does not. See
 * `updateFaq` in `listing.ts` for why this is a compare-and-set and not a
 * transaction.
 */
export async function updatePack(
  orgId: string, slug: string, input: PackInput, expect?: { faq: string },
): Promise<P.PackRow> {
  const pack = await P.getPack(slug);
  if (!pack) throw new PackConflictError(`no pack at /packs/${slug}`);
  if (pack.author_org_id !== orgId) throw new NotTheAuthorError();
  validate(input);
  const s = await sql();
  // `faq` is the last assignment and the last-but-one parameter precisely so
  // that leaving it out needs no renumbering of the twenty-one before it. An
  // unreferenced `$n` is not free: Postgres infers a type per parameter up to
  // the highest one used, so a gap in the middle is a "could not determine
  // data type" error rather than an ignored value.
  const faqSet = input.faq === undefined ? "" : ", faq = $22";
  const guard = expect ? ` AND COALESCE(faq, '') = $${input.faq === undefined ? 22 : 23}` : "";
  const written = await s.query<{ id: string }>(
    `UPDATE packs SET name = $1, tagline = $2, author = $3, price_points = $4, upgrade_points = $5,
       model = $6, effort = $7, pinned_models = $8, extras = $9, instructions = $10,
       author_payout_email = $11, tags = $13, image = $14, role = $15,
       description = $16, use_cases = $17, limitations = $18, requirements = $19, built_on = $20,
       scenarios = $21${faqSet}
     WHERE id = $12${guard} RETURNING id`,
    [input.name.trim(), input.tagline.trim(), input.author.trim() || pack.author,
      input.pricePoints, input.upgradePoints, input.model.trim(), input.effort ?? "",
      JSON.stringify(input.pinnedModels ?? []), JSON.stringify(input.extras ?? {}),
      input.instructions.trim(), input.payoutEmail?.trim() || null, pack.id,
      input.tags?.trim() ?? pack.tags, input.image?.trim() || pack.image,
      input.role?.trim() || pack.role,
      // A caller that never mentions the listing (the plain pack-details form,
      // for instance) must not wipe one set through the import or listing
      // flows — so an absent field keeps the row's current value. `faq` is
      // the one that does this by not being written at all; see above.
      input.descriptionLong?.trim() ?? pack.description,
      input.useCases ? JSON.stringify(input.useCases) : pack.use_cases,
      input.limitations ? JSON.stringify(input.limitations) : pack.limitations,
      input.requirements ? JSON.stringify(input.requirements) : pack.requirements,
      input.builtOn?.trim() ?? pack.built_on,
      input.scenarios ? JSON.stringify(input.scenarios) : pack.scenarios,
      ...(input.faq === undefined ? [] : [JSON.stringify(input.faq)]),
      ...(expect ? [expect.faq] : [])]);
  // A conditional write that matched nothing means somebody else wrote the
  // FAQ between the caller's read and this statement. Nothing here changed,
  // so the caller can re-read, merge again and run the whole thing — which is
  // what `importPack` below does. Without `expect` there is no condition to
  // miss and a zero-row result can only be the row having been deleted
  // mid-call, which is left as it was rather than made a new failure mode.
  if (expect && written.length === 0) throw new FaqContendedError();
  // Undefined means this caller never mentioned the field (the plain
  // details-form save, for instance) and the stored set is left alone;
  // an explicit array — including an empty one — replaces it, so re-importing
  // a folder whose tools: block shrank or whose mcp_servers disappeared is
  // honoured rather than ignored.
  if (input.tools !== undefined) await saveTools(s, pack.id, input.tools);
  if (input.mcpServers !== undefined) await saveMcpServers(s, pack.id, input.mcpServers);
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
  // The debut date, written once. The pack page's trust rail says "reviewed
  // and listed on <date>", and that date has to survive a withdrawal and a
  // relisting — a pack that came back to the shelf is not a new pack. So the
  // first time it reaches `listed` is the stamp, and nothing moves it after.
  const listedAt = status === "listed" ? (pack.listed_at ?? now()) : pack.listed_at;
  const s = await sql();
  await s.query("UPDATE packs SET status = $1, listed_at = $2 WHERE id = $3", [status, listedAt, pack.id]);
}

/**
 * The curator's one knob on shelf order: a plain integer, lower first, null
 * to clear it. Until there is real usage to rank by, this is the only honest
 * signal a curated shelf has — so only the curator may set it, same gate as
 * every other `/curate` action.
 */
export async function setFeaturedRank(actorOrgId: string, slug: string, rank: number | null): Promise<void> {
  const pack = await P.getPack(slug);
  if (!pack) throw new PackConflictError(`no pack at /packs/${slug}`);
  const curator = await platformOrgId();
  if (curator === null || curator !== actorOrgId) throw new NotTheCuratorError();
  if (rank != null && !Number.isFinite(rank)) {
    throw new PackConflictError("featured rank must be a finite number or empty");
  }
  const s = await sql();
  await s.query("UPDATE packs SET featured_rank = $1 WHERE id = $2",
    [rank == null ? null : Math.round(rank), pack.id]);
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
 * `updatePack`, with the folder's FAQ merged over whatever is stored at the
 * moment of writing rather than whatever was stored when the import started.
 *
 * The merge itself is Ruling 12's rule from the other side: a folder's `faq:`
 * block knows nothing of the answers `publishToFaq` put on the page out of a
 * real buyer exchange, so the live entries win and a re-import can only add.
 * But reading the column, merging in memory and writing the whole thing back
 * is the same lost-update shape `approveDraft` and `publishToFaq` already
 * guard against: an inbox publish landing in that gap was simply erased by
 * the import. So the value is recomputed from what is actually stored and the
 * write is conditional on it, retrying on a miss — the loser re-reads,
 * re-merges and writes again, and nobody's answer disappears.
 */
async function updateMergingFaq(
  orgId: string, slug: string, input: PackInput, proposed: FaqEntry[],
): Promise<P.PackRow> {
  for (let attempt = 1; attempt <= FAQ_WRITE_ATTEMPTS; attempt += 1) {
    const current = await P.getPack(slug);
    if (!current) throw new PackConflictError(`no pack at /packs/${slug}`);
    const was = current.faq ?? "";
    try {
      return await updatePack(
        orgId, slug, { ...input, faq: mergeFaq(faqFromJson(was), proposed) }, { faq: was });
    } catch (e) {
      if (!(e instanceof FaqContendedError)) throw e;
    }
  }
  throw new FaqContendedError();
}

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
  anthropicSkills: string[]; advisorModel?: string;
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
    // The folder wins when it states a price: it is the author's own copy of
    // the pack, and a value they wrote there should not be silently ignored.
    pricePoints: parsed.pricePoints ?? args.defaults?.pricePoints ?? existing?.price_points ?? 0,
    tags: parsed.tags ?? existing?.tags ?? "",
    image: parsed.image ?? existing?.image ?? undefined,
    role: parsed.role ?? existing?.role ?? "",
    upgradePoints: args.defaults?.upgradePoints ?? existing?.upgrade_points ?? 0,
    instructions: parsed.instructions,
    pinnedModels: parsed.pinnedModels.length
      ? parsed.pinnedModels
      : existing ? JSON.parse(existing.pinned_models) : args.defaults?.pinnedModels ?? [],
    mcpServers: parsed.mcpServers,
    tools: parsed.tools,
    payoutEmail: args.defaults?.payoutEmail ?? existing?.author_payout_email ?? undefined,
    // Same precedence as above: the folder wins when it says something, an
    // approved listing already on the pack survives otherwise, so a re-import
    // of just the instructions does not wipe a listing an author wrote in
    // the browser.
    descriptionLong: parsed.descriptionLong ?? existing?.description ?? "",
    // Parsed through the shared shape module rather than `JSON.parse`: these
    // columns are read back off a row this process did not necessarily write,
    // and `listing.ts` makes "tolerate a malformed column" an explicit
    // invariant everywhere else. A hand-fixed row should not make an import
    // throw.
    useCases: parsed.useCases.length ? parsed.useCases : stringsFromJson(existing?.use_cases),
    limitations: parsed.limitations.length ? parsed.limitations : stringsFromJson(existing?.limitations),
    // The FAQ is the one listing field that merges instead of replacing.
    // Every other field is prose only the author writes, so a folder that
    // states one is the author changing their mind. An FAQ entry can also
    // arrive from a real buyer exchange — `publishToFaq` quotes a question
    // and the creator's own answer onto this column — and a folder carrying
    // a `faq:` block has no idea those exist. Replacing wholesale deleted
    // them, with no way back but the thread they came from. The live entries
    // win on a repeated question, same rule `approveDraft` follows.
    //
    // This value is the one a *new* pack is created with, where there is
    // nothing to merge against and nobody to race; on an update it is
    // recomputed under a compare-and-set by `updateMergingFaq`.
    faq: mergeFaq(faqFromJson(existing?.faq), parsed.faq),
    scenarios: parsed.scenarios.length ? parsed.scenarios : scenariosFromJson(existing?.scenarios),
    requirements: parsed.requirements.length ? parsed.requirements : stringsFromJson(existing?.requirements),
    builtOn: parsed.builtOn ?? existing?.built_on ?? "",
    extras: {
      ...(parsed.anthropicSkills.length ? { anthropicSkills: parsed.anthropicSkills } : {}),
      ...(parsed.advisorModel ? { advisorModel: parsed.advisorModel } : {}),
      ...(parsed.web ? { web: parsed.web } : {}),
    },
  };

  const created = !existing;
  if (existing && existing.author_org_id !== args.orgId) throw new NotTheAuthorError();
  const pack = existing
    ? await updateMergingFaq(args.orgId, slug, input, parsed.faq)
    : await createPack(args.orgId, input);

  const { warnings } = await P.savePackTree(pack.id, tree);
  return {
    pack: (await P.getPack(slug))!, created, parsed,
    skills: skills.map((sk) => sk.name),
    subagents: subagents.map((sa) => sa.name),
    commands: findCommands(tree).map((c) => c.name),
    hooks: findHooks(tree),
    workflows: findWorkflows(tree),
    anthropicSkills: parsed.anthropicSkills,
    ...(parsed.advisorModel ? { advisorModel: parsed.advisorModel } : {}),
    inert, warnings,
  };
}
