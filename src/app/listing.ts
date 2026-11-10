/**
 * Listing content: what a buyer reads before they buy.
 *
 * Approved content lives on `packs`. Proposed content — whatever a draft or a
 * regeneration produced — lives on `pack_listing_drafts` until someone with
 * the authority to publish approves it. They are separate tables so that
 * regenerating a listing can never overwrite what buyers are already reading;
 * a pack may have live content and a pending draft at the same time.
 *
 * One-way import: this module may reach into `authoring.ts` for the
 * authority pattern and its error type; `authoring.ts` never reaches back.
 */
import { now, platformOrgId } from "./db.js";
import { sql } from "./sql.js";
import { DomainError } from "./errors.js";
import { NotTheAuthorError, PackConflictError } from "./authoring.js";
import * as P from "./platform.js";

export type Listing = {
  description: string;
  useCases: string[];
  limitations: string[];
  faq: Array<{ q: string; a: string }>;
  scenarios: Array<{ brief: string; reached: string[]; output: string }>;
  requirements: string[];
};

/** The six stored columns, shared by `packs` and `pack_listing_drafts`. */
type ListingColumns = {
  description: string; use_cases: string; limitations: string; faq: string; scenarios: string; requirements: string;
};

type DraftRow = ListingColumns & { pack_id: string; generated_at: string; source_version: number | null };

/**
 * A column is stored as JSON, except it starts life as `''` rather than
 * `'[]'` — deliberate, so nothing has to be written before an author touches
 * it. `''` means empty, same as genuinely malformed JSON: either way, there
 * is nothing usable to show, so both fall through to the empty array.
 */
function parseArray(raw: string): unknown[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** A list column as the page needs it: strings with something in them. */
const strings = (raw: unknown): string[] =>
  (Array.isArray(raw) ? raw : []).map(text).filter(Boolean);

/**
 * Shape, not just type.
 *
 * `Array.isArray` was the whole check, and the page renders `s.reached.length`
 * and `f.q` straight off the element — so one stored scenario missing a field
 * took the entire pack page down with a 500 rather than dropping a card. The
 * columns hold whatever was written to them (a hand-fixed row, an older
 * writer, a generator), so the shape is settled here, once, on the way in.
 *
 * An entry with no heading — a scenario with no brief, a question with no
 * question — has nothing to render, so it is dropped rather than rendered as
 * an empty card.
 */
function toFaq(raw: unknown[]): Array<{ q: string; a: string }> {
  return raw
    .filter((e): e is Record<string, unknown> => typeof e === "object" && e !== null)
    .map((e) => ({ q: text(e["q"]), a: text(e["a"]) }))
    .filter((e) => e.q.length > 0);
}

function toScenarios(raw: unknown[]): Array<{ brief: string; reached: string[]; output: string }> {
  return raw
    .filter((e): e is Record<string, unknown> => typeof e === "object" && e !== null)
    .map((e) => ({ brief: text(e["brief"]), reached: strings(e["reached"]), output: text(e["output"]) }))
    .filter((e) => e.brief.length > 0);
}

/**
 * Six fields of unknown provenance as one listing.
 *
 * The one place the shape is decided, so a column read back off `packs` and a
 * block of JSON a generator produced cannot disagree about what a scenario
 * is — `scripts/generate-listings.mjs` normalises through here too.
 */
export function listingFromParts(parts: {
  description?: unknown; useCases?: unknown; limitations?: unknown;
  faq?: unknown; scenarios?: unknown; requirements?: unknown;
}): Listing {
  return {
    description: text(parts.description),
    useCases: strings(parts.useCases),
    limitations: strings(parts.limitations),
    faq: toFaq(Array.isArray(parts.faq) ? parts.faq : []),
    scenarios: toScenarios(Array.isArray(parts.scenarios) ? parts.scenarios : []),
    requirements: strings(parts.requirements),
  };
}

function fromColumns(row: ListingColumns): Listing {
  return listingFromParts({
    description: row.description,
    useCases: parseArray(row.use_cases),
    limitations: parseArray(row.limitations),
    faq: parseArray(row.faq),
    scenarios: parseArray(row.scenarios),
    requirements: parseArray(row.requirements),
  });
}

/** The listing currently approved and live on the pack. */
export function listingOf(pack: P.PackRow): Listing {
  return fromColumns(pack);
}

/** Whether a pack has any real listing content beyond its tagline. */
export function hasListing(pack: P.PackRow): boolean {
  const l = listingOf(pack);
  return l.description.trim().length > 0 || l.useCases.length > 0 || l.limitations.length > 0
    || l.faq.length > 0 || l.scenarios.length > 0 || l.requirements.length > 0;
}

/** A draft plus the two facts the approval screen needs about it. */
export type PendingDraft = { listing: Listing; generatedAt: string; sourceVersion: number | null };

/** The draft awaiting approval, with when it was generated and from what. */
export async function draftWithMeta(packId: string): Promise<PendingDraft | null> {
  const s = await sql();
  const row = await s.one<DraftRow>("SELECT * FROM pack_listing_drafts WHERE pack_id = $1", [packId]);
  if (!row) return null;
  return {
    listing: fromColumns(row),
    generatedAt: row.generated_at,
    sourceVersion: row.source_version == null ? null : Number(row.source_version),
  };
}

/** The draft awaiting approval, if there is one. */
export async function draftFor(packId: string): Promise<Listing | null> {
  return (await draftWithMeta(packId))?.listing ?? null;
}

/** How long a shared run of words has to be before a draft is copy, not prose. */
export const VERBATIM_RUN_WORDS = 12;

/**
 * A draft that pastes the pack body back at the buyer.
 *
 * The instructions are not a secret — a free pack hands them out over MCP and
 * a paid one on entitlement. This is a copy-quality refusal: a description
 * that quotes the method describes nothing, and shipping seventy of them
 * would be worse than shipping none.
 */
export class ListingVerbatimError extends DomainError {
  constructor(run: string) {
    super(
      `that draft repeats the pack's own instructions verbatim ("${run}…") — `
      + `a listing describes what the worker does, it does not quote the method`,
      409, "ListingVerbatimError");
  }
}

/** Comparable words: case and punctuation are not what makes a run copied. */
const wordsOf = (s: string): string[] => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];

/**
 * The first run of `VERBATIM_RUN_WORDS` words the draft shares with the
 * instructions, or null. Compared field by field, so a run is a real run of
 * prose rather than one that happens to straddle two unrelated bullets.
 */
export function verbatimRun(listing: Listing, instructions: string): string | null {
  const source = wordsOf(instructions);
  if (source.length < VERBATIM_RUN_WORDS) return null;
  const runs = new Set<string>();
  for (let i = 0; i + VERBATIM_RUN_WORDS <= source.length; i += 1) {
    runs.add(source.slice(i, i + VERBATIM_RUN_WORDS).join(" "));
  }
  const fields = [
    listing.description, ...listing.useCases, ...listing.limitations, ...listing.requirements,
    ...listing.faq.flatMap((f) => [f.q, f.a]),
    ...listing.scenarios.flatMap((s) => [s.brief, s.output, ...s.reached]),
  ];
  for (const field of fields) {
    const words = wordsOf(field);
    for (let i = 0; i + VERBATIM_RUN_WORDS <= words.length; i += 1) {
      const run = words.slice(i, i + VERBATIM_RUN_WORDS).join(" ");
      if (runs.has(run)) return run;
    }
  }
  return null;
}

/**
 * Replace whatever draft exists for this pack with a freshly generated one.
 *
 * Prefer `saveGeneratedDraft` for anything a model wrote: it carries the
 * live FAQ forward, which approval would otherwise delete.
 */
export async function saveDraft(
  packId: string, listing: Listing, sourceVersion: number | null,
): Promise<void> {
  const pack = await P.packById(packId);
  if (pack) {
    const run = verbatimRun(listing, pack.instructions);
    if (run) throw new ListingVerbatimError(run);
  }
  const s = await sql();
  await s.query(
    `INSERT INTO pack_listing_drafts
       (pack_id, description, use_cases, limitations, faq, scenarios, requirements, generated_at, source_version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (pack_id) DO UPDATE SET
       description = EXCLUDED.description, use_cases = EXCLUDED.use_cases, limitations = EXCLUDED.limitations,
       faq = EXCLUDED.faq, scenarios = EXCLUDED.scenarios, requirements = EXCLUDED.requirements,
       generated_at = EXCLUDED.generated_at, source_version = EXCLUDED.source_version`,
    [packId, listing.description, JSON.stringify(listing.useCases), JSON.stringify(listing.limitations),
      JSON.stringify(listing.faq), JSON.stringify(listing.scenarios), JSON.stringify(listing.requirements),
      now(), sourceVersion]);
}

/**
 * Two FAQs as one, the human-written entries first and winning.
 *
 * A question is the identity — asked twice, in whatever casing, it is one
 * entry — and the answer kept is the one from `live`, because that is the one
 * a creator wrote to a buyer who actually asked.
 */
export function mergeFaq(
  live: Array<{ q: string; a: string }>, proposed: Array<{ q: string; a: string }>,
): Array<{ q: string; a: string }> {
  const seen = new Set(live.map((f) => f.q.trim().toLowerCase()));
  const out = [...live];
  for (const entry of proposed) {
    const key = entry.q.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ q: entry.q.trim(), a: entry.a.trim() });
  }
  return out;
}

/**
 * Save a draft a generator produced, seeded from what is already live.
 *
 * `approveDraft` copies the draft's six fields *onto* `packs`, faq included.
 * A creator can publish a buyer's question and their own answer to
 * `packs.faq` from the inbox (`publishToFaq`), and a generator knows nothing
 * about those — so approving a generated listing would delete every answer
 * that came out of a real exchange, with no way back but the thread itself.
 * Seeding the draft from the live FAQ makes approval additive: the generator
 * can only add questions, never remove an answered one.
 */
export async function saveGeneratedDraft(
  packId: string, listing: Listing, sourceVersion: number | null,
): Promise<void> {
  const pack = await P.packById(packId);
  const live = pack ? listingOf(pack) : null;
  await saveDraft(packId, {
    ...listing,
    faq: mergeFaq(live?.faq ?? [], listing.faq),
  }, sourceVersion);
}

/**
 * Publish the draft: copy it onto `packs`, stamp the approval, clear any
 * staleness, and remove the draft so there is nothing left to re-approve.
 *
 * Follows the authority pattern `setStatus` already uses in `authoring.ts`:
 * the author's own organisation, or the curating organisation, and nobody
 * else.
 */
export async function approveDraft(orgId: string, slug: string): Promise<void> {
  const pack = await P.getPack(slug);
  if (!pack) throw new PackConflictError(`no pack at /packs/${slug}`);
  const curator = await platformOrgId();
  const isAuthor = pack.author_org_id === orgId;
  const isCurator = curator !== null && curator === orgId;
  if (!isAuthor && !isCurator) throw new NotTheAuthorError();

  const draft = await draftFor(pack.id);
  if (!draft) throw new PackConflictError("there is no draft to approve");

  // The draft was seeded from the live FAQ when it was generated, but a
  // creator can publish another answer out of the inbox in between — so the
  // union is taken again here, at the moment of writing. Publishing a listing
  // is never the thing that deletes an answer somebody wrote to a buyer.
  const faq = mergeFaq(listingOf(pack).faq, draft.faq);

  const s = await sql();
  await s.query(
    `UPDATE packs SET description = $1, use_cases = $2, limitations = $3, faq = $4, scenarios = $5,
       requirements = $6, listing_approved_at = $7, listing_stale_at = NULL WHERE id = $8`,
    [draft.description, JSON.stringify(draft.useCases), JSON.stringify(draft.limitations),
      JSON.stringify(faq), JSON.stringify(draft.scenarios), JSON.stringify(draft.requirements),
      now(), pack.id]);
  await s.query("DELETE FROM pack_listing_drafts WHERE pack_id = $1", [pack.id]);
}

/** A pack was edited: its live listing may no longer describe what ships. */
export async function markStale(packId: string): Promise<void> {
  const s = await sql();
  await s.query("UPDATE packs SET listing_stale_at = $1 WHERE id = $2", [now(), packId]);
}
