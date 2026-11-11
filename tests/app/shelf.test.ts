import { describe, it, expect } from "vitest";
import { shapeAnatomy, searchTerms, rankByTerms, capPerRole } from "../../src/app/shelf.js";

describe("shapeAnatomy", () => {
  it("counts the parts a folder carries, in a fixed order", () => {
    const rows = shapeAnatomy([
      { path: "agent.md", packId: "a" },
      { path: "skills/one/SKILL.md", packId: "a" },
      { path: "skills/two/SKILL.md", packId: "a" },
      { path: "hooks/pre.json", packId: "a" },
      { path: "skills/one/SKILL.md", packId: "b" },
    ]);
    expect(rows.map((r) => r.dir)).toEqual(["skills", "hooks"]);
    expect(rows[0]).toMatchObject({ label: "Skills", packs: 2, files: 3 });
    expect(rows[1]).toMatchObject({ label: "Hooks", packs: 1, files: 1 });
  });

  it("leaves out a part nobody uses", () => {
    // "0 workflows" invites the question and answers it badly.
    const rows = shapeAnatomy([{ path: "skills/a/SKILL.md", packId: "a" }]);
    expect(rows.find((r) => r.dir === "workflows")).toBeUndefined();
  });

  it("does not count agent.md as a part, because every pack has one", () => {
    expect(shapeAnatomy([{ path: "agent.md", packId: "a" }])).toEqual([]);
  });

  it("ignores a top-level directory that is not part of the contract", () => {
    expect(shapeAnatomy([{ path: "node_modules/x.js", packId: "a" }])).toEqual([]);
  });

  it("survives a path with no directory at all", () => {
    expect(() => shapeAnatomy([{ path: "", packId: "a" }])).not.toThrow();
  });
});

describe("searchTerms", () => {
  it("pulls the carrying words out of a sentence", () => {
    expect(searchTerms("someone to review my code")).toEqual(["review", "code"]);
  });

  it("keeps the two-letter words that are whole roles", () => {
    expect(searchTerms("I need a QA and a UX person")).toEqual(["qa", "ux"]);
  });

  it("leaves a single keyword alone, so the plain search still works", () => {
    expect(searchTerms("brutalism")).toEqual(["brutalism"]);
  });

  it("drops duplicates and caps a rambling answer at six terms", () => {
    const terms = searchTerms("design design a brutalist neon playful retro bold loud quiet");
    expect(terms).toEqual(["design", "brutalist", "neon", "playful", "retro", "bold"]);
  });

  it("finds nothing to search for in a sentence made only of filler", () => {
    expect(searchTerms("I am looking for someone who can help me")).toEqual([]);
  });
});

describe("rankByTerms", () => {
  const packs = [
    { name: "Senior Engineer", tagline: "Reviews code", tags: "engineering,review", role: "engineer", author: "a" },
    { name: "Neobrutalism", tagline: "Loud design", tags: "design,web", role: "designer", author: "b" },
    { name: "Code Historian", tagline: "Reads git", tags: "code", role: "engineer", author: "c" },
  ];

  it("puts the pack that answers more of the question first", () => {
    expect(rankByTerms(packs, ["review", "code"]).map((p) => p.name))
      .toEqual(["Senior Engineer", "Code Historian"]);
  });

  it("breaks a tie on the order the shelf handed it over", () => {
    expect(rankByTerms(packs, ["code"]).map((p) => p.name))
      .toEqual(["Senior Engineer", "Code Historian"]);
  });

  it("matches nothing when no term lands, rather than falling back to everything", () => {
    expect(rankByTerms(packs, ["accountant"])).toEqual([]);
  });

  it("returns nothing for a question with no searchable words in it", () => {
    expect(rankByTerms(packs, [])).toEqual([]);
  });
});

describe("capPerRole", () => {
  const p = (name: string, role: string) => ({ name, role });

  it("keeps the ranked order it was handed", () => {
    const row = capPerRole([p("a", "designer"), p("b", "engineer")], 2, 6);
    expect(row.map((x) => x.name)).toEqual(["a", "b"]);
  });

  it("stops one role filling the row, which is what the lopsided shelf would do", () => {
    const packs = ["a", "b", "c", "d"].map((n) => p(n, "designer")).concat([p("e", "engineer")]);
    expect(capPerRole(packs, 2, 6).map((x) => x.name)).toEqual(["a", "b", "e"]);
  });

  it("honours the overall limit as well as the per-role one", () => {
    const packs = ["a", "b", "c", "d", "e", "f", "g", "h"]
      .map((n, i) => p(n, `role${Math.floor(i / 2)}`));
    expect(capPerRole(packs, 2, 6)).toHaveLength(6);
  });

  it("returns nothing when there is nothing to rank", () => {
    expect(capPerRole([], 2, 6)).toEqual([]);
  });
});
