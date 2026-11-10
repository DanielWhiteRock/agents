import { describe, it, expect, vi, beforeEach } from "vitest";
import { ManagedAgentsRuntime, type ManagedAgentsClient } from "../../src/runtime/managed-agents.js";
import { BudgetExhaustedError, BudgetRemovalForbiddenError, BudgetRequiredError } from "../../src/runtime/types.js";
import { parseMoney } from "../../src/runtime/money.js";
import { PACK_ZERO } from "../../src/packs/pack-zero.js";
import { composeSystemPrompt } from "../../src/packs/wrapper.js";

function makeFake() {
  return {
    skills: { create: vi.fn().mockResolvedValue({ id: "skill_1", latest_version_id: "sv_1" }) },
    beta: {
      environments: { create: vi.fn().mockResolvedValue({ id: "env_1" }) },
      agents: { create: vi.fn().mockResolvedValue({ id: "agt_1", version: 1 }) },
      skills: { create: vi.fn().mockResolvedValue({ id: "skill_1", latest_version_id: "sv_1" }) },
      files: { upload: vi.fn().mockResolvedValue({ id: "file_1" }) },
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
    await expect(runtime.publishPack(PACK_ZERO)).resolves.toEqual({ runtimePackId: "agt_1", version: "1", skills: [], subagents: [], mounts: [] });
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
  it("nests a model override inside agent_with_overrides, not at the top level", async () => {
    await runtime.createSession({ ...opts(), model: "claude-haiku-4-5", effort: "low" });
    const body = fake.beta.sessions.create.mock.calls[0]![0];
    // A top-level `model` is rejected by the API as an unknown field.
    expect(body.model).toBeUndefined();
    expect(body.agent).toEqual({
      type: "agent_with_overrides", id: "agt_1", version: 1,
      model: { id: "claude-haiku-4-5", effort: "low" },
    });
  });
  it("omits effort entirely when none is given, since some models reject the field", async () => {
    await runtime.createSession({ ...opts(), model: "claude-haiku-4-5" });
    expect(fake.beta.sessions.create.mock.calls[0]![0].agent.model).toEqual({ id: "claude-haiku-4-5" });
  });
  it("uses the plain pinned form when there is no override", async () => {
    await runtime.createSession(opts());
    expect(fake.beta.sessions.create.mock.calls[0]![0].agent)
      .toEqual({ type: "agent", id: "agt_1", version: 1 });
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
  it("normalises text, tool use and status, and keeps genuinely unknown events as raw", async () => {
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

  it("maps the platform's own usage snapshot, with its budget", async () => {
    // Shape captured from a live session.
    fake.beta.sessions.events.stream.mockResolvedValue((async function* () {
      yield {
        type: "session.usage",
        budget: { type: "limit", max_list_cost: { amount: "50", currency: "USD" } },
        usage: { active_seconds: 19.426, cache_read_input_tokens: 5119, input_tokens: 2,
          list_cost: { amount: "4", currency: "USD" }, output_tokens: 1129 },
      };
      yield { type: "session.status_idle", stop_reason: { type: "end_turn" } };
    })());
    const out = [];
    for await (const e of await runtime.streamEvents("s1")) out.push(e);
    expect(out[0]).toEqual({
      type: "usage.snapshot",
      usage: { inputTokens: 2, outputTokens: 1129, activeSeconds: 19.426, listCost: { amount: "4", currency: "USD" } },
      budget: { amount: "50", currency: "USD" },
    });
    expect(out[1]).toEqual({ type: "status", status: "idle", stopReason: "end_turn" });
  });

  it("labels the stream's echoes and spans instead of leaving them unmapped", async () => {
    fake.beta.sessions.events.stream.mockResolvedValue((async function* () {
      yield { type: "span.model_request_start" };
      yield { type: "session.thread_status_idle", agent_name: "Guardrails Reviewer", stop_reason: { type: "end_turn" } };
      yield { type: "user.message", content: [{ type: "text", text: "review this" }] };
      yield { type: "user.tool_confirmation", result: "deny", deny_message: "no shell" };
      yield { type: "session.status_idle", stop_reason: null };
    })());
    const out = [];
    for await (const e of await runtime.streamEvents("s1")) out.push(e);
    expect(out.map((e) => e.type)).toEqual(["model.request_start", "thread.status", "echo", "echo", "status"]);
    expect(out[1]).toMatchObject({ agentName: "Guardrails Reviewer", status: "idle", stopReason: "end_turn" });
    expect(out[2]).toEqual({ type: "echo", of: "user.message", text: "review this" });
    expect(out[3]).toEqual({ type: "echo", of: "tool_confirmation:deny", text: "no shell" });
  });
});

describe("publishing a pack folder", () => {
  const SKILL = {
    name: "processing-pdfs",
    files: [
      { path: "SKILL.md", content: "---\nname: processing-pdfs\ndescription: Extracts text. Use when asked.\n---\nbody" },
      { path: "references/notes.md", content: "detail" },
    ],
  };

  it("uploads each skill under its own top-level directory", async () => {
    await runtime.publishPack(PACK_ZERO, [SKILL]);
    expect(fake.skills.create).toHaveBeenCalledTimes(1);
    const files = fake.skills.create.mock.calls[0]![0].files as Array<{ name: string }>;
    // The Skills API requires one top-level directory with SKILL.md at its root.
    expect(files.map((f) => f.name)).toEqual(["processing-pdfs/SKILL.md", "processing-pdfs/references/notes.md"]);
  });

  it("attaches the uploaded skills to the agent by id", async () => {
    const out = await runtime.publishPack(PACK_ZERO, [SKILL]);
    expect(fake.beta.agents.create.mock.calls[0]![0].skills)
      .toEqual([{ type: "custom", skill_id: "skill_1", version: "latest" }]);
    expect(out.skills).toEqual([{ name: "processing-pdfs", skillId: "skill_1", skillVersion: "sv_1" }]);
  });

  it("sends no skills field at all when a pack has no skill directories", async () => {
    await runtime.publishPack(PACK_ZERO);
    expect(fake.beta.agents.create.mock.calls[0]![0].skills).toBeUndefined();
    expect(fake.skills.create).not.toHaveBeenCalled();
  });

  it("creates each subagent and lists it as a predefined agent", async () => {
    fake.beta.agents.create
      .mockResolvedValueOnce({ id: "agt_sub", version: 1 })
      .mockResolvedValueOnce({ id: "agt_main", version: 1 });
    const out = await runtime.publishPack(PACK_ZERO, [], [
      { name: "reviewer", description: "Reviews", system: "You review." },
    ]);
    // The subagent is created first, because the main agent references it by id.
    expect(fake.beta.agents.create.mock.calls[0]![0].name).toBe("reviewer");
    const main = fake.beta.agents.create.mock.calls[1]![0];
    expect(main.multiagent).toEqual({
      type: "multiagent_20261001",
      subagents: {
        type: "enabled",
        inline_agents: { type: "disabled" },
        predefined_agents: [{ type: "agent", id: "agt_sub", version: 1 }],
      },
    });
    expect(out.subagents).toEqual([{ name: "reviewer", agentId: "agt_sub", version: "1" }]);
  });

  it("gives a subagent the same always_ask posture as the pack", async () => {
    await runtime.publishPack(PACK_ZERO, [], [{ name: "reviewer", system: "You review." }]);
    const configs = fake.beta.agents.create.mock.calls[0]![0].tools[0].configs;
    expect(configs.map((c: { name: string }) => c.name).sort()).toEqual(["bash", "edit", "write"]);
  });

  it("falls back to the pack's model for a subagent that names none", async () => {
    await runtime.publishPack(PACK_ZERO, [], [{ name: "reviewer", system: "You review." }]);
    expect(fake.beta.agents.create.mock.calls[0]![0].model).toEqual({ id: PACK_ZERO.model });
  });

  it("refuses more subagents than the platform allows", async () => {
    const many = Array.from({ length: 21 }, (_, i) => ({ name: `a${i}`, system: "x" }));
    await expect(runtime.publishPack(PACK_ZERO, [], many)).rejects.toThrow(/at most 20 subagents/);
  });

  it("sends no multiagent block when a pack declares no subagents", async () => {
    await runtime.publishPack(PACK_ZERO, [SKILL]);
    expect(fake.beta.agents.create.mock.calls[0]![0].multiagent).toBeUndefined();
  });
});

describe("the destructive-tool posture", () => {
  const policyOf = (call: any) =>
    call.tools[0].configs.map((c: { permission_policy: { type: string } }) => c.permission_policy.type);

  it("defaults to always_ask when a pack declares nothing", async () => {
    await runtime.publishPack(PACK_ZERO);
    expect(policyOf(fake.beta.agents.create.mock.calls[0]![0])).toEqual(["always_ask", "always_ask", "always_ask"]);
  });

  it("runs destructive tools unattended when configured to", async () => {
    await runtime.publishPack({ ...PACK_ZERO, destructivePolicy: "always_allow" });
    expect(policyOf(fake.beta.agents.create.mock.calls[0]![0])).toEqual(["always_allow", "always_allow", "always_allow"]);
  });

  it("supports letting the server judge each call", async () => {
    await runtime.publishPack({ ...PACK_ZERO, destructivePolicy: "auto" });
    expect(policyOf(fake.beta.agents.create.mock.calls[0]![0])).toEqual(["auto", "auto", "auto"]);
  });

  it("applies the same posture to a pack's custom spending tools", async () => {
    await runtime.publishPack({
      ...PACK_ZERO, destructivePolicy: "always_allow",
      tools: [{ name: "charge_card", description: "d", inputSchema: {}, spending: true }],
    });
    const custom = fake.beta.agents.create.mock.calls[0]![0].tools.find((t: any) => t.type === "custom");
    expect(custom.permission_policy).toEqual({ type: "always_allow" });
  });

  it("gives a subagent the same posture, since a specialist is not an exemption", async () => {
    fake.beta.agents.create
      .mockResolvedValueOnce({ id: "agt_sub", version: 1 })
      .mockResolvedValueOnce({ id: "agt_main", version: 1 });
    await runtime.publishPack({ ...PACK_ZERO, destructivePolicy: "always_allow" }, [],
      [{ name: "reviewer", system: "You review." }]);
    expect(policyOf(fake.beta.agents.create.mock.calls[0]![0]))
      .toEqual(["always_allow", "always_allow", "always_allow"]);
  });
});

describe("mounting the pack folder", () => {
  it("asks for a relative path, because the platform rewrites it under the upload root", async () => {
    await runtime.publishPack(PACK_ZERO, [], [], [{ path: "commands/audit.md", content: "# audit" }]);
    expect(fake.beta.files.upload).toHaveBeenCalledTimes(1);
    const out = await runtime.publishPack(PACK_ZERO, [], [], [{ path: "commands/audit.md", content: "# audit" }]);
    // Not "/workspace/pack/..." — that is the path we used to claim and the
    // files were never there, which an agent told us in as many words.
    expect(out.mounts[0]!.mountPath).toBe("pack/commands/audit.md");
  });

  it("passes the mounts to the session as file resources", async () => {
    await runtime.createSession({
      pack: { runtimePackId: "agt_1", version: "1" },
      environmentId: "env_1",
      budget: parseMoney({ amount: "500", currency: "USD" }),
      mounts: [{ path: "commands/audit.md", fileId: "file_1", mountPath: "pack/commands/audit.md" }],
    });
    expect(fake.beta.sessions.create.mock.calls[0]![0].resources)
      .toEqual([{ type: "file", file_id: "file_1", mount_path: "pack/commands/audit.md" }]);
  });

  it("sends no resources when a pack has no folder", async () => {
    await runtime.createSession({
      pack: { runtimePackId: "agt_1", version: "1" },
      environmentId: "env_1",
      budget: parseMoney({ amount: "500", currency: "USD" }),
    });
    expect(fake.beta.sessions.create.mock.calls[0]![0].resources).toBeUndefined();
  });
});
