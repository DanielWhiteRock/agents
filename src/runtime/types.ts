import type { Money } from "./money.js";
import type { RuntimeUsage } from "./usage.js";
import type { PackDefinition } from "../packs/types.js";

/** One skill directory, ready to upload: SKILL.md at the root of its own folder. */
export type SkillUpload = { name: string; files: Array<{ path: string; content: string }> };

/** A subagent the pack declared in agents/<name>.md. */
export type SubagentUpload = {
  name: string; description?: string; model?: string; system: string;
};

export type PublishedSubagent = { name: string; agentId: string; version: string };

export type SessionStatus = "running" | "idle" | "requires_action" | "terminated";

export type RuntimeSession = {
  id: string;
  status: SessionStatus;
  stopReason: string | null;
  usage: RuntimeUsage;
};

export type PublishedPack = {
  runtimePackId: string;
  version: string;
  /** The platform skills uploaded for this version, in the order declared. */
  skills: PublishedSkill[];
  /** The subagents created for this version, attached as predefined agents. */
  subagents: PublishedSubagent[];
  /** Pack files uploaded once and mounted into every session of this version. */
  mounts: MountedFile[];
};

export type PublishedSkill = { name: string; skillId: string; skillVersion: string };

/**
 * A pack file uploaded once at publish and mounted into every session.
 *
 * This is how commands/, hooks/, workflows/ and docs/ reach the machine. The
 * platform has no field for them, so we put them where the agent can read
 * them and tell it they are there.
 */
export type MountedFile = { path: string; fileId: string; mountPath: string };

/** A file the agent produced, waiting in the session for whoever asked for it. */
export type OutputFile = { fileId: string; filename: string; sizeBytes: number };

export type CreateSessionOptions = {
  /** A session only needs to know which agent version to pin to. */
  pack: Pick<PublishedPack, "runtimePackId" | "version">;
  /** Pack files to mount, so the whole folder is on the machine. */
  mounts?: MountedFile[];
  environmentId: string;
  /** Required. A budget cannot be added to a session later — only changed or removed. */
  budget: Money;
  title?: string;
  /** Per-session model override. Replaces the model object wholesale, so effort is restated. */
  model?: string;
  effort?: PackDefinition["effort"];
};

/** allow = ran; ask = paused for a human; deny = the server refused it. */
export type ToolDecision = "allow" | "ask" | "deny";

export type RuntimeEvent =
  | { type: "agent.text"; text: string }
  | { type: "agent.thinking" }
  /** The platform's own cumulative figures. Authoritative — prefer this over summing. */
  | { type: "usage.snapshot"; usage: RuntimeUsage; budget: Money | null }
  | { type: "model.request_start" }
  | { type: "thread.status"; status: SessionStatus; agentName: string | null; stopReason: string | null }
  /** The stream echoes back what we sent; useful in the transcript, not new information. */
  | { type: "echo"; of: string; text: string | null }
  /** A background workflow run the agent started, and its phases. */
  | { type: "workflow.run"; runId: string; state: "created" | "running" | "ended";
      name?: string; description?: string; phases?: number; result?: string }
  | { type: "workflow.phase"; runId: string; phaseId: string; state: "started" | "ended" }
  | { type: "thread.created"; threadId: string; agentName: string | null; runId: string | null }
  | { type: "tool.use"; eventId: string; name: string; input: unknown; permission: ToolDecision; source: "builtin" | "mcp" | "custom" }
  | { type: "tool.result"; name: string; isError: boolean; preview: string }
  | { type: "model.usage"; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number }
  | { type: "status"; status: SessionStatus; stopReason: string | null }
  | { type: "error"; message: string }
  | { type: "raw"; payload: unknown };

/** A tool call paused for a human decision. `eventId` is the sevt_ id to answer. */
export type PendingAsk = { eventId: string; name: string; input: unknown };

export interface AgentRuntime {
  ensureEnvironment(name: string): Promise<string>;
  /** Upload a skill on its own, so a shared one can be made once and reused. */
  uploadSkill(skill: SkillUpload): Promise<PublishedSkill>;
  /** Exact token count for a system prompt, so the trace can say where context went. */
  countSystemTokens(model: string, system: string): Promise<number>;
  /**
   * Publish a pack. `skills` are real platform skills, uploaded and attached,
   * so the model reads only the one a task calls for instead of carrying the
   * whole method in its system prompt.
   */
  publishPack(
    pack: PackDefinition, skills?: SkillUpload[], subagents?: SubagentUpload[],
    mount?: Array<{ path: string; content: string }>,
  ): Promise<PublishedPack>;
  createSession(opts: CreateSessionOptions): Promise<RuntimeSession>;
  /**
   * `systemContext` is appended as privileged context for this turn and every
   * turn after it — how a SessionStart hook reaches the agent.
   */
  sendMessage(sessionId: string, text: string, systemContext?: string): Promise<void>;
  streamEvents(sessionId: string): Promise<AsyncIterable<RuntimeEvent>>;
  readSession(sessionId: string): Promise<RuntimeSession>;
  raiseBudgetTo(sessionId: string, headroomCents: bigint): Promise<RuntimeSession>;
  confirmTool(sessionId: string, eventId: string, result: "allow" | "deny", denyMessage?: string): Promise<void>;
  /** Deliverables the agent wrote. A pack whose output is a file needs these. */
  listOutputs(sessionId: string): Promise<OutputFile[]>;
  downloadOutput(fileId: string): Promise<{ bytes: Buffer; filename: string }>;
  deleteSession(sessionId: string): Promise<void>;
}

export class BudgetRequiredError extends Error {
  constructor() { super("every session must be created with a budget; one cannot be added later"); this.name = "BudgetRequiredError"; }
}
export class BudgetRemovalForbiddenError extends Error {
  constructor() { super("removing a budget is one-way and permanent; raise it instead"); this.name = "BudgetRemovalForbiddenError"; }
}
export class BudgetExhaustedError extends Error {
  constructor(public readonly sessionId: string) {
    super(`session ${sessionId} has reached its budget; raise it to continue`);
    this.name = "BudgetExhaustedError";
  }
}
