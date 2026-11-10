import { describe, it, expect } from "vitest";
import { redactForBuyer, containsPackInstructions, redactStoredPayload, REDACTION_NOTICE } from "../../src/transcripts/redact.js";
import type { RuntimeEvent } from "../../src/runtime/types.js";

const instructions = `Step 1: Establish the single commercial outcome before any creative work.
Channel is never the starting point and should be chosen last.`;
const pack = { instructions };
const text = (e: RuntimeEvent) => (e.type === "agent.text" ? e.text : undefined);

describe("redactForBuyer", () => {
  it("redacts a verbatim quote of the instructions", () => {
    const out = redactForBuyer([{ type: "agent.text", text: "Sure: Channel is never the starting point and should be chosen last." }], pack);
    expect(text(out[0]!)).toBe(REDACTION_NOTICE);
  });
  it("redacts a near-verbatim quote differing only in spacing and punctuation", () => {
    const out = redactForBuyer([{ type: "agent.text", text: "my rule:  channel is never  the starting point, and should be chosen last!" }], pack);
    expect(text(out[0]!)).toBe(REDACTION_NOTICE);
  });
  it("leaves ordinary output alone", () => {
    const t = "Here is a campaign plan for your spring launch.";
    expect(text(redactForBuyer([{ type: "agent.text", text: t }], pack)[0]!)).toBe(t);
  });
  it("does not redact a short common phrase that happens to appear", () => {
    const t = "Step 1: pick a date.";
    expect(text(redactForBuyer([{ type: "agent.text", text: t }], pack)[0]!)).toBe(t);
  });
  it("replaces raw events wholesale", () => {
    const out = redactForBuyer([{ type: "raw", payload: { system: instructions } }], pack);
    expect(out[0]).toEqual({ type: "raw", payload: REDACTION_NOTICE });
  });
  it("keeps a tool-use event but scrubs instruction text from its input", () => {
    const out = redactForBuyer([{ type: "tool.use", eventId: "sevt_1", name: "write", input: { body: instructions }, permission: "ask", source: "builtin" }], pack);
    expect(out[0]).toMatchObject({ type: "tool.use", name: "write", input: REDACTION_NOTICE });
  });
  it("leaves an innocent tool input alone", () => {
    const out = redactForBuyer([{ type: "tool.use", eventId: "sevt_2", name: "read", input: { path: "/tmp/a" }, permission: "allow", source: "builtin" }], pack);
    expect(out[0]).toMatchObject({ input: { path: "/tmp/a" } });
  });
  it("fails open on empty instructions rather than redacting everything", () => {
    const t = "anything";
    expect(text(redactForBuyer([{ type: "agent.text", text: t }], { instructions: "" })[0]!)).toBe(t);
    expect(containsPackInstructions(t, "")).toBe(false);
  });
  it("passes status events through untouched", () => {
    const out = redactForBuyer([{ type: "status", status: "idle", stopReason: null }], pack);
    expect(out[0]).toEqual({ type: "status", status: "idle", stopReason: null });
  });
});

describe("redactStoredPayload", () => {
  const stored = (kind: string, obj: unknown) => redactStoredPayload(kind, JSON.stringify(obj), instructions);

  it("redacts agent text that quotes the instructions", () => {
    const out = stored("agent.text", { type: "agent.text", text: "Channel is never the starting point and should be chosen last." });
    expect(JSON.parse(out).text).toBe(REDACTION_NOTICE);
  });
  it("leaves ordinary agent text untouched", () => {
    const text = "Here is your campaign plan.";
    expect(JSON.parse(stored("agent.text", { text })).text).toBe(text);
  });
  it("keeps a buyer's own message exactly as typed, even if it quotes the pack", () => {
    const text = "Channel is never the starting point and should be chosen last.";
    expect(JSON.parse(stored("user.message", { text })).text).toBe(text);
  });
  it("scrubs instruction text out of a tool input", () => {
    const out = stored("tool.use", { name: "write", input: { body: instructions } });
    expect(JSON.parse(out).input).toBe(REDACTION_NOTICE);
  });
  it("scrubs a tool result that echoes the instructions", () => {
    const out = stored("tool.result", { name: "read", preview: instructions });
    expect(JSON.parse(out).preview).toBe(REDACTION_NOTICE);
  });
  it("replaces raw payloads wholesale", () => {
    expect(JSON.parse(stored("raw", { type: "raw", payload: { system: instructions } })).payload).toBe(REDACTION_NOTICE);
  });
  it("passes metering rows through so the buyer still sees what it cost", () => {
    const row = { list_cost_cents: 6, delta_cents: 6 };
    expect(JSON.parse(stored("run.metered", row))).toEqual(row);
  });
  it("returns the payload unchanged when there are no instructions to protect", () => {
    const p = JSON.stringify({ text: "anything" });
    expect(redactStoredPayload("agent.text", p, "")).toBe(p);
  });
  it("survives a payload that is not valid JSON", () => {
    expect(redactStoredPayload("agent.text", "not json", instructions)).toBe("not json");
  });
});
