import { describe, it, expect, vi } from "vitest";
import { runTurn } from "../../src/runtime/run.js";
import type { AgentRuntime, RuntimeEvent } from "../../src/runtime/types.js";

const idle: RuntimeEvent = { type: "status", status: "idle", stopReason: null };
const session = {
  id: "s1", status: "idle" as const, stopReason: null,
  usage: { inputTokens: 2, outputTokens: 288, activeSeconds: 6.1, listCost: { amount: "87", currency: "USD" as const } },
};

function fakeRuntime(events: RuntimeEvent[], order?: string[]): AgentRuntime {
  return {
    ensureEnvironment: vi.fn(),
    publishPack: vi.fn(),
    createSession: vi.fn(),
    sendMessage: vi.fn(async () => { order?.push("send"); }),
    streamEvents: vi.fn(async () => { order?.push("stream"); return (async function* () { for (const e of events) yield e; })(); }),
    readSession: vi.fn(async () => session),
    raiseBudgetTo: vi.fn(),
    deleteSession: vi.fn(),
  } as unknown as AgentRuntime;
}

describe("runTurn", () => {
  it("opens the stream before sending the message", async () => {
    const order: string[] = [];
    await runTurn(fakeRuntime([idle], order), "s1", "hello");
    expect(order[0]).toBe("stream");
  });
  it("collects text in order and stops at idle", async () => {
    const { events } = await runTurn(fakeRuntime([
      { type: "agent.text", text: "one " }, { type: "agent.text", text: "two" }, idle,
      { type: "agent.text", text: "never" },
    ]), "s1", "hi");
    const text = events.flatMap((e) => (e.type === "agent.text" ? [e.text] : [])).join("");
    expect(text).toBe("one two");
  });
  it("stops at terminated as well as idle", async () => {
    const { events } = await runTurn(fakeRuntime([
      { type: "status", status: "terminated", stopReason: "done" },
      { type: "agent.text", text: "never" },
    ]), "s1", "hi");
    expect(events).toHaveLength(1);
  });
  it("preserves unknown event types as raw rather than dropping them", async () => {
    const { events } = await runTurn(fakeRuntime([{ type: "raw", payload: { type: "x" } }, idle]), "s1", "hi");
    expect(events.some((e) => e.type === "raw")).toBe(true);
  });
  it("returns the session usage read after the turn", async () => {
    const { session: s } = await runTurn(fakeRuntime([idle]), "s1", "hi");
    expect(s.usage.listCost).toEqual({ amount: "87", currency: "USD" });
  });
  it("reports each event to the observer as it arrives", async () => {
    const seen: string[] = [];
    await runTurn(fakeRuntime([{ type: "agent.text", text: "a" }, idle]), "s1", "hi", (e) => seen.push(e.type));
    expect(seen).toEqual(["agent.text", "status"]);
  });
});
