/**
 * The permissions rail, turned into words.
 *
 * A pack page can either let an author *say* what their worker does, or let a
 * buyer see what it is actually configured to do. The second is harder to
 * fake, which is the whole point of the rail — so this function takes only
 * what was parsed off the pack (its tool *names*, its MCP servers, its pinned
 * web domains) and the policy the run is **effectively** configured with, and
 * turns that into plain lines. No database, no settings lookup, no import from
 * `src/app/` — it is handed everything it needs and returns strings.
 *
 * Why names only. `pack_tools.policy` is the author's own `agent.md`
 * declaration, and it never reaches the runtime: `publishPack` builds the
 * agent config from the platform-wide `destructive_tool_policy` and overrides
 * it to `always_ask` when the pack ships a PreToolUse hook. Rendering the
 * stored policy therefore let the rail state a falsehood — a pack declaring
 * `always_allow` alongside a hook runs with `always_ask` while the rail said
 * "runs unattended" — and the branch's own export→re-import round trip makes
 * that the normal case, since `export.ts` writes `always_ask` for bash, write
 * and edit into every exported `agent.md` and the importer reads it back. The
 * caller resolves the effective policy (`platform.effectivePolicy`) and hands
 * it here; the stored rows supply the names and nothing else.
 */

const POLICY_LABELS: Record<string, string> = {
  always_allow: "runs unattended",
  always_ask: "pauses for a human",
  auto: "left to the server's judgement",
};

function describePolicy(policy: string): string {
  return POLICY_LABELS[policy] ?? policy;
}

/**
 * The platform-level truth, for a pack with no tools recorded — which is
 * every pack published before they were persisted, so this is the rail on
 * most of the shelf.
 *
 * It used to read "no tools recorded for this pack yet — the platform default
 * runs unattended", which is an internals report: it tells a buyer about the
 * state of our own tables and nothing about what the worker may do to their
 * machine, and it reads ungrammatically under `auto`. Two sentences instead —
 * what any worker here may do, then the posture it does it with, derived from
 * the same effective policy as every other line.
 */
const CAPABILITIES =
  "This worker may run shell commands, read and write files in the run's workspace, and use the web.";

function describePosture(policy: string): string {
  if (policy === "always_ask") return "It pauses for a human before each of those and waits to be told to go on.";
  if (policy === "auto") return "Each of those calls is left to the server's judgement as it comes.";
  return "The platform's default is to run unattended, without pausing for approval.";
}

export function permissionSummary(args: {
  /** Tool names, from `pack_tools`. The stored policy is deliberately not read — see above. */
  tools: string[];
  mcpServers: Array<{ name: string; url: string }>;
  web?: { allowedDomains?: string[]; blockedDomains?: string[] };
  /** What the run is actually configured with: the platform policy, forced to `always_ask` by a PreToolUse hook. */
  policy: string;
}): { lines: string[] } {
  const lines: string[] = [];

  if (args.tools.length === 0) {
    lines.push(CAPABILITIES);
    lines.push(describePosture(args.policy));
  } else {
    // One line, because one policy governs all of them: "bash, write, edit —
    // runs unattended" reads as a sentence where three lines read as a form.
    lines.push(`${args.tools.join(", ")} — ${describePolicy(args.policy)}`);
  }

  for (const server of args.mcpServers) {
    lines.push(`connects to ${server.name} (${server.url})`);
  }

  const allowed = args.web?.allowedDomains ?? [];
  const blocked = args.web?.blockedDomains ?? [];
  if (allowed.length > 0) {
    lines.push(`web: limited to ${allowed.join(", ")}`);
  } else if (blocked.length > 0) {
    lines.push(`web: everywhere except ${blocked.join(", ")}`);
  } else {
    lines.push("web: unrestricted");
  }

  return { lines };
}
