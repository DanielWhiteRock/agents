import { describe, it, expect } from "vitest";
import { parsePackMarkdown } from "../../src/packs/import.js";
import {
  packPage, catalogPage, creatorPage, creatorEditorPage, listingApprovalPage, type PackPageExtras,
} from "../../src/app/views.js";
import { hasListing, type Listing } from "../../src/app/listing.js";
import { listingFromForm, listingToForm } from "../../src/packs/listing-shape.js";
import type { PackRow, PackVersionRow } from "../../src/app/platform.js";
import type { CreatorRow } from "../../src/app/creators.js";

/**
 * A folder's own copy of its listing: the long description, the list fields
 * and the FAQ, read off frontmatter so an import is not a blank pack page.
 *
 * `description:` already means the tagline (tested in import.test.ts), and
 * every existing agent.md relies on that staying true — so the long body
 * arrives under its own key, `description_long:`.
 */
const md = `---
name: Three Lenses
description: Three lenses for one branch
description_long: Three bodies of work, pulling against each other.
use_cases: Review a branch, Find the bug you can describe
limitations: Needs a real diff, Not for binary files
requirements: A git remote, Read access to the repo
built_on: "Dietrich Gebert, Cursor, Poteto — MIT"
faq:
  - q: Does it write to the branch?
    a: No, it only reads.
  - q: Does it need network access?
    a: No.
---
Do the work.`;

describe("listing fields off frontmatter", () => {
  it("reads the long description and the list fields off frontmatter", () => {
    const p = parsePackMarkdown(md);
    expect(p.descriptionLong).toBe("Three bodies of work, pulling against each other.");
    expect(p.useCases).toEqual(["Review a branch", "Find the bug you can describe"]);
    expect(p.limitations).toEqual(["Needs a real diff", "Not for binary files"]);
    expect(p.requirements).toEqual(["A git remote", "Read access to the repo"]);
    expect(p.builtOn).toBe("Dietrich Gebert, Cursor, Poteto — MIT");
  });

  it("reads a list of question/answer pairs for the FAQ", () => {
    const p = parsePackMarkdown(md);
    expect(p.faq).toEqual([
      { q: "Does it write to the branch?", a: "No, it only reads." },
      { q: "Does it need network access?", a: "No." },
    ]);
  });

  it("leaves the tagline alone when only description is present", () => {
    const p = parsePackMarkdown("---\ndescription: A short line\n---\nbody");
    expect(p.tagline).toBe("A short line");
    expect(p.descriptionLong).toBeUndefined();
  });

  it("leaves the new fields empty or undefined when a pack asks for none of them", () => {
    const p = parsePackMarkdown("---\nname: X\n---\nbody");
    expect(p.descriptionLong).toBeUndefined();
    expect(p.useCases).toEqual([]);
    expect(p.limitations).toEqual([]);
    expect(p.requirements).toEqual([]);
    expect(p.faq).toEqual([]);
    expect(p.builtOn).toBeUndefined();
  });

  it("does not let an unrecognised nested faq key leave a stray entry", () => {
    const p = parsePackMarkdown("---\nfaq:\n  - a: An answer with no question first\n---\nbody");
    expect(p.faq).toEqual([]);
  });

  /**
   * `scenarios` is the sixth listing field, and it was the one with no
   * frontmatter key — so a folder could carry five sixths of its listing in
   * and had to have the last one generated or typed.
   */
  it("reads written scenarios off frontmatter, the way it reads the FAQ", () => {
    const p = parsePackMarkdown(`---
name: Three Lenses
scenarios:
  - brief: Review this branch
    reached: bash, read
    output: Three findings, worst first.
  - brief: A one-file change
    reached: read
    output: Nothing to say.
---
Do the work.`);
    expect(p.scenarios).toEqual([
      { brief: "Review this branch", reached: ["bash", "read"], output: "Three findings, worst first." },
      { brief: "A one-file change", reached: ["read"], output: "Nothing to say." },
    ]);
  });

  it("leaves scenarios empty for a pack that writes none", () => {
    expect(parsePackMarkdown("---\nname: X\n---\nbody").scenarios).toEqual([]);
  });

  it("does not let a nested scenario key with no brief first leave a stray entry", () => {
    const p = parsePackMarkdown("---\nscenarios:\n  - output: An output with no brief first\n---\nbody");
    expect(p.scenarios).toEqual([]);
  });

  it("does not report scenarios as a key it has never heard of", () => {
    expect(parsePackMarkdown("---\nscenarios:\n  - brief: B\n---\nbody").unknownKeys).toEqual([]);
  });
});

// ---------------------------------------------------------------- the page

/**
 * What the pack page says, and — the part that matters on a shelf of seventy
 * packs where almost none of them have listing content yet — what it does
 * not say. A block with nothing in it must leave no heading behind.
 */
const EMPTY_COLUMNS = {
  description: "", use_cases: "", limitations: "", faq: "", scenarios: "", requirements: "",
};

function packRow(over: Partial<PackRow> = {}): PackRow {
  return {
    id: "pk_1", slug: "senior-engineer", name: "Senior Engineer",
    tagline: "Reads the code before it changes it", author: "typeui.sh",
    author_org_id: null, price_points: 49, tags: "engineering,quality", image: null,
    role: "engineer", upgrade_points: 0, model: "claude-opus-5", effort: "high",
    pinned_models: "[]", instructions: "Read it first.", status: "listed",
    author_payout_email: null, extras: "{}", created_at: "2026-01-02T03:04:05.000Z",
    ...EMPTY_COLUMNS,
    listing_approved_at: null, listing_stale_at: null, listed_at: null, built_on: null,
    creator_id: null, featured_rank: null,
    ...over,
  };
}

const packVersion = (over: Partial<PackVersionRow> = {}): PackVersionRow => ({
  id: "pv_1", pack_id: "pk_1", version: 3, runtime_pack_id: "agt_1", runtime_version: "1",
  instructions: "Read it first.", created_at: "2026-02-03T04:05:06.000Z", ...over,
});

const NOTHING_KNOWN: PackPageExtras = {
  listing: null,
  stats: { runs: 0, buyers: 0, version: 3 },
  permissions: ["web: unrestricted"],
  files: { files: 0, skills: 0, tree: [] },
  updatedAt: null,
  builtOn: null,
  refundDays: 14,
  creator: null,
  rating: { average: null, count: 0, distribution: [0, 0, 0, 0, 0] },
  reviews: [],
  mayReview: false,
  myReview: null,
  votes: { count: 0, voted: false },
  saved: false,
  changelog: [],
};

const FULL: Listing = {
  description: "Three bodies of work, pulling against each other.\n\nAnd a fourth that referees.",
  useCases: ["Review a branch before it merges", "Find the bug you can describe"],
  limitations: ["Needs a real diff", "Not for binary files"],
  faq: [{ q: "Does it write to the branch?", a: "No, it only reads." }],
  scenarios: [{ brief: "Review this branch", reached: ["bash", "read"], output: "Three findings, worst first." }],
  requirements: ["A git remote", "Read access to the repo"],
};

type RenderOpts = {
  pack?: Partial<PackRow>;
  owned?: boolean;
  isAuthor?: boolean;
  trial?: { turns: number; budgetCents: number; used: boolean } | null;
  extras?: Partial<PackPageExtras>;
};

function render(o: RenderOpts = {}): string {
  return packPage(
    packRow(o.pack), packVersion(), o.owned ?? false, ["claude-opus-5", "claude-sonnet-5"], 120_000,
    undefined, { name: "Daniel", email: "d@example.com", role: "owner", orgName: "alphaCEO" },
    o.trial ?? null, o.isAuthor ?? false, { ...NOTHING_KNOWN, ...o.extras });
}

const h2 = (text: string): string => `<h2>${text}</h2>`;

describe("the pack page", () => {
  it("renders no heading for a section with no content", () => {
    const h = render();
    expect(h).not.toContain("What you'd hire it for");
    expect(h).not.toContain("Known limitations");
    expect(h).not.toContain(h2("What it does"));
    expect(h).not.toContain("What a session looks like");
    expect(h).not.toContain("What's inside");
    expect(h).not.toContain("Questions people ask");
  });

  it("renders no heading for a listing whose every field is empty", () => {
    const h = render({ extras: { listing: {
      description: "   ", useCases: [], limitations: [], faq: [], scenarios: [], requirements: [],
    } } });
    expect(h).not.toContain("What you'd hire it for");
    expect(h).not.toContain("Known limitations");
    expect(h).not.toContain(h2("What it does"));
    expect(h).not.toContain("What a session looks like");
    expect(h).not.toContain("Questions people ask");
    expect(h).not.toContain("Requires");
  });

  it("renders every block once the listing has content", () => {
    const h = render({ extras: { listing: FULL } });
    expect(h).toContain(h2("What it does"));
    expect(h).toContain("Three bodies of work, pulling against each other.");
    expect(h).toContain("And a fourth that referees.");
    expect(h).toContain("What you'd hire it for");
    expect(h).toContain("Review a branch before it merges");
    expect(h).toContain("What a session looks like");
    expect(h).toContain("Three findings, worst first.");
    expect(h).toContain("Known limitations");
    expect(h).toContain("Needs a real diff");
    expect(h).toContain("Questions people ask");
    expect(h).toContain("Does it write to the branch?");
    expect(h).toContain("A git remote");
  });

  it("shows runs and owning orgs on the detail page", () => {
    const h = render({ extras: { stats: { runs: 128, buyers: 9, version: 3 } } });
    expect(h).toMatch(/Runs<[\s\S]{0,200}>128</);
    expect(h).toMatch(/Owning organisations<[\s\S]{0,200}>9</);
  });

  it("says nothing about usage rather than showing zeroes", () => {
    const h = render({ extras: { stats: { runs: 0, buyers: 0, version: 3 } } });
    expect(h).not.toContain("0 runs");
    expect(h).not.toContain("organisations");
  });

  it("puts the trial above the buy button", () => {
    const h = render({ trial: { turns: 6, budgetCents: 40, used: false } });
    const trialAt = h.indexOf("/packs/senior-engineer/trial");
    const buyAt = h.indexOf("/packs/senior-engineer/acquire");
    expect(trialAt).toBeGreaterThan(-1);
    expect(buyAt).toBeGreaterThan(-1);
    expect(trialAt).toBeLessThan(buyAt);
    expect(h.indexOf("Try it")).toBeLessThan(h.indexOf("Buy for"));
  });

  it("renders the permissions rail from stored tools", () => {
    const h = render({ extras: { permissions: [
      "bash, write, edit — runs unattended",
      "connects to notion (https://mcp.notion.com)",
      "web: limited to example.com",
    ] } });
    expect(h).toContain("bash, write, edit — runs unattended");
    expect(h).toContain("connects to notion (https://mcp.notion.com)");
    expect(h).toContain("web: limited to example.com");
  });

  it("shows a built-on line without changing the byline", () => {
    const h = render({ extras: { builtOn: "Dietrich Gebert, Cursor, Poteto — MIT" } });
    expect(h).toContain("Built on");
    expect(h).toContain("Dietrich Gebert, Cursor, Poteto — MIT");
    expect(h).toContain("by typeui.sh");
  });

  it("leaves out the built-on line when nothing upstream is credited", () => {
    expect(render()).not.toContain("Built on");
  });

  it("puts the role from P.ROLES in the breadcrumb", () => {
    const h = render();
    expect(h).toContain("Workers");
    expect(h).toContain(`<a href="/?q=engineer">Engineer</a>`);
    expect(h).toContain("Senior Engineer");
  });

  it("drops the role out of the breadcrumb when a pack has none", () => {
    const h = render({ pack: { role: "" } });
    expect(h).toContain("Workers");
    expect(h).not.toContain("?q=engineer");
  });

  it("no longer promises that the method stays secret", () => {
    const h = render();
    expect(h).not.toContain("never how it was told to do it");
    expect(h).toContain("the method leaves with you");
  });

  it("claims the export and no third-party agents", () => {
    const h = render();
    expect(h).toContain(h2("Works with")); // it is a claim we can defend, so it always renders
    const from = h.indexOf(h2("Works with"));
    const block = h.slice(from, h.indexOf("<h2", from + 1));
    expect(block).toContain("ant apply");
    expect(block).toContain("on a model you pick");
    for (const name of ["Cursor", "Codex", "Windsurf", "Copilot", "logo"]) expect(block).not.toContain(name);
  });

  it("counts the folder in what's inside", () => {
    const h = render({ extras: { files: { files: 4, skills: 2, tree: [
      "agent.md", "skills/review/SKILL.md", "skills/triage/SKILL.md", "README.md",
    ] } } });
    expect(h).toContain("What's inside");
    expect(h).toContain("skills/review/SKILL.md");
    expect(h).toMatch(/4 files/);
    expect(h).toMatch(/2 skills/);
  });

  it("dates the listing from listed_at and the last publish", () => {
    const h = render({
      pack: { listed_at: "2026-03-04T05:06:07.000Z" },
      extras: { updatedAt: "2026-05-06T07:08:09.000Z" },
    });
    expect(h).toContain("2026-03-04");
    expect(h).toContain("2026-05-06");
  });

  it("states the refund window beside the price", () => {
    expect(render()).toContain("14 days");
  });

  it("does not offer a refund window to somebody who already owns it", () => {
    const h = render({ owned: true });
    expect(h).not.toContain("14 days");
    expect(h).toContain("Yours already");
    expect(h).toContain("/packs/senior-engineer/export?format=md");
  });

  it("offers no export to somebody who has not bought it", () => {
    expect(render()).not.toContain("/export");
  });

  /**
   * Two different things to take away, and the page counts the folder two
   * blocks later — so an owner who has one must be able to download it
   * without hand-editing a query string.
   */
  it("offers the folder as well as the definition when there is a folder", () => {
    const h = render({ owned: true, extras: { files: { files: 3, skills: 1, tree: [
      "agent.md", "skills/review/SKILL.md", "README.md",
    ] } } });
    expect(h).toContain(`href="/packs/senior-engineer/export?format=md"`);
    expect(h).toContain(`href="/packs/senior-engineer/export"`);
    expect(h).toContain("The definition — senior-engineer.md");
    expect(h).toContain("The whole folder — senior-engineer.tar.gz");
  });

  it("offers only the definition when the pack is one file", () => {
    const h = render({ owned: true, extras: { files: { files: 1, skills: 0, tree: ["agent.md"] } } });
    expect(h).toContain(`href="/packs/senior-engineer/export?format=md"`);
    expect(h).not.toContain(`href="/packs/senior-engineer/export"`);
    expect(h).not.toContain("tar.gz");
  });

  /**
   * `trial_budget_cents` is cents, and `pts()` reads millipoints — rendering
   * one with the other turned a 40-cent trial into "0.04 points" on the most
   * prominent line the page has.
   */
  it("states the trial budget as money, not as points", () => {
    const h = render({ trial: { turns: 6, budgetCents: 40, used: false } });
    expect(h).toContain("6 turns, $0.40");
    expect(h).not.toContain("0.04 points");
  });

  it("links the byline to the creator's page when the pack has one", () => {
    const h = render({ extras: { creator: { id: "cr_1", handle: "typeui" } } });
    expect(h).toContain(`<a href="/creators/typeui">typeui.sh</a>`);
  });

  it("leaves the byline as plain text for a pack with no creator", () => {
    const h = render();
    expect(h).toContain("by typeui.sh");
    expect(h).not.toContain("/creators/");
  });
});

// ------------------------------------------------------------- changelog

describe("the pack page's changelog", () => {
  it("renders no changelog heading for a pack with no notes", () => {
    const h = render();
    expect(h).not.toContain("Changelog");
  });

  it("shows the changelog once a version has a note", () => {
    const h = render({ extras: { changelog: [
      { version: 3, note: "Added support for private repositories.", createdAt: "2026-05-06T07:08:09.000Z" },
    ] } });
    expect(h).toContain("Changelog");
    expect(h).toContain("Added support for private repositories.");
    expect(h).toContain("Version 3");
    expect(h).toContain("2026-05-06");
  });

  it("lists multiple notes, escaping author-written text", () => {
    const h = render({ extras: { changelog: [
      { version: 4, note: "<script>alert(1)</script>", createdAt: "2026-06-01T00:00:00.000Z" },
      { version: 2, note: "Fixed the export link.", createdAt: "2026-04-01T00:00:00.000Z" },
    ] } });
    expect(h).not.toContain("<script>alert(1)</script>");
    expect(h).toContain("&lt;script&gt;");
    expect(h).toContain("Fixed the export link.");
    expect(h).toContain("Version 4");
    expect(h).toContain("Version 2");
  });
});

// -------------------------------------------------------- social proof

const REVIEW_A = { byline: "Buyer Co", rating: 5, body: "Did exactly what it said.", createdAt: "2026-04-01T00:00:00.000Z" };

describe("the pack page's social proof", () => {
  it("below the threshold, shows the written reviews and no average anywhere", () => {
    const h = render({ extras: {
      rating: { average: null, count: 4, distribution: [0, 0, 0, 0, 4] },
      reviews: [REVIEW_A],
    } });
    expect(h).toContain("Did exactly what it said.");
    expect(h).toContain("Buyer Co");
    // No aggregate number anywhere: no "X / 5" average line, and no
    // distribution bars — both are gated together, by the same field.
    expect(h).not.toMatch(/\d(\.\d)?\s*\/\s*5/);
    expect(h).not.toContain('class="bar"');
    expect(h).not.toContain("4 ratings");
  });

  it("at the threshold, shows both the average and the distribution bars", () => {
    const h = render({ extras: {
      rating: { average: 4.6, count: 5, distribution: [0, 0, 1, 1, 3] },
      reviews: [REVIEW_A],
    } });
    expect(h).toContain("4.6");
    expect(h).toContain('class="bar"');
    expect(h).toContain("5 ratings");
  });

  it("shows no review heading for a pack with no reviews and no votes", () => {
    const h = render();
    expect(h).not.toContain("<h2>Reviews</h2>");
  });

  it("shows the review heading when there are votes but no written reviews yet", () => {
    const h = render({ extras: { votes: { count: 3, voted: false } } });
    expect(h).toContain("<h2>Reviews</h2>");
    expect(h).toContain("3 organisations marked this useful");
  });

  it("shows the review heading once there is at least one written review", () => {
    const h = render({ extras: { reviews: [REVIEW_A] } });
    expect(h).toContain("<h2>Reviews</h2>");
  });

  it("escapes a review's free-text byline and body", () => {
    const h = render({ extras: { reviews: [{
      byline: "<b>Evil</b>", rating: 5, body: "<script>alert(1)</script>", createdAt: "2026-04-01T00:00:00.000Z",
    }] } });
    expect(h).not.toContain("<script>alert(1)</script>");
    expect(h).not.toContain("<b>Evil</b>");
    expect(h).toContain("&lt;script&gt;");
    expect(h).toContain("&lt;b&gt;");
  });

  it("shows no form and a reason when the viewer may not review", () => {
    const h = render({ extras: { mayReview: false } });
    expect(h).toContain("You can rate this once you have run it.");
    expect(h).not.toContain(`action="/packs/senior-engineer/review"`);
  });

  it("shows the review form, prefilled with the viewer's own review, when eligible", () => {
    const h = render({ extras: {
      mayReview: true,
      myReview: { rating: 3, body: "okay so far", byline: "Buyer Co", anonymous: false },
    } });
    expect(h).toContain(`action="/packs/senior-engineer/review"`);
    expect(h).toContain(`value="3" selected`);
    expect(h).toContain("okay so far");
    expect(h).toContain(`value="Buyer Co"`);
    expect(h).toContain("Update your review");
  });

  it("offers a blank form, not a blank reused layout, to a first-time eligible reviewer", () => {
    const h = render({ extras: { mayReview: true, myReview: null } });
    expect(h).toContain(`action="/packs/senior-engineer/review"`);
    expect(h).toContain("Submit your review");
    expect(h).not.toContain("Update your review");
  });

  it("shows the save control's two states", () => {
    expect(render({ extras: { saved: false } })).toMatch(/>Save</);
    expect(render({ extras: { saved: true } })).toMatch(/>Saved</);
  });

  it("shows the vote control's two states", () => {
    expect(render({ extras: { votes: { count: 0, voted: false } } })).toContain("Looks good");
    expect(render({ extras: { votes: { count: 1, voted: true } } })).toContain("Marked useful");
  });
});

// ------------------------------------------------------------- the catalog

function catalogPack(creatorHandle: string | null = null, over: Partial<PackRow> = {}): PackRow & {
  published: boolean; owned: boolean; pricePoints: number;
  stats: { runs: number; buyers: number; version: number };
  creatorHandle: string | null;
} {
  return {
    ...packRow(over),
    published: true, owned: false, pricePoints: 49,
    stats: { runs: 0, buyers: 0, version: 1 },
    creatorHandle,
  };
}

describe("the catalog", () => {
  it("links a card's byline to the creator's page when there is one", () => {
    const h = catalogPage([catalogPack("typeui")], 1000);
    expect(h).toMatch(/<a class="who-link" href="\/creators\/typeui"[^>]*>typeui\.sh<\/a>/);
  });

  it("leaves a card's byline as plain text when there is no creator", () => {
    const h = catalogPage([catalogPack()], 1000);
    expect(h).not.toContain("/creators/");
    expect(h).toContain("typeui.sh");
  });

  it("still links the card itself to the pack even once the byline links elsewhere", () => {
    const h = catalogPage([catalogPack("typeui")], 1000);
    expect(h).toContain(`href="/packs/senior-engineer"`);
  });
});

// -------------------------------------------------------------- the creator

function creatorRow(over: Partial<CreatorRow> = {}): CreatorRow {
  return {
    id: "cr_1", user_id: "u_1", org_id: "org_1", handle: "typeui",
    display_name: "typeui.sh", bio: "", avatar: null, links: "[]",
    verified: 0, created_at: "2026-01-02T03:04:05.000Z",
    ...over,
  };
}

const CREATOR_PACK = {
  ...packRow(), pricePoints: 49,
  stats: { runs: 0, buyers: 0, version: 1 },
};

const NO_RATING = { average: null, count: 0 };

describe("the creator page", () => {
  it("renders no empty headings for a creator with no bio, no links and no packs", () => {
    const h = creatorPage(creatorRow(), [], { packs: 0, runs: 0, orgs: 0 }, NO_RATING, null, 0);
    expect(h).not.toContain("<h2>");
  });

  it("lists the creator's packs and their totals", () => {
    const h = creatorPage(
      creatorRow(),
      [{ ...CREATOR_PACK, stats: { runs: 42, buyers: 3, version: 1 } }],
      { packs: 1, runs: 42, orgs: 3 },
      NO_RATING, null, 0,
    );
    expect(h).toContain("Senior Engineer");
    expect(h).toContain(`href="/packs/senior-engineer"`);
    expect(h).toMatch(/42/);
  });

  it("shows runs rather than stars for a creator with no rating", () => {
    const h = creatorPage(creatorRow(), [], { packs: 0, runs: 128, orgs: 9 }, NO_RATING, null, 0);
    expect(h).toMatch(/128/);
    expect(h).toContain("runs");
    expect(h).not.toContain("★");
    expect(h).not.toContain("rating");
    expect(h).not.toContain("stars");
  });

  it("shows the verified mark only when the creator is verified", () => {
    const plain = creatorPage(creatorRow(), [], { packs: 0, runs: 0, orgs: 0 }, NO_RATING, null, 0);
    const verified = creatorPage(creatorRow({ verified: 1 }), [], { packs: 0, runs: 0, orgs: 0 }, NO_RATING, null, 0);
    expect(plain).not.toContain("Verified");
    expect(verified).toContain("Verified");
  });

  it("renders the bio and the links once the creator has written them", () => {
    const h = creatorPage(
      creatorRow({ bio: "Reads the diff before the commit.", links: JSON.stringify([
        { label: "Site", url: "https://typeui.sh" },
      ]) }),
      [], { packs: 0, runs: 0, orgs: 0 }, NO_RATING, null, 0,
    );
    expect(h).toContain("Reads the diff before the commit.");
    expect(h).toContain(`<a href="https://typeui.sh">Site</a>`);
  });

  it("escapes a creator's free-text bio and link label", () => {
    const h = creatorPage(
      creatorRow({ bio: "<script>alert(1)</script>", links: JSON.stringify([
        { label: "<b>evil</b>", url: "https://example.com" },
      ]) }),
      [], { packs: 0, runs: 0, orgs: 0 }, NO_RATING, null, 0,
    );
    expect(h).not.toContain("<script>alert(1)</script>");
    expect(h).toContain("&lt;script&gt;");
    expect(h).not.toContain("<b>evil</b>");
  });

  it("refuses a javascript: link rather than rendering it as an href", () => {
    const h = creatorPage(
      creatorRow({ links: JSON.stringify([{ label: "Click me", url: "javascript:alert(1)" }]) }),
      [], { packs: 0, runs: 0, orgs: 0 }, NO_RATING, null, 0,
    );
    expect(h).not.toContain("javascript:alert(1)");
  });

  it("shows no stars below the creator rating threshold", () => {
    const h = creatorPage(creatorRow(), [], { packs: 1, runs: 4, orgs: 4 }, { average: null, count: 4 }, null, 0);
    expect(h).not.toContain("★");
    expect(h).not.toMatch(/\d(\.\d)?\s*\(\d+\)/);
  });

  it("shows the aggregate star rating once the creator's packs cross the threshold", () => {
    const h = creatorPage(creatorRow(), [], { packs: 2, runs: 10, orgs: 10 }, { average: 4.8, count: 5 }, null, 0);
    expect(h).toContain("★");
    expect(h).toContain("4.8");
    expect(h).toContain("(5)");
  });
});

/**
 * `hasListing` is the gate the route uses to decide whether there is a
 * listing to hand the page at all, so it has to be right about emptiness —
 * including the kinds of emptiness the columns actually hold: `''` before
 * anybody wrote anything, and malformed JSON after somebody did.
 */
describe("hasListing", () => {
  it("is false for a pack nobody has written a listing for", () => {
    expect(hasListing(packRow())).toBe(false);
  });

  it("is false for a description that is only whitespace", () => {
    expect(hasListing(packRow({ description: "   \n  " }))).toBe(false);
  });

  it("is true once any one of the six fields has something in it", () => {
    expect(hasListing(packRow({ description: "What it actually does." }))).toBe(true);
    expect(hasListing(packRow({ use_cases: JSON.stringify(["Review a branch"]) }))).toBe(true);
    expect(hasListing(packRow({ limitations: JSON.stringify(["Needs a diff"]) }))).toBe(true);
    expect(hasListing(packRow({ faq: JSON.stringify([{ q: "?", a: "." }]) }))).toBe(true);
    expect(hasListing(packRow({ scenarios: JSON.stringify([{ brief: "b", reached: [], output: "o" }]) }))).toBe(true);
    expect(hasListing(packRow({ requirements: JSON.stringify(["A git remote"]) }))).toBe(true);
  });

  it("is false for an empty JSON array, which is a written-down nothing", () => {
    expect(hasListing(packRow({ use_cases: "[]", faq: "[]" }))).toBe(false);
  });

  it("is false for a column that does not parse", () => {
    expect(hasListing(packRow({ use_cases: "not json at all" }))).toBe(false);
  });
});

// ------------------------------------------------------- the creator editor

describe("the creator editor page", () => {
  it("offers an empty form to an owner with no creator profile yet", () => {
    const h = creatorEditorPage({ creator: null, canEdit: true, balance: 0, viewer: null });
    expect(h).toContain("<form");
    expect(h).toContain("Set up your creator profile");
    expect(h).not.toContain("Edit your creator profile");
    expect(h).not.toContain("View your public page");
  });

  it("prefills the form from an existing profile, and links to the public page", () => {
    const h = creatorEditorPage({
      creator: creatorRow({ bio: "Writes the method down.", links: JSON.stringify([{ label: "Site", url: "https://typeui.sh" }]) }),
      canEdit: true, balance: 0, viewer: null,
    });
    expect(h).toContain("Edit your creator profile");
    expect(h).toContain(`value="typeui"`);
    expect(h).toContain(`value="typeui.sh"`);
    expect(h).toContain("Writes the method down.");
    expect(h).toContain("Site | https://typeui.sh");
    expect(h).toContain(`<a href="/creators/typeui">View your public page</a>`);
  });

  it("shows the submitted error beside the form", () => {
    const h = creatorEditorPage({ creator: null, canEdit: true, balance: 0, viewer: null, err: `the handle "typeui" is already taken` });
    expect(h).toContain(`the handle &quot;typeui&quot; is already taken`);
  });

  it("gives a non-owner the facts and a reason instead of a dead form", () => {
    const h = creatorEditorPage({ creator: creatorRow(), canEdit: false, balance: 0, viewer: null });
    expect(h).not.toContain("<form");
    expect(h).toContain("Only an owner can change this organisation's creator profile.");
    expect(h).toContain(`<a href="/creators/typeui">View the public page</a>`);
  });

  it("tells a non-owner there is nothing set up yet, rather than offering a form", () => {
    const h = creatorEditorPage({ creator: null, canEdit: false, balance: 0, viewer: null });
    expect(h).not.toContain("<form");
    expect(h).toContain("has not set up a creator profile yet");
  });

  it("escapes a creator's free-text fields in the form and in the read-only view", () => {
    const evil = creatorRow({ display_name: `<script>alert(1)</script>`, handle: "evil" });
    const editable = creatorEditorPage({ creator: evil, canEdit: true, balance: 0, viewer: null });
    expect(editable).not.toContain("<script>alert(1)</script>");
    const readOnly = creatorEditorPage({ creator: evil, canEdit: false, balance: 0, viewer: null });
    expect(readOnly).not.toContain("<script>alert(1)</script>");
  });
});

// ------------------------------------------------------ the approval screen

/**
 * The one screen that stands between generated copy and a buyer. Its job is
 * to show what would be published, next to what is published now, and to be
 * the only way the first becomes the second.
 */
const approvalArgs = (over: Record<string, unknown> = {}) => ({
  pack: packRow(),
  live: null as Listing | null,
  draft: null as Listing | null,
  generatedAt: null as string | null,
  sourceVersion: null as number | null,
  currentVersion: 3 as number | null,
  canApprove: true,
  balance: 0,
  viewer: null,
  ...over,
});

describe("the listing approval screen", () => {
  it("offers nothing to approve when no draft has been generated", () => {
    const h = listingApprovalPage(approvalArgs());
    expect(h).not.toContain("/listing/approve");
    expect(h).toContain("generate-listings");
  });

  it("shows the proposed copy and the one button that publishes it", () => {
    const h = listingApprovalPage(approvalArgs({
      draft: FULL, generatedAt: "2026-11-10T09:00:00.000Z", sourceVersion: 3,
    }));
    expect(h).toContain("Three bodies of work, pulling against each other.");
    expect(h).toContain("Review a branch before it merges");
    expect(h).toContain("Three findings, worst first.");
    expect(h).toContain(`action="/packs/senior-engineer/listing/approve"`);
    expect(h).toContain("2026-11-10");
  });

  it("says in as many words that nothing here is live yet", () => {
    const h = listingApprovalPage(approvalArgs({ draft: FULL, generatedAt: "2026-11-10T09:00:00.000Z" }));
    expect(h).toMatch(/not live|nobody has seen|no buyer/i);
  });

  it("shows what a buyer reads now beside what is proposed", () => {
    const h = listingApprovalPage(approvalArgs({
      live: { ...FULL, description: "The copy that is live today." },
      draft: { ...FULL, description: "The copy somebody would have to approve." },
      generatedAt: "2026-11-10T09:00:00.000Z",
    }));
    expect(h).toContain("The copy that is live today.");
    expect(h).toContain("The copy somebody would have to approve.");
  });

  it("warns when the method changed under the live listing", () => {
    const h = listingApprovalPage(approvalArgs({
      pack: packRow({ listing_stale_at: "2026-11-09T09:00:00.000Z", listing_approved_at: "2026-11-01T09:00:00.000Z" }),
      live: FULL,
    }));
    expect(h).toMatch(/no longer describes|out of date|stale/i);
  });

  it("flags a draft generated against an older version of the pack", () => {
    const h = listingApprovalPage(approvalArgs({
      draft: FULL, generatedAt: "2026-11-10T09:00:00.000Z", sourceVersion: 1, currentVersion: 3,
    }));
    expect(h).toMatch(/version 1/);
    expect(h).toMatch(/version 3/);
  });

  it("gives a member the facts and a reason rather than a button that would 403", () => {
    const h = listingApprovalPage(approvalArgs({
      draft: FULL, generatedAt: "2026-11-10T09:00:00.000Z", canApprove: false,
    }));
    expect(h).toContain("Three bodies of work, pulling against each other.");
    expect(h).not.toContain("/listing/approve");
    expect(h).toMatch(/owner/i);
  });

  it("escapes every word of the generated copy", () => {
    const h = listingApprovalPage(approvalArgs({
      draft: {
        description: "<script>alert(1)</script>",
        useCases: ["<img src=x onerror=1>"],
        limitations: ["<b>bold</b>"],
        faq: [{ q: "<i>q</i>", a: "<i>a</i>" }],
        scenarios: [{ brief: "<u>brief</u>", reached: ["<em>reached</em>"], output: "<s>output</s>" }],
        requirements: ["<hr>"],
      },
      generatedAt: "2026-11-10T09:00:00.000Z",
    }));
    for (const raw of ["<script>alert(1)</script>", "<img src=x", "<b>bold</b>", "<i>q</i>",
      "<u>brief</u>", "<em>reached</em>", "<s>output</s>", "<hr>"]) {
      expect(h).not.toContain(raw);
    }
    expect(h).toContain("&lt;script&gt;");
  });

  it("shows the submitted error beside the draft", () => {
    const h = listingApprovalPage(approvalArgs({ err: "there is no draft to approve" }));
    expect(h).toContain("there is no draft to approve");
  });
});

// ------------------------------------------- the draft is editable, or else
//
// Without an editor, approval is approve-verbatim or nothing: the six listing
// fields had exactly two writers (a folder import and the generator), so an
// author who disagreed with one sentence could publish it anyway, publish
// nothing, or pay for another model call. The spec says twice that the author
// "edits freely, and approves", and chose per-pack approval because of it.

describe("editing a proposed listing", () => {
  it("renders the proposed column as fields, one per listing field", () => {
    const h = listingApprovalPage(approvalArgs({ draft: FULL, generatedAt: "2026-11-10T09:00:00.000Z" }));
    expect(h).toContain(`action="/packs/senior-engineer/listing"`);
    for (const name of ["description", "useCases", "scenarios", "limitations", "faq", "requirements"]) {
      expect(h).toContain(`name="${name}"`);
    }
    // The boxes are filled with what the generator wrote, not left blank.
    expect(h).toContain("Three bodies of work, pulling against each other.");
    expect(h).toContain("Review a branch before it merges");
    expect(h).toContain("Q: Does it write to the branch?");
    expect(h).toContain("Brief: Review this branch");
  });

  it("carries the pack page's scenario disclaimer onto the approval screen", () => {
    const editable = listingApprovalPage(approvalArgs({ draft: FULL, generatedAt: "2026-11-10T09:00:00.000Z" }));
    expect(editable).toMatch(/Written examples, not recorded runs/);
    // And in the read-only column a member sees, which is the same prose.
    const readOnly = listingApprovalPage(approvalArgs({
      draft: FULL, generatedAt: "2026-11-10T09:00:00.000Z", canApprove: false,
    }));
    expect(readOnly).toMatch(/Written examples, not recorded runs/);
  });

  it("gives a member no form to post, the same way it gives them no button", () => {
    const h = listingApprovalPage(approvalArgs({
      draft: FULL, generatedAt: "2026-11-10T09:00:00.000Z", canApprove: false,
    }));
    expect(h).not.toContain(`action="/packs/senior-engineer/listing"`);
    expect(h).not.toContain("<textarea");
  });

  it("says a save is still only a draft", () => {
    const h = listingApprovalPage(approvalArgs({
      draft: FULL, generatedAt: "2026-11-10T09:00:00.000Z", saved: true,
    }));
    expect(h).toMatch(/Draft saved/);
    expect(h).toMatch(/still a draft/);
  });

  it("round-trips a listing through the form and back unchanged", () => {
    expect(listingFromForm(listingToForm(FULL))).toEqual(FULL);
  });

  it("reads lists one per line and the object fields as labelled blocks", () => {
    const l = listingFromForm({
      description: "One paragraph.\n\nAnd another.",
      useCases: "Review a branch\n  Find the bug  \n\n",
      limitations: "Needs a diff",
      requirements: "A git remote",
      faq: "Q: Does it write?\nA: No.\nIt reads, and reports.\n---\nQ: Models?\nA: Opus.",
      scenarios: "Brief: A noisy refactor\nReached: bash, read\nOutput: three findings\nworst first\n---\n"
        + "Brief: A dependency bump\nReached: read\nOutput: one question",
    });
    expect(l.useCases).toEqual(["Review a branch", "Find the bug"]);
    expect(l.faq).toEqual([
      { q: "Does it write?", a: "No.\nIt reads, and reports." },
      { q: "Models?", a: "Opus." },
    ]);
    expect(l.scenarios).toEqual([
      { brief: "A noisy refactor", reached: ["bash", "read"], output: "three findings\nworst first" },
      { brief: "A dependency bump", reached: ["read"], output: "one question" },
    ]);
  });

  it("drops an entry a person emptied out rather than storing a blank card", () => {
    const l = listingFromForm({ faq: "Q:\nA: an answer to nothing", scenarios: "---\n---" });
    expect(l.faq).toEqual([]);
    expect(l.scenarios).toEqual([]);
  });

  it("takes an unlabelled first line as the question, so a hand-typed entry still lands", () => {
    const l = listingFromForm({ faq: "Does it write?\nA: No." });
    expect(l.faq).toEqual([{ q: "Does it write?", a: "No." }]);
  });
});
