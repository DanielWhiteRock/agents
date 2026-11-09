import { describe, it, expect, vi, beforeEach } from "vitest";
import { ManagedAgentsRuntime, type ManagedAgentsClient } from "../../src/runtime/managed-agents.js";
import { BudgetExhaustedError, BudgetRemovalForbiddenError, BudgetRequiredError } from "../../src/runtime/types.js";
import { parseMoney } from "../../src/runtime/money.js";
import { PACK_ZERO } from "../../src/packs/pack-zero.js";
import { composeSystemPrompt } from "../../src/packs/wrapper.js";

function makeFake() {
  return {
    beta: {
      environments: { create: vi.fn().mockResolvedValue({ id: "env_1" }) },
      agents: { create: vi.fn().mockResolvedValue({ id: "agt_1", version: 1 }) },
      sessions: {
        create: vi.fn().mockResolvedValue({ id: "s1", status: "running", stop_reason: null, usage: undefined }),
        retrieve: vi.fn().mockResolvedValue({
          id: "s1", status: "idle", stop_reason: null,
          usage: { input_tokens: 2, output_tokens: 288, active_seconds: 6.144, list_cost: { amount: "87", currency: "USD" } },
        }),
        update: vi.fn().mockResolvedValue({ id: "s1", status: "idle", stop_reason: null, usage: undefined }),
        delete: vi.fn().mockResolvedValue({}),
        events: { send: vi.fn().mockResolvedValue({}), stream: vi.fn() },
      },
    },
  };
}

let fake: ReturnType<typeof makeFake>;
let runtime: ManagedAgentsRuntime;
const opts = () => ({ pack: { runtimePackId: "agt_1", version: "1" }, environmentId: "env_1", budget: parseMoney({ amount: "500", currency: "USD" }) });

beforeEach(() => {
  fake = makeFake();
  runtime = new ManagedAgentsRuntime(fake as unknown as ManagedAgentsClient);
});

describe("publishPack", () => {
  it("publishes a pack as an agent carrying the composed prompt", async () => {
    await runtime.publishPack(PACK_ZERO);
    expect(fake.beta.agents.create).toHaveBeenCalledWith(expect.objectContaining({
      system: composeSystemPrompt(PACK_ZERO),
    }));
  });
  it("sends the model as an object so effort travels with it", async () => {
    await runtime.publishPack(PACK_ZERO);
    expect(fake.beta.agents.create.mock.calls[0]![0].model).toEqual({ id: "claude-opus-5", effort: "high" });
  });
  it("sets always_ask on the destructive built-ins, since the platform default is always_allow", async () => {
    await runtime.publishPack(PACK_ZERO);
    const configs = fake.beta.agents.create.mock.calls[0]![0].tools[0].configs;
    expect(configs.map((c: any) => c.name).sort()).toEqual(["bash", "edit", "write"]);
    for (const c of configs) expect(c.permission_policy).toEqual({ type: "always_ask" });
  });
  it("returns the agent version so sessions can pin to it", async () => {
    await expect(runtime.publishPack(PACK_ZERO)).resolves.toEqual({ runtimePackId: "agt_1", version: "1" });
  });
});

describe("createSession", () => {
  it("pins the session to the published pack version", async () => {
    await runtime.createSession({ ...opts(), pack: { runtimePackId: "agt_1", version: "3" } });
    expect(fake.beta.sessions.create.mock.calls[0]![0].agent).toEqual({ type: "agent", id: "agt_1", version: 3 });
  });
  it("always sends a budget", async () => {
    await runtime.createSession(opts());
    expect(fake.beta.sessions.create.mock.calls[0]![0].budget)
      .toEqual({ type: "limit", max_list_cost: { amount: "500", currency: "USD" } });
  });
  it("refuses to create a session with no budget", async () => {
    await expect(runtime.createSession({ ...opts(), budget: undefined as never })).rejects.toThrow(BudgetRequiredError);
  });
  it("restates effort alongside a model override, which replaces the object wholesale", async () => {
    await runtime.createSession({ ...opts(), model: "claude-haiku-4-5", effort: "low" });
    expect(fake.beta.sessions.create.mock.calls[0]![0].model).toEqual({ id: "claude-haiku-4-5", effort: "low" });
  });
  it("reports zero usage for a session that has not run", async () => {
    const s = await runtime.createSession(opts());
    expect(s.usage.listCost).toEqual({ amount: "0", currency: "USD" });
  });
});

describe("budget lifecycle", () => {
  it("detects exhaustion from the 400 on send, not from stop_reason", async () => {
    fake.beta.sessions.events.send.mockRejectedValue(Object.assign(
      new Error("session budget reached: consumed list cost has met `budget.max_list_cost`"), { status: 400 }));
    await expect(runtime.sendMessage("s1", "hi")).rejects.toThrow(BudgetExhaustedError);
  });
  it("passes other errors through untouched", async () => {
    fake.beta.sessions.events.send.mockRejectedValue(Object.assign(new Error("teapot"), { status: 418 }));
    await expect(runtime.sendMessage("s1", "hi")).rejects.toThrow("teapot");
  });
  it("does not mistake a merely idle session for an exhausted one", async () => {
    expect((await runtime.readSession("s1")).stopReason).toBeNull();
  });
  it("raises a budget from consumed list_cost, not the old cap", async () => {
    await runtime.raiseBudgetTo("s1", 100n);
    expect(fake.beta.sessions.update).toHaveBeenCalledWith("s1", {
      budget: { type: "limit", max_list_cost: { amount: "187", currency: "USD" } },
    });
  });
  it("never issues a budget removal", async () => {
    await expect(runtime.raiseBudgetTo("s1", 0n)).rejects.toThrow(BudgetRemovalForbiddenError);
  });
});

describe("streamEvents", () => {
  it("normalises text, tool use and status, and keeps unknown events as raw", async () => {
    fake.beta.sessions.events.stream.mockResolvedValue((async function* () {
      yield { type: "agent.message", content: [{ type: "text", text: "hello" }] };
      yield { type: "agent.custom_tool_use", name: "run_tests", input: { x: 1 } };
      yield { type: "something.new", foo: 1 };
      yield { type: "session.status_idle", stop_reason: null };
    })());
    const out = [];
    for await (const e of await runtime.streamEvents("s1")) out.push(e);
    expect(out.map((e) => e.type)).toEqual(["agent.text", "tool.use", "raw", "status"]);
  });
});
