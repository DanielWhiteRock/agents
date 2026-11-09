import type { AgentRuntime, RuntimeEvent, RuntimeSession } from "./types.js";

/**
 * One turn, stream-first.
 *
 * The stream only delivers events that occur after it opens, so it is opened
 * before (concurrently with) the send. Opening it afterwards loses the early
 * events and produces a transcript that cannot bill or settle a dispute.
 */
export async function runTurn(
  runtime: AgentRuntime,
  sessionId: string,
  text: string,
  onEvent?: (e: RuntimeEvent) => void,
): Promise<{ events: RuntimeEvent[]; session: RuntimeSession }> {
  const streamPromise = runtime.streamEvents(sessionId);
  const sendPromise = runtime.sendMessage(sessionId, text);
  const stream = await streamPromise;

  const events: RuntimeEvent[] = [];
  for await (const ev of stream) {
    events.push(ev);
    onEvent?.(ev);
    if (ev.type === "status" && (ev.status === "idle" || ev.status === "terminated")) break;
  }
  await sendPromise;
  const session = await runtime.readSession(sessionId);
  return { events, session };
}
