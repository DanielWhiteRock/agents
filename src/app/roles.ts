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
 */
export type Role = { id: string; name: string; blurb: string; icon: string };

export const ROLES: Role[] = [
  { id: "designer", name: "Designer", icon: "file",
    blurb: "Restyles an interface by a named system, to that system's own numbers." },
  { id: "engineer", name: "Engineer", icon: "tokens",
    blurb: "Reads the code before changing it, and reviews like someone who maintains it." },
  { id: "qa", name: "QA", icon: "check",
    blurb: "Finds what breaks before a customer does, and writes the test that keeps it found." },
  { id: "security", name: "Security", icon: "warn",
    blurb: "Looks for the way in, names the risk plainly, and says what to do first." },
  { id: "devops", name: "DevOps", icon: "catalog",
    blurb: "Ships it, watches it, and makes the next deploy boring." },
  { id: "marketer", name: "Marketer", icon: "runs",
    blurb: "Turns a vague brief into a campaign with one outcome and one audience." },
  { id: "support", name: "Support", icon: "info",
    blurb: "Reads the inbox and tells you which tickets become problems." },
  { id: "producer", name: "Producer", icon: "clock",
    blurb: "Takes an idea and returns a brief a crew could turn up to." },
];
