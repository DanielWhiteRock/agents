# The pack page, made worth reading

**Date:** 2026-11-10
**Status:** design, awaiting approval
**Topic:** listing metadata, social proof, creator identity and messaging for the pack catalog

---

## Intent

A pack page today is a name, a tagline, a price and a buy button. `src/app/views.ts:604`
renders the whole thing in sixty lines, and most of what a buyer would want to know is
either sealed inside the pack (by design) or sitting unused in our own tables.

Agensi's equivalent page — their `code-reviewer` listing — carries about thirty fields:
a long description, use cases, an example session, a file manifest, limitations, an FAQ,
a changelog, requirements, a permissions disclosure, listed and updated dates, a security
posture, a star rating with its distribution, a usage counter, an upvote, a save-for-later,
a creator card with an "ask the creator" button, and a row of agents it works with.

The gap is not that they built harder things. It is that they tell a buyer what they are
buying and we do not. This design closes that gap, and then goes past it on the three
axes where we have something they structurally cannot copy: a **free trial on your own
brief**, a **measured cost trace** for every run, and an **export you can walk away with**.

### Why now

The shelf is curated and short on purpose. Every pack on it has to carry its own weight,
because there is no long tail to hide a thin listing behind. A buyer who lands on
`senior-engineer` and sees one sentence has nothing to decide with, and the trial — the
single strongest thing we offer — is currently below the buy button where nobody reads it.

### What success looks like

Someone who has just made an account lands on a pack page cold, and within thirty seconds
knows what the worker does, what it has done for other people, what it will touch on
their machine, who made it, and how to try it without paying. Nobody had to write seventy
listings by hand to make that true.

**The catalog stays behind signup.** `src/app/server.ts:59` keeps its `PUBLIC` route list
as it is; no block in this design needs a signed-out variant, there is no public-caching
or crawler story to settle, and run counts, owning-org counts, the file tree and the
permissions rail are shown to account holders rather than published to the open internet.
Making the shelf public is a separate decision with its own disclosure questions.

---

## Goals

1. **Every field on a competitor's listing exists on ours**, populated, for all ~70 packs
   already on the shelf.
2. **Nothing on the page is a lie.** Counted numbers come from our tables. Generated prose
   is approved by a human before a buyer sees it. Claims about other agents are claims we
   can actually honour.
3. **Social proof that survives its own cold start.** A pack nobody has used must not look
   worse than a pack with one friendly review.
4. **A creator is a person, not a string.** `dflopi@gmail.com` becomes a real creator
   record with a profile page; every byline links to it.
5. **A buyer can reach the creator**, and the answer makes the next buyer's page better.
6. **The whole thing is testable before a stranger sees it** — seeded orgs, ratings,
   reviews, votes and threads that look real and can be wiped in one command.

## Non-goals

- **CI/CD triggering.** Running a pack from a pipeline is a real feature and a different
  project. Explicitly out, decided in conversation. Example scenarios may *describe* a
  worker being useful in a pipeline; nothing in this work makes that runnable.
- **Multi-agent distribution.** We are not shipping Cursor/Codex/Windsurf adapters here.
  See "Works with", below, for what we claim instead.
- **Public creator signup flow.** One creator (the user) gets a real record. A general
  "become a creator" onboarding is later.
- **Moderation tooling.** Reviews and messages need a report path and a curator override,
  not a moderation queue product.

## Anti-goals

Things that would make this a failure even if every field shipped:

- **A page that out-promises the pack.** Generated prose that describes a worker better
  than the worker is, is worse than no prose. It converts once and refunds twice.
- **Stars before anyone has given any.** `src/app/platform.ts:145` already argues this
  position and the argument is right: *"the temptation is to show stars before anybody has
  given any… A pack nobody has used says so by showing nothing, which is the honest
  version of a new listing and the thing a rating out of five would hide."* This design
  adds ratings; it must not discard that reasoning. See **Ratings**.
- **Seventy empty sections.** A field that renders as a blank box on most packs has made
  the page worse, not better.
- **Leaking a buyer's work.** No real buyer's brief, repo name or output appears on a
  public page without explicit opt-in. Example sessions are authored, not harvested.

---

## Constraints (what exists and must keep working)

- **Node + TypeScript, no framework.** Server-rendered HTML as template literals in
  `src/app/views.ts`; routing is an if-chain in `src/app/server.ts`; SQL through a thin
  dual-dialect wrapper in `src/app/sql.ts` (SQLite locally, Postgres in production).
  Nothing here introduces a client framework or a build step.
- **Schema changes are additive only.** `src/app/db.ts` applies `CREATE TABLE IF NOT
  EXISTS` plus an append-only `MIGRATIONS` array, each entry recorded in
  `schema_migrations` and attempted once. New columns go on the end of that array. The
  file's own comment records why: a destructive one-time cleanup that re-ran on boot once
  deleted the entire points ledger.
- **A version is immutable.** Editing a pack never changes what an existing buyer runs
  (`src/app/authoring.ts`). Listing metadata is a property of the **pack**, not the
  version — a better description is not a new version — with one exception noted under
  **Changelog**.
- **Instructions never reach a buyer.** The pack page says so in as many words. Every
  generated field is derived *from* instructions and must not reproduce them. This is the
  single hardest constraint in this document and the one most likely to be violated by
  accident.
- **Authors can arrive as a folder.** `importPack` builds a pack from uploaded files and
  `parsePackMarkdown` reads `agent.md` frontmatter. Every new author-supplied field needs
  a frontmatter key, or folder-imported packs will never have it.
- **Per-pack tools are not currently stored.** `src/packs/import.ts` lists `tools` in
  `KNOWN` but never parses it, so the `tools:` / `permission_policy` block in each
  `agent.md` is dropped at import. `mcpServers` reaches `PackInput` but no INSERT or
  UPDATE persists it, and `destructivePolicy` comes from the global
  `destructive_tool_policy` setting at publish time (`platform.ts:333`), not from the
  pack. Only `extras.web` and `anthropicSkills` are genuinely per-pack today. The
  permissions rail depends on fixing this — see **Trust and safety**.
- **Two front doors.** The web catalog and the MCP server (`src/mcp/server.ts`) both list
  packs. A field worth showing a human is usually worth returning to an agent.

---

## The page

Top to bottom, with where each field's content comes from.

| Block | Fields | Source |
|---|---|---|
| Breadcrumb | Home › Workers › *Role* › *Pack* | derived from `role` + `tags` |
| Header | icon/hero, name, byline → creator page, upvote, save-for-later | stored / counted |
| Tagline | one line | author |
| Buy card | price, primary CTA, **trial CTA promoted above the fold**, cost-trace promise, refund window | counted |
| Proof strip | runs, owning orgs, rating + count, version | counted |
| Works with | honest compatibility statement + export | stated |
| Description | 2–3 paragraphs | generated, author-approved |
| Use cases | 3–6 bullets | generated, author-approved |
| Example scenarios | 2–4 scenarios: brief, what it reached for, a slice of output | generated, author-approved |
| What's inside | file tree, skill count, file count | counted from `pack_version_files` |
| Limitations | 2–4 bullets | generated, author-approved |
| Reviews | average, distribution, written reviews | counted |
| Changelog | per version, one line each | author per publish |
| FAQ | Q&A pairs | generated + promoted from message threads |
| Rail: trust & safety | curation status + date, price posture, requires, permissions, listed, updated | counted / derived |
| Rail: creator | avatar, name, verified, runs, pack count, aggregate rating, bio, **Ask the creator** | counted |
| Rail: related | three packs sharing role or tags | derived |

**Empty sections do not render.** A pack with no FAQ has no FAQ heading. This is what
keeps the page from degrading as the catalog grows past what anyone curates by hand.

### Works with

Agensi lists ~27 agent logos. We run everything ourselves, so copying that row verbatim
would be the first lie on the page. What we say instead, and can defend: **it runs here,
on a model you pick, and it exports as one `.md` that `ant apply` takes directly.** The
export route already exists (`/packs/:slug/export`). If a second export format is ever
added, this block grows a logo honestly.

*This is my call, not the user's.* If the intent was to claim broad agent compatibility,
that is a different project — adapters, not a field.

---

## Data model

All additive. New columns on `packs` unless stated.

**Listing content** — `description`, `use_cases`, `limitations`, `faq`, `scenarios`,
`requirements`. The list-shaped ones are JSON text, consistent with how `pinned_models`
and `extras` are already stored. Each gets a frontmatter key in `parsePackMarkdown` so a
folder import can supply it.

**Generation state.** A single `content_status` column over all six fields works for a
one-shot backfill and breaks on the second pass: regenerating would overwrite live text
with a draft. So live and proposed are **separate storage**. The approved values live on
`packs`; a proposed set lives in `pack_listing_drafts` (`pack_id` primary key, the six
fields, `generated_at`, `source_version`). Generation writes a draft and never touches
what is live. Approval copies the draft onto `packs`, stamps `listing_approved_at`, and
deletes the draft. A pack can therefore have live content and a pending draft at once,
which is exactly what a second generation pass needs.

Approval is **per pack**, not per field — the author edits any field they like in the
draft and approves the set, because six separate approval states is a worse screen and a
worse schema for no gain. Editing the pack's `instructions` sets `listing_stale_at`,
which shows the author a banner suggesting a regeneration and changes nothing a buyer
sees. Stale approved content stays live; silently blanking a page because the author
fixed a typo in their method would be worse than a slightly dated description.

**New tables:**

- `creators` — `id`, `user_id`, `org_id`, `handle`, `display_name`, `bio`, `avatar`,
  `links` (JSON), `verified`, `created_at`. `packs.creator_id` references it; the existing
  `packs.author` string stays as the display fallback for packs with no creator record,
  so nothing breaks on day one.
- `pack_reviews` — `id`, `pack_id`, `org_id`, `user_id`, `rating` 1–5, `body`,
  `created_at`, `updated_at`. Unique on `(pack_id, org_id)` — one organisation, one
  review, editable.
- `pack_votes` — `pack_id`, `org_id`, `value` ∈ {−1, +1}, `created_at`. Primary key on
  the pair.
- `pack_saves` — `pack_id`, `org_id`, `user_id`, `created_at`. Save-for-later.
- `pack_changelog` — `pack_id`, `version`, `note`, `created_at`.
- `pack_listing_drafts` — see **Generated content**.
- `threads` / `thread_messages` — see **Messaging**.

**Derived, never stored:** runs, owning orgs, file counts, the file tree, listed and
updated dates. `packStats` (`src/app/platform.ts:151`) already computes the first three
and is currently called only for the catalog cards — the detail page gets it too.

---

## Generated content

The user chose this explicitly: **all fields, generated**.

A platform-owned worker reads a pack's own `instructions` and folder and drafts the
description, use cases, scenarios, limitations and FAQ. It writes into the pack's columns
with `content_status = 'draft'`. The author opens a review screen, edits freely, and
approves. Only `approved` content is public.

Three rules the generator lives under:

1. **Derive, never reproduce.** The output describes what the worker does. It must not
   quote, paraphrase closely, or reconstruct the instructions. The product is the method;
   the listing is the advertisement.
2. **Claim only what the pack supports.** A scenario naming a tool the pack does not have
   is a bug, not a flourish. The generator sees the tool list, the skill names and the
   folder manifest, and is bounded by them.
3. **Draft is the terminal state without a human.** No path exists from generation to
   public except an author pressing approve.

Backfill is a script over the ~70 listed packs, run once, reviewed in bulk.

**Open to the builder:** whether the generator is a pack that runs on our own runtime
(elegant, dogfoods the product, costs points) or a direct API call from a script
(simpler, fewer moving parts). Either satisfies the design.

---

## Changelog

This is the exception to "listing metadata attaches to the pack, not the version": a
changelog note belongs to the version it describes, and a version is immutable, so the
note is captured at publish and never edited afterwards.

The note is **optional**. Making it mandatory would be a breaking change to three
existing publish paths (`POST /packs/:slug/publish`, `POST /api/packs`,
`scripts/pack-publish.mjs`) and their tests, for a field most publishes do not need.

The 68 packs already on the shelf have versions nobody can describe honestly — nobody
knows what their v1 → v2 changed. Those versions get no note and the section does not
render, per the empty-section rule. **Changelogs start from the next publish.** Inventing
history to fill the block would breach the anti-goals; a changelog that begins today and
is true beats one that begins at v1 and is fiction.

## Ratings, reviews, votes

The hard part is not the schema. It is not undoing the argument already written into
`platform.ts`.

**The rules, which are my call unless overridden:**

- Only an org that has **completed a non-trial run** of the pack may rate it. Buying is
  not enough; running is the thing that gives you an opinion.
- One org, one rating, editable forever. Ratings are an organisation's position, not a
  seat's.
- **An average is hidden until five ratings exist.** Below that, the page shows what it
  shows today — runs, owning orgs, or `new` — and the written reviews, which are useful
  individually in a way a 1-of-1 average is not.
- The distribution bars render wherever the average does.
- A review may be left without a star, and a star without prose.
- Votes are separate, lighter, and need no run — they are "this looks good", not "this
  worked". They order the shelf; they are not social proof about quality.
- **A review is bylined with a name the reviewer picks at submit time**, defaulting to
  their organisation's name, with "post anonymously" one click away. The individual
  user's name and email never appear. This holds whether or not the page is public.

This preserves the honesty the original comment was defending while giving the page a
number once that number means something. The comment in `platform.ts` should be updated
rather than deleted, so the next reader sees the reasoning evolved rather than lost.

**Shelf ordering** replaces `ORDER BY price_points DESC`, which currently sorts the shelf
most-expensive first. On today's catalog a pure composite of runs, ratings and votes
collapses to import order, because none of those signals exist yet. So ordering is:
curator-set `featured_rank` first where set, then the composite, then recency. The
curator surface is one number per row on the existing `/curate` page — a curated shelf
should be orderable by the person curating it, and until there is real usage that is the
only honest signal we have. The same ordering applies to role and tag filters and to the
MCP `search_packs`, which reuses `listPacks`.

---

## Creator identity

`dflopi@gmail.com` becomes creator #1: a `creators` row linked to that user and their
org, with handle, display name, bio, avatar, links and `verified = true`.

**Every pack on the shelf is re-attributed to that creator.** Today all 68 listed packs
have an empty `author_org_id` and a byline string — `typeui.sh` on 67 of them,
`Dietrich Gebert, Cursor, Poteto — MIT` on `senior-engineer`. They become owned packs:
one creator, one approval path, one inbox, and no generated prose shipping under a name
that did not write it.

This is a **provenance change**, so it carries two obligations. A migration sets
`author_org_id` and `creator_id` on existing packs — the one place in this design that
writes to rows it did not create, and it belongs in the append-only `MIGRATIONS` array
like everything else. And upstream credit does not disappear: `senior-engineer` is
MIT-licensed third-party work and its `README.md` says so, so the listing keeps a
**"built on"** line naming the original authors and licence, distinct from the byline.
The byline says who stands behind this worker running here; the built-on line says whose
work it rests on. A pack whose folder declares a licence or upstream author gets that
line automatically.

**The profile page** (`/creators/:handle`) carries: avatar, display name, verified mark,
bio, links, join date, every published pack as a card, total runs across all of them,
total owning orgs, an aggregate rating across packs that have one, and an **Ask the
creator** button. Every byline, card and rail links here.

Verification is a curator-set flag. There is no self-serve verification and should not be
one yet; what the tick means is "the curator knows who this is".

---

## Messaging

The user asked for real messages.

A buyer opens a thread from a pack page or a creator profile. It is private between the
asking org and the creator. Both sides see history; both get a notification badge in the
header. A creator inbox lives at `/inbox`.

**Threads are scoped to a pack where they start from one** — a creator with four workers
does not want one undifferentiated inbox.

**The FAQ loop, which is the reason this is worth building:** a creator can publish any
exchange to the pack's FAQ in one click. The question is quoted as asked, the answer as
written, and the asking org is never named. This is how the FAQ section stays fed with
questions people actually have instead of questions the generator imagined.

*My calls here:* private by default; publish is explicit and one-directional; a buyer can
delete their own message before it is published; rate-limited per org per day to keep the
inbox from being a spam target.

---

## Example scenarios

The user's steer: be creative, show the range — a code reviewer that also runs in a
pipeline, an auditor that also reads a dependency bump.

Each scenario is: a **brief** (what a buyer would type), **what the worker reached for**
(skills and tools, from the pack's real manifest), and a **slice of output**. Two to four
per pack. Labelled as an example, never dressed up as a live session.

**Why not replay a real run:** every real trace belongs to a buyer, with their repo name
and their code in it. Harvesting those for marketing is the kind of thing that is fine
until it is a headline.

**Promoting a real trace is out of scope for this build.** An author running their own
pack on a public repo and publishing that trace is more convincing than any written
scenario, and it is the obvious next step — but it needs a trace picker over the author's
own runs, a stored output slice, redaction through the existing `redactForBuyer` /
`containsPackInstructions` path, and a recorded opt-in. That is its own reviewable chunk.
Here, scenarios are a generated, author-approved JSON field and nothing more.

---

## Trust and safety

Four lines in the rail, all honest about what they actually assert:

- **Curation status and date.** We have `status` already; what we lack is a timestamp for
  when it changed. Add `listed_at`.
- **Price posture** — free, or what it costs, from existing data.
- **Requires** — author-stated, generator-drafted from the pack definition.
- **Permissions** — *derived*, not author-declared. This is the block that beats Agensi's
  equivalent, and it is also the one with a prerequisite: as the constraints note, a
  pack's tool list and MCP servers are parsed and then thrown away at import, and the
  destructive policy is a global setting rather than a pack property.

  **The fix is part of this work:** `parsePackMarkdown` learns to read the `tools:` block,
  `pack_tools` and `pack_mcp_servers` are persisted per pack, and the rail renders from
  them. Where a pack has no stored tools yet, the rail states the platform-level truth —
  what any worker here may do — rather than a blank.

  **We do not re-publish the 70 existing packs to make their baked configuration match.**
  The rail describes what the worker may do when it runs, which the global
  `always_allow` default already makes true of every pack on the shelf today; minting a
  new immutable version for all 70 to tidy a field is a cost with no buyer-visible
  benefit. The accurate per-pack configuration takes effect on each pack's next publish,
  exactly as `destructive_tool_policy` already documents.

We do **not** claim a security scan we do not run. "Curated by the platform, reviewed and
listed on *date*" is true today. A real scan is a later feature and gets its own badge
when it exists.

---

## Seed data

The user asked for mock users to test with.

A seed script creates orgs, users, completed runs, ratings spanning the distribution,
written reviews, votes, saves and a couple of message threads — enough that every block on
the page renders with plausible content, including the five-rating threshold on at least
one pack and deliberately *under* it on another.

Every seeded row is flagged (an `is_seed` column or an id prefix — builder's choice) and
one command removes them all.

**Seeded rows are counted by every aggregate.** They have to be: a seed that stats
filter out renders nothing, which defeats the entire purpose of seeding. What keeps fake
social proof away from a buyer is therefore not a query filter but a **hard environment
guard**: the seed script refuses to run unless it is pointed at SQLite or an explicitly
named non-production database, and refuses outright when the production
`DATABASE_URL`-style configuration is present. One refusal at the top of one script,
rather than an `is_seed` predicate threaded through `packStats`, the rating average, the
distribution, the vote count, the creator totals and the shelf ordering — six places to
forget it, versus one place to get it right.

---

## What's left to the builder

- Order of work and how it splits into reviewable pieces.
- Whether the generator runs as a pack on our runtime or as a script.
- The seed-flag mechanism.
- All HTML, CSS and layout within the existing `views.ts` idiom. The mockup at
  `.superpowers/brainstorm/*/content/pack-page-all-fields.html` is the agreed field
  inventory and rough arrangement, not a visual spec.
- Which new fields the MCP `search_packs` / `pack_details` responses should carry.
- Test coverage, following the existing `tests/` layout.

## Decisions the user made

Generated content for every field (option C, chosen explicitly) · `dflopi@gmail.com` as a
real creator with an expanded profile · **every pack re-attributed to that creator** ·
mock users and seeded social proof for testing · real messaging, not a mailto · creative
scenario examples rather than one replayed session · **the catalog stays behind signup** ·
CI/CD triggering out of scope.

## Decisions I made, for checking

Rating eligibility requires a completed non-trial run · averages hidden under five ratings
· votes separate from ratings and not treated as quality proof · reviews bylined with a
name the reviewer picks, defaulting to their org, never the individual · generated content
cannot reach a buyer without author approval · live and draft listing content stored
separately so regeneration never overwrites what is published · approval is per pack, not
per field · an `instructions` edit marks a listing stale but never un-publishes it ·
changelog notes are optional and start from the next publish, with no invented history for
existing versions · per-pack tools and MCP servers get parsed and persisted so the
permissions rail is derived rather than declared, but the 70 existing packs are **not**
re-published to match · promoting a real run trace as a scenario is deferred to its own
chunk · seeded rows are counted by aggregates and kept out of production by a hard
environment guard rather than a filter in six queries · shelf ordering is curator-set rank,
then composite, then recency · "works with" states the export rather than claiming other
agents · no security-scan badge until there is a scan · threads private by default with
explicit publish-to-FAQ · listing metadata attaches to the pack, not the version, except
changelog notes · upstream credit survives re-attribution as a separate "built on" line.
