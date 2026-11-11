import { describe, it, expect } from "vitest";
import { frontPage, type FrontData } from "../../src/app/views.js";
import type { PackRow } from "../../src/app/platform.js";

/**
 * The page a stranger sees before they have an account.
 *
 * Everything it prints has to be backed by a row we hold, so these tests are
 * mostly about what it declines to say: a figure it does not have, a worker it
 * cannot sell, a match it did not find.
 */
const pack = (over: Partial<PackRow> = {}): PackRow & { pricePoints: number; runs: number } => ({
  id: "pk_1", slug: "senior-engineer", name: "Senior Engineer",
  tagline: "Reads the code before it changes it", author: "typeui.sh",
  author_org_id: null, price_points: 0, tags: "engineering,quality", image: null,
  role: "engineer", upgrade_points: 0, model: "claude-opus-5", effort: "high",
  pinned_models: "[]", instructions: "Read it first.", status: "listed",
  author_payout_email: null, extras: "{}", created_at: "2026-01-02T03:04:05.000Z",
  description: "", use_cases: "", limitations: "", faq: "", scenarios: "", requirements: "",
  listing_approved_at: null, listing_stale_at: null, listed_at: null, built_on: null,
  creator_id: null, featured_rank: null,
  pricePoints: 0, runs: 0,
  ...over,
});

const data = (over: Partial<FrontData> = {}): FrontData => ({
  totals: { packs: 71, roles: 2, authors: 6, skills: 146, runs: 0, pointsSpent: 0 },
  roles: [{ id: "engineer", name: "Engineer", blurb: "Ships it", icon: "runs", count: 4 }],
  anatomy: [{ dir: "skills", label: "Skills", packs: 71, files: 146 }],
  featured: [pack()],
  ...over,
});

describe("the stat strip", () => {
  it("leaves out a count it does not have, rather than printing a zero", () => {
    const h = frontPage(data());
    expect(h).not.toContain("<span>runs</span>");
    expect(h).not.toContain("0 runs");
  });

  it("prints the run count once there is one", () => {
    const h = frontPage(data({
      totals: { packs: 71, roles: 2, authors: 6, skills: 146, runs: 5, pointsSpent: 12 },
    }));
    expect(h).toContain("<b>5</b><span>runs</span>");
    expect(h).toContain("5 runs. That is not a typo");
  });

  it("says the shelf came first either way, so the zero is not hidden", () => {
    expect(frontPage(data())).toContain("The shelf came first and the traffic has not");
  });

  it("promises no rating it cannot show", () => {
    const h = frontPage(data());
    expect(h).toContain("no ratings, vote counts or user numbers");
  });
});

describe("the funnel", () => {
  it("says nothing about matching until somebody has asked", () => {
    const h = frontPage(data());
    expect(h).not.toContain("Nothing on the shelf matches");
    expect(h).not.toContain("workers for");
  });

  it("names what it found, and how many", () => {
    const h = frontPage(data({ asked: "review my code", matches: [pack(), pack({ id: "pk_2" })] }));
    expect(h).toContain("2 workers for");
    expect(h).toContain("review my code");
  });

  it("counts one worker in the singular", () => {
    expect(frontPage(data({ asked: "review my code", matches: [pack()] }))).toContain("1 worker for");
  });

  it("says plainly when the shelf has nothing, instead of showing the featured row", () => {
    const h = frontPage(data({ asked: "a plumber", matches: [] }));
    expect(h).toContain("Nothing on the shelf matches");
    expect(h).toContain("a plumber");
  });

  it("escapes what the visitor typed, so the question cannot carry markup", () => {
    const h = frontPage(data({ asked: `<img src=x onerror="alert(1)">`, matches: [] }));
    expect(h).not.toContain("<img src=x");
    expect(h).toContain("&lt;img");
  });
});
