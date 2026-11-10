import { describe, it, expect, vi } from "vitest";
import { runTurn, resumeAfterDecision } from "../../src/runtime/run.js";
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
    confirmTool: vi.fn(),
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
  it("does not stop on a transient idle that is waiting on something", async () => {
    const { events } = await runTurn(fakeRuntime([
      { type: "status", status: "idle", stopReason: "requires_action" },
      { type: "agent.text", text: "kept going" },
      idle,
    ]), "s1", "hi");
    expect(events.some((e) => e.type === "agent.text" && e.text === "kept going")).toBe(true);
  });
  it("stops on an idle that is waiting for a decision it can surface", async () => {
    const { pendingAsks, events } = await runTurn(fakeRuntime([
      { type: "tool.use", eventId: "sevt_9", name: "bash", input: { command: "rm -rf /" }, permission: "ask", source: "builtin" },
      { type: "status", status: "idle", stopReason: "requires_action" },
      { type: "agent.text", text: "never" },
    ]), "s1", "hi");
    expect(pendingAsks).toEqual([{ eventId: "sevt_9", name: "bash", input: { command: "rm -rf /" } }]);
    expect(events.some((e) => e.type === "agent.text")).toBe(false);
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
    await runTurn(fakeRuntime([{ type: "agent.text", text: "a" }, idle]), "s1", "hi",
      { onEvent: (e) => { seen.push(e.type); } });
    expect(seen).toEqual(["agent.text", "status"]);
  });
});

describe("resumeAfterDecision", () => {
  it("opens the stream before sending the confirmation", async () => {
    const order: string[] = [];
    const rt = fakeRuntime([idle], order);
    await resumeAfterDecision(rt, "s1", async () => { order.push("confirm"); });
    expect(order).toEqual(["stream", "confirm"]);
  });
  it("returns the continuation the agent produced after the decision", async () => {
    const { events } = await resumeAfterDecision(
      fakeRuntime([{ type: "agent.text", text: "carried on" }, idle]), "s1", async () => {});
    expect(events.some((e) => e.type === "agent.text" && e.text === "carried on")).toBe(true);
  });
});

describe("intercepting a paused tool call", () => {
  const ask = (name: string, input: unknown): RuntimeEvent =>
    ({ type: "tool.use", eventId: "sevt_1", name, input, permission: "ask", source: "builtin" });

  function interceptingRuntime(events: RuntimeEvent[], confirmed: Array<[string, string, string | undefined]>) {
    return {
      ...fakeRuntime(events),
      confirmTool: vi.fn(async (_s: string, id: string, result: string, reason?: string) => {
        confirmed.push([id, result, reason]);
      }),
    } as unknown as AgentRuntime;
  }

  it("answers the pause itself, so nothing is left for a human", async () => {
    const confirmed: Array<[string, string, string | undefined]> = [];
    const { pendingAsks } = await runTurn(
      interceptingRuntime([ask("bash", { command: "rm -rf /" }), idle], confirmed), "s1", "go", {
        intercept: async () => ({ result: "deny", reason: "Deletes are forbidden." }),
      });
    expect(confirmed).toEqual([["sevt_1", "deny", "Deletes are forbidden."]]);
    expect(pendingAsks).toEqual([]);
  });

  it("keeps going after it allows, rather than ending the turn", async () => {
    const confirmed: Array<[string, string, string | undefined]> = [];
    const { events } = await runTurn(interceptingRuntime(
      [ask("bash", { command: "ls" }), { type: "agent.text", text: "carried on" }, idle], confirmed), "s1", "go", {
        intercept: async () => ({ result: "allow" }),
      });
    expect(confirmed[0]![1]).toBe("allow");
    expect(events.some((e) => e.type === "agent.text" && e.text === "carried on")).toBe(true);
  });

  it("leaves the pause for a person when the interceptor declines to decide", async () => {
    const confirmed: Array<[string, string, string | undefined]> = [];
    const { pendingAsks } = await runTurn(
      interceptingRuntime([ask("bash", { command: "ls" }), idle], confirmed), "s1", "go", {
        intercept: async () => null,
      });
    expect(confirmed).toEqual([]);
    expect(pendingAsks).toHaveLength(1);
  });

  it("reports what it decided and why, so a trace can explain itself", async () => {
    const seen: Array<{ tool: string; result: string }> = [];
    await runTurn(interceptingRuntime([ask("write", { file_path: "/.env" }), idle], []), "s1", "go", {
      intercept: async () => ({ result: "deny", reason: "Never touch .env." }),
      onIntercepted: (a, d) => seen.push({ tool: a.name, result: d.result }),
    });
    expect(seen).toEqual([{ tool: "write", result: "deny" }]);
  });

  it("passes SessionStart context to the send, for this turn and the ones after", async () => {
    const sent: Array<string | undefined> = [];
    const rt = { ...fakeRuntime([idle]),
      sendMessage: vi.fn(async (_s: string, _t: string, ctx?: string) => { sent.push(ctx); }) } as unknown as AgentRuntime;
    await runTurn(rt, "s1", "go", { systemContext: "The client is in Berlin." });
    expect(sent).toEqual(["The client is in Berlin."]);
  });
});
