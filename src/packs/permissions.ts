/**
 * The permissions rail, turned into words.
 *
 * A pack page can either let an author *say* what their worker does, or let a
 * buyer see what it is actually configured to do. The second is harder to
 * fake, which is the whole point of the rail — so this function takes only
 * what was parsed off the pack (its stored tools, its MCP servers, its pinned
 * web domains) and the platform's own default policy, and turns that into
 * plain lines. No database, no settings lookup, no import from `src/app/` —
 * it is handed everything it needs and returns strings.
 */

const POLICY_LABELS: Record<string, string> = {
  always_allow: "runs unattended",
  always_ask: "pauses for a human",
  auto: "left to the server's judgement",
};

function describePolicy(policy: string): string {
  return POLICY_LABELS[policy] ?? policy;
}

export function permissionSummary(args: {
  tools: Array<{ name: string; policy: string }>;
  mcpServers: Array<{ name: string; url: string }>;
  web?: { allowedDomains?: string[]; blockedDomains?: string[] };
  defaultPolicy: string;
}): { lines: string[] } {
  const lines: string[] = [];

  if (args.tools.length === 0) {
    // Nothing was ever parsed off this pack's agent.md — the platform's own
    // policy is what a run would actually fall back to, so that is the
    // honest statement rather than silence.
    lines.push(`no tools recorded for this pack yet — the platform default ${describePolicy(args.defaultPolicy)}`);
  } else {
    // Grouped by policy, in the order each policy was first seen, with the
    // tool names in the order they were declared — so "bash, write, edit"
    // reads as one sentence rather than three.
    const order: string[] = [];
    const groups = new Map<string, string[]>();
    for (const tool of args.tools) {
      if (!groups.has(tool.policy)) {
        order.push(tool.policy);
        groups.set(tool.policy, []);
      }
      groups.get(tool.policy)!.push(tool.name);
    }
    for (const policy of order) {
      lines.push(`${groups.get(policy)!.join(", ")} — ${describePolicy(policy)}`);
    }
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
