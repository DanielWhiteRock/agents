/**
 * Ratings, reviews, votes and saves — the social proof `platform.ts`
 * deliberately withholds until it has been earned.
 *
 * `packStats` already argues the case: a pack nobody has used says so by
 * showing nothing, which is the honest version of a new listing. This module
 * adds the rating that case was guarding against being shown too early —
 * gated two ways:
 *
 *   - Eligibility to rate at all: a `runs` row for this pack, not a trial,
 *     actually finished. Buying is not running; starting is not finishing.
 *   - Eligibility to *show* the average: five ratings, no fewer. Below that
 *     the written reviews still show — they are useful individually in a way
 *     a 1-of-1 average is not — but the number stays hidden.
 *
 * `RATING_THRESHOLD` lives here and only here; `creators.ts` deliberately
 * left the aggregate out of `creatorStats` so this constant would have one
 * home instead of two that could drift.
 *
 * Votes are a lighter signal than a review — "this looks good", not "this
 * worked" — and need no run at all, so `vote` never calls `mayReview`.
 */
import { id, now } from "./db.js";
import { sql } from "./sql.js";
import { DomainError } from "./errors.js";

export const RATING_THRESHOLD = 5;

/** Thrown by `submitReview` when the organisation has not earned an opinion yet. */
export class ReviewNotAllowedError extends DomainError {
  constructor() {
    super(
      "only an organisation that has completed a run of this pack may rate it",
      403,
      "ReviewNotAllowedError",
    );
  }
}

/**
 * True only when this organisation has a finished, non-trial run of some
 * version of this pack. Counted the way `packStats` counts runs — joined
 * through `pack_versions`, `is_trial = 0` — with one addition: the run must
 * have ended. A run started and abandoned is not an opinion.
 */
export async function mayReview(orgId: string, packId: string): Promise<boolean> {
  const s = await sql();
  const row = await s.one<{ ok: number }>(
    `SELECT 1 AS ok FROM runs r JOIN pack_versions v ON v.id = r.pack_version_id
      WHERE r.org_id = $1 AND v.pack_id = $2 AND r.is_trial = 0 AND r.ended_at IS NOT NULL
      LIMIT 1`,
    [orgId, packId],
  );
  return Boolean(row);
}

export type SubmitReviewInput = {
  orgId: string;
  userId: string;
  packId: string;
  rating?: number;
  body?: string;
  byline: string;
  anonymous: boolean;
};

/**
 * One organisation, one review, editable forever: upserts on `(pack_id,
 * org_id)`. Throws when `mayReview` is false, so an ineligible organisation
 * cannot get a rating in by calling this directly.
 *
 * An anonymous review keeps whatever rating and body were given but drops
 * the byline entirely — not just at render time, on the row itself — so the
 * name chosen at submit time never reaches storage for an anonymous review.
 * `user_id` is always recorded, for audit, never for display: the
 * individual's name and email live only in `users` and are never written
 * here.
 */
export async function submitReview(args: SubmitReviewInput): Promise<void> {
  if (!(await mayReview(args.orgId, args.packId))) throw new ReviewNotAllowedError();

  const rating = args.rating == null ? null : Math.max(1, Math.min(5, Math.round(args.rating)));
  const byline = args.anonymous ? null : (args.byline.trim() || null);
  const t = now();

  const s = await sql();
  await s.query(
    `INSERT INTO pack_reviews (id, pack_id, org_id, user_id, rating, body, byline, anonymous, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)
     ON CONFLICT (pack_id, org_id) DO UPDATE SET
       rating = EXCLUDED.rating, body = EXCLUDED.body, byline = EXCLUDED.byline,
       anonymous = EXCLUDED.anonymous, updated_at = EXCLUDED.updated_at`,
    [
      id("rev"), args.packId, args.orgId, args.userId, rating,
      args.body?.trim() ?? "", byline, args.anonymous ? 1 : 0, t,
    ],
  );
}

export type Rating = {
  average: number | null;
  count: number;
  distribution: [number, number, number, number, number];
};

/** The shared aggregation behind `ratingOf` and `creatorRating`. */
async function aggregateRating(whereSql: string, params: unknown[]): Promise<Rating> {
  const s = await sql();
  const rows = await s.query<{ rating: number | string }>(
    `SELECT rating FROM pack_reviews WHERE rating IS NOT NULL AND ${whereSql}`,
    params,
  );
  const distribution: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  let sum = 0;
  for (const row of rows) {
    const n = Number(row.rating);
    if (n >= 1 && n <= 5) distribution[n - 1] = (distribution[n - 1] ?? 0) + 1;
    sum += n;
  }
  const count = rows.length;
  return { average: count >= RATING_THRESHOLD ? sum / count : null, count, distribution };
}

/**
 * A single pack's rating. `distribution` and `count` are always real —
 * useful even at one rating — but `average` stays `null` until five ratings
 * exist, exactly the threshold `packStats`'s own reasoning calls for.
 */
export async function ratingOf(packId: string): Promise<Rating> {
  return aggregateRating("pack_id = $1", [packId]);
}

/**
 * The same threshold rule, applied across every pack a creator has been
 * attributed (Task 7's `creator_id`), so a creator with four packs at one
 * rating each is still below the threshold and a creator with five across
 * two packs is not.
 */
export async function creatorRating(creatorId: string): Promise<{ average: number | null; count: number }> {
  const { average, count } = await aggregateRating(
    "pack_id IN (SELECT id FROM packs WHERE creator_id = $1)",
    [creatorId],
  );
  return { average, count };
}

/**
 * "This looks good" — no run required, unlike a review. One vote per
 * organisation per pack; voting again replaces the previous value rather
 * than adding a second row.
 *
 * `value` is clamped to -1..1 here, in the one place every caller passes
 * through — the UI only ever sends 1, but a later caller (the MCP surface,
 * say) might not, and the next task orders the whole shelf by the sum of
 * these, so an unbounded value would skew it for everyone, not just the
 * pack that sent it.
 */
export async function vote(orgId: string, packId: string, value: number): Promise<void> {
  const clamped = Math.max(-1, Math.min(1, Math.round(Number(value) || 0)));
  const s = await sql();
  await s.query(
    `INSERT INTO pack_votes (pack_id, org_id, value) VALUES ($1,$2,$3)
     ON CONFLICT (pack_id, org_id) DO UPDATE SET value = EXCLUDED.value`,
    [packId, orgId, clamped],
  );
}

/**
 * Bookmark a pack, or remove the bookmark if one is already there. Returns
 * the new saved state so a caller can render the toggle without a second
 * read.
 */
export async function toggleSave(orgId: string, userId: string, packId: string): Promise<boolean> {
  const s = await sql();
  const existing = await s.one<{ ok: number }>(
    "SELECT 1 AS ok FROM pack_saves WHERE pack_id = $1 AND org_id = $2",
    [packId, orgId],
  );
  if (existing) {
    await s.query("DELETE FROM pack_saves WHERE pack_id = $1 AND org_id = $2", [packId, orgId]);
    return false;
  }
  await s.query(
    "INSERT INTO pack_saves (pack_id, org_id, user_id, created_at) VALUES ($1,$2,$3,$4)",
    [packId, orgId, userId, now()],
  );
  return true;
}
