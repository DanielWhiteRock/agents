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
      files: {
        upload: vi.fn().mockResolvedValue({ id: "file_1" }),
        list: vi.fn().mockResolvedValue({ data: [] }),
        download: vi.fn().mockResolvedValue({ arrayBuffer: async () => new ArrayBuffer(0) }),
      },
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
    expect(main.multiagent.subagents).toEqual({
      type: "enabled",
      inline_agents: { type: "disabled" },
      predefined_agents: [{ type: "agent", id: "agt_sub", version: 1 }],
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

  it("still sends a multiagent block when a pack declares no subagents, so workflows stay on", async () => {
    await runtime.publishPack(PACK_ZERO, [SKILL]);
    const block = fake.beta.agents.create.mock.calls[0]![0].multiagent;
    expect(block.subagents).toEqual({ type: "disabled" });
    expect(block.workflows.type).toBe("enabled");
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

describe("sending a turn with privileged context", () => {
  it("puts system.message last, which the API requires", async () => {
    await runtime.sendMessage("s1", "do the thing", "House rule: quote GBP.");
    const events = fake.beta.sessions.events.send.mock.calls[0]![1].events;
    // Putting it first returns 400 "`system.message` must be the last event".
    expect(events.map((e: { type: string }) => e.type)).toEqual(["user.message", "system.message"]);
    expect(events[1].content[0].text).toBe("House rule: quote GBP.");
  });

  it("sends the message alone when there is no context to add", async () => {
    await runtime.sendMessage("s1", "do the thing");
    expect(fake.beta.sessions.events.send.mock.calls[0]![1].events.map((e: { type: string }) => e.type))
      .toEqual(["user.message"]);
  });
});

describe("delegation and workflow runs", () => {
  const blockOf = () => fake.beta.agents.create.mock.calls.at(-1)![0].multiagent;

  it("enables dynamic workflows even for a pack with no declared specialists", async () => {
    await runtime.publishPack(PACK_ZERO);
    // Omitting multiagent entirely is what silently gave up workflows.
    expect(blockOf()).toEqual({
      type: "multiagent_20261001",
      subagents: { type: "disabled" },
      workflows: { type: "enabled", predefined_agents: [{ type: "self" }] },
    });
  });

  it("restricts delegation to the specialists the author declared", async () => {
    fake.beta.agents.create
      .mockResolvedValueOnce({ id: "agt_sub", version: 1 })
      .mockResolvedValueOnce({ id: "agt_main", version: 1 });
    await runtime.publishPack(PACK_ZERO, [], [{ name: "reviewer", system: "You review." }]);
    expect(blockOf().subagents).toEqual({
      type: "enabled",
      inline_agents: { type: "disabled" },
      predefined_agents: [{ type: "agent", id: "agt_sub", version: 1 }],
    });
  });

  it("lets a workflow use the declared agents and copies of the pack itself", async () => {
    fake.beta.agents.create
      .mockResolvedValueOnce({ id: "agt_sub", version: 1 })
      .mockResolvedValueOnce({ id: "agt_main", version: 1 });
    await runtime.publishPack(PACK_ZERO, [], [{ name: "reviewer", system: "You review." }]);
    expect(blockOf().workflows).toEqual({
      type: "enabled",
      predefined_agents: [{ type: "agent", id: "agt_sub", version: 1 }, { type: "self" }],
    });
  });

  it("does not disable inline agents for workflows, which would make a run useless", async () => {
    await runtime.publishPack(PACK_ZERO);
    // A workflow writes its own agents; restricting it to a list the author
    // never wrote stops runs working rather than making them safe.
    expect(blockOf().workflows.inline_agents).toBeUndefined();
  });
});

describe("workflow run events", () => {
  it("maps a run, its phases and its threads instead of filing them as raw", async () => {
    // Shapes captured from a live workflow run.
    fake.beta.sessions.events.stream.mockResolvedValue((async function* () {
      yield { type: "workflow_run.created", name: "Portfolio price sweep", description: "d",
        phases: [{ id: "wrph_1" }, { id: "wrph_2" }, { id: "wrph_3" }], workflow_run_id: "wrun_1" };
      yield { type: "workflow_run.status_running", workflow_run_id: "wrun_1" };
      yield { type: "workflow_run.phase_started", workflow_run_id: "wrun_1", workflow_run_phase_id: "wrph_1" };
      yield { type: "session.thread_created", session_thread_id: "sthr_1",
        agent_name: "devils-advocate", workflow_run_id: "wrun_1" };
      yield { type: "workflow_run.phase_ended", workflow_run_id: "wrun_1", workflow_run_phase_id: "wrph_1" };
      yield { type: "workflow_run.status_ended", workflow_run_id: "wrun_1", result: { type: "completed" } };
      yield { type: "session.status_idle", stop_reason: null };
    })());
    const out = [];
    for await (const e of await runtime.streamEvents("s1")) out.push(e);

    expect(out.map((e) => e.type)).toEqual([
      "workflow.run", "workflow.run", "workflow.phase", "thread.created",
      "workflow.phase", "workflow.run", "status",
    ]);
    expect(out[0]).toEqual({
      type: "workflow.run", state: "created", runId: "wrun_1",
      name: "Portfolio price sweep", description: "d", phases: 3,
    });
    expect(out[3]).toEqual({
      type: "thread.created", threadId: "sthr_1", agentName: "devils-advocate", runId: "wrun_1",
    });
    expect(out[5]).toEqual({ type: "workflow.run", state: "ended", runId: "wrun_1", result: "completed" });
  });

  it("maps a thread created outside a workflow run too", async () => {
    fake.beta.sessions.events.stream.mockResolvedValue((async function* () {
      yield { type: "session.thread_created", session_thread_id: "sthr_9", agent_name: null };
      yield { type: "session.status_idle", stop_reason: null };
    })());
    const out = [];
    for await (const e of await runtime.streamEvents("s1")) out.push(e);
    expect(out[0]).toEqual({ type: "thread.created", threadId: "sthr_9", agentName: null, runId: null });
  });
});

describe("capabilities a pack asks for", () => {
  it("attaches Anthropic's prebuilt skills alongside the pack's own", async () => {
    await runtime.publishPack(
      { ...PACK_ZERO, anthropicSkills: ["xlsx", "pdf"] },
      [{ name: "thing", files: [{ path: "SKILL.md", content: "---\nname: thing\ndescription: d. Use when x.\n---\nb" }] }]);
    expect(fake.beta.agents.create.mock.calls[0]![0].skills).toEqual([
      { type: "anthropic", skill_id: "xlsx" },
      { type: "anthropic", skill_id: "pdf" },
      { type: "custom", skill_id: "skill_1", version: "latest" },
    ]);
  });

  it("enables an advisor only when the pack asks", async () => {
    await runtime.publishPack(PACK_ZERO);
    expect(fake.beta.agents.create.mock.calls[0]![0].multiagent.advisor).toBeUndefined();
    await runtime.publishPack({ ...PACK_ZERO, advisorModel: "claude-opus-5" });
    expect(fake.beta.agents.create.mock.calls[1]![0].multiagent.advisor)
      .toEqual({ type: "enabled", model: "claude-opus-5" });
  });

  it("pins the web tools to allowed domains", async () => {
    await runtime.publishPack({ ...PACK_ZERO, web: { allowedDomains: ["gov.uk"] } });
    const configs = fake.beta.agents.create.mock.calls[0]![0].tools[0].configs;
    const web = configs.filter((c: { name: string }) => c.name.startsWith("web_"));
    expect(web).toEqual([
      { name: "web_search", allowed_domains: ["gov.uk"] },
      { name: "web_fetch", allowed_domains: ["gov.uk"] },
    ]);
  });

  it("sends one domain list or the other, never both", async () => {
    await runtime.publishPack({
      ...PACK_ZERO, web: { allowedDomains: ["gov.uk"], blockedDomains: ["reddit.com"] },
    });
    const web = fake.beta.agents.create.mock.calls[0]![0].tools[0].configs
      .find((c: { name: string }) => c.name === "web_search");
    expect(web.allowed_domains).toEqual(["gov.uk"]);
    expect(web.blocked_domains).toBeUndefined();
  });

  it("leaves the web tools unrestricted by default", async () => {
    await runtime.publishPack(PACK_ZERO);
    expect(fake.beta.agents.create.mock.calls[0]![0].tools[0].configs
      .some((c: { name: string }) => c.name.startsWith("web_"))).toBe(false);
  });
});

describe("listing deliverables", () => {
  it("keeps only what the platform says is downloadable", async () => {
    // Shape captured live: mounted pack files come back in the same listing
    // with fresh ids and downloadable: false.
    fake.beta.files.list.mockResolvedValue({ data: [
      { id: "file_a", filename: "agent.md", size_bytes: 478, downloadable: false },
      { id: "file_b", filename: "capabilities.html", size_bytes: 17676, downloadable: true },
      { id: "file_c", filename: "notes.md", size_bytes: 24, downloadable: false },
    ] });
    expect(await runtime.listOutputs("sesn_1"))
      .toEqual([{ fileId: "file_b", filename: "capabilities.html", sizeBytes: 17676 }]);
  });

  it("keeps a file that does not say, rather than discarding it", async () => {
    fake.beta.files.list.mockResolvedValue({ data: [{ id: "file_x", filename: "out.csv", size_bytes: 10 }] });
    expect(await runtime.listOutputs("sesn_1")).toHaveLength(1);
  });

  it("retries an empty listing, because indexing lags the session going idle", async () => {
    fake.beta.files.list
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [{ id: "file_b", filename: "late.html", downloadable: true }] });
    expect(await runtime.listOutputs("sesn_1")).toHaveLength(1);
    expect(fake.beta.files.list).toHaveBeenCalledTimes(2);
  });
});

describe("assertGithubUrl", () => {
  it("accepts a plain GitHub repository and normalises it", async () => {
    const { assertGithubUrl } = await import("../../src/runtime/managed-agents.js");
    expect(assertGithubUrl("https://github.com/owner/repo")).toBe("https://github.com/owner/repo");
    expect(assertGithubUrl("https://github.com/owner/repo/")).toBe("https://github.com/owner/repo");
    expect(assertGithubUrl("https://www.github.com/owner/repo")).toBe("https://github.com/owner/repo");
  });

  it("refuses to send a credential anywhere but github.com over https", () => {
    // The URL decides where the token goes. A mistyped host that still parses
    // is the whole risk here, and it is not a mistake anybody gets twice.
    return import("../../src/runtime/managed-agents.js").then(({ assertGithubUrl }) => {
      expect(() => assertGithubUrl("http://github.com/owner/repo")).toThrow(/https/);
      expect(() => assertGithubUrl("https://githubb.com/owner/repo")).toThrow(/only github.com/);
      expect(() => assertGithubUrl("https://evil.example/owner/repo")).toThrow(/only github.com/);
      expect(() => assertGithubUrl("https://github.com.evil.example/o/r")).toThrow(/only github.com/);
      expect(() => assertGithubUrl("not a url")).toThrow(/not a URL/);
    });
  });

  it("refuses a URL carrying its own credentials", async () => {
    const { assertGithubUrl } = await import("../../src/runtime/managed-agents.js");
    expect(() => assertGithubUrl("https://user:tok@github.com/owner/repo"))
      .toThrow(/token field/);
  });

  it("refuses anything that is not owner/repo", async () => {
    const { assertGithubUrl } = await import("../../src/runtime/managed-agents.js");
    expect(() => assertGithubUrl("https://github.com/owner")).toThrow(/owner\/repo/);
    expect(() => assertGithubUrl("https://github.com/o/r/tree/main")).toThrow(/owner\/repo/);
  });
});
