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
  type MountedFile, type OutputFile, type PublishedSkill, type PublishedSubagent, type SubagentUpload,
  BudgetExhaustedError, BudgetRemovalForbiddenError, BudgetRequiredError,
} from "./types.js";
import type { PackDefinition } from "../packs/types.js";
import { composeSystemPrompt } from "../packs/wrapper.js";

/** Structural subset of the SDK we use, so tests can inject a fake. */
export type ManagedAgentsClient = {
  /** Skills are out of beta: client.skills, not client.beta.skills. */
  skills: { create(body: any): Promise<{ id: string; latest_version_id?: string }> };
  beta: {
    files: {
      upload(body: any): Promise<{ id: string }>;
      list(body: any): Promise<{ data: Array<{
        id: string; filename: string; size_bytes?: number; downloadable?: boolean; mime_type?: string;
      }> }>;
      download(id: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>;
    };
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

/** The tools a domain restriction applies to. */
const WEB_TOOLS = ["web_search", "web_fetch"] as const;

/** Anthropic's prebuilt skills, referenced by short name rather than an id. */
export const ANTHROPIC_SKILLS = ["pptx", "xlsx", "docx", "pdf"] as const;

/** The platform caps a subagents.predefined_agents list at 20. */
export const MAX_SUBAGENTS = 20;

/**
 * Where a pack's non-skill files actually end up.
 *
 * A requested mount_path is advisory: the platform places uploads under
 * /mnt/session/uploads/<requested>. So we ask for a bare `pack/...` and the
 * real root is the constant below — which is what the agent is told. Telling it
 * the path we asked for instead of the path that exists sends it looking for
 * files that are not there, and it will say so.
 */
export const UPLOAD_ROOT = "/mnt/session/uploads";
export const PACK_MOUNT = `${UPLOAD_ROOT}/pack`;
/** What we ask for, relative, so the rewrite lands on PACK_MOUNT. */
const requestedMount = (path: string): string => `pack/${path}`;

/**
 * Delegation and background workflow runs.
 *
 * Both are platform features and both default to on — but only when a
 * multiagent block exists at all, so omitting it silently gave up dynamic
 * workflows. Every pack gets one now.
 *
 * The two settings are deliberately different:
 *
 * `subagents` is restricted to the specialists the author declared in agents/,
 * with inline agents off, because a pack's specialists are part of its design
 * and letting the model invent others escapes what the buyer bought. A pack
 * that declares none cannot delegate at all.
 *
 * `workflows` allows inline agents, because a dynamic workflow is a program the
 * model writes and its agents are that program's own business. Restricting a
 * run to a list the author never wrote would make workflows useless rather than
 * safe. A run's agents are transient and the server archives them at the end.
 * `{type: "self"}` is listed so a workflow can fan the pack itself out across
 * many pieces of work.
 *
 * Every agent in a run spends tokens, which is why every session is created
 * with a hard budget.
 */
function multiagentBlock(subagents: PublishedSubagent[], advisorModel?: string): Record<string, unknown> {
  const predefined = subagents.map((s) => ({ type: "agent", id: s.agentId, version: Number(s.version) }));
  return {
    type: "multiagent_20261001",
    subagents: subagents.length > 0
      ? { type: "enabled", inline_agents: { type: "disabled" }, predefined_agents: predefined }
      : { type: "disabled" },
    workflows: { type: "enabled", predefined_agents: [...predefined, { type: "self" }] },
    // Disabled unless the pack asks: an advisor is a second model consulted
    // mid-turn, and the buyer pays for both.
    ...(advisorModel ? { advisor: { type: "enabled", model: advisorModel } } : {}),
  };
}

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

  /**
   * Upload the pack's other files once, so every session can mount them
   * without re-uploading. The requested mount path is advisory — the platform
   * rewrites it — so the real location is read back from the session later and
   * told to the agent in its prompt.
   */
  private async uploadMounts(files: Array<{ path: string; content: string }>): Promise<MountedFile[]> {
    const { toFile } = await import("@anthropic-ai/sdk");
    const out: MountedFile[] = [];
    for (const f of files) {
      const uploaded = await this.client.beta.files.upload({
        file: await toFile(Buffer.from(f.content, "utf8"), f.path.split("/").pop() ?? "file"),
        purpose: "agent",
      });
      out.push({ path: f.path, fileId: uploaded.id, mountPath: requestedMount(f.path) });
    }
    return out;
  }

  async publishPack(
    pack: PackDefinition, skills: SkillUpload[] = [], subagents: SubagentUpload[] = [],
    mount: Array<{ path: string; content: string }> = [],
  ): Promise<PublishedPack> {
    if (subagents.length > MAX_SUBAGENTS) {
      throw new Error(`a pack may declare at most ${MAX_SUBAGENTS} subagents; this one has ${subagents.length}`);
    }
    // The platform's own default is always_allow, so whatever posture we want
    // has to be stated explicitly on every publish.
    const policy = pack.destructivePolicy ?? "always_ask";
    // Web restrictions ride on the web tools' own config entries. The API
    // rejects allowed_domains and blocked_domains together, so one wins.
    const webConfig = pack.web?.allowedDomains?.length
      ? { allowed_domains: pack.web.allowedDomains }
      : pack.web?.blockedDomains?.length
        ? { blocked_domains: pack.web.blockedDomains }
        : null;

    const tools: any[] = [{
      type: "agent_toolset_20260401",
      default_config: { enabled: true },
      configs: [
        ...DESTRUCTIVE.map((name) => ({ name, permission_policy: { type: policy } })),
        ...(webConfig ? WEB_TOOLS.map((name) => ({ name, ...webConfig })) : []),
      ],
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

    const mounts = mount.length > 0 ? await this.uploadMounts(mount) : [];

    const publishedSubagents: PublishedSubagent[] = [];
    for (const sub of subagents) {
      publishedSubagents.push(await this.createSubagent(sub, pack.model, policy));
    }

    const agent = await this.client.beta.agents.create({
      name: pack.name,
      model: { id: pack.model, ...(pack.effort ? { effort: pack.effort } : {}) },
      system: composeSystemPrompt(pack, pack.folder),
      description: pack.tagline,
      tools,
      ...(pack.mcpServers?.length
        ? { mcp_servers: pack.mcpServers.map((m) => ({ type: "url", name: m.name, url: m.url })) }
        : {}),
      ...(() => {
        const attached = [
          // Anthropic's own first, so a document skill is found before a
          // pack's narrower one when both could apply.
          ...(pack.anthropicSkills ?? []).map((id) => ({ type: "anthropic", skill_id: id })),
          ...published.map((s) => ({ type: "custom", skill_id: s.skillId, version: "latest" })),
        ];
        return attached.length > 0 ? { skills: attached } : {};
      })(),
      multiagent: multiagentBlock(publishedSubagents, pack.advisorModel),
      metadata: { pack_slug: pack.slug },
    });
    return {
      runtimePackId: agent.id, version: String(agent.version),
      skills: published, subagents: publishedSubagents, mounts,
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
      ...(opts.mounts?.length
        ? { resources: opts.mounts.map((m) => ({ type: "file", file_id: m.fileId, mount_path: m.mountPath })) }
        : {}),
      budget: { type: "limit", max_list_cost: budget },
    });
    return toSession(raw);
  }

  async sendMessage(sessionId: string, text: string, systemContext?: string): Promise<void> {
    try {
      await this.client.beta.sessions.events.send(sessionId, {
        events: [
          { type: "user.message", content: [{ type: "text", text }] },
          // A system.message appends privileged context for this turn and every
          // turn after it, and the API requires it to be LAST in the request:
          // putting it first returns "`system.message` must be the last event".
          ...(systemContext
            ? [{ type: "system.message", content: [{ type: "text", text: systemContext }] }]
            : []),
        ],
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
          case "workflow_run.created":
            yield {
              type: "workflow.run", state: "created",
              runId: String(ev.workflow_run_id ?? ev.id ?? ""),
              ...(ev.name ? { name: String(ev.name) } : {}),
              ...(ev.description ? { description: String(ev.description) } : {}),
              ...(Array.isArray(ev.phases) ? { phases: ev.phases.length } : {}),
            };
            break;
          case "workflow_run.status_running":
          case "workflow_run.status_ended":
            yield {
              type: "workflow.run",
              state: ev.type === "workflow_run.status_ended" ? "ended" : "running",
              runId: String(ev.workflow_run_id ?? ""),
              ...(ev.result?.type ? { result: String(ev.result.type) } : {}),
            };
            break;
          case "workflow_run.phase_started":
          case "workflow_run.phase_ended":
            yield {
              type: "workflow.phase",
              runId: String(ev.workflow_run_id ?? ""),
              phaseId: String(ev.workflow_run_phase_id ?? ""),
              state: ev.type === "workflow_run.phase_ended" ? "ended" : "started",
            };
            break;
          case "session.thread_created":
            yield {
              type: "thread.created",
              threadId: String(ev.session_thread_id ?? ""),
              agentName: ev.agent_name ?? null,
              runId: ev.workflow_run_id ?? null,
            };
            break;
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

  /**
   * What the agent produced.
   *
   * The listing covers the whole session scope, so the pack files we mounted
   * come back too — with fresh ids, so they cannot be filtered by the id we
   * uploaded. The platform marks them `downloadable: false` while a genuine
   * deliverable is `true`, which is the distinction to use.
   *
   * Files written to /mnt/session/outputs are indexed a beat after the session
   * goes idle, so a single empty listing is not evidence of no output — it is
   * retried before being believed.
   */
  async listOutputs(sessionId: string): Promise<OutputFile[]> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const res = await this.client.beta.files.list({
        scope_id: sessionId, betas: ["managed-agents-2026-04-01"],
      });
      const files = (res.data ?? [])
        .filter((f) => f.downloadable !== false)
        .map((f) => ({ fileId: f.id, filename: f.filename, sizeBytes: Number(f.size_bytes ?? 0) }));
      if (files.length > 0 || attempt === 2) return files;
      await new Promise((r) => setTimeout(r, 1500));
    }
    return [];
  }

  async downloadOutput(fileId: string): Promise<{ bytes: Buffer; filename: string }> {
    const res = await this.client.beta.files.download(fileId);
    return { bytes: Buffer.from(await res.arrayBuffer()), filename: fileId };
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.client.beta.sessions.delete(sessionId);
  }
}
