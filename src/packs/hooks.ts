import type { PackTree } from "./tree.js";

/**
 * Hooks a pack declares, and the enforcement behind them.
 *
 * A hook in a mounted file is only a strong suggestion — the agent can read it
 * and ignore it. Real enforcement needs an intercept, and the platform gives us
 * one: a tool whose permission policy is `always_ask` pauses and waits for a
 * `user.tool_confirmation`. Nothing says a human has to send it. So a pack with
 * PreToolUse hooks is published with `always_ask`, and the server answers every
 * pause itself — denying when a hook matches, allowing immediately otherwise.
 *
 * The result is that hooks bind without anyone being blocked.
 *
 * Declarative on purpose: a hook is a matcher and a message, never a command we
 * run. Executing an author's shell on our own machine would be a far larger
 * decision than making hooks work.
 */
export type HookEvent = "PreToolUse" | "SessionStart";
export type HookAction = "deny" | "allow" | "inject";

export type Hook = {
  /** Where it came from, for error messages. */
  path: string;
  name: string;
  event: HookEvent;
  /** Tool name this applies to. Omitted means every tool. */
  tool?: string;
  /** Regex tested against the tool's serialised input. Omitted means always. */
  match?: string;
  action: HookAction;
  /** The deny reason the agent is shown, or the text injected. */
  message: string;
};

export class HookParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HookParseError";
  }
}

const EVENTS = new Set<HookEvent>(["PreToolUse", "SessionStart"]);
const ACTIONS = new Set<HookAction>(["deny", "allow", "inject"]);

function frontMatter(text: string): { fields: Record<string, string>; body: string } {
  const normalised = text.replace(/\r\n/g, "\n");
  if (!normalised.startsWith("---\n")) return { fields: {}, body: normalised.trim() };
  const end = normalised.indexOf("\n---", 4);
  if (end === -1) throw new HookParseError("the front matter opens with --- but never closes");
  const fields: Record<string, string> = {};
  for (const line of normalised.slice(4, end).split("\n")) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line.trim());
    if (m) fields[m[1]!] = m[2]!.trim().replace(/^["']|["']$/g, "");
  }
  return { fields, body: normalised.slice(end + 4).trim() };
}

export function parseHook(path: string, text: string): Hook {
  const { fields, body } = frontMatter(text);
  const name = fields["name"] ?? path.replace(/^hooks\//, "").replace(/\.[a-z]+$/i, "");
  const event = fields["event"] as HookEvent | undefined;
  if (!event) throw new HookParseError(`${path}: no \`event\` — one of ${[...EVENTS].join(", ")}`);
  if (!EVENTS.has(event)) {
    throw new HookParseError(
      `${path}: event "${event}" is not enforced yet; this platform supports ${[...EVENTS].join(", ")}`);
  }
  const action = (fields["action"] ?? (event === "PreToolUse" ? "deny" : "inject")) as HookAction;
  if (!ACTIONS.has(action)) throw new HookParseError(`${path}: action "${action}" is not one of ${[...ACTIONS].join(", ")}`);
  if (event === "SessionStart" && action !== "inject") {
    throw new HookParseError(`${path}: a SessionStart hook can only inject, not ${action}`);
  }
  if (!body) throw new HookParseError(`${path}: no message — a hook needs to say why, or what to add`);

  if (fields["match"]) {
    // A bad regex must be an upload-time error, not a surprise at run time.
    try { new RegExp(fields["match"], "i"); }
    catch { throw new HookParseError(`${path}: match "${fields["match"]}" is not a valid regular expression`); }
  }

  return {
    path, name, event, action, message: body,
    ...(fields["tool"] ? { tool: fields["tool"] } : {}),
    ...(fields["match"] ? { match: fields["match"] } : {}),
  };
}

export function parseHooks(tree: PackTree): Hook[] {
  return tree
    .filter((f) => /^hooks\/[^/]+\.(md|markdown|ya?ml|json)$/i.test(f.path))
    .map((f) => parseHook(f.path, f.content))
    .sort((a, b) => a.path.localeCompare(b.path));
}

const toolMatches = (hook: Hook, tool: string): boolean => {
  if (!hook.tool || hook.tool === "*") return true;
  return hook.tool.split(/[,|]/).map((t) => t.trim()).filter(Boolean).includes(tool);
};

/**
 * Every string an author might plausibly be matching against.
 *
 * Testing only the serialised JSON looks fine until someone writes `^rm` and it
 * silently never matches, because the first character is `{`. So each string
 * value is tested on its own as well, which is what an author means by
 * "the command starts with rm".
 */
function candidates(input: unknown, depth = 0): string[] {
  if (depth > 4) return [];
  if (typeof input === "string") return [input];
  if (typeof input === "number" || typeof input === "boolean") return [String(input)];
  if (Array.isArray(input)) return input.flatMap((v) => candidates(v, depth + 1));
  if (input && typeof input === "object") {
    return Object.values(input as Record<string, unknown>).flatMap((v) => candidates(v, depth + 1));
  }
  return [];
}

const inputMatches = (hook: Hook, input: unknown): boolean => {
  if (!hook.match) return true;
  const re = new RegExp(hook.match, "i");
  const whole = typeof input === "string" ? input : JSON.stringify(input ?? null);
  return [...candidates(input), whole].some((c) => re.test(c));
};

export type Decision = { result: "allow" | "deny"; reason?: string; hook?: string };

/**
 * What to answer a paused tool call with.
 *
 * A deny wins over an allow however the files are ordered, because a hook that
 * forbids something is the whole reason the author wrote it. With nothing
 * matching, the call is allowed — hooks restrict, they do not gate.
 */
export function decidePreToolUse(hooks: Hook[], call: { tool: string; input: unknown }): Decision {
  const applicable = hooks.filter((h) =>
    h.event === "PreToolUse" && toolMatches(h, call.tool) && inputMatches(h, call.input));
  const denial = applicable.find((h) => h.action === "deny");
  if (denial) return { result: "deny", reason: denial.message, hook: denial.name };
  const allowance = applicable.find((h) => h.action === "allow");
  return allowance ? { result: "allow", hook: allowance.name } : { result: "allow" };
}

/** Text to prepend as privileged context when a session starts. */
export function sessionStartContext(hooks: Hook[]): string | null {
  const notes = hooks.filter((h) => h.event === "SessionStart").map((h) => h.message);
  return notes.length > 0 ? notes.join("\n\n") : null;
}

/** Does this pack need the intercept at all? */
export const needsInterception = (hooks: Hook[]): boolean =>
  hooks.some((h) => h.event === "PreToolUse");
