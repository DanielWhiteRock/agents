import type { RuntimeEvent } from "../runtime/types.js";

export const REDACTION_NOTICE = "[redacted: pack instructions]";

/**
 * A line shorter than this is too generic to treat as a leak — "Step 1: pick a
 * date" should not be redacted because a pack happens to start with "Step 1".
 * Raising it leaks more; lowering it redacts legitimate output.
 */
const MIN_WORDS = 6;

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function significantLines(instructions: string): string[] {
  return instructions
    .split("\n")
    .map(normalise)
    .filter((l) => l.split(" ").filter(Boolean).length >= MIN_WORDS);
}

export function containsPackInstructions(text: string, instructions: string): boolean {
  if (!instructions.trim()) return false;
  const haystack = normalise(text);
  if (!haystack) return false;
  return significantLines(instructions).some((line) => haystack.includes(line));
}

/**
 * Everything a buyer sees passes through here. Authors and the platform see the
 * raw transcript; buyers never do.
 */
export function redactForBuyer(
  events: RuntimeEvent[],
  pack: { instructions: string },
): RuntimeEvent[] {
  return events.map((ev) => {
    switch (ev.type) {
      case "agent.text":
        return containsPackInstructions(ev.text, pack.instructions)
          ? { type: "agent.text", text: REDACTION_NOTICE }
          : ev;
      case "tool.use": {
        const serialised = JSON.stringify(ev.input ?? null);
        return containsPackInstructions(serialised, pack.instructions)
          ? { ...ev, input: REDACTION_NOTICE }
          : ev;
      }
      case "raw":
        // Shape is not ours to parse, so it is replaced wholesale.
        return { type: "raw", payload: REDACTION_NOTICE };
      default:
        return ev;
    }
  });
}
