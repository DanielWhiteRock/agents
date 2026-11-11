import { describe, it, expect } from "vitest";
import {
  faqFromJson, listingFromColumns, mergeFaq, scenariosFromJson, stringsFromJson,
} from "../../src/packs/listing-shape.js";

/**
 * The shape of a listing, in the leaf module three layers share:
 * `src/app/listing.ts` (drafts and approval), `src/app/authoring.ts` (a
 * folder import) and `src/app/messages.ts` (publishing an answer to the
 * FAQ). They cannot all import one another — `listing.ts` imports
 * `authoring.ts`, so the reverse edge would be a cycle evaluated at module
 * load — which is why this module exists and why it imports nothing.
 */
describe("the stored columns", () => {
  it("tolerates a malformed column rather than throwing", () => {
    expect(stringsFromJson("not json")).toEqual([]);
    expect(faqFromJson("{")).toEqual([]);
    expect(scenariosFromJson("null")).toEqual([]);
    // `''` is the column's own default, and means the same thing as broken.
    expect(stringsFromJson("")).toEqual([]);
    expect(stringsFromJson(null)).toEqual([]);
    expect(stringsFromJson(undefined)).toEqual([]);
  });

  it("drops an entry with nothing to render rather than half-rendering it", () => {
    expect(faqFromJson('[{"a":"an answer nobody asked for"},{"q":"Real?","a":"Yes."}]'))
      .toEqual([{ q: "Real?", a: "Yes." }]);
    expect(scenariosFromJson('[{"output":"orphan"},{"brief":"A brief"}]'))
      .toEqual([{ brief: "A brief", reached: [], output: "" }]);
  });

  it("reads all six columns off one row", () => {
    const l = listingFromColumns({
      description: "Two paragraphs.",
      use_cases: '["Review a branch"]',
      limitations: '["Needs a diff"]',
      faq: '[{"q":"Does it write?","a":"No."}]',
      scenarios: '[{"brief":"A noisy refactor","reached":["read"],"output":"three findings"}]',
      requirements: '["A git remote"]',
    });
    expect(l.description).toBe("Two paragraphs.");
    expect(l.useCases).toEqual(["Review a branch"]);
    expect(l.faq).toEqual([{ q: "Does it write?", a: "No." }]);
    expect(l.scenarios[0]!.reached).toEqual(["read"]);
  });
});

describe("mergeFaq", () => {
  it("keeps every live answer and appends only the questions that are new", () => {
    const live = [{ q: "Does it write?", a: "No — it reads and reports." }];
    const proposed = [
      { q: "does it write?", a: "A generator's guess at the same question." },
      { q: "Can it read a private repo?", a: "With a token, yes." },
    ];
    expect(mergeFaq(live, proposed)).toEqual([
      { q: "Does it write?", a: "No — it reads and reports." },
      { q: "Can it read a private repo?", a: "With a token, yes." },
    ]);
  });

  it("drops a proposed entry with no question at all", () => {
    expect(mergeFaq([], [{ q: "   ", a: "an answer to nothing" }])).toEqual([]);
  });

  it("is a no-op in both directions when one side is empty", () => {
    const live = [{ q: "Q", a: "A" }];
    expect(mergeFaq(live, [])).toEqual(live);
    expect(mergeFaq([], live)).toEqual(live);
  });
});
