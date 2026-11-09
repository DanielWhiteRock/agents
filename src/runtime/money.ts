/**
 * Exact money, in minor units.
 *
 * The platform reports a session's cost as `{ amount: "<integer string>",
 * currency: "USD" }` where the amount is cents. It is a string rather than a
 * number so that no float rounding is ever applied, and decimal forms such as
 * "25.00" are rejected outright. We keep that discipline: points are debited
 * from these figures, so a rounded cent is a mis-billed run.
 */
export type Money = { amount: string; currency: "USD" };

export class InvalidMoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidMoneyError";
  }
}

/** Zero or a non-zero-leading run of digits. No sign, no decimal point. */
const MINOR_UNITS = /^(0|[1-9][0-9]*)$/;

export function parseMoney(value: unknown): Money {
  if (typeof value !== "object" || value === null) {
    throw new InvalidMoneyError(`expected a money object, got ${typeof value}`);
  }
  const { amount, currency } = value as { amount?: unknown; currency?: unknown };
  if (currency !== "USD") {
    throw new InvalidMoneyError(`only USD is supported, got ${String(currency)}`);
  }
  if (typeof amount !== "string") {
    throw new InvalidMoneyError(`amount must be a string in minor units, got ${typeof amount}`);
  }
  if (!MINOR_UNITS.test(amount)) {
    throw new InvalidMoneyError(`amount must be an integer string in minor units, got "${amount}"`);
  }
  return { amount, currency: "USD" };
}

export function cents(m: Money): bigint {
  return BigInt(m.amount);
}

export function fromCents(n: bigint): Money {
  if (n < 0n) throw new InvalidMoneyError(`amount cannot be negative, got ${n}`);
  return { amount: n.toString(), currency: "USD" };
}

export function addCents(m: Money, n: bigint): Money {
  return fromCents(cents(m) + n);
}

export const ZERO_USD: Money = { amount: "0", currency: "USD" };
