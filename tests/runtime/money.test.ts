import { describe, it, expect } from "vitest";
import { parseMoney, cents, addCents, fromCents, InvalidMoneyError } from "../../src/runtime/money.js";

describe("parseMoney", () => {
  it("parses integer minor units", () => {
    expect(parseMoney({ amount: "2500", currency: "USD" })).toEqual({ amount: "2500", currency: "USD" });
  });
  it("accepts zero", () => {
    expect(parseMoney({ amount: "0", currency: "USD" })).toEqual({ amount: "0", currency: "USD" });
  });
  it("rejects a decimal amount", () => {
    expect(() => parseMoney({ amount: "25.00", currency: "USD" })).toThrow(InvalidMoneyError);
  });
  it("rejects a number amount", () => {
    expect(() => parseMoney({ amount: 2500, currency: "USD" })).toThrow(InvalidMoneyError);
  });
  it("rejects leading zeros", () => {
    expect(() => parseMoney({ amount: "0250", currency: "USD" })).toThrow(InvalidMoneyError);
  });
  it("rejects a negative amount", () => {
    expect(() => parseMoney({ amount: "-5", currency: "USD" })).toThrow(InvalidMoneyError);
  });
  it("rejects a non-USD currency", () => {
    expect(() => parseMoney({ amount: "100", currency: "EUR" })).toThrow(InvalidMoneyError);
  });
  it("rejects a non-object", () => {
    expect(() => parseMoney("2500")).toThrow(InvalidMoneyError);
  });
});

describe("cent arithmetic", () => {
  it("uses bigint so large amounts do not lose precision", () => {
    expect(cents({ amount: "90071992547409910", currency: "USD" })).toBe(90071992547409910n);
  });
  it("adds cents without floats", () => {
    expect(addCents({ amount: "2500", currency: "USD" }, 25n)).toEqual({ amount: "2525", currency: "USD" });
  });
  it("refuses to produce a negative amount", () => {
    expect(() => fromCents(-1n)).toThrow(InvalidMoneyError);
  });
});
