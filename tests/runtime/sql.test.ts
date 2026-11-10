import { describe, it, expect } from "vitest";
import { toSqlitePlaceholders } from "../../src/app/sql.js";

describe("toSqlitePlaceholders", () => {
  it("rewrites numbered placeholders in order", () => {
    expect(toSqlitePlaceholders("SELECT $1, $2", ["a", "b"]))
      .toEqual({ text: "SELECT ?, ?", params: ["a", "b"] });
  });
  it("reorders arguments to match the placeholders as written", () => {
    expect(toSqlitePlaceholders("SELECT $2, $1", ["a", "b"]))
      .toEqual({ text: "SELECT ?, ?", params: ["b", "a"] });
  });
  it("repeats an argument used twice", () => {
    expect(toSqlitePlaceholders("WHERE a = $1 OR b = $1", ["x"]))
      .toEqual({ text: "WHERE a = ? OR b = ?", params: ["x", "x"] });
  });
  it("handles double-digit placeholders", () => {
    const params = Array.from({ length: 12 }, (_, i) => i);
    const out = toSqlitePlaceholders("VALUES ($11, $12)", params);
    expect(out).toEqual({ text: "VALUES (?, ?)", params: [10, 11] });
  });
  it("leaves SQL without placeholders alone", () => {
    expect(toSqlitePlaceholders("SELECT 1", [])).toEqual({ text: "SELECT 1", params: [] });
  });
});
