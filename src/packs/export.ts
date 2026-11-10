import type { PackDefinition } from "./types.js";
import { composeSystemPrompt } from "./wrapper.js";

/**
 * A pack as a file you can run yourself.
 *
 * The format is deliberately the one `ant apply` already consumes — markdown
 * with YAML front matter — so an exported pack is not a bespoke bundle that
 * needs our tooling, it is an agent definition the platform's own CLI accepts.
 *
 * Exporting hands over the author's instructions. That is the honest cost of
 * the developer path the design chose: buyers are owners, and authors are told
 * plainly that a determined buyer can read what they bought.
 */
export function exportPackMarkdown(pack: PackDefinition, version: number): string {
  const yaml: string[] = [
    "---",
    `name: ${quote(pack.name)}`,
    `model:`,
    `  id: ${pack.model}`,
    ...(pack.effort ? [`  effort: ${pack.effort}`] : []),
    `description: ${quote(pack.tagline)}`,
  ];

  yaml.push("tools:");
  yaml.push("  - type: agent_toolset_20260401");
  yaml.push("    default_config:");
  yaml.push("      enabled: true");
  yaml.push("    configs:");
  // The platform default is always_allow, so the safe posture is restated here
  // rather than assumed — an exported pack must not be more permissive than the
  // hosted one.
  for (const tool of ["bash", "write", "edit"]) {
    yaml.push(`      - name: ${tool}`);
    yaml.push(`        permission_policy:`);
    yaml.push(`          type: always_ask`);
  }
  for (const t of pack.tools ?? []) {
    yaml.push(`  - type: custom`);
    yaml.push(`    name: ${t.name}`);
    yaml.push(`    description: ${quote(t.description)}`);
    yaml.push(`    input_schema: ${JSON.stringify(t.inputSchema)}`);
    if (t.spending) {
      yaml.push(`    permission_policy:`);
      yaml.push(`      type: always_ask`);
    }
  }
  for (const m of pack.mcpServers ?? []) {
    yaml.push(`  - type: mcp_toolset`);
    yaml.push(`    mcp_server_name: ${m.name}`);
  }
  if (pack.mcpServers?.length) {
    yaml.push("mcp_servers:");
    for (const m of pack.mcpServers) {
      yaml.push(`  - type: url`);
      yaml.push(`    name: ${m.name}`);
      yaml.push(`    url: ${m.url}`);
    }
  }
  yaml.push(`metadata:`);
  yaml.push(`  pack_slug: ${pack.slug}`);
  yaml.push(`  pack_version: "${version}"`);
  yaml.push(`  author: ${quote(pack.author)}`);
  yaml.push("---");

  return [
    ...yaml,
    "",
    `<!-- ${pack.name} v${version} by ${pack.author}, from agents.alphaceo.ai.`,
    `     Apply it with:  ant apply ${pack.slug}.md`,
    `     The instructions below are the author's work. Licensed to the`,
    `     organisation that bought it, not for redistribution. -->`,
    "",
    composeSystemPrompt(pack),
    "",
  ].join("\n");
}

/** YAML scalars that may contain a colon or a quote need quoting. */
function quote(v: string): string {
  return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
