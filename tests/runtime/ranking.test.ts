import { describe, it, expect } from "vitest";
import { rankPacks, type PackRow } from "../../src/app/platform.js";

/**
 * `rankPacks` is a pure comparator: featured_rank ascending where set, then
 * runs, then rating where shown, then votes, then created_at descending.
 * Every field the real `PackRow` carries has to be present on a test row —
 * only the ones the comparator actually reads vary between cases.
 */
type Row = PackRow & { runs: number; rating: number | null; votes: number };

let n = 0;
function row(overrides: Partial<Row> = {}): Row {
  n += 1;
  return {
    id: `pack_${n}`, slug: `pack-${n}`, name: `Pack ${n}`, tagline: "", author: "Someone",
    author_org_id: null, price_points: 0, tags: "", image: null, role: "", upgrade_points: 0,
    model: "claude-opus-5", effort: "", pinned_models: "[]", instructions: "", status: "listed",
    author_payout_email: null, extras: "{}", created_at: "2026-01-01T00:00:00.000Z",
    description: "", use_cases: "", limitations: "", faq: "", scenarios: "", requirements: "",
    listing_approved_at: null, listing_stale_at: null, listed_at: null, built_on: null, creator_id: null,
    featured_rank: null, runs: 0, rating: null, votes: 0,
    ...overrides,
  };
}

describe("rankPacks", () => {
  it("lets a curator-featured pack outrank a busier unfeatured one", () => {
    const quiet = row({ id: "quiet", featured_rank: 1, runs: 0, rating: null, votes: 0 });
    const busy = row({ id: "busy", featured_rank: null, runs: 500, rating: 4.9, votes: 50 });
    const [first, second] = rankPacks([busy, quiet]);
    expect(first!.id).toBe("quiet");
    expect(second!.id).toBe("busy");
  });

  it("orders newest first when there is no signal at all — not most expensive first", () => {
    // Same regression the shelf used to have: price_points DESC made an old,
    // expensive, untouched pack beat a cheap new one. None of these rows
    // carry any ranking signal (no featured_rank, no runs, no rating, no
    // votes) — only price and age differ.
    const oldExpensive = row({
      id: "old-expensive", price_points: 9000, created_at: "2020-01-01T00:00:00.000Z",
    });
    const newCheap = row({
      id: "new-cheap", price_points: 0, created_at: "2026-11-01T00:00:00.000Z",
    });
    const midPriced = row({
      id: "mid-priced", price_points: 4000, created_at: "2024-06-01T00:00:00.000Z",
    });
    const ranked = rankPacks([oldExpensive, midPriced, newCheap]);
    expect(ranked.map((p) => p.id)).toEqual(["new-cheap", "mid-priced", "old-expensive"]);
  });

  it("gives no weight to a rating that is below the display threshold", () => {
    // A hidden rating is represented here exactly as `ratingOf` represents it
    // once below RATING_THRESHOLD: `rating: null`. It must not be able to
    // out-rank a pack whose (lower) rating is actually shown — a hidden
    // number must contribute nothing, not act as an implicit perfect score.
    const hiddenHighTrueAverage = row({
      id: "hidden", runs: 0, rating: null, votes: 0, created_at: "2025-01-01T00:00:00.000Z",
    });
    const shownLowerRating = row({
      id: "shown", runs: 0, rating: 2, votes: 0, created_at: "2024-01-01T00:00:00.000Z",
    });
    const [first, second] = rankPacks([hiddenHighTrueAverage, shownLowerRating]);
    expect(first!.id).toBe("shown");
    expect(second!.id).toBe("hidden");
  });

  it("breaks a tie on every other key deterministically, by id, regardless of input order or repeated calls", () => {
    // Same created_at (plausible: now() is millisecond resolution and a seed
    // loop can hand two packs the identical timestamp), same everything else.
    // Without a final tiebreaker the result is whatever order the rows
    // happened to arrive in — which SQL makes no promise about absent an
    // ORDER BY, and which `Array.prototype.sort`'s stability cannot fix when
    // there is no stable input order to begin with.
    const a = row({ id: "pack-a", created_at: "2026-01-01T00:00:00.000Z" });
    const b = row({ id: "pack-b", created_at: "2026-01-01T00:00:00.000Z" });
    const c = row({ id: "pack-c", created_at: "2026-01-01T00:00:00.000Z" });

    const expected = ["pack-a", "pack-b", "pack-c"];
    expect(rankPacks([a, b, c]).map((p) => p.id)).toEqual(expected);
    expect(rankPacks([c, b, a]).map((p) => p.id)).toEqual(expected);
    expect(rankPacks([b, a, c]).map((p) => p.id)).toEqual(expected);
    // Repeated calls on the same input are just as deterministic.
    expect(rankPacks([c, a, b]).map((p) => p.id)).toEqual(expected);
  });
});
