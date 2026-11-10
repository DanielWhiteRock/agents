import { describe, it, expect } from "vitest";
import { sslFor, toSqlitePlaceholders } from "../../src/app/sql.js";

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

describe("sslFor", () => {
  it("leaves a local container on plain TCP", () => {
    expect(sslFor("postgres://agents:agents@localhost:5433/agents", {})).toEqual({});
  });

  it("encrypts without verifying when the URL says sslmode=require", () => {
    // What every managed provider's own connection string says, because they
    // sign with a private CA. Encrypted, not authenticated.
    expect(sslFor("postgres://u:p@db.example.com/d?sslmode=require", {}))
      .toEqual({ ssl: { rejectUnauthorized: false } });
  });

  it("verifies the certificate when the URL asks for verify-full", () => {
    expect(sslFor("postgres://u:p@db.example.com/d?sslmode=verify-full", {}))
      .toEqual({ ssl: { rejectUnauthorized: true } });
  });

  it("accepts ssl=true, which some providers hand out instead", () => {
    expect(sslFor("postgres://u:p@db.example.com/d?ssl=true", {}))
      .toEqual({ ssl: { rejectUnauthorized: false } });
  });

  it("lets DATABASE_SSL override a URL that says nothing", () => {
    expect(sslFor("postgres://u:p@db.example.com/d", { DATABASE_SSL: "require" }))
      .toEqual({ ssl: { rejectUnauthorized: false } });
  });

  it("lets DATABASE_SSL turn off a URL that asks for TLS", () => {
    expect(sslFor("postgres://u:p@db.example.com/d?sslmode=require", { DATABASE_SSL: "off" }))
      .toEqual({});
  });

  it("does not throw on a connection string it cannot parse", () => {
    // A libpq keyword/value DSN is legal and is not a URL. Misreading it as
    // "no TLS" is survivable; crashing at startup is not.
    expect(sslFor("host=localhost port=5433 dbname=agents", {})).toEqual({});
  });
});

describe("PostgresSql.connect", () => {
  it("retries a database that is not up yet, rather than crash-looping", async () => {
    // The first Render deploy died here: the container started seconds after
    // the database said it was available but before its private route was. A
    // refused connection at that moment is a blip, not a failure.
    const { PostgresSql } = await import("../../src/app/sql.js");
    let calls = 0;
    const fakePool = {
      query: async () => { calls += 1; if (calls < 3) throw new Error("ECONNREFUSED"); return { rows: [] }; },
      end: async () => {},
    };
    const sql = await (PostgresSql as never as {
      fromPool(p: unknown, attempts: number): Promise<unknown>;
    }).fromPool(fakePool, 6);
    expect(calls).toBe(3);
    expect(sql).toBeTruthy();
  });

  it("gives up with the real error rather than hiding it", async () => {
    const { PostgresSql } = await import("../../src/app/sql.js");
    const fakePool = {
      query: async () => { throw new Error("password authentication failed"); },
      end: async () => {},
    };
    await expect((PostgresSql as never as {
      fromPool(p: unknown, attempts: number): Promise<unknown>;
    }).fromPool(fakePool, 2)).rejects.toThrow("password authentication failed");
  });
});
