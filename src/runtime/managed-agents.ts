/**
 * The only module in the codebase that knows Anthropic Managed Agents exists.
 * Everything else depends on ./types.js, so the self-hosted/OpenRouter path is a
 * second implementation rather than a rewrite.
 */
import { type Money, addCents, parseMoney } from "./money.js";
import { parseUsage } from "./usage.js";
import {
  type AgentRuntime, type CreateSessionOptions, type PublishedPack,
  type RuntimeEvent, type RuntimeSession, type SessionStatus,
  BudgetExhaustedError, BudgetRemovalForbiddenError, BudgetRequiredError,
} from "./types.js";
import type { PackDefinition } from "../packs/types.js";
import { composeSystemPrompt } from "../packs/wrapper.js";

/** Structural subset of the SDK we use, so tests can inject a fake. */
export type ManagedAgentsClient = {
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

const STATUSES: Record<string, SessionStatus> = {
  running: "running", idle: "idle", requires_action: "requires_action", terminated: "terminated",
};

function toStatus(raw: unknown): SessionStatus {
  return STATUSES[String(raw)] ?? "idle";
}

function toSession(raw: any): RuntimeSession {
  return {
    id: String(raw?.id ?? ""),
    status: toStatus(raw?.status),
    stopReason: raw?.stop_reason ?? null,
    usage: parseUsage(raw?.usage),
  };
}

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

  async publishPack(pack: PackDefinition): Promise<PublishedPack> {
    const tools: any[] = [{
      type: "agent_toolset_20260401",
      default_config: { enabled: true },
      // Spending/destructive built-ins never run unattended. The platform
      // default is always_allow, so this must be stated explicitly.
      configs: [
        { name: "bash", permission_policy: { type: "always_ask" } },
        { name: "write", permission_policy: { type: "always_ask" } },
        { name: "edit", permission_policy: { type: "always_ask" } },
      ],
    }];
    for (const t of pack.tools ?? []) {
      tools.push({
        type: "custom", name: t.name, description: t.description, input_schema: t.inputSchema,
        ...(t.spending ? { permission_policy: { type: "always_ask" } } : {}),
      });
    }
    for (const m of pack.mcpServers ?? []) tools.push({ type: "mcp_toolset", mcp_server_name: m.name });

    const agent = await this.client.beta.agents.create({
      name: pack.name,
      model: { id: pack.model, effort: pack.effort },
      system: composeSystemPrompt(pack),
      description: pack.tagline,
      tools,
      ...(pack.mcpServers?.length
        ? { mcp_servers: pack.mcpServers.map((m) => ({ type: "url", name: m.name, url: m.url })) }
        : {}),
      metadata: { pack_slug: pack.slug },
    });
    return { runtimePackId: agent.id, version: String(agent.version) };
  }

  async createSession(opts: CreateSessionOptions): Promise<RuntimeSession> {
    if (!opts.budget) throw new BudgetRequiredError();
    const budget = parseMoney(opts.budget);
    const raw = await this.client.beta.sessions.create({
      agent: { type: "agent", id: opts.pack.runtimePackId, version: Number(opts.pack.version) },
      environment_id: opts.environmentId,
      ...(opts.title ? { title: opts.title } : {}),
      // A model override replaces the object wholesale, so effort is restated.
      ...(opts.model ? { model: { id: opts.model, effort: opts.effort ?? "high" } } : {}),
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
          case "agent.custom_tool_use":
            yield { type: "tool.use", name: String(ev.name), input: ev.input, spending: false };
            break;
          case "session.status_idle":
            yield { type: "status", status: "idle", stopReason: ev.stop_reason ?? null };
            break;
          case "session.status_terminated":
            yield { type: "status", status: "terminated", stopReason: ev.stop_reason ?? null };
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

  async deleteSession(sessionId: string): Promise<void> {
    await this.client.beta.sessions.delete(sessionId);
  }
}
