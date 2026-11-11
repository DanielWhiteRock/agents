/**
 * The jobs we list.
 *
 * A marketplace of skills has to organise by topic, because a skill is not a
 * thing anybody hires — it is a part you would have to assemble. A worker is
 * already the assembly, so the shelf is organised the way hiring is: pick the
 * job, then pick which one.
 *
 * In a module of its own, importing nothing, because `views.ts` needs these
 * and `views.ts` is a pure render module: reading them off `platform.ts` put
 * the Anthropic SDK, the runtime and the whole service layer into the render
 * module's import graph for a list of eight labels. `platform.roles()` adds
 * the counts, which is the part that needs a database.
 *
 * The taxonomy itself now lives in the `roles` table — changing the roles is
 * a row, not a deploy. What is below is two things and not a third: the SEED
 * a fresh database is given at bootstrap, and the FALLBACK `platform.roles()`
 * renders from if the table is somehow empty. It is not the source of truth
 * at runtime, so an edited row wins over it everywhere except the breadcrumb,
 * which is rendered without a database by design.
 *
 * `icon` is the one field that cannot be data alone. It names a function in
 * `views.ts` that draws an SVG, so a row saying `icon: "sparkle"` has no
 * drawing behind it. The names are declared here, where the module that owns
 * them can be imported by both the writer and the renderer; `views.ts` types
 * its icon table as `Record<IconName, string>`, which makes `tsc` reject a
 * name added here with nothing drawn for it, or a drawing with no name.
 */

/** Every icon `views.ts` draws. A role may only ask for one of these. */
export const ICON_NAMES = [
  "catalog", "runs", "points", "search", "download", "trash", "stop", "send",
  "trace", "clock", "tokens", "cost", "file", "info", "warn", "check", "inbox",
] as const;

export type IconName = (typeof ICON_NAMES)[number];

export type Role = { id: string; name: string; blurb: string; icon: string };

/**
 * A role as the table holds it. `rank` is display order; `listed` lets a role
 * be retired without deleting it, which would orphan every pack tagged with
 * it.
 */
export type RoleRow = Role & { rank: number; listed: boolean };

/**
 * Loudly, on the way in.
 *
 * A bad icon does not throw at render time — `views.ts` substitutes the info
 * glyph — so nothing would ever report the mistake; the tile would just be
 * wrong on the shelf forever. Checked on every write instead.
 */
export function assertRoleIcon(role: { id: string; icon: string }): void {
  if (!(ICON_NAMES as readonly string[]).includes(role.icon)) {
    throw new Error(
      `role ${role.id}: no icon named "${role.icon}". views.ts draws: ${ICON_NAMES.join(" ")}`);
  }
}

/**
 * The eight, from `docs/role-design-from-the-catalogue.md` §4, in display
 * order. Each one is argued there from what the catalogue can actually stock:
 * `reviewer`, `growth` and `operator` are renames of roles nothing was ever
 * tagged with, `writer` and `agent` are the two shelves the evidence says we
 * most obviously lack, and `support` and `producer` are gone because nobody
 * buys that work at any price.
 */
export const ROLES: RoleRow[] = [
  { rank: 1, id: "engineer", name: "Engineer", icon: "tokens", listed: true,
    blurb: "Reads the code before changing it, and reviews like someone who maintains it." },
  { rank: 2, id: "reviewer", name: "Reviewer", icon: "check", listed: true,
    blurb: "Reads it as the last person before the customer, and says ship, fix or stop." },
  { rank: 3, id: "designer", name: "Designer", icon: "file", listed: true,
    blurb: "Picks the look on purpose, then builds the interface that wears it." },
  { rank: 4, id: "writer", name: "Writer", icon: "send", listed: true,
    blurb: "Writes it the way a person would, and leaves a document someone can act on." },
  { rank: 5, id: "growth", name: "Growth", icon: "runs", listed: true,
    blurb: "Finds who would buy it, and audits the page that has to sell it." },
  { rank: 6, id: "operator", name: "Operator", icon: "catalog", listed: true,
    blurb: "Gets it out, and writes up honestly what happened when it broke." },
  { rank: 7, id: "security", name: "Security", icon: "warn", listed: true,
    blurb: "Looks for the way in, names the risk plainly, and says what to do first." },
  { rank: 8, id: "agent", name: "Agents Engineering", icon: "trace", listed: true,
    blurb: "Builds the worker, not the answer — and tests that it fires when it should." },
];
