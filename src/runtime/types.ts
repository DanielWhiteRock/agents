import type { Money } from "./money.js";
import type { RuntimeUsage } from "./usage.js";
import type { PackDefinition } from "../packs/types.js";

export type SessionStatus = "running" | "idle" | "requires_action" | "terminated";

export type RuntimeSession = {
  id: string;
  status: SessionStatus;
  stopReason: string | null;
  usage: RuntimeUsage;
};

export type PublishedPack = { runtimePackId: string; version: string };

export type CreateSessionOptions = {
  pack: PublishedPack;
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
  publishPack(pack: PackDefinition): Promise<PublishedPack>;
  createSession(opts: CreateSessionOptions): Promise<RuntimeSession>;
  sendMessage(sessionId: string, text: string): Promise<void>;
  streamEvents(sessionId: string): Promise<AsyncIterable<RuntimeEvent>>;
  readSession(sessionId: string): Promise<RuntimeSession>;
  raiseBudgetTo(sessionId: string, headroomCents: bigint): Promise<RuntimeSession>;
  confirmTool(sessionId: string, eventId: string, result: "allow" | "deny", denyMessage?: string): Promise<void>;
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
