/**
 * The payment boundary.
 *
 * Nothing outside this file knows which provider is behind it. Billing is the
 * most painful thing to migrate, and the provider here is expected to change —
 * Stripe Connect was the natural fit and was ruled out on Israeli availability,
 * so PayPal is the launch rail and a merchant of record is the likely successor.
 */
export type Money = { amountCents: number; currency: "USD" };

export type ChargeRequest = {
  /** Our own id for the purchase; providers get it for reconciliation. */
  reference: string;
  amount: Money;
  description: string;
  /** Where the provider should send the buyer back to. */
  returnUrl: string;
  cancelUrl: string;
};

export type ChargeResult = {
  /** The provider's id for this charge. */
  ref: string;
  /** "paid" settles immediately; "redirect" needs the buyer to approve first. */
  status: "paid" | "redirect";
  approveUrl?: string;
};

export type PayoutRequest = {
  reference: string;
  amount: Money;
  /** The author's payout address with this provider — an email, for PayPal. */
  recipient: string;
  note: string;
};

export interface PaymentProvider {
  readonly name: string;
  /** True when money actually moves. The stub does not. */
  readonly real: boolean;
  charge(req: ChargeRequest): Promise<ChargeResult>;
  /** Called when the buyer returns from an approval redirect. */
  capture(providerRef: string): Promise<{ status: "paid" | "failed" }>;
  refund(providerRef: string, amount: Money): Promise<void>;
  payout(req: PayoutRequest): Promise<{ ref: string }>;
}

// -------------------------------------------------------------------- stub

/**
 * Records intent and settles immediately. No money moves.
 *
 * This exists so the purchase flow, the entitlement gate and the refund window
 * are all exercised and correct before real credentials arrive — rather than
 * the current situation, where acquiring a pack charges nothing and the price on
 * the page is decoration.
 */
export class StubProvider implements PaymentProvider {
  readonly name = "stub";
  readonly real = false;
  async charge(req: ChargeRequest): Promise<ChargeResult> {
    return { ref: `stub_${req.reference}`, status: "paid" };
  }
  async capture(): Promise<{ status: "paid" | "failed" }> { return { status: "paid" }; }
  async refund(): Promise<void> { /* nothing to reverse */ }
  async payout(req: PayoutRequest): Promise<{ ref: string }> { return { ref: `stub_payout_${req.reference}` }; }
}

// ------------------------------------------------------------------ paypal

/**
 * PayPal Orders v2 for charges, Payouts v1 for author commissions.
 *
 * UNVERIFIED: written from the documented API shapes and never exercised
 * against a live account, because no credentials exist yet. Treat the first
 * real sandbox run as the test, and keep the stub as the default until it
 * passes.
 */
export class PayPalProvider implements PaymentProvider {
  readonly name = "paypal";
  readonly real = true;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly clientId: string,
    private readonly secret: string,
    private readonly base = process.env["PAYPAL_BASE"] ?? "https://api-m.sandbox.paypal.com",
  ) {
    if (!clientId || !secret) throw new Error("PayPal needs PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET");
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 30_000) return this.token.value;
    const auth = Buffer.from(`${this.clientId}:${this.secret}`).toString("base64");
    const res = await fetch(`${this.base}/v1/oauth2/token`, {
      method: "POST",
      headers: { authorization: `Basic ${auth}`, "content-type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) throw new Error(`PayPal auth failed: ${res.status} ${await res.text()}`);
    const j = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: j.access_token, expiresAt: Date.now() + j.expires_in * 1000 };
    return j.access_token;
  }

  private async call(path: string, body: unknown, method = "POST"): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${await this.accessToken()}`,
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`PayPal ${path} failed: ${res.status} ${text}`);
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  }

  private static dollars(m: Money): string { return (m.amountCents / 100).toFixed(2); }

  async charge(req: ChargeRequest): Promise<ChargeResult> {
    const order = await this.call("/v2/checkout/orders", {
      intent: "CAPTURE",
      purchase_units: [{
        reference_id: req.reference,
        description: req.description.slice(0, 127),
        amount: { currency_code: req.amount.currency, value: PayPalProvider.dollars(req.amount) },
      }],
      application_context: {
        return_url: req.returnUrl, cancel_url: req.cancelUrl,
        user_action: "PAY_NOW", shipping_preference: "NO_SHIPPING",
      },
    });
    const links = (order["links"] ?? []) as Array<{ rel?: string; href?: string }>;
    const approve = links.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href;
    if (!approve) throw new Error("PayPal returned no approval link");
    return { ref: String(order["id"]), status: "redirect", approveUrl: approve };
  }

  async capture(providerRef: string): Promise<{ status: "paid" | "failed" }> {
    const out = await this.call(`/v2/checkout/orders/${encodeURIComponent(providerRef)}/capture`, {});
    return { status: out["status"] === "COMPLETED" ? "paid" : "failed" };
  }

  async refund(providerRef: string, amount: Money): Promise<void> {
    const order = await this.call(`/v2/checkout/orders/${encodeURIComponent(providerRef)}`, undefined, "GET");
    const units = (order["purchase_units"] ?? []) as Array<{ payments?: { captures?: Array<{ id?: string }> } }>;
    const captureId = units[0]?.payments?.captures?.[0]?.id;
    if (!captureId) throw new Error("no capture to refund on that order");
    await this.call(`/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, {
      amount: { currency_code: amount.currency, value: PayPalProvider.dollars(amount) },
    });
  }

  async payout(req: PayoutRequest): Promise<{ ref: string }> {
    const out = await this.call("/v1/payments/payouts", {
      sender_batch_header: { sender_batch_id: req.reference, email_subject: "Your alphaCEO agent earnings" },
      items: [{
        recipient_type: "EMAIL",
        receiver: req.recipient,
        amount: { currency: req.amount.currency, value: PayPalProvider.dollars(req.amount) },
        note: req.note.slice(0, 1000),
        sender_item_id: req.reference,
      }],
    });
    const header = out["batch_header"] as { payout_batch_id?: string } | undefined;
    return { ref: String(header?.payout_batch_id ?? req.reference) };
  }
}

// ----------------------------------------------------------------- factory

let provider: PaymentProvider | null = null;

/** PayPal when credentials are present, the stub otherwise. */
export function payments(): PaymentProvider {
  if (provider) return provider;
  const clientId = process.env["PAYPAL_CLIENT_ID"];
  const secret = process.env["PAYPAL_CLIENT_SECRET"];
  provider = clientId && secret ? new PayPalProvider(clientId, secret) : new StubProvider();
  return provider;
}

export function setPayments(p: PaymentProvider | null): void { provider = p; }
