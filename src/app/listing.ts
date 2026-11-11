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
 * What both of them need — the shape of a listing, the JSON parsers and the
 * FAQ merge — is in `src/packs/listing-shape.ts`, which imports nothing.
 */
import { now, platformOrgId } from "./db.js";
import { sql } from "./sql.js";
import { DomainError } from "./errors.js";
import { NotTheAuthorError, PackConflictError } from "./authoring.js";
import * as P from "./platform.js";
import {
  faqFromJson, listingFromColumns, listingFromParts, mergeFaq,
  type DraftAuthor, type FaqEntry, type Listing, type ListingColumns,
} from "../packs/listing-shape.js";

/**
 * The shape itself lives in `src/packs/listing-shape.ts`, a leaf module, so
 * `authoring.ts` and `messages.ts` can share it: this module imports
 * `authoring.ts`, so nothing in `authoring.ts` may import this one back.
 * Re-exported here because a listing is still this module's subject —
 * callers say `L.Listing` and `L.mergeFaq`, and the move is not their news.
 */
export { listingFromParts, mergeFaq };
export type { DraftAuthor, Listing };

type DraftRow = ListingColumns & {
  pack_id: string; generated_at: string; source_version: number | null; authored_by: string | null;
};

/** The listing currently approved and live on the pack. */
export function listingOf(pack: P.PackRow): Listing {
  return listingFromColumns(pack);
}

/** Whether a listing says anything at all — one field with something in it. */
export function hasContent(l: Listing): boolean {
  return l.description.trim().length > 0 || l.useCases.length > 0 || l.limitations.length > 0
    || l.faq.length > 0 || l.scenarios.length > 0 || l.requirements.length > 0;
}

/** Whether a pack has any real listing content beyond its tagline. */
export function hasListing(pack: P.PackRow): boolean {
  return hasContent(listingOf(pack));
}

/** A draft plus the three facts the approval screen needs about it. */
export type PendingDraft = {
  listing: Listing; generatedAt: string; sourceVersion: number | null;
  /** Who saved it last, which decides what approval does with the FAQ. */
  authoredBy: DraftAuthor;
};

/** The draft awaiting approval, with when it was generated and from what. */
export async function draftWithMeta(packId: string): Promise<PendingDraft | null> {
  const s = await sql();
  const row = await s.one<DraftRow>("SELECT * FROM pack_listing_drafts WHERE pack_id = $1", [packId]);
  if (!row) return null;
  return {
    listing: listingFromColumns(row),
    generatedAt: row.generated_at,
    sourceVersion: row.source_version == null ? null : Number(row.source_version),
    // Anything but an explicit "human" is read as generator-written: an
    // unmarked row is one this code did not write, and generator is the
    // reading under which no published answer can be lost.
    authoredBy: row.authored_by === "human" ? "human" : "generator",
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

/**
 * A save with nothing in it at all.
 *
 * `POST /packs/:slug/listing` upserts whatever arrives, so a submission with
 * all six boxes blank replaced a generated draft with an empty one and said
 * nothing — a draft gone and a model call to get it back.
 *
 * Refused outright rather than only when the pack has no live content,
 * because the exception would permit exactly the case with the most to lose:
 * an all-empty POST against a pack that *does* have an approved listing
 * destroys the draft and then, approved, blanks the page. An all-empty form
 * is also the shape an accident takes — a submit with the fields never
 * filled, a resubmitted empty form — and it is indistinguishable from the
 * deliberate version. Nothing is unreachable as a result: any five fields can
 * be emptied, the FAQ included, so every field can still be cleared and
 * published. Taking a listing off the page altogether is what withdrawing the
 * pack is for, and that is a reviewable action rather than a blank form.
 */
export class ListingEmptyError extends DomainError {
  constructor() {
    super(
      "every field was blank, so nothing was saved and the draft you had is still there — "
      + "fill in at least one, or withdraw the pack if you want it off the shelf altogether",
      409, "ListingEmptyError");
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

/** The guard, as a statement: this listing is prose, not a copy of the method. */
function assertNotVerbatim(listing: Listing, instructions: string): void {
  const run = verbatimRun(listing, instructions);
  if (run) throw new ListingVerbatimError(run);
}

/**
 * Replace whatever draft exists for this pack with one a person saved.
 *
 * This is the human path, and the draft it writes is marked as such: the
 * author takes responsibility for its contents, so approval publishes the
 * FAQ exactly as they left it, deletions included. A human editing a
 * generated draft flips it — the upsert below writes `authored_by` like any
 * other column — which is the point: once somebody has read a generated FAQ
 * and saved it, the entries in it are theirs.
 *
 * Use `saveGeneratedDraft` for anything a model wrote: a generator knows
 * nothing of the answers published out of a buyer exchange, so its draft
 * carries the live FAQ forward and can never delete one.
 */
export async function saveDraft(
  packId: string, listing: Listing, sourceVersion: number | null,
): Promise<void> {
  // Emptiness first: it needs no pack row, and an empty listing cannot
  // repeat the instructions anyway.
  if (!hasContent(listing)) throw new ListingEmptyError();
  const pack = await P.packById(packId);
  if (pack) assertNotVerbatim(listing, pack.instructions);
  await writeDraft(packId, listing, sourceVersion, "human");
}

/** The write itself, with nothing judged — every caller above guards first. */
async function writeDraft(
  packId: string, listing: Listing, sourceVersion: number | null, authoredBy: DraftAuthor,
): Promise<void> {
  const s = await sql();
  await s.query(
    `INSERT INTO pack_listing_drafts
       (pack_id, description, use_cases, limitations, faq, scenarios, requirements, generated_at, source_version,
        authored_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (pack_id) DO UPDATE SET
       description = EXCLUDED.description, use_cases = EXCLUDED.use_cases, limitations = EXCLUDED.limitations,
       faq = EXCLUDED.faq, scenarios = EXCLUDED.scenarios, requirements = EXCLUDED.requirements,
       generated_at = EXCLUDED.generated_at, source_version = EXCLUDED.source_version,
       authored_by = EXCLUDED.authored_by`,
    [packId, listing.description, JSON.stringify(listing.useCases), JSON.stringify(listing.limitations),
      JSON.stringify(listing.faq), JSON.stringify(listing.scenarios), JSON.stringify(listing.requirements),
      now(), sourceVersion, authoredBy]);
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
 *
 * The copy-quality guard runs on the *proposal*, before the live FAQ is
 * merged in, and the merged value is then written unjudged. Guarding the
 * merged listing judged text this function had just injected: `publishToFaq`
 * stores a buyer's question and a creator's answer word for word, and the
 * instructions are not secret — one creator explaining their own method in an
 * answer would have blocked every future generation for that pack, with an
 * error that blamed the model.
 */
export async function saveGeneratedDraft(
  packId: string, listing: Listing, sourceVersion: number | null,
): Promise<void> {
  const pack = await P.packById(packId);
  if (pack) assertNotVerbatim(listing, pack.instructions);
  const live = pack ? listingOf(pack) : null;
  await writeDraft(packId, {
    ...listing,
    faq: mergeFaq(live?.faq ?? [], listing.faq),
  }, sourceVersion, "generator");
}

/**
 * `packs.faq` has two writers, and both of them read it, change it in memory
 * and write the whole column back: `approveDraft` here, and
 * `publishToFaq` in `messages.ts`, where a creator quotes a buyer's question
 * and their own answer onto the page. Interleave those two read-modify-write
 * cycles and the loser's entry is gone — the exact content loss the FAQ merge
 * exists to prevent, arrived at from the other direction.
 *
 * There is no transaction primitive to reach for: `src/app/sql.ts` exposes
 * `query`/`one`/`exec`/`close`, and adding one is a change with its own
 * blast radius (pooled connections, two drivers, every existing caller) and
 * its own review. So the narrow fix, which needs nothing new: make the write
 * conditional on the value it was computed from, and retry on a miss. The
 * loser re-reads, re-merges and writes again; nobody's answer disappears.
 *
 * `COALESCE(faq, '')` on both sides because the column arrived by migration
 * and an older row can hold SQL NULL where a newer one holds `''` — and in
 * both dialects `NULL = NULL` is not true, which would turn a retry loop
 * into a guaranteed failure on exactly those rows.
 */
const FAQ_WRITE_ATTEMPTS = 5;

export class FaqContendedError extends DomainError {
  constructor() {
    super("the FAQ was being written by somebody else at the same time — try that again",
      409, "FaqContendedError");
  }
}

/**
 * Read `packs.faq`, let the caller decide what it should become, and write it
 * back only if nobody else changed it in between.
 *
 * The one place `packs.faq` is appended to, so a second writer cannot be
 * added without inheriting the guard.
 */
export async function updateFaq(packId: string, next: (live: FaqEntry[]) => FaqEntry[]): Promise<void> {
  const s = await sql();
  for (let attempt = 1; attempt <= FAQ_WRITE_ATTEMPTS; attempt += 1) {
    const row = await s.one<{ faq: string | null }>("SELECT faq FROM packs WHERE id = $1", [packId]);
    if (!row) throw new PackConflictError("no such pack");
    const was = row.faq ?? "";
    const written = await s.query<{ id: string }>(
      `UPDATE packs SET faq = $1 WHERE id = $2 AND COALESCE(faq, '') = $3 RETURNING id`,
      [JSON.stringify(next(faqFromJson(was))), packId, was]);
    if (written.length > 0) return;
  }
  throw new FaqContendedError();
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

  const pending = await draftWithMeta(pack.id);
  if (!pending) throw new PackConflictError("there is no draft to approve");
  const draft = pending.listing;

  // The FAQ is the one field whose publication depends on who wrote the draft.
  //
  // A generated draft was seeded from the live FAQ when it was generated, but
  // a creator can publish another answer out of the inbox in between — so for
  // a generator the union is taken again here, at the moment of writing.
  // Publishing a *generated* listing is never the thing that deletes an
  // answer somebody wrote to a buyer.
  //
  // A draft a person saved is the opposite case, and the merge was never
  // meant to cover it: they read the questions in the box, changed them and
  // pressed save, so their version is the whole FAQ — a corrected answer
  // reaches the page and a deleted one leaves it. Without this branch nothing
  // in the application could edit a live answer at all, while the screen
  // said otherwise.
  //
  // "At the moment of writing" has to mean it: between this read and this
  // write, `publishToFaq` can land. So the pack is re-read each attempt, the
  // value recomputed from what is actually stored, and the write conditional
  // on that value — the same compare-and-set `updateFaq` makes, extended over
  // the other five columns this statement also sets. See `updateFaq` above
  // for why this is not a transaction. On the human path the retry re-reads
  // and then still writes the author's own list, which is what authoritative
  // means: an answer published in that gap is one they did not keep.
  const s = await sql();
  for (let attempt = 1; attempt <= FAQ_WRITE_ATTEMPTS; attempt += 1) {
    const current = await P.packById(pack.id);
    if (!current) throw new PackConflictError(`no pack at /packs/${slug}`);
    const was = current.faq ?? "";
    const faq = pending.authoredBy === "human" ? draft.faq : mergeFaq(listingOf(current).faq, draft.faq);
    const written = await s.query<{ id: string }>(
      `UPDATE packs SET description = $1, use_cases = $2, limitations = $3, faq = $4, scenarios = $5,
         requirements = $6, listing_approved_at = $7, listing_stale_at = NULL
       WHERE id = $8 AND COALESCE(faq, '') = $9 RETURNING id`,
      [draft.description, JSON.stringify(draft.useCases), JSON.stringify(draft.limitations),
        JSON.stringify(faq), JSON.stringify(draft.scenarios), JSON.stringify(draft.requirements),
        now(), pack.id, was]);
    if (written.length > 0) {
      await s.query("DELETE FROM pack_listing_drafts WHERE pack_id = $1", [pack.id]);
      return;
    }
  }
  throw new FaqContendedError();
}

/** A pack was edited: its live listing may no longer describe what ships. */
export async function markStale(packId: string): Promise<void> {
  const s = await sql();
  await s.query("UPDATE packs SET listing_stale_at = $1 WHERE id = $2", [now(), packId]);
}
