import { expect, test } from "vitest";
import { score, type ScoreFields } from "../../src/mcp/relevance.js";

const blank: ScoreFields = { name: "", tagline: "", author: "", description: "", useCases: [], tags: "", tools: [] };

test("a name hit outranks a description hit", () => {
  const byName = score("audits", { ...blank, name: "Code Audits" });
  const byDescription = score("audits", { ...blank, description: "It performs audits on request." });
  expect(byName).toBeGreaterThan(byDescription);
});

test("the whole phrase outranks its separate words", () => {
  const phrase = score("code review", { ...blank, tagline: "Code review, automated." });
  const scattered = score("code review", { ...blank, tagline: "Reviews your code for style." });
  expect(phrase).toBeGreaterThan(scattered);
});

test("a declared tool name is matchable", () => {
  expect(score("playwright", { ...blank, tools: ["playwright"] })).toBeGreaterThan(0);
});

test("no match scores zero", () => {
  expect(score("nothing-matches-this", { ...blank, name: "Totally unrelated" })).toBe(0);
});
