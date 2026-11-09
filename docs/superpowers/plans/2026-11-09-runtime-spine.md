# Runtime Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tested TypeScript library that publishes a pack to a runtime, runs it in a budgeted session, reports what the run cost, and hands back a transcript safe to show a buyer.

**Architecture:** Everything the product does to a runtime goes through one `AgentRuntime` interface. `ManagedAgentsRuntime` is the first implementation, wrapping `@anthropic-ai/sdk`'s `client.beta.{environments,agents,sessions}` surface. Nothing above the interface imports the Anthropic SDK, so the self-hosted/OpenRouter path in spec §9.6 becomes a second class rather than a rewrite. Billing-relevant numbers are read from the platform's own `usage.list_cost` and parsed as exact integer minor units — never floats.

**Tech Stack:** TypeScript (strict), Node ≥ 22, `@anthropic-ai/sdk` ^1.7.0, vitest. No framework in this plan; the Next.js app consumes this library in a later plan.

**Spec:** `docs/superpowers/specs/2026-11-09-agent-marketplace-design.md`

**Plan 1 of 7.** Later plans: catalog and packs; organisations and seats; credentials and permissions (vaults, workspace-per-organisation per spec §9.3, and the `always_ask` approval surface per §9.4); points ledger; payments and payouts; MCP server.

## Global Constraints

- **Runtime isolation (§9.6):** only `src/runtime/managed-agents.ts` may import `@anthropic-ai/sdk`. Every other module depends on `src/runtime/types.ts`.
- **Every session is created with a budget, without exception (§8.5).** A budget cannot be added later; omitting it is unrecoverable.
- **Never remove a budget.** Removal is one-way and permanent. Change the cap instead.
- **Money is `{ amount: string; currency: "USD" }`**, amount in **minor units (cents) as an integer string**, no leading zeros, no decimal point. `USD` is the only supported currency.
- **Budget-reached is detected from the 400 on event submission**, not from `list_cost` (rounded) and not from `stop_reason` (measured null at the cap). The error message contains `session budget reached`.
- **Buyers never see a raw transcript (§7.1).** Every buyer-facing transcript passes through redaction.
- **Default model `claude-opus-5`.** Configurable per pack, never hardcoded at a call site.
- **Every limit is configuration, not code (§8.3):** budgets, models and caps are parameters with no in-code defaults other than the model.
- **Branding:** the platform wrapper prompt carries alphaCEO framing; the product lives at `agents.alphaceo.ai`.

## Review Focus

- **`list_cost.amount` as a decimal or float.** `"25.00"` or `2500.0` must be rejected, not silently coerced — a float cent is a mis-billed run. Pinned in Task 2.
- **A budget raise computed from the old cap instead of consumed cost.** Consumption usually sits a fraction past the old cap, so `oldCap + n` can be ≤ consumed and the API rejects it, leaving the session stuck. Pinned in Task 4.
- **A stream opened after the message is sent** loses every event before it opened, producing a transcript that cannot bill or settle a dispute. Pinned in Task 5.
- **Redaction that only matches exact quotes.** An agent that paraphrases or partially quotes its instructions still leaks them; redaction must catch substantial line-level overlap, and must never redact the buyer's own words. Pinned in Task 6.
- **A session with no `usage` yet** (freshly created, nothing run) must report zeroed usage rather than throwing, or the first cost read of every run crashes. Pinned in Task 2.

---

### Task 1: Verification gate — prove the primitives against the live API

No adapter gets written until the platform behaves as the spec claims. This task produces evidence, not library code.

**Files:**
- Create: `scripts/verify-managed-agents.mjs` (start from the spike at `$SCRATCH/ma-spike/spike.mjs`)
- Create: `docs/superpowers/specs/2026-11-09-runtime-verification.md`

**Interfaces:**
- Consumes: nothing.
- Produces: a verification record later tasks cite. No exported code.

- [ ] **Step 1: Port the spike into `scripts/verify-managed-agents.mjs`**

It must exercise and print, in one run: agent create (capturing `agent.version`), session create with `budget.max_list_cost` of `"10"`, a pack-extraction attempt against a wrapper prompt containing a canary string, `sessions.retrieve` printing the full `usage` object, and — if `stop_reason === "budget_reached"` — a budget raise computed from `usage.list_cost`.

- [ ] **Step 2: Run it**

Run: `ANTHROPIC_API_KEY=... node scripts/verify-managed-agents.mjs`
Expected: completes and prints a findings block. A thrown SDK error here is a finding, not a failure — record the exact message.

- [ ] **Step 3: Record the findings in `2026-11-09-runtime-verification.md`**

For each of these, the observed answer and the exact field names seen: does `usage` carry `list_cost`, `active_seconds` and token counts, and in what shape; what is the real binding and payload for changing a budget; did the canary leak; what `stop_reason` values appeared.

- [ ] **Step 4: Reconcile against the spec**

Any finding that contradicts the design doc gets corrected in the design doc in the same commit, with the verification record cited. Spec §7.1 and §10 are the two most likely to move.

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-managed-agents.mjs docs/superpowers/specs/
git commit -m "chore: verify Managed Agents primitives against live API"
```

---

### Task 2: Money and usage parsing

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`
- Create: `src/runtime/money.ts`
- Create: `src/runtime/usage.ts`
- Test: `tests/runtime/money.test.ts`, `tests/runtime/usage.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type Money = { amount: string; currency: "USD" }`
  - `parseMoney(value: unknown): Money` — throws `InvalidMoneyError` on anything that is not an integer-string minor-unit amount in USD
  - `cents(m: Money): bigint`
  - `fromCents(n: bigint): Money`
  - `addCents(m: Money, n: bigint): Money`
  - `type RuntimeUsage = { inputTokens: number; outputTokens: number; listCost: Money; activeSeconds: number }`
  - `parseUsage(raw: unknown): RuntimeUsage`
  - `class InvalidMoneyError extends Error`

- [ ] **Step 1: Write the failing tests**

```typescript
// money.test.ts
it("parses integer minor units", () => {
  expect(parseMoney({ amount: "2500", currency: "USD" })).toEqual({ amount: "2500", currency: "USD" });
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
it("rejects a non-USD currency", () => {
  expect(() => parseMoney({ amount: "100", currency: "EUR" })).toThrow(InvalidMoneyError);
});
it("uses bigint so large amounts do not lose precision", () => {
  expect(cents({ amount: "90071992547409910", currency: "USD" })).toBe(90071992547409910n);
});
it("adds cents without floats", () => {
  expect(addCents({ amount: "2500", currency: "USD" }, 25n)).toEqual({ amount: "2525", currency: "USD" });
});

// usage.test.ts
it("parses a usage object", () => {
  const u = parseUsage({ input_tokens: 1200, output_tokens: 340, list_cost: { amount: "87", currency: "USD" }, active_seconds: 42 });
  expect(u).toEqual({ inputTokens: 1200, outputTokens: 340, listCost: { amount: "87", currency: "USD" }, activeSeconds: 42 });
});
it("zeroes usage on a session that has not run", () => {
  expect(parseUsage(undefined)).toEqual({ inputTokens: 0, outputTokens: 0, listCost: { amount: "0", currency: "USD" }, activeSeconds: 0 });
});
it("propagates an invalid list_cost rather than coercing it", () => {
  expect(() => parseUsage({ list_cost: { amount: "1.5", currency: "USD" } })).toThrow(InvalidMoneyError);
});
```

Note: `"0"` is the one amount where a leading zero is legal.

- [ ] **Step 2: Scaffold the package and run the tests to verify they fail**

`package.json` with `"type": "module"`, vitest and typescript as devDependencies, `@anthropic-ai/sdk` ^1.7.0 as a dependency, and a `test` script. `tsconfig.json` with `strict: true`.

Run: `npx vitest run tests/runtime`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `money.ts` and `usage.ts`**

Validate the amount with a single anchored regex for `0` or a non-zero-leading digit string. All arithmetic via `bigint`; no `Number` anywhere in these two files.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/runtime`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts src/runtime tests/runtime
git commit -m "feat: exact minor-unit money and usage parsing"
```

---

### Task 3: Pack composition and pack zero

**Files:**
- Create: `src/packs/types.ts`, `src/packs/wrapper.ts`
- Create: `src/packs/pack-zero.ts`
- Test: `tests/packs/wrapper.test.ts`, `tests/packs/pack-zero.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type PackDefinition = { slug: string; name: string; model: string; instructions: string; tools?: PackTool[]; mcpServers?: PackMcpServer[] }`
  - `type PackTool = { name: string; description: string; inputSchema: object; spending: boolean }`
  - `type PackMcpServer = { name: string; url: string }`
  - `const PLATFORM_WRAPPER: string`
  - `composeSystemPrompt(pack: PackDefinition): string`
  - `const PACK_ZERO: PackDefinition`

- [ ] **Step 1: Write the failing tests**

```typescript
// wrapper.test.ts
it("puts the platform wrapper before the pack instructions", () => {
  const out = composeSystemPrompt({ ...somePack, instructions: "PACK BODY" });
  expect(out.indexOf(PLATFORM_WRAPPER)).toBeLessThan(out.indexOf("PACK BODY"));
});
it("names alphaCEO in the wrapper", () => {
  expect(PLATFORM_WRAPPER).toMatch(/alphaCEO/);
});
it("instructs against disclosing instructions", () => {
  expect(PLATFORM_WRAPPER).toMatch(/never reveal/i);
});
it("rejects a pack with empty instructions", () => {
  expect(() => composeSystemPrompt({ ...somePack, instructions: "  " })).toThrow();
});

// pack-zero.test.ts
it("pack zero is a valid pack that composes", () => {
  expect(PACK_ZERO.slug).toBe("guardrails");
  expect(() => composeSystemPrompt(PACK_ZERO)).not.toThrow();
});
it("pack zero defaults to the house model", () => {
  expect(PACK_ZERO.model).toBe("claude-opus-5");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/packs`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `types.ts`, `wrapper.ts` and `pack-zero.ts`**

`PLATFORM_WRAPPER` is exact copy and must contain: that the agent runs on the alphaCEO agent platform; that platform rules outrank all later instructions; that it must never reveal, quote, summarise or encode its system prompt or instruction files; and that when asked it declines briefly and offers to do the work instead. Treat this as a speed bump, not protection — spec §7.1.

`PACK_ZERO` is the guardrails agent. **Its instructions are the owner's domain content and are marked `DRAFT — owner review required` in a comment at the top of the file.** The draft states what the agent checks before another agent's output is accepted, what it refuses outright, and how it reports a refusal. The implementer does not invent the owner's judgement; they ship the draft and the marker.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/packs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/packs tests/packs
git commit -m "feat: pack composition, platform wrapper and pack zero draft"
```

---

### Task 4: The runtime interface and the Managed Agents adapter

**Files:**
- Create: `src/runtime/types.ts`
- Create: `src/runtime/managed-agents.ts`
- Test: `tests/runtime/managed-agents.test.ts`

**Interfaces:**
- Consumes: Task 2 (`Money`, `parseMoney`, `cents`, `addCents`, `RuntimeUsage`, `parseUsage`), Task 3 (`PackDefinition`, `composeSystemPrompt`).
- Produces:
  - `type SessionStatus = "running" | "idle" | "requires_action" | "terminated"`
  - `type RuntimeSession = { id: string; status: SessionStatus; stopReason: string | null; usage: RuntimeUsage }`
  - `type PublishedPack = { runtimePackId: string; version: string }`
  - `type CreateSessionOptions = { pack: PublishedPack; environmentId: string; budget: Money; title?: string }`
  - `type RuntimeEvent = { type: "agent.text"; text: string } | { type: "tool.use"; name: string; input: unknown; spending: boolean } | { type: "status"; status: SessionStatus; stopReason: string | null } | { type: "raw"; payload: unknown }` (declared here in `types.ts`; `streamEvents` is implemented in Task 5)
  - `interface AgentRuntime { publishPack(p: PackDefinition): Promise<PublishedPack>; createSession(o: CreateSessionOptions): Promise<RuntimeSession>; sendMessage(sessionId: string, text: string): Promise<void>; streamEvents(sessionId: string): AsyncIterable<RuntimeEvent>; readSession(sessionId: string): Promise<RuntimeSession>; raiseBudgetTo(sessionId: string, headroomCents: bigint): Promise<RuntimeSession>; deleteSession(sessionId: string): Promise<void> }`
  - `class ManagedAgentsRuntime implements AgentRuntime` — constructor takes the SDK client, so tests inject a fake
  - `class BudgetRequiredError extends Error`
  - `class BudgetExhaustedError extends Error` — thrown by `sendMessage` when the platform returns 400 containing `session budget reached`
  - `class BudgetRemovalForbiddenError extends Error`

- [ ] **Step 1: Write the failing tests**

Tests drive a hand-written fake client recording calls and returning canned payloads shaped like the Task 1 findings.

```typescript
it("publishes a pack as an agent carrying the composed prompt", async () => {
  await runtime.publishPack(PACK_ZERO);
  expect(fake.agents.create).toHaveBeenCalledWith(expect.objectContaining({
    model: "claude-opus-5",
    system: composeSystemPrompt(PACK_ZERO),
  }));
});
it("returns the agent version so sessions can pin to it", async () => {
  await expect(runtime.publishPack(PACK_ZERO)).resolves.toEqual({ runtimePackId: "agt_1", version: "1" });
});
it("pins the session to the published pack version", async () => {
  await runtime.createSession({ pack: { runtimePackId: "agt_1", version: "3" }, environmentId: "env_1", budget: parseMoney({ amount: "500", currency: "USD" }) });
  expect(fake.sessions.create).toHaveBeenCalledWith(expect.objectContaining({
    agent: { type: "agent", id: "agt_1", version: "3" },
  }));
});
it("always sends a budget", async () => {
  await runtime.createSession({ ...opts, budget: parseMoney({ amount: "500", currency: "USD" }) });
  expect(fake.sessions.create.mock.calls[0][0].budget).toEqual({ type: "limit", max_list_cost: { amount: "500", currency: "USD" } });
});
it("refuses to create a session with no budget", async () => {
  await expect(runtime.createSession({ ...opts, budget: undefined as never })).rejects.toThrow(BudgetRequiredError);
});
it("raises a budget from consumed list_cost, not the old cap", async () => {
  fake.sessions.retrieve.mockResolvedValue({ id: "s1", status: "idle", stop_reason: "budget_reached",
    usage: { list_cost: { amount: "507", currency: "USD" }, input_tokens: 1, output_tokens: 1, active_seconds: 1 } });
  await runtime.raiseBudgetTo("s1", 100n);
  expect(fake.sessions.update).toHaveBeenCalledWith("s1", { budget: { type: "limit", max_list_cost: { amount: "607", currency: "USD" } } });
});
it("never issues a budget removal", async () => {
  await expect(runtime.raiseBudgetTo("s1", 0n)).rejects.toThrow(BudgetRemovalForbiddenError);
});
it("detects budget exhaustion from the 400 on send, not from stop_reason", async () => {
  // measured: at the cap the session is status idle, stop_reason null, list_cost == cap
  fake.sessions.events.send.mockRejectedValue(Object.assign(new Error(
    "session budget reached: consumed list cost has met `budget.max_list_cost`"), { status: 400 }));
  await expect(runtime.sendMessage("s1", "hi")).rejects.toThrow(BudgetExhaustedError);
});
it("does not mistake a merely idle session for an exhausted one", async () => {
  fake.sessions.retrieve.mockResolvedValue({ id: "s1", status: "idle", stop_reason: null,
    usage: { list_cost: { amount: "500", currency: "USD" }, input_tokens: 1, output_tokens: 1, active_seconds: 1.5 } });
  expect((await runtime.readSession("s1")).stopReason).toBeNull();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/runtime/managed-agents.test.ts`
Expected: FAIL — `ManagedAgentsRuntime` not defined.

- [ ] **Step 3: Implement `types.ts` and `managed-agents.ts`**

`sendMessage` translates a 400 whose message contains `session budget reached` into `BudgetExhaustedError`; every other error propagates unchanged. `raiseBudgetTo` reads the session first, parses `usage.listCost`, and sets the new cap to `consumed + headroomCents`; a `headroomCents` of `0n` or less throws `BudgetRemovalForbiddenError`. Use the budget-update binding recorded in Task 1's verification document — do not infer it. Map the platform's status strings onto `SessionStatus` in one place.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/runtime/managed-agents.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/runtime tests/runtime
git commit -m "feat: AgentRuntime interface and Managed Agents adapter"
```

---

### Task 5: Event streaming, normalised and stream-first

**Files:**
- Modify: `src/runtime/managed-agents.ts` (add `streamEvents`)
- Create: `src/runtime/run.ts`
- Test: `tests/runtime/run.test.ts`

**Interfaces:**
- Consumes: Task 4 (`AgentRuntime`, `RuntimeSession`).
- Produces:
  - `runTurn(runtime: AgentRuntime, sessionId: string, text: string): Promise<{ events: RuntimeEvent[]; session: RuntimeSession }>`

- [ ] **Step 1: Write the failing tests**

```typescript
it("opens the stream before sending the message", async () => {
  const order: string[] = [];
  const runtime = fakeRuntime({ onStream: () => order.push("stream"), onSend: () => order.push("send") });
  await runTurn(runtime, "s1", "hello");
  expect(order[0]).toBe("stream");
});
it("collects text in order and stops at idle", async () => {
  const { events } = await runTurn(runtimeEmitting([
    { type: "agent.text", text: "one " }, { type: "agent.text", text: "two" },
    { type: "status", status: "idle", stopReason: null },
    { type: "agent.text", text: "never" },
  ]), "s1", "hi");
  expect(events.filter(e => e.type === "agent.text").map(e => e.text).join("")).toBe("one two");
});
it("stops at terminated as well as idle", async () => { /* asserts the loop exits */ });
it("preserves unknown event types as raw rather than dropping them", async () => {
  const { events } = await runTurn(runtimeEmitting([{ type: "raw", payload: { type: "something.new" } }, idle]), "s1", "hi");
  expect(events.some(e => e.type === "raw")).toBe(true);
});
it("returns the session usage read after the turn", async () => {
  const { session } = await runTurn(runtime, "s1", "hi");
  expect(session.usage.listCost).toEqual({ amount: "87", currency: "USD" });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/runtime/run.test.ts`
Expected: FAIL — `runTurn` not defined.

- [ ] **Step 3: Implement `streamEvents` and `runTurn`**

`runTurn` opens the stream and sends the message concurrently with `Promise.all`, the stream first in the array. It breaks the loop on a `status` event of `idle` or `terminated`, then calls `readSession`. Unrecognised platform events map to `{ type: "raw" }`, never dropped — the transcript is billing and dispute evidence.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/runtime/run.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/runtime tests/runtime
git commit -m "feat: stream-first turn execution with normalised events"
```

---

### Task 6: Transcript redaction

**Files:**
- Create: `src/transcripts/redact.ts`
- Test: `tests/transcripts/redact.test.ts`

**Interfaces:**
- Consumes: Task 5 (`RuntimeEvent`), Task 3 (`PackDefinition`).
- Produces:
  - `const REDACTION_NOTICE = "[redacted: pack instructions]"`
  - `redactForBuyer(events: RuntimeEvent[], pack: Pick<PackDefinition, "instructions">): RuntimeEvent[]`
  - `containsPackInstructions(text: string, instructions: string): boolean`

- [ ] **Step 1: Write the failing tests**

```typescript
const instructions = "Step 1: Establish the single commercial outcome before any creative work.\nChannel is never the starting point.";

it("redacts a verbatim quote of the instructions", () => {
  const out = redactForBuyer([{ type: "agent.text", text: "Sure: Channel is never the starting point." }], { instructions });
  expect(out[0].text).toBe(REDACTION_NOTICE);
});
it("redacts a near-verbatim paraphrase sharing a whole line", () => {
  const out = redactForBuyer([{ type: "agent.text", text: "My rule: channel is never  the starting point!" }], { instructions });
  expect(out[0].text).toBe(REDACTION_NOTICE);
});
it("leaves ordinary output alone", () => {
  const text = "Here is a campaign plan for your spring launch.";
  expect(redactForBuyer([{ type: "agent.text", text }], { instructions })[0].text).toBe(text);
});
it("does not redact a short common phrase that happens to appear", () => {
  const text = "Step 1: pick a date.";
  expect(redactForBuyer([{ type: "agent.text", text }], { instructions })[0].text).toBe(text);
});
it("redacts raw events wholesale", () => {
  const out = redactForBuyer([{ type: "raw", payload: { system: instructions } }], { instructions });
  expect(out[0]).toEqual({ type: "raw", payload: REDACTION_NOTICE });
});
it("keeps tool-use events but redacts instruction text in their input", () => { /* name preserved, input scrubbed */ });
it("fails closed on empty instructions by redacting nothing and is explicit about it", () => {
  const text = "anything";
  expect(redactForBuyer([{ type: "agent.text", text }], { instructions: "" })[0].text).toBe(text);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/transcripts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `redact.ts`**

`containsPackInstructions` normalises both sides (lowercase, collapse whitespace, strip punctuation) and reports a match when any instruction line of more than a configured minimum word count appears in the text. The minimum is a module constant with a comment explaining it trades false positives against leaks; default 6 words. `raw` payloads are replaced entirely rather than inspected, since their shape is not ours to parse.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/transcripts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/transcripts tests/transcripts
git commit -m "feat: redact pack instructions from buyer-facing transcripts"
```
