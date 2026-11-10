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
function parseArray<T>(raw: string): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function fromColumns(row: ListingColumns): Listing {
  return {
    description: row.description || "",
    useCases: parseArray<string>(row.use_cases),
    limitations: parseArray<string>(row.limitations),
    faq: parseArray<{ q: string; a: string }>(row.faq),
    scenarios: parseArray<{ brief: string; reached: string[]; output: string }>(row.scenarios),
    requirements: parseArray<string>(row.requirements),
  };
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

/** The draft awaiting approval, if there is one. */
export async function draftFor(packId: string): Promise<Listing | null> {
  const s = await sql();
  const row = await s.one<DraftRow>("SELECT * FROM pack_listing_drafts WHERE pack_id = $1", [packId]);
  return row ? fromColumns(row) : null;
}

/** Replace whatever draft exists for this pack with a freshly generated one. */
export async function saveDraft(packId: string, listing: Listing, sourceVersion: number): Promise<void> {
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

  const s = await sql();
  await s.query(
    `UPDATE packs SET description = $1, use_cases = $2, limitations = $3, faq = $4, scenarios = $5,
       requirements = $6, listing_approved_at = $7, listing_stale_at = NULL WHERE id = $8`,
    [draft.description, JSON.stringify(draft.useCases), JSON.stringify(draft.limitations),
      JSON.stringify(draft.faq), JSON.stringify(draft.scenarios), JSON.stringify(draft.requirements),
      now(), pack.id]);
  await s.query("DELETE FROM pack_listing_drafts WHERE pack_id = $1", [pack.id]);
}

/** A pack was edited: its live listing may no longer describe what ships. */
export async function markStale(packId: string): Promise<void> {
  const s = await sql();
  await s.query("UPDATE packs SET listing_stale_at = $1 WHERE id = $2", [now(), packId]);
}
