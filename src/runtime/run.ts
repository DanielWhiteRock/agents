import type { AgentRuntime, PendingAsk, RuntimeEvent, RuntimeSession } from "./types.js";

export type TurnResult = { events: RuntimeEvent[]; session: RuntimeSession; pendingAsks: PendingAsk[] };

/**
 * Do NOT break on idle alone: a session goes idle transiently between parallel
 * tool calls and whenever it is waiting on a human. Break on termination, on an
 * idle that is genuinely finished or budget-capped, or on an idle where a
 * decision is pending that we can surface to the buyer.
 */
async function drain(
  runtime: AgentRuntime,
  sessionId: string,
  onEvent?: (e: RuntimeEvent) => void,
): Promise<TurnResult> {
  const stream = await runtime.streamEvents(sessionId);
  const events: RuntimeEvent[] = [];
  const pendingAsks: PendingAsk[] = [];

  for await (const ev of stream) {
    events.push(ev);
    onEvent?.(ev);
    if (ev.type === "tool.use" && ev.permission === "ask") {
      pendingAsks.push({ eventId: ev.eventId, name: ev.name, input: ev.input });
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
  onEvent?: (e: RuntimeEvent) => void,
): Promise<TurnResult> {
  const streamFirst = drain(runtime, sessionId, onEvent);
  await runtime.sendMessage(sessionId, text);
  return streamFirst;
}

/**
 * Continue after answering a paused tool call.
 *
 * Stream-first applies here too, and it is easier to get wrong: the stream must
 * be open before the confirmation is sent, or the agent's continuation lands
 * before anyone is listening and the turn looks like it ended at the pause.
 */
export async function resumeAfterDecision(
  runtime: AgentRuntime,
  sessionId: string,
  confirm: () => Promise<void>,
  onEvent?: (e: RuntimeEvent) => void,
): Promise<TurnResult> {
  const draining = drain(runtime, sessionId, onEvent);
  await confirm();
  return draining;
}
