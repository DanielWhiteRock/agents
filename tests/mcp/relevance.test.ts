import { expect, test } from "vitest";
import { score, type ScoreFields } from "../../src/mcp/relevance.js";

const blank: ScoreFields = {
  name: "", tagline: "", author: "", description: "", useCases: [], tags: "", tools: [], slug: "",
};

test("a name hit outranks a description hit", () => {
  const byName = score("audits", { ...blank, name: "Code Audits" });
  const byDescription = score("audits", { ...blank, description: "It performs audits on request." });
  expect(byName).toBeGreaterThan(byDescription);
});

// M1: rewritten so both words genuinely match separately in "scattered" —
// "Reviews" (a prefix match on "review") and "code" — but not adjacently, so
// the only thing distinguishing it from "phrase" is the phrase bonus itself.
// With the old wordPattern (both-boundary), "review" never matched "Reviews"
// at all, so this assertion held even with the bonus deleted — it scored 3
// (one hit on "code") against the phrase's 12 regardless of the bonus.
test("the whole phrase outranks its separate words", () => {
  const phrase = score("code review", { ...blank, tagline: "Code review, automated." });
  const scattered = score("code review", { ...blank, tagline: "Reviews your code when it changes." });
  expect(phrase).toBeGreaterThan(scattered);
});

test("a declared tool name is matchable", () => {
  expect(score("playwright", { ...blank, tools: ["playwright"] })).toBeGreaterThan(0);
});

test("no match scores zero", () => {
  expect(score("nothing-matches-this", { ...blank, name: "Totally unrelated" })).toBe(0);
});

// ----------------------------------------------------------------- I1

test("a slug hit is matchable — search_packs must be able to find a pack by its own slug", () => {
  expect(score("senior-engineer", { ...blank, slug: "senior-engineer" })).toBeGreaterThan(0);
});

test("a hyphenated query matches the equivalent spaced-out name", () => {
  expect(score("senior-engineer", { ...blank, name: "Senior Engineer" })).toBeGreaterThan(0);
});

test("a short word (under 4 chars) still requires both boundaries — it must not match inside a longer word", () => {
  expect(score("in", { ...blank, name: "Pointing Device" })).toBe(0);
  // Sanity check the same short word still matches when it really is a
  // whole word, so the zero above is the boundary rule working, not a
  // broken pattern.
  expect(score("in", { ...blank, tagline: "Works in the browser" })).toBeGreaterThan(0);
});

// The five queries the shipped build answered with a score of 0 against,
// turning a real pack into an empty result (`Nothing in the catalog
// matches…`) — see docs/superpowers/.../final-fix-report.md for the full
// before/after table.
test("audit matches Audits (leading-boundary relaxation for words of 4+ chars)", () => {
  expect(score("audit", { ...blank, name: "Code Audits" })).toBeGreaterThan(0);
});

test("review matches Reviews", () => {
  expect(score("review", { ...blank, name: "Code Reviews" })).toBeGreaterThan(0);
});

test("engineer matches Engineering", () => {
  expect(score("engineer", { ...blank, name: "Senior Engineering Pack" })).toBeGreaterThan(0);
});

test("code-review matches the name Code Review", () => {
  expect(score("code-review", { ...blank, name: "Code Review" })).toBeGreaterThan(0);
});
