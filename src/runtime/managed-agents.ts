/**
 * The only module in the codebase that knows Anthropic Managed Agents exists.
 * Everything else depends on ./types.js, so the self-hosted/OpenRouter path is a
 * second implementation rather than a rewrite.
 */
import { type Money, addCents, parseMoney } from "./money.js";
import { parseUsage } from "./usage.js";
import {
  type AgentRuntime, type CreateSessionOptions, type PublishedPack,
  type RuntimeEvent, type RuntimeSession, type SessionStatus, type SkillUpload, type ToolDecision,
  type PublishedSkill, type PublishedSubagent, type SubagentUpload,
  BudgetExhaustedError, BudgetRemovalForbiddenError, BudgetRequiredError,
} from "./types.js";
import type { PackDefinition } from "../packs/types.js";
import { composeSystemPrompt } from "../packs/wrapper.js";

/** Structural subset of the SDK we use, so tests can inject a fake. */
export type ManagedAgentsClient = {
  /** Skills are out of beta: client.skills, not client.beta.skills. */
  skills: { create(body: any): Promise<{ id: string; latest_version_id?: string }> };
  beta: {
    environments: { create(body: any): Promise<{ id: string }> };
    agents: { create(body: any): Promise<{ id: string; version: number }> };
    sessions: {
      create(body: any): Promise<any>;
      retrieve(id: string): Promise<any>;
      update(id: string, body: any): Promise<any>;
      delete(id: string): Promise<unknown>;
      events: {
        send(id: string, body: any): Promise<unknown>;
        stream(id: string): Promise<AsyncIterable<any>>;
      };
    };
  };
};

/** Built-ins that change the world, so they ask before running. */
const DESTRUCTIVE = ["bash", "write", "edit"] as const;

/** The platform caps a subagents.predefined_agents list at 20. */
export const MAX_SUBAGENTS = 20;

const STATUSES: Record<string, SessionStatus> = {
  running: "running", idle: "idle", requires_action: "requires_action", terminated: "terminated",
};

function toStatus(raw: unknown): SessionStatus {
  return STATUSES[String(raw)] ?? "idle";
}

/** stop_reason arrives as an object ({ type: "requires_action", ... }) or a string. */
export function toStopReason(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string") return raw;
  const t = (raw as { type?: unknown }).type;
  return typeof t === "string" ? t : null;
}

function toSession(raw: any): RuntimeSession {
  return {
    id: String(raw?.id ?? ""),
    status: toStatus(raw?.status),
    stopReason: toStopReason(raw?.stop_reason),
    usage: parseUsage(raw?.usage),
  };
}

const DECISIONS: Record<string, ToolDecision> = { allow: "allow", ask: "ask", deny: "deny" };
const decision = (raw: unknown): ToolDecision => DECISIONS[String(raw)] ?? "allow";
const textOf = (content: unknown): string | null => {
  if (!Array.isArray(content)) return null;
  const parts = content.filter((b) => b?.type === "text").map((b) => String(b.text));
  return parts.length ? parts.join("") : null;
};
const preview = (v: unknown): string => {
  const s = typeof v === "string" ? v : JSON.stringify(v ?? null);
  return s.length > 600 ? `${s.slice(0, 600)}…` : s;
};

function isBudgetReached(err: unknown): boolean {
  const e = err as { status?: number; message?: unknown };
  return e?.status === 400 && String(e?.message ?? "").includes("session budget reached");
}

export class ManagedAgentsRuntime implements AgentRuntime {
  constructor(private readonly client: ManagedAgentsClient) {}

  async ensureEnvironment(name: string): Promise<string> {
    const env = await this.client.beta.environments.create({
      name, config: { type: "cloud", networking: { type: "unrestricted" } },
    });
    return env.id;
  }

  /**
   * Upload one skill directory to the workspace.
   *
   * Every file must sit under a single top-level directory with SKILL.md at its
   * root, so each file is named `<skill>/<relative path>`.
   */
  private async uploadSkill(skill: SkillUpload): Promise<PublishedSkill> {
    const { toFile } = await import("@anthropic-ai/sdk");
    const files = await Promise.all(skill.files.map((f) =>
      toFile(Buffer.from(f.content, "utf8"), `${skill.name}/${f.path}`)));
    const created = await this.client.skills.create({ files });
    return { name: skill.name, skillId: created.id, skillVersion: created.latest_version_id ?? "latest" };
  }

  /**
   * A subagent is its own agent object, referenced by id.
   *
   * It inherits the pack's model unless its own definition names one, and it
   * gets the same always_ask posture on destructive tools — a specialist is not
   * a reason to drop the guardrail.
   */
  private async createSubagent(
    sub: SubagentUpload, fallbackModel: string, policy: "always_ask" | "always_allow" | "auto",
  ): Promise<PublishedSubagent> {
    const agent = await this.client.beta.agents.create({
      name: sub.name,
      model: { id: sub.model ?? fallbackModel },
      system: sub.system,
      ...(sub.description ? { description: sub.description } : {}),
      tools: [{
        type: "agent_toolset_20260401",
        default_config: { enabled: true },
        // A specialist is not a reason to drop the guardrail, so a subagent
        // inherits whatever posture the pack is published with.
        configs: DESTRUCTIVE.map((name) => ({ name, permission_policy: { type: policy } })),
      }],
    });
    return { name: sub.name, agentId: agent.id, version: String(agent.version) };
  }

  async publishPack(
    pack: PackDefinition, skills: SkillUpload[] = [], subagents: SubagentUpload[] = [],
  ): Promise<PublishedPack> {
    if (subagents.length > MAX_SUBAGENTS) {
      throw new Error(`a pack may declare at most ${MAX_SUBAGENTS} subagents; this one has ${subagents.length}`);
    }
    // The platform's own default is always_allow, so whatever posture we want
    // has to be stated explicitly on every publish.
    const policy = pack.destructivePolicy ?? "always_ask";
    const tools: any[] = [{
      type: "agent_toolset_20260401",
      default_config: { enabled: true },
      configs: DESTRUCTIVE.map((name) => ({ name, permission_policy: { type: policy } })),
    }];
    for (const t of pack.tools ?? []) {
      tools.push({
        type: "custom", name: t.name, description: t.description, input_schema: t.inputSchema,
        ...(t.spending ? { permission_policy: { type: policy } } : {}),
      });
    }
    for (const m of pack.mcpServers ?? []) tools.push({ type: "mcp_toolset", mcp_server_name: m.name });

    // Skills are uploaded before the agent, because the agent references them
    // by id. A failure here stops the publish rather than creating an agent
    // whose skills are half there.
    const published: PublishedSkill[] = [];
    for (const skill of skills) published.push(await this.uploadSkill(skill));

    const publishedSubagents: PublishedSubagent[] = [];
    for (const sub of subagents) {
      publishedSubagents.push(await this.createSubagent(sub, pack.model, policy));
    }

    const agent = await this.client.beta.agents.create({
      name: pack.name,
      model: { id: pack.model, ...(pack.effort ? { effort: pack.effort } : {}) },
      system: composeSystemPrompt(pack),
      description: pack.tagline,
      tools,
      ...(pack.mcpServers?.length
        ? { mcp_servers: pack.mcpServers.map((m) => ({ type: "url", name: m.name, url: m.url })) }
        : {}),
      ...(published.length
        ? { skills: published.map((s) => ({ type: "custom", skill_id: s.skillId, version: "latest" })) }
        : {}),
      ...(publishedSubagents.length
        ? {
            multiagent: {
              type: "multiagent_20261001",
              subagents: {
                type: "enabled",
                // The author declared this pack's specialists. Letting the model
                // invent its own at runtime would escape both the author's
                // design and what the buyer paid for.
                inline_agents: { type: "disabled" },
                predefined_agents: publishedSubagents.map((s) => ({
                  type: "agent", id: s.agentId, version: Number(s.version),
                })),
              },
            },
          }
        : {}),
      metadata: { pack_slug: pack.slug },
    });
    return {
      runtimePackId: agent.id, version: String(agent.version),
      skills: published, subagents: publishedSubagents,
    };
  }

  async createSession(opts: CreateSessionOptions): Promise<RuntimeSession> {
    if (!opts.budget) throw new BudgetRequiredError();
    const budget = parseMoney(opts.budget);
    // Overrides nest inside `agent` as `agent_with_overrides` — a top-level
    // `model` is rejected as an unknown field. An override replaces the agent's
    // model object in full, so effort is restated or it resets to the default.
    const agent = opts.model
      ? {
          type: "agent_with_overrides",
          id: opts.pack.runtimePackId,
          version: Number(opts.pack.version),
          // Only send effort when the caller supplied one: some models reject
          // the field entirely (Haiku 4.5 returns 400 for any effort level).
          model: { id: opts.model, ...(opts.effort ? { effort: opts.effort } : {}) },
        }
      : { type: "agent", id: opts.pack.runtimePackId, version: Number(opts.pack.version) };

    const raw = await this.client.beta.sessions.create({
      agent,
      environment_id: opts.environmentId,
      ...(opts.title ? { title: opts.title } : {}),
      budget: { type: "limit", max_list_cost: budget },
    });
    return toSession(raw);
  }

  async sendMessage(sessionId: string, text: string): Promise<void> {
    try {
      await this.client.beta.sessions.events.send(sessionId, {
        events: [{ type: "user.message", content: [{ type: "text", text }] }],
      });
    } catch (err) {
      if (isBudgetReached(err)) throw new BudgetExhaustedError(sessionId);
      throw err;
    }
  }

  async streamEvents(sessionId: string): Promise<AsyncIterable<RuntimeEvent>> {
    const stream = await this.client.beta.sessions.events.stream(sessionId);
    return (async function* () {
      for await (const ev of stream) {
        switch (ev?.type) {
          case "agent.message":
            for (const b of ev.content ?? []) {
              if (b?.type === "text") yield { type: "agent.text", text: String(b.text) } as RuntimeEvent;
            }
            break;
          case "agent.thinking":
            // A progress signal only; it never carries the reasoning itself.
            yield { type: "agent.thinking" };
            break;
          case "agent.tool_use":
          case "agent.mcp_tool_use":
          case "agent.custom_tool_use":
            yield {
              type: "tool.use",
              // The id to answer a pause with is this EVENT id (sevt_), not a toolu_ id.
              eventId: String(ev.id ?? ""),
              name: String(ev.name ?? ev.tool_name ?? "tool"),
              input: ev.input,
              permission: decision(ev.evaluated_permission),
              source: ev.type === "agent.mcp_tool_use" ? "mcp" : ev.type === "agent.custom_tool_use" ? "custom" : "builtin",
            };
            break;
          case "agent.tool_result":
          case "agent.mcp_tool_result":
            yield {
              type: "tool.result", name: String(ev.name ?? "tool"),
              isError: Boolean(ev.is_error), preview: preview(ev.content ?? ev.output ?? ev.result),
            };
            break;
          case "span.model_request_end": {
            const u = ev.model_usage ?? {};
            yield {
              type: "model.usage",
              inputTokens: Number(u.input_tokens ?? 0),
              outputTokens: Number(u.output_tokens ?? 0),
              cacheReadTokens: Number(u.cache_read_input_tokens ?? 0),
              cacheCreationTokens: Number(u.cache_creation_input_tokens ?? u.cache_creation?.ephemeral_5m_input_tokens ?? 0),
            };
            break;
          }
          case "session.usage":
            yield {
              type: "usage.snapshot",
              usage: parseUsage(ev.usage),
              budget: ev.budget?.max_list_cost ? parseMoney(ev.budget.max_list_cost) : null,
            };
            break;
          case "span.model_request_start":
            yield { type: "model.request_start" };
            break;
          case "session.thread_status_running":
          case "session.thread_status_idle":
          case "session.thread_status_terminated":
          case "session.thread_status_rescheduled":
            yield {
              type: "thread.status",
              status: toStatus(String(ev.type).replace("session.thread_status_", "")),
              agentName: ev.agent_name ?? null,
              stopReason: toStopReason(ev.stop_reason),
            };
            break;
          case "user.message":
            yield { type: "echo", of: "user.message", text: textOf(ev.content) };
            break;
          case "user.tool_confirmation":
            yield { type: "echo", of: `tool_confirmation:${ev.result}`, text: ev.deny_message ?? null };
            break;
          case "session.status_running":
            yield { type: "status", status: "running", stopReason: null };
            break;
          case "session.status_idle":
            yield { type: "status", status: "idle", stopReason: toStopReason(ev.stop_reason) };
            break;
          case "session.status_terminated":
            yield { type: "status", status: "terminated", stopReason: toStopReason(ev.stop_reason) };
            break;
          case "session.error":
            yield { type: "error", message: String(ev.message ?? ev.error ?? "session error") };
            break;
          default:
            // Never dropped: the transcript is billing and dispute evidence.
            yield { type: "raw", payload: ev };
        }
      }
    })();
  }

  async readSession(sessionId: string): Promise<RuntimeSession> {
    return toSession(await this.client.beta.sessions.retrieve(sessionId));
  }

  async raiseBudgetTo(sessionId: string, headroomCents: bigint): Promise<RuntimeSession> {
    if (headroomCents <= 0n) throw new BudgetRemovalForbiddenError();
    // Consumption usually sits at or just past the old cap, so the new cap is
    // computed from consumed list_cost, never from the previous cap.
    const current = await this.readSession(sessionId);
    const next: Money = addCents(current.usage.listCost, headroomCents);
    const raw = await this.client.beta.sessions.update(sessionId, {
      budget: { type: "limit", max_list_cost: next },
    });
    return toSession(raw);
  }

  /** Answer a tool call that paused. `eventId` is the sevt_ id of the tool.use event. */
  async confirmTool(sessionId: string, eventId: string, result: "allow" | "deny", denyMessage?: string): Promise<void> {
    await this.client.beta.sessions.events.send(sessionId, {
      events: [{
        type: "user.tool_confirmation", tool_use_id: eventId, result,
        ...(result === "deny" && denyMessage ? { deny_message: denyMessage } : {}),
      }],
    });
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.client.beta.sessions.delete(sessionId);
  }
}
