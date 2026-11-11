import { expect, test } from "vitest";
import { text, price } from "../../src/mcp/reply.js";
import { pts } from "../../src/billing/points.js";

test("price renders points, never dollars", () => {
  expect(price(0)).toBe("free");
  expect(price(120)).toBe(pts(120 * 1000));
  expect(price(120)).not.toContain("$");
});
test("text puts reason on its own first line", () => {
  expect(text("body", "Checking the price").content[0].text).toBe("Checking the price\n\nbody");
  expect(text("body").content[0].text).toBe("body");
});
