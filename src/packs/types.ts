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
  /**
   * Cost dial: low | medium | high | xhigh | max.
   * Optional because not every model accepts it — Haiku 4.5 rejects any effort
   * level with a 400, so for those models it must be omitted, not defaulted.
   */
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  /**
   * The expertise — the product itself. Over MCP, `load_pack` hands this to
   * any signed-in organisation for a free pack, and to an entitled one for a
   * paid pack. The website's own pack-page copy decides separately whether to
   * show it there; this field's name and type carry no promise either way.
   */
  instructions: string;
  /** Author's name, shown in the catalog. */
  author: string;
  /** Price in whole points, one-off. */
  pricePoints: number;
  /** What it is for, comma separated. The shelf's categories are these, counted. */
  tags?: string;
  /** A hero image, served from /assets. Generated, never stock. */
  image?: string;
  /**
   * The job this worker does: one id from the `roles` table, or absent.
   *
   * Absent is a real answer and the honest one for a pack whose work no
   * surviving role describes — `platform.roles()` only advertises a role
   * something is tagged with, so an invented tag would put a shelf on the
   * front page that the catalog cannot fill.
   */
  role?: string;
  /** Points charged to take a newer version. */
  upgradePoints: number;
  tools?: PackTool[];
  mcpServers?: PackMcpServer[];
  /**
   * What happens when the agent reaches for a tool that changes the world
   * (bash, write, edit, or a tool the author marked as spending).
   *
   * `always_ask` pauses for a human. `always_allow` runs it unattended — which
   * is the platform's own default. `auto` lets the server judge each call and
   * pause only when it cannot decide. Set from platform configuration unless a
   * pack declares its own.
   */
  destructivePolicy?: "always_ask" | "always_allow" | "auto";
  /**
   * What the pack brought besides skills — commands, hooks, workflows, docs —
   * and where it is mounted. Put in the system prompt so the agent knows the
   * files are there and what they are for.
   */
  folder?: import("./wrapper.js").FolderBrief | undefined;
  /**
   * Anthropic's own prebuilt skills, by short name: pptx, xlsx, docx, pdf.
   * A pack that delivers a spreadsheet needs to be able to ask for one.
   */
  anthropicSkills?: string[];
  /** Already-uploaded skills to attach by id — the platform's shared ones. */
  attachSkillIds?: string[];
  /**
   * A model the agent may consult mid-turn for strategic guidance. Off unless
   * a pack asks, because it is a second model on every consultation.
   */
  advisorModel?: string;
  /**
   * Pin where the web tools may look. Exactly one of these, never both — the
   * API rejects a request carrying the pair.
   */
  web?: { allowedDomains?: string[]; blockedDomains?: string[] };
  /**
   * Models this pack is allowed to run on. Empty means any.
   * Exists because every extraction refusal measured in the spikes came from
   * claude-opus-5; a weaker model may simply comply.
   */
  pinnedModels?: string[];
};
