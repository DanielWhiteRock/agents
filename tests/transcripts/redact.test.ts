import { describe, it, expect } from "vitest";
import { redactForBuyer, containsPackInstructions, REDACTION_NOTICE } from "../../src/transcripts/redact.js";
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
    const out = redactForBuyer([{ type: "tool.use", name: "write", input: { body: instructions }, spending: false }], pack);
    expect(out[0]).toMatchObject({ type: "tool.use", name: "write", input: REDACTION_NOTICE });
  });
  it("leaves an innocent tool input alone", () => {
    const out = redactForBuyer([{ type: "tool.use", name: "read", input: { path: "/tmp/a" }, spending: false }], pack);
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
