/** A tool a pack may use. `spending` marks tools that move money or change the world. */
export type PackTool = {
  name: string;
  description: string;
  inputSchema: object;
  /** Spending/destructive tools get `always_ask`; the platform default is always_allow. */
  spending: boolean;
};

export type PackMcpServer = { name: string; url: string };

export type PackDefinition = {
  slug: string;
  name: string;
  /** Author-facing one-liner for the catalog. */
  tagline: string;
  /** Default model. Buyers may override per session unless `pinnedModels` restricts it. */
  model: string;
  /** Cost dial: low | medium | high | xhigh | max. */
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  /** The expertise. This is the product and must never reach a buyer verbatim. */
  instructions: string;
  /** Author's name, shown in the catalog. */
  author: string;
  /** Price in minor units (cents), one-off. */
  priceCents: number;
  /** Points charged to take a newer version. */
  upgradePoints: number;
  tools?: PackTool[];
  mcpServers?: PackMcpServer[];
  /**
   * Models this pack is allowed to run on. Empty means any.
   * Exists because every extraction refusal measured in the spikes came from
   * claude-opus-5; a weaker model may simply comply.
   */
  pinnedModels?: string[];
};
