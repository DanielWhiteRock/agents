import { describe, it, expect } from "vitest";
import { shapeAnatomy } from "../../src/app/shelf.js";

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
