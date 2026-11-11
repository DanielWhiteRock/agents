# Front Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A front page that sells a worker rather than a skill, built only from
numbers we can actually produce.

**Architecture:** One aggregate query feeds every section, replacing the N+1
`packStats` call the catalog does today. Each section declares what it needs to
be worth showing and renders nothing when it has less, so the page is honest at
72 packs and still right at 7,000. The catalog becomes `/catalog`; `/` becomes
the front page.

**Tech Stack:** The existing server-rendered views (`src/app/views.ts`), the
dual-driver SQL layer (`src/app/sql.ts`), Perspective tokens, vitest + node:test.

**Spec:** `docs/superpowers/specs/2026-11-09-agent-marketplace-design.md`

## Global Constraints

- **Points, not dollars.** Compute is `pts()`; dollars appear only where money
  moves (§8.1). A points value through `fmt()` is a bug.
- **Mobile first.** Base styles are the phone; wider screens add room through
  `min-width`. `docs/design/perspective.md`.
- **Perspective tokens only.** Type 12/14/16/20/24/32, spacing 4/8/12/16/24/32,
  `--primary:#00BD7D` as a fill and never as text. Semantic tokens, never raw
  values.
- **No fabricated social proof.** No ratings, no vote counts, no "users" figure.
  Every number on the page traces to a row we hold. The spec's anti-goals
  forbid inventing a result (§4); a star rating nobody gave is one.
- **Every screen stays at 100** on `npm run judge:strict`.
- **Both drivers.** `npm test` green on SQLite and with `DATABASE_URL` set.

## Review Focus

- **An empty shelf.** A new deployment has zero packs and zero runs; every
  section must render or hide without throwing. Task 1.
- **A pack nobody has run.** `runs: 0` must not divide, rank oddly, or show
  "0 runs" as if it were a recommendation. Task 2.
- **One pack dominating.** With 67 designers and 1 engineer, "most run" must not
  be 10 designers; a role cap keeps the row representative. Task 4.
- **A pack with no image and no tags.** The anatomy strip and card must degrade
  to something, not to a gap. Task 3.
- **Counts that disagree.** The hero says 72 workers, the role row sums to 71
  because one has no role. The two must be computed from the same query or one
  of them is wrong on every load. Task 1.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/app/shelf.ts` *(new)* | One aggregate read: shelf totals, per-pack signals, anatomy counts. Nothing renders here. |
| `src/app/views.ts` *(modify)* | `frontPage()` added; `catalogPage()` keeps its job and loses the role row. |
| `src/app/server.ts` *(modify)* | `/` → front page, `/catalog` → catalog, redirect preserved. |
| `src/app/db.ts` *(modify)* | `orgs.verified` migration. |
| `tests/app/shelf.test.ts` *(new)* | Pure shaping: ranking, caps, thresholds. |
| `tests/node/shelf.test.mjs` *(new)* | The aggregate query against a real schema, both drivers. |

---

## Task 1: One read for the whole page

Today the catalog calls `packStats(p.id)` once per pack — 72 queries to draw
one page, and the hero's totals would add more. Everything the front page
shows comes from one call.

**Files:**
- Create: `src/app/shelf.ts`
- Create: `tests/node/shelf.test.mjs`
- Modify: `src/app/server.ts` (catalog route stops calling `packStats` per pack)

**Interfaces:**
- Consumes: `sql()` from `src/app/sql.ts`; `PackRow` from `src/app/platform.ts`.
- Produces:
  ```ts
  export type ShelfTotals = {
    packs: number; roles: number; authors: number; skills: number;
    runs: number; pointsSpent: number;
  };
  export type PackSignal = {
    packId: string; runs: number; buyers: number; version: number;
    newThisWeek: boolean;
  };
  export async function shelfTotals(): Promise<ShelfTotals>;
  export async function packSignals(): Promise<Map<string, PackSignal>>;
  ```

- [ ] **Step 1: Write the failing test**

```js
test("the shelf reads itself in one pass, and agrees with itself", async () => {
  const totals = await Shelf.shelfTotals();
  const signals = await Shelf.packSignals();
  assert.equal(totals.packs, signals.size, "every listed pack has a signal row");
  // The hero's count and the role row's sum come from one query or they
  // disagree on every load.
  const byRole = await P.roles();
  assert.ok(byRole.reduce((n, r) => n + r.count, 0) <= totals.packs);
});

test("an empty shelf reports zeroes rather than throwing", async () => {
  await emptyTheShelf();
  const totals = await Shelf.shelfTotals();
  assert.deepEqual(totals, { packs: 0, roles: 0, authors: 0, skills: 0, runs: 0, pointsSpent: 0 });
  assert.equal((await Shelf.packSignals()).size, 0);
});

test("a pack nobody has run reports zero, not nothing", async () => {
  const sig = (await Shelf.packSignals()).get(packId);
  assert.equal(sig.runs, 0);
  assert.equal(sig.buyers, 0);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test tests/node/shelf.test.mjs`
Expected: FAIL, `Cannot find module '../../dist/src/app/shelf.js'`

- [ ] **Step 3: Implement `shelfTotals()` and `packSignals()` in `src/app/shelf.ts`**

Two queries, not one per pack. `packSignals` returns a `Map` keyed by pack id
so the caller joins in memory. Trials are excluded from `runs` — a trial is
not evidence anybody chose it. Postgres returns counts as strings; `Number()`
them at the boundary, as `packStats` already does.

- [ ] **Step 4: Run it and watch it pass, on both drivers**

Run: `npm run test:integration` then the same with `DATABASE_URL` set.
Expected: PASS on both.

- [ ] **Step 5: Replace the per-pack call in the catalog route**

`src/app/server.ts` builds one `packSignals()` map before the `map`, and reads
from it. `packStats()` stays for the pack page, which legitimately wants one.

- [ ] **Step 6: Commit**

```bash
git add src/app/shelf.ts tests/node/shelf.test.mjs src/app/server.ts
git commit -m "perf: read the shelf in one pass instead of once per pack"
```

---

## Task 2: What is in a worker

The section agensi has no equivalent for, and the clearest statement of the
difference. A skill is one file; a worker is a folder that may carry skills,
tools, hooks, workflows, commands and docs. The strip shows what the packs on
the shelf *actually* contain, so it tells the truth today (skills only) and
tells a better one as packs grow.

**Files:**
- Modify: `src/app/shelf.ts`
- Create: `tests/app/shelf.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Anatomy = { dir: string; label: string; packs: number; files: number };
  export async function anatomy(): Promise<Anatomy[]>;
  ```

- [ ] **Step 1: Write the failing test**

```ts
describe("anatomy", () => {
  it("counts a folder's parts, and leaves out the parts nobody uses", () => {
    const rows = shapeAnatomy([
      { path: "agent.md" }, { path: "skills/a/SKILL.md" }, { path: "skills/b/SKILL.md" },
      { path: "hooks/pre.json" },
    ]);
    expect(rows.map((r) => r.dir)).toEqual(["skills", "hooks"]);
    // agent.md is every pack and is not a part; a directory with nothing in it
    // is not shown, because "0 workflows" invites the question and answers it
    // badly.
    expect(rows.find((r) => r.dir === "workflows")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/app/shelf.test.ts`
Expected: FAIL, `shapeAnatomy is not a function`

- [ ] **Step 3: Implement `shapeAnatomy(files)` and `anatomy()`**

`shapeAnatomy` is pure and exported for the test; `anatomy()` is the query that
feeds it. Order follows `PACK_DIRS` so the strip reads the same way every time.
Labels: skills, tools, hooks, workflows, commands, docs.

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/app/shelf.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/app/shelf.ts tests/app/shelf.test.ts
git commit -m "feat: count what a worker's folder actually carries"
```

---

## Task 3: A person behind every agent

The sharpest difference from agensi, and the one the data model currently
cannot express. `packs.author` is a single free-text field, so the Senior
Engineer — which credits three people under MIT — is stored as the string
`"Dietrich Gebert, Cursor, Poteto — MIT, see README.md"`. That is not a
credit, it is a sentence where a credit should be.

A pack credits one or more people. A person has a name, optionally a link and
a line about themselves, and a verification flag somebody sets. What the shelf
shows of them is what they made and how much it has been run.

**What it does not show: their earnings.** A person's income is their
business. §8.6 makes earned points cashable, which makes them money, and
publishing somebody's income on a marketplace page because the number happens
to sit in our database is not a thing to do. Earnings appear on their own
dashboard and nowhere else.

**Honesty rule.** Three packs are authored by `Placeholder — needs a real
campaigner`. They stay exactly as they are and appear in this section as what
they are: unclaimed. A shelf that admits three of its workers are waiting for
an author is worth more than one that quietly hides them, and it doubles as
the to-do list.

**Files:**
- Modify: `src/app/db.ts` (`people` table, `pack_authors` join, `people.verified`)
- Modify: `src/app/platform.ts` (`authorsOf`, `person`)
- Modify: `src/packs/import.ts` (`author:` accepts a list)
- Create: `tests/node/authors.test.mjs`

**Interfaces:**
- Produces:

      export type Person = {
        id: string; name: string; handle: string; link: string | null;
        bio: string | null; verified: boolean; orgId: string | null;
      };
      export async function authorsOf(packIds: string[]): Promise<Map<string, Person[]>>;
      export async function person(handle: string): Promise<
        (Person & { packs: PackRow[]; runs: number }) | undefined>;

- [ ] **Step 1: Write the failing test**

      test("a pack credits every person who wrote it, not a sentence about them", async () => {
        // The Senior Engineer is three people under MIT. One string cannot say that.
        const people = (await P.authorsOf([packId])).get(packId);
        assert.deepEqual(people.map((p) => p.name).sort(),
          ["Cursor", "Dietrich Gebert", "Poteto"]);
      });

      test("an author is unverified until somebody verifies them", async () => {
        assert.equal((await P.person("typeui-sh")).verified, false,
          "verification is a claim we make, not a default");
      });

      test("a placeholder author is not a person and is not dressed as one", async () => {
        const people = (await P.authorsOf([supportTriageId])).get(supportTriageId);
        assert.equal(people.length, 0, "nobody wrote it yet, and the shelf says so");
      });

      test("a person's page shows what they made and how it ran, never what it earned", async () => {
        const p = await P.person("typeui-sh");
        assert.equal(p.packs.length, 67);
        assert.equal(typeof p.runs, "number");
        assert.ok(!("earnings" in p), "income is theirs, not the shelf's");
      });

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test tests/node/authors.test.mjs`
Expected: FAIL, `authorsOf is not a function`

- [ ] **Step 3: Add `people`, `pack_authors` and the migration**

`people(id, handle, name, link, bio, verified, org_id, created_at)` with
`handle` unique; `pack_authors(pack_id, person_id, position)`. Backfill splits
the existing `author` string on commas and em dashes, discarding anything
matching `/^placeholder/i`, so a placeholder becomes zero authors rather than
a person called Placeholder. `packs.author` stays as the display fallback
until every pack is migrated; the plan does not drop a column it has not
finished replacing.

- [ ] **Step 4: Teach `agent.md` a list**

`author: "A, B"` and a YAML list both parse to several people. One name still
parses to one. Existing folders keep working.

- [ ] **Step 5: Run it and watch it pass, on both drivers**

- [ ] **Step 6: Commit**

      git add src/app/db.ts src/app/platform.ts src/packs/import.ts tests/node/authors.test.mjs
      git commit -m "feat: a pack credits people, not a sentence about them"

---

## Task 3b: Their page, and their face

A person gets a page at `/by/<handle>`: who they are, the workers they wrote,
how much those have run. The card already carries an avatar drawn from the
name — initials on a hue derived from it, so one person is one colour
everywhere. A real photograph is theirs to upload and nobody else's to
generate.

**Files:**
- Modify: `src/app/views.ts` (`personPage`, author line on `.gig`)
- Modify: `src/app/server.ts` (`/by/:handle`)
- Modify: `scripts/judge.mjs` (a person page is a screen)

- [ ] **Step 1: Write the failing test**

      test("/by/<handle> shows a person and their workers", async () => {
        const html = await get("/by/typeui-sh");
        assert.match(html, /typeui\.sh/);
        assert.match(html, /67/);
        assert.ok(!/earn/i.test(html), "their income is not on a public page");
      });

      test("an unknown handle is a 404, not an empty person", async () => {
        assert.equal(await status("/by/nobody"), 404);
      });

- [ ] **Step 2: Run it and watch it fail**

- [ ] **Step 3: Implement `personPage()` and the route**

- [ ] **Step 4: Add `/by/typeui-sh` to the judge's `SCREENS` and run it**

Run: `npm run judge:strict`
Expected: 100.

- [ ] **Step 5: Commit**

      git add src/app/views.ts src/app/server.ts scripts/judge.mjs
      git commit -m "feat: a page for the person behind the worker"

---

## Task 4: The sections, each with a reason to exist

Nine sections. Each declares what it needs to be worth rendering, and renders
nothing below that. This is the whole honesty mechanism: the page is the same
code at 72 packs and 7,000, and simply shows less now.

**Files:**
- Modify: `src/app/views.ts` (`frontPage()`, section helpers, styles)
- Create: `tests/app/front-page.test.ts`

**Interfaces:**
- Consumes: `ShelfTotals`, `PackSignal`, `Anatomy` from Task 1 and 2;
  `ROLES`/`roles()` from `src/app/platform.ts`.
- Produces: `export function frontPage(data: FrontPageData): string`

| # | Section | Ours, not theirs | Shows when |
|---|---|---|---|
| 1 | Hero | "Hire a worker, not a prompt." Two CTAs: browse, how it runs. | always |
| 2 | Stat strip | workers · roles · skills carried. Not runs, not users. | a stat ≥ 10 |
| 3 | Roles | the existing role row, moved here | ≥ 1 filled role |
| 4 | What's in a worker | the anatomy strip — agensi's missing section | ≥ 1 part |
| 5 | Most run | ranked by real runs, capped at 2 per role | ≥ 5 non-trial runs |
| 6 | New this week | `created_at` within 7 days, newest first | ≥ 3 |
| 6b | Somebody wrote this | the people behind the workers, and the three still unclaimed | ≥ 1 credited person |
| 7 | It runs here | the wedge: hosted, budgeted, traced, billed in points | always |
| 8 | Connect over MCP | the seven tools, the one endpoint | always |
| 9 | For authors | earn on every run, cash out, keep your instructions | always |

- [ ] **Step 1: Write the failing test**

```ts
describe("frontPage sections", () => {
  it("hides a section it cannot fill honestly", () => {
    const html = frontPage({ ...base, totals: { ...zero, runs: 2 } });
    expect(html).not.toContain("Most run");
    // Three runs is not a trend, and a "trending" row of three is a claim
    // about popularity we have not earned.
  });

  it("caps one role from taking the whole most-run row", () => {
    const html = frontPage({ ...base, mostRun: sixtySevenDesigners });
    expect(countCards(html, "designer")).toBeLessThanOrEqual(2);
  });

  it("shows no stat it would be embarrassed by", () => {
    const html = frontPage({ ...base, totals: { ...zero, packs: 72, runs: 3 } });
    expect(html).toContain("72");
    expect(html).not.toContain("3 runs");
  });

  it("renders an empty shelf without a gap where a section was", () => {
    const html = frontPage({ ...base, totals: zero, packs: [], roles: [] });
    expect(html).toContain("Hire a worker");
    expect(html).not.toMatch(/<section[^>]*>\s*<\/section>/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/app/front-page.test.ts`

- [ ] **Step 3: Implement `frontPage()` in `src/app/views.ts`**

Each section is a small function returning `""` when its threshold is unmet.
Reuses the existing `.gig` card, `.roles` row and `icon()`. New styles follow
Perspective tokens; the hero uses `--display` at `--t6`.

- [ ] **Step 4: Run it and watch it pass**

- [ ] **Step 5: Commit**

```bash
git add src/app/views.ts tests/app/front-page.test.ts
git commit -m "feat: a front page that shows only what it can stand behind"
```

---

## Task 5: Route it, and keep the catalog findable

**Files:**
- Modify: `src/app/server.ts`
- Modify: `scripts/judge.mjs` (the front page is a screen; it gets judged)

- [ ] **Step 1: Write the failing test**

```js
test("/ is the front page and /catalog is the shelf", async () => {
  assert.match(await get("/"), /Hire a worker/);
  assert.match(await get("/catalog"), /class="roles"|class="gig"/);
  assert.match(await get("/catalog?q=designer"), /67 packs matching/);
});
```

- [ ] **Step 2: Run it and watch it fail**

- [ ] **Step 3: Split the route**

`/` renders `frontPage()`. `/catalog` takes everything the old `/` did,
including `?q=`. The nav's catalog icon points at `/catalog`; the brand points
at `/`. `SECTION` in the wayfinding script maps `/catalog` to itself.

- [ ] **Step 4: Add both to `SCREENS` in the judge and run it**

Run: `npm run judge:strict`
Expected: both at 100, worst 100.

- [ ] **Step 5: Commit**

```bash
git add src/app/server.ts scripts/judge.mjs tests/node/*.mjs
git commit -m "feat: the front page is the front door, the catalog is the shelf"
```

---

## What this does not do

- **No ratings or votes.** Both need a rating anybody gave, and nobody has.
  When buyers rate packs, that is its own plan with its own abuse questions.
- **No "+220 new this week" per role.** True at agensi's volume, silly at ours.
- **No per-agent marketplaces.** Their skills install into seven agents; our
  workers run here, and the portability story is export, which §9.6 already
  covers and Task 4 §9 states plainly.
- **No founder card.** Trust at our size comes from the trace, not a photograph.

---

## Assets

Generated and on R2 before implementation, so Task 4 wires up art that exists
rather than placeholders somebody has to come back for. One visual language
across all five: isometric projection, a vanishing point, layered translucent
planes, matte charcoal forms on warm off-white, emerald as the only colour —
Perspective's own brief, rendered.

| Section | File | Reads as |
|---|---|---|
| 1 Hero | `https://pub-e651801aa8fc476c81b409baa6972944.r2.dev/agentspace/front/hero.mp4` · poster | a founder moving along an endless wall of other people's toolkits, each lighting up as he passes. Bright, delighted, loops. See below. |
| 4 What's in a worker | `https://pub-e651801aa8fc476c81b409baa6972944.r2.dev/agentspace/front/anatomy.webp` | a solid block exploded into six stacked plates, the top one lit. A folder, not a file. |
| 6b Somebody wrote this | `https://pub-e651801aa8fc476c81b409baa6972944.r2.dev/agentspace/front/author.webp` | the same frame held: the people who turned up, and what they brought. |
| 7 It runs here | `https://pub-e651801aa8fc476c81b409baa6972944.r2.dev/agentspace/front/runs-here.webp` | a sealed enclosure with a glowing core, a measured ribbon unrolling out of it. Hosted, and metered. |
| 8 Connect over MCP | `https://pub-e651801aa8fc476c81b409baa6972944.r2.dev/agentspace/front/mcp.webp` | five cables converging into one socket. |
| 9 For authors | `https://pub-e651801aa8fc476c81b409baa6972944.r2.dev/agentspace/front/authors.webp` | one original on a plinth, many faint copies around it, coins returning along a curve. |

All 16-34KB, immutable cache header. Seedream 4.5 at 2K, 135 credits across
six images and two reruns.

**The author image took two passes.** The first gave the finished object a
serene human face, in a prompt that said "no people, no faces" — the model
read "human" and "made-by-someone" and anthropomorphised the product. That is
exactly backwards for this section: the claim is that a person made the tool,
not that the tool is a person. Naming the negative precisely ("no faces, no
eyes, no mask, no figure") and describing the panel as blank fixed it.

**One thing worth knowing for the next batch:** the first hero named the
palette by hex code and the model rendered `#F7F8FF` and `118.30` into the
image as literal text, despite "no text" in the same prompt. Describe colour
in words — "warm off-white", "emerald" — and say "no written characters of any
kind". The four that did so came back clean first time.

### The hero is a founder spoilt for choice

Not somebody being rescued — somebody enjoying themselves. He is moving along
a wall of other people's toolkits, each one different, each lighting up as he
passes, and the wall does not end. The feeling is abundance, and the second
beat is the one the economics make possible: he hires fifty, because he can.

| File | What it is |
|---|---|
| `https://pub-e651801aa8fc476c81b409baa6972944.r2.dev/agentspace/front/hero.mp4` | 4s loop, 1152×648, h264, no audio, 257KB |
| `https://pub-e651801aa8fc476c81b409baa6972944.r2.dev/agentspace/front/hero-poster.webp` | first frame, 70KB |
| `https://pub-e651801aa8fc476c81b409baa6972944.r2.dev/agentspace/front/hired-fifty.webp` | fifty specialists, each with their own kit, and one delighted founder. Section 3, Roles. |

**The sweep was chosen because it loops and an arrival does not.** Our own
Video Producer's Brief pack made that argument: an arrival needs a before and
an after, and a seamless loop has neither. A lateral track along an endless
wall has no before and no after by construction, which is exactly what a
four-second loop wants.

**It still did not loop on the first encode.** The generated plate brightens
monotonically — the wall is greener at frame 96 than at frame 0 — so cutting
it straight gives a visible flash every four seconds. The remedy is the
producer's own: overlap the join and cross-dissolve it rather than cut. Half a
second of overlap, and because the content is self-similar repeating recesses,
the dissolve is invisible. Verified by extracting the frames either side of
the join and comparing them.

257KB at crf 33 against the producer's 300KB budget. crf 35 gets to 209KB if
the page needs the headroom; the wall mottles slightly at that setting, which
is the trade it named.

**Reduced motion still wins.** Hidden under
`prefers-reduced-motion: reduce`, poster shown instead, `preload="none"`, and
on a phone the poster is the hero.
