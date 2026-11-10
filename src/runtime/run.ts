import type { AgentRuntime, PendingAsk, RuntimeEvent, RuntimeSession } from "./types.js";

export type TurnResult = { events: RuntimeEvent[]; session: RuntimeSession; pendingAsks: PendingAsk[] };

/**
 * Answers a paused tool call without a human.
 *
 * Returning a decision resolves the pause immediately; returning null leaves it
 * for a person. This is how a pack's hooks are enforced rather than merely
 * suggested: the pause exists so somebody can judge the call, and nothing says
 * that somebody has to be human.
 */
export type AskInterceptor = (ask: PendingAsk) => Promise<{ result: "allow" | "deny"; reason?: string } | null>;

export type DrainOptions = {
  onEvent?: (e: RuntimeEvent) => void;
  intercept?: AskInterceptor;
  /** Called when an interceptor decides, so the transcript can say who and why. */
  onIntercepted?: (ask: PendingAsk, decision: { result: "allow" | "deny"; reason?: string }) => void;
};

/**
 * Do NOT break on idle alone: a session goes idle transiently between parallel
 * tool calls and whenever it is waiting on a human. Break on termination, on an
 * idle that is genuinely finished or budget-capped, or on an idle where a
 * decision is pending that only a person can make.
 */
async function drain(runtime: AgentRuntime, sessionId: string, opts: DrainOptions): Promise<TurnResult> {
  const stream = await runtime.streamEvents(sessionId);
  const events: RuntimeEvent[] = [];
  const pendingAsks: PendingAsk[] = [];

  for await (const ev of stream) {
    events.push(ev);
    opts.onEvent?.(ev);

    if (ev.type === "tool.use" && ev.permission === "ask") {
      const ask: PendingAsk = { eventId: ev.eventId, name: ev.name, input: ev.input };
      const decision = opts.intercept ? await opts.intercept(ask) : null;
      if (decision) {
        opts.onIntercepted?.(ask, decision);
        await runtime.confirmTool(sessionId, ask.eventId, decision.result, decision.reason);
      } else {
        pendingAsks.push(ask);
      }
    }
    if (ev.type === "status") {
      if (ev.status === "terminated") break;
      if (ev.status === "idle" && ev.stopReason !== "requires_action") break;
      if (ev.status === "idle" && pendingAsks.length > 0) break;
    }
  }
  const session = await runtime.readSession(sessionId);
  return { events, session, pendingAsks };
}

/**
 * One turn, stream-first. The stream only delivers events that occur after it
 * opens, so it is opened before the send — otherwise the early events are lost
 * and the transcript cannot bill or settle a dispute.
 */
export async function runTurn(
  runtime: AgentRuntime,
  sessionId: string,
  text: string,
  opts: DrainOptions & { systemContext?: string } = {},
): Promise<TurnResult> {
  const streamFirst = drain(runtime, sessionId, opts);
  await runtime.sendMessage(sessionId, text, opts.systemContext);
  return streamFirst;
}

/** Continue after answering a paused tool call, with no new user message. */
export async function resumeAfterDecision(
  runtime: AgentRuntime,
  sessionId: string,
  confirm: () => Promise<void>,
  opts: DrainOptions = {},
): Promise<TurnResult> {
  const draining = drain(runtime, sessionId, opts);
  await confirm();
  return draining;
}
