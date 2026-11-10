# Marketplace Listing Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the pack page from a tagline and a buy button into a listing a buyer can decide from — generated descriptions, derived permissions, measured proof, ratings, a real creator profile and buyer↔creator messaging.

**Architecture:** Everything is additive on the existing stack: new columns and tables appended to `MIGRATIONS` in `src/app/db.ts`, new domain modules beside `platform.ts`/`authoring.ts`, new render functions in `views.ts`, new branches in the `server.ts` if-chain. Listing content lives on `packs` once approved and in `pack_listing_drafts` while proposed, so regeneration never overwrites what is published. Counted facts (runs, owning orgs, file counts, dates) are queried, never stored.

**Tech Stack:** Node 22+, TypeScript, no framework. Server-rendered HTML template literals. `src/app/sql.ts` dual-dialect wrapper (SQLite local, Postgres deployed). Vitest for pure units (`tests/**/*.test.ts`), `node:test` against `dist/` for anything touching the database (`tests/node/*.test.mjs`).

**Spec:** `docs/superpowers/specs/2026-11-10-marketplace-listing-parity-design.md`

## Global Constraints

- **Schema changes are additive only.** New columns and tables go on the end of the `MIGRATIONS` array in `src/app/db.ts`, or into `SCHEMA` as `CREATE TABLE IF NOT EXISTS`. Never edit or reorder an existing migration entry — they are recorded by index-prefixed name in `schema_migrations` and applied once.
- **Postgres dialect with `$1` placeholders.** The SQLite driver rewrites positionally. Use `{PK_SERIAL}` / `{REAL}` substitution tokens where a dialect differs.
- **The catalog stays behind signup.** Do not touch the `PUBLIC` route regex at `src/app/server.ts:59`.
- **A pack's `instructions` may reach a buyer.** *Superseded 2026-11-10* (see `2026-11-10-mcp-full-surface-design.md`): free packs hand them out over MCP, paid packs on entitlement. A generated *listing* field still must not paste them verbatim, for copy quality — not secrecy.
- **A version is immutable.** Listing metadata attaches to the pack, not the version — except changelog notes, which attach to the version and are written once at publish.
- **Empty sections do not render.** Every new block is conditional on having content.
- **Ratings:** eligibility is a completed non-trial run; the average is hidden below **5** ratings.
- **Existing packs are not re-published.** No task may mint new `pack_versions` rows for the 68 packs on the shelf.
- **Commit messages** follow the repo's existing voice (lowercase `feat:`/`fix:`, a claim with its reason) and end with the attribution lines this session was given.
- Run `npm run typecheck` before every commit.

## Review Focus

Failure modes the spec implies that no task's happy path exercises. Each has a test added to the task that owns the code.

1. **A pack with no listing content renders a page with no empty headings** — most packs are in this state until the backfill runs (Task 13).
2. **An org that only trialled a pack cannot rate it** — `runs.is_trial = 1` must not confer eligibility (Task 9).
3. **The rating average appears at exactly 5 ratings and not at 4** — an off-by-one here publishes a number the spec says must stay hidden (Task 9).
4. **The re-attribution migration is idempotent and never claims a pack that already has an owner** — it runs on every boot of every environment (Task 7).
5. **The seed script refuses to run against Postgres** — the only thing standing between fake social proof and a buyer (Task 14).

---

## File Structure

**Created:**
- `src/app/listing.ts` — listing content: read, draft, approve, staleness.
- `src/app/creators.ts` — creator records, profiles, aggregate stats.
- `src/app/social.ts` — ratings, reviews, votes, saves, eligibility, ranking.
- `src/app/messages.ts` — threads, messages, publish-to-FAQ.
- `src/packs/permissions.ts` — pure summary of what a pack may do, from stored tools.
- `scripts/generate-listings.mjs` — the backfill.
- `scripts/seed-social.mjs` — seeded orgs, runs, ratings, reviews, votes, threads.
- `tests/packs/permissions.test.ts`, `tests/packs/listing-fields.test.ts`, `tests/runtime/ranking.test.ts` (vitest)
- `tests/node/listing.test.mjs`, `tests/node/creators.test.mjs`, `tests/node/social.test.mjs`, `tests/node/messages.test.mjs` (node:test)

**Modified:**
- `src/app/db.ts` — schema and migrations.
- `src/packs/import.ts` — frontmatter keys for new author fields and the `tools:` block.
- `src/app/authoring.ts` — carry the new fields through `PackInput`, persist tools and MCP servers.
- `src/app/platform.ts` — `packStats` on the detail page, listing dates, ranking in `listPacks`.
- `src/app/views.ts` — `packPage` rebuilt; creator, inbox, review and approval screens.
- `src/app/server.ts` — routes for creators, reviews, votes, saves, threads, listing approval.
- `src/mcp/server.ts` — new fields in the catalog responses.

---

## Phase 1 — the page and what feeds it

### Task 1: Listing columns and the drafts table

**Files:**
- Modify: `src/app/db.ts` (`SCHEMA`, `MIGRATIONS`)
- Test: `tests/node/listing.test.mjs`

**Interfaces:**
- Produces: `packs.description`, `packs.use_cases`, `packs.limitations`, `packs.faq`, `packs.scenarios`, `packs.requirements` (all TEXT, default `''`); `packs.listing_approved_at`, `packs.listing_stale_at`, `packs.listed_at`, `packs.built_on` (TEXT, nullable); table `pack_listing_drafts` (`pack_id` PK, the six content columns, `generated_at`, `source_version`).
- The five list-shaped fields (`use_cases`, `limitations`, `faq`, `scenarios`, `requirements`) store JSON arrays as text, matching how `pinned_models` is already stored. `description` is plain text.

- [ ] **Step 1: Write the failing test**

```js
test("a new pack carries empty listing fields and no draft", async () => {
  const { pack } = await makePack();           // helper: signUp + Auth.createPack
  assert.equal(pack.description, "");
  assert.deepEqual(JSON.parse(pack.use_cases || "[]"), []);
  assert.equal(pack.listing_approved_at, null);
  const s = await sql();
  assert.equal(await s.one("SELECT 1 AS ok FROM pack_listing_drafts WHERE pack_id = $1", [pack.id]), undefined);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test:integration`
Expected: FAIL — no such column `description`.

- [ ] **Step 3: Add the columns and the table**

`CREATE TABLE IF NOT EXISTS pack_listing_drafts` goes in `SCHEMA`. The `packs` columns go on the end of `MIGRATIONS` as `ALTER TABLE packs ADD COLUMN …` entries, one per column, each with a comment saying what the field is for in the repo's existing voice.

- [ ] **Step 4: Run it and watch it pass**

Run: `npm run test:integration` → PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/db.ts tests/node/listing.test.mjs
git commit -m "feat: a listing is a thing a pack has, not a tagline and a price"
```

---

### Task 2: The listing module

**Files:**
- Create: `src/app/listing.ts`
- Test: `tests/node/listing.test.mjs`

**Interfaces:**
- Consumes: Task 1's columns.
- Produces:
  - `type Listing = { description: string; useCases: string[]; limitations: string[]; faq: Array<{ q: string; a: string }>; scenarios: Array<{ brief: string; reached: string[]; output: string }>; requirements: string[] }`
  - `listingOf(pack: PackRow): Listing` — parses the stored columns, tolerating malformed JSON by returning empty.
  - `draftFor(packId: string): Promise<Listing | null>`
  - `saveDraft(packId: string, listing: Listing, sourceVersion: number): Promise<void>` — upserts.
  - `approveDraft(orgId: string, slug: string): Promise<void>` — copies the draft onto `packs`, stamps `listing_approved_at`, clears `listing_stale_at`, deletes the draft. Throws `NotTheAuthorError` when `orgId` is neither the pack's `author_org_id` nor the curator org.
  - `markStale(packId: string): Promise<void>`
  - `hasListing(pack: PackRow): boolean`

- [ ] **Step 1: Write the failing tests**

```js
test("approving a draft publishes it and leaves no draft behind", …)
  // saveDraft → approveDraft → pack.description is the draft's, draftFor() is null
test("generating again does not disturb what is already published", …)
  // approve A, saveDraft B, pack.description still A, draftFor() is B
test("only the author or the curator may approve", …)
  // a third org's approveDraft rejects with /only the organisation/
test("listingOf survives a malformed column", …)
  // use_cases = "not json" → []
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npm run test:integration` → FAIL, module not found.

- [ ] **Step 3: Implement `src/app/listing.ts`**

Reuse `NotTheAuthorError` from `authoring.ts` and `platformOrgId()` from `db.ts` for the curator check, matching `setStatus`'s existing authority pattern.

- [ ] **Step 4: Run them and watch them pass**
- [ ] **Step 5: Commit**

```bash
git commit -m "feat: live copy and proposed copy are different things, stored differently"
```

---

### Task 3: New fields arrive from a folder

**Files:**
- Modify: `src/packs/import.ts`, `src/app/authoring.ts`
- Test: `tests/packs/listing-fields.test.ts` (vitest)

**Interfaces:**
- Consumes: Task 2's `Listing`.
- Produces: `parsePackMarkdown` gains `description_long`, `use_cases`, `limitations`, `faq`, `requirements`, `built_on` frontmatter keys on `ParsedPack`; `PackInput` gains the matching optional fields; `createPack`/`updatePack` persist them.
- `description:` keeps its current meaning (the tagline) — the long body uses `description_long:` so no existing `agent.md` changes meaning.

- [ ] **Step 1: Write the failing test**

```ts
it("reads the long description and the list fields off frontmatter", () => {
  const p = parsePackMarkdown(md); // fixture with description_long, use_cases, limitations, built_on
  expect(p.descriptionLong).toBe("Three bodies of work, pulling against each other.");
  expect(p.useCases).toEqual(["Review a branch", "Find the bug you can describe"]);
  expect(p.builtOn).toBe("Dietrich Gebert, Cursor, Poteto — MIT");
});
it("leaves the tagline alone when only description is present", …)
```

- [ ] **Step 2: Run it and watch it fail** — `npx vitest run tests/packs/listing-fields.test.ts`
- [ ] **Step 3: Add the keys to `KNOWN` and the parse branches; thread them through `PackInput` and both SQL statements in `authoring.ts`**
- [ ] **Step 4: Run it and watch it pass**
- [ ] **Step 5: Commit**

```bash
git commit -m "feat: a folder can carry its own listing, so an import is not a blank page"
```

---

### Task 4: Per-pack tools, persisted

**Files:**
- Modify: `src/app/db.ts`, `src/packs/import.ts`, `src/app/authoring.ts`
- Create: `src/packs/permissions.ts`
- Test: `tests/packs/permissions.test.ts` (vitest)

**Interfaces:**
- Produces:
  - Tables `pack_tools` (`pack_id`, `name`, `policy`, PK on the pair) and `pack_mcp_servers` (`pack_id`, `name`, `url`, PK on `pack_id,name`).
  - `parsePackMarkdown` parses the `tools:` block it currently lists in `KNOWN` and discards, yielding `tools: Array<{ name: string; policy: string }>`.
  - `permissionSummary(args: { tools: Array<{ name: string; policy: string }>; mcpServers: Array<{ name: string; url: string }>; web?: { allowedDomains?: string[]; blockedDomains?: string[] }; defaultPolicy: string }): { lines: string[] }` — pure, in `src/packs/permissions.ts`.
- When a pack has no stored tools, `permissionSummary` returns the platform-level statement rather than an empty list.

- [ ] **Step 1: Write the failing tests**

```ts
it("says what a pack with bash, write and edit may do", () => {
  expect(permissionSummary({ tools: [{name:"bash",policy:"always_allow"}, …], mcpServers: [], defaultPolicy: "always_allow" }).lines)
    .toContain("bash, write, edit — runs unattended");
});
it("falls back to the platform statement when a pack has no stored tools", …)
it("names pinned web domains, and says unrestricted when there are none", …)
```

- [ ] **Step 2: Run them and watch them fail**
- [ ] **Step 3: Implement the parse, the two tables, the persistence in `createPack`/`updatePack`, and `permissionSummary`**

The `tools:` block is the Anthropic agent-toolset shape already in every `packs/*/agent.md` — `configs[].name` and `configs[].permission_policy.type`. Parse those two fields only.

- [ ] **Step 4: Run them and watch them pass**
- [ ] **Step 5: Commit**

```bash
git commit -m "feat: we stopped throwing away the tool list, so the page can say what a worker touches"
```

---

### Task 5: The pack page, rebuilt

**Files:**
- Modify: `src/app/views.ts:604` (`packPage`), `src/app/server.ts:139` (the pack route), `src/app/platform.ts`
- Test: `tests/packs/listing-fields.test.ts` (vitest — `packPage` is pure)

**Interfaces:**
- Consumes: `listingOf` (Task 2), `permissionSummary` (Task 4), `packStats` (`platform.ts:151`).
- Produces: `packPage` gains a single `extras` argument carrying `{ listing, stats, permissions, files, updatedAt, builtOn, creator?, rating?, saved?, voted? }`. Later tasks add to this object rather than to the signature.
- New in `platform.ts`: `packFileSummary(packId): Promise<{ files: number; skills: number; tree: string[] }>` from `pack_version_files` of the latest version.
- Also in this task: `setStatus` in `authoring.ts` stamps `packs.listed_at` the first time a pack reaches `listed`, because Task 1 added the column and nothing yet writes it. Existing listed packs get `listed_at` backfilled from `created_at` by a migration entry — the only honest value available.
- The **works-with** block states the export (`/packs/:slug/export`, one `.md` that `ant apply` takes) and claims no third-party agents. The **breadcrumb** is `Home › Workers › <role from P.ROLES> › <pack name>`.

- [ ] **Step 1: Write the failing tests**

```ts
it("renders no heading for a section with no content", () => {
  const h = packPage(packWithNoListing, …);
  expect(h).not.toContain("What you'd hire it for");
  expect(h).not.toContain("Known limitations");
});
it("shows runs and owning orgs on the detail page", …)        // Review Focus 1
it("puts the trial above the buy button", …)                  // index of "Try it" < index of "Start a run"
it("renders the permissions rail from stored tools", …)
it("shows a built-on line without changing the byline", …)
```

- [ ] **Step 2: Run them and watch them fail**
- [ ] **Step 3: Rebuild `packPage` and widen the route to gather the new data**

Block order and content follow the spec's field table. Keep the existing CSS token vocabulary in `views.ts` — no new colour literals.

- [ ] **Step 4: Run them and watch them pass**
- [ ] **Step 5: Commit**

```bash
git commit -m "feat: the pack page says what you are buying, which it did not before"
```

---

## Phase 2 — who made it, and what people think

### Task 6: Creator records

**Files:**
- Modify: `src/app/db.ts`
- Create: `src/app/creators.ts`
- Test: `tests/node/creators.test.mjs`

**Interfaces:**
- Produces:
  - Table `creators` (`id`, `user_id`, `org_id`, `handle` UNIQUE, `display_name`, `bio`, `avatar`, `links`, `verified`, `created_at`); `packs.creator_id` column.
  - `creatorByHandle(handle)`, `creatorForOrg(orgId)`, `upsertCreator(input)`, `creatorStats(creatorId): Promise<{ packs: number; runs: number; orgs: number }>`.
- Aggregate **rating** is deliberately absent here: it depends on the threshold constant that Task 9 owns. Task 9 adds `creatorRating(creatorId)` to `social.ts`, and Task 8's page calls both. Putting a second copy of the threshold in this module is how the two drift apart.

- [ ] **Step 1: Write the failing tests** — a creator's run and owning-org totals sum across their packs; an unknown handle returns undefined.
- [ ] **Step 2: Run them and watch them fail** — `npm run test:integration`
- [ ] **Step 3: Implement the `creators` table, the `packs.creator_id` column and `src/app/creators.ts`**
- [ ] **Step 4: Run them and watch them pass**
- [ ] **Step 5: Commit** — `feat: a creator is a person with a page, not a string in a column`

---

### Task 7: Re-attribution

**Files:**
- Modify: `src/app/db.ts` (`MIGRATIONS`), `src/app/creators.ts`
- Test: `tests/node/creators.test.mjs`

**Interfaces:**
- Consumes: Task 6.
- Produces: `claimUnownedPacks(creatorId, orgId): Promise<number>` — sets `author_org_id` and `creator_id` on every pack where `author_org_id IS NULL`, returns the count. Packs whose `author_org_id` is already set are untouched. The existing `author` string is copied to `built_on` where it is not already set, so upstream credit survives.
- A boot-time migration entry calls it for the platform org's creator when one exists.

- [ ] **Step 1: Write the failing tests**

```js
test("claiming takes only the packs nobody owns", …)
test("claiming twice changes nothing the second time", …)   // Review Focus 4
test("the old byline becomes the built-on line", …)
```

- [ ] **Step 2: Run them and watch them fail**
- [ ] **Step 3: Implement `claimUnownedPacks` and wire the migration entry**
- [ ] **Step 4: Run them and watch them pass**
- [ ] **Step 5: Commit** — `feat: the shelf has an owner, and the people it was built on keep their credit`

---

### Task 8: The creator profile page

**Files:**
- Modify: `src/app/views.ts`, `src/app/server.ts`
- Test: `tests/packs/listing-fields.test.ts`

**Interfaces:**
- Consumes: `creatorStats` (Task 6).
- Produces: `creatorPage(creator, packs, stats, viewer, balance): string`; routes `GET /creators/:handle`, `GET /creators/me`, `POST /creators/me` (edit bio, avatar, links). Pack cards and the pack page byline link to `/creators/:handle`.

- [ ] **Step 1: Write the failing tests** — the page lists the creator's packs and their totals; a creator below the rating threshold shows runs instead of stars; a byline on a pack card links to `/creators/:handle`.
- [ ] **Step 2: Run them and watch them fail** — `npx vitest run tests/packs/listing-fields.test.ts`
- [ ] **Step 3: Implement `creatorPage`, the three routes, and the byline links in `catalogPage` and `packPage`**
- [ ] **Step 4: Run them and watch them pass**
- [ ] **Step 5: Commit** — `feat: a byline that goes somewhere`

---

### Task 9: Ratings, reviews, votes, saves

**Files:**
- Modify: `src/app/db.ts`
- Create: `src/app/social.ts`
- Test: `tests/node/social.test.mjs`

**Interfaces:**
- Produces:
  - Tables `pack_reviews` (`id`, `pack_id`, `org_id`, `user_id`, `rating`, `body`, `byline`, `anonymous`, `created_at`, `updated_at`, UNIQUE `(pack_id, org_id)`), `pack_votes` (`pack_id`, `org_id`, `value`, PK on the pair), `pack_saves` (`pack_id`, `org_id`, `user_id`, `created_at`, PK on `pack_id,org_id`).
  - `mayReview(orgId, packId): Promise<boolean>` — true only with a `runs` row for a version of this pack where `is_trial = 0` and `ended_at IS NOT NULL`.
  - `submitReview(args: { orgId; userId; packId; rating?: number; body?: string; byline: string; anonymous: boolean }): Promise<void>` — upserts on `(pack_id, org_id)`; throws when `mayReview` is false.
  - `ratingOf(packId): Promise<{ average: number | null; count: number; distribution: [number,number,number,number,number] }>` — `average` is `null` below 5 ratings; `distribution` and `count` are always real.
  - `vote(orgId, packId, value)`, `toggleSave(orgId, userId, packId)`.
  - `creatorRating(creatorId): Promise<{ average: number | null; count: number }>` — the same threshold rule applied across all of a creator's packs. Task 8's page calls this alongside `creatorStats`.
- `RATING_THRESHOLD = 5` is exported from this module and is the only copy of that number.

- [ ] **Step 1: Write the failing tests**

```js
test("a trial does not earn you an opinion", …)             // Review Focus 2: is_trial = 1 → mayReview false, submitReview throws
test("a run that has not ended does not either", …)
test("the average appears at five ratings and not at four", …)  // Review Focus 3: 4 → null, 5th → number
test("one organisation has one review, editable", …)        // second submit updates, count stays 1
test("an anonymous review keeps its rating and loses its byline", …)
```

- [ ] **Step 2: Run them and watch them fail**
- [ ] **Step 3: Implement the tables and `src/app/social.ts`**
- [ ] **Step 4: Run them and watch them pass**
- [ ] **Step 5: Commit** — `feat: you may rate a worker you have actually run, and not before`

---

### Task 10: Social proof on the page

**Files:**
- Modify: `src/app/views.ts`, `src/app/server.ts`
- Test: `tests/packs/listing-fields.test.ts`

**Interfaces:**
- Consumes: Task 9.
- Produces: the review block, distribution bars, vote control, save control and submit form in `packPage`; routes `POST /packs/:slug/review`, `POST /packs/:slug/vote`, `POST /packs/:slug/save`.

- [ ] **Step 1: Write the failing tests** — below threshold the page shows the written reviews and no average; at threshold it shows both; a viewer who cannot review sees no form, with a line saying why.
- [ ] **Step 2: Run them and watch them fail** — `npx vitest run tests/packs/listing-fields.test.ts`
- [ ] **Step 3: Implement the review block, the distribution bars, the vote and save controls, and the three routes**
- [ ] **Step 4: Run them and watch them pass**
- [ ] **Step 5: Commit** — `feat: stars, but only once they mean something`

---

### Task 11: Shelf ordering

**Files:**
- Modify: `src/app/db.ts`, `src/app/platform.ts:130-141`, `src/app/views.ts` (the `/curate` table), `src/mcp/server.ts`
- Test: `tests/runtime/ranking.test.ts` (vitest)

**Interfaces:**
- Produces: `packs.featured_rank` (INTEGER, nullable); `rankPacks(rows): PackRow[]` — a pure comparator exported from `platform.ts`, ordering by `featured_rank` ascending where set, then runs, then rating where shown, then votes, then `created_at` descending. `listPacks` applies it; `search_packs` inherits it.

- [ ] **Step 1: Write the failing tests** — a featured pack outranks a busier unfeatured one; with no signal at all the order is newest first, not most expensive first; a hidden rating does not contribute to the ordering.
- [ ] **Step 2: Run them and watch them fail** — `npx vitest run tests/runtime/ranking.test.ts`
- [ ] **Step 3: Add `featured_rank`, implement `rankPacks`, apply it in `listPacks`, add the input to `/curate`**
- [ ] **Step 4: Run them and watch them pass**
- [ ] **Step 5: Commit** — `fix: the shelf stopped sorting most-expensive-first`

---

## Phase 3 — messages, generated copy, and something to look at

### Task 12: Ask the creator

**Files:**
- Modify: `src/app/db.ts`, `src/app/views.ts`, `src/app/server.ts`
- Create: `src/app/messages.ts`
- Test: `tests/node/messages.test.mjs`

**Interfaces:**
- Produces:
  - Tables `threads` (`id`, `pack_id` nullable, `creator_id`, `org_id`, `subject`, `created_at`, `last_at`) and `thread_messages` (`id`, `thread_id`, `org_id`, `user_id`, `body`, `published_at`, `created_at`).
  - `openThread(args)`, `reply(args)`, `threadsFor(creatorId)`, `threadsForOrg(orgId)`, `publishToFaq(creatorId, threadId, questionId, answerId)` — appends `{ q, a }` to the pack's `faq` column, never naming the asking org.
  - `MAX_THREADS_PER_DAY = 10` per org, enforced in `openThread`.
- Routes: `GET /inbox`, `POST /threads`, `POST /threads/:id/reply`, `POST /threads/:id/publish`.

- [ ] **Step 1: Write the failing tests** — a buyer opens a thread and the creator sees it; a third org sees neither; publishing appends to the FAQ without the asker's name; the eleventh thread in a day is refused.
- [ ] **Step 2: Run them and watch them fail** — `npm run test:integration`
- [ ] **Step 3: Implement the two tables, `src/app/messages.ts`, the inbox page and the four routes**
- [ ] **Step 4: Run them and watch them pass**
- [ ] **Step 5: Commit** — `feat: a buyer can ask, and the answer feeds the page`

---

### Task 13: The generator and the backfill

**Files:**
- Create: `scripts/generate-listings.mjs`
- Modify: `src/app/views.ts` (approval screen), `src/app/server.ts` (`POST /packs/:slug/listing/approve`), `src/app/authoring.ts` (call `markStale` on an `instructions` edit)
- Test: `tests/node/listing.test.mjs`

**Interfaces:**
- Consumes: `saveDraft`/`approveDraft` (Task 2).
- Produces: `node scripts/generate-listings.mjs [--slug <slug>] [--all]` — reads each pack's instructions and folder manifest, calls the Anthropic SDK (already a dependency) once per pack, writes a draft. It never writes to `packs` directly.
- The prompt is bounded by the pack's real skill names and tool list and instructed to describe, never quote.

- [ ] **Step 1: Write the failing tests**

```js
test("editing instructions marks the listing stale and changes nothing public", …)
test("a draft whose text reproduces the instructions is refused", …)
  // saveDraft rejects when description shares a long verbatim run with pack.instructions
```

- [ ] **Step 2: Run them and watch them fail**
- [ ] **Step 3: Implement the staleness hook, the verbatim guard in `saveDraft`, the approval screen and route, then the script**

The guard: reject when any 12-word sequence of the draft appears verbatim in `instructions`. It survives the 2026-11-10 change as a **copy-quality** check — a listing that pastes the pack body is lazy prose, not a breach — so keep it and drop the secrecy language around it.

- [ ] **Step 4: Run them and watch them pass**
- [ ] **Step 5: Commit** — `feat: seventy listings nobody had to write`

---

### Task 14: Seed data, with a lock on it

**Files:**
- Create: `scripts/seed-social.mjs`
- Modify: `src/app/db.ts` (an `is_seed` column on `pack_reviews`, `pack_votes`, `runs`, `orgs`)
- Test: `tests/node/social.test.mjs`

**Interfaces:**
- Produces: `node scripts/seed-social.mjs` and `node scripts/seed-social.mjs --wipe`. Seeds orgs, completed non-trial runs, ratings spanning the distribution (one pack above the five-rating threshold, one deliberately at four), reviews, votes, saves and two threads.
- Refuses to run when `DATABASE_URL` is set, or when `--force-production` is absent and the configured database is not SQLite. The refusal is the safety mechanism; aggregates do **not** filter `is_seed`.

- [ ] **Step 1: Write the failing test**

```js
test("the seed refuses a Postgres target", …)   // Review Focus 5: DATABASE_URL set → non-zero exit, nothing written
```

- [ ] **Step 2: Run it and watch it fail**
- [ ] **Step 3: Implement the guard first, then the seeding**
- [ ] **Step 4: Run it and watch it pass, then run the seed and open a pack page**
- [ ] **Step 5: Commit** — `feat: a shelf you can look at before a stranger does, and never in production`

---

### Task 15: Changelog notes

**Files:**
- Modify: `src/app/db.ts`, `src/app/platform.ts` (publish), `src/app/views.ts`, `src/app/server.ts`
- Test: `tests/node/listing.test.mjs`

**Interfaces:**
- Produces: table `pack_changelog` (`pack_id`, `version`, `note`, `created_at`); an optional `note` field on the publish form and on `POST /api/packs`; `changelogOf(packId)`.
- The note is optional. Existing versions have none and the section does not render for them.

- [ ] **Step 1: Write the failing tests** — a publish with a note records it against that version; a publish without one succeeds and records nothing; a pack with no notes renders no changelog heading.
- [ ] **Step 2: Run them and watch them fail** — `npm run test:integration`
- [ ] **Step 3: Add the table, the optional `note` on both publish paths, `changelogOf`, and the block in `packPage`**
- [ ] **Step 4: Run them and watch them pass**
- [ ] **Step 5: Commit** — `feat: a changelog that starts today and is true`

---

### Task 16: The MCP catalog catches up

**Files:**
- Modify: `src/mcp/server.ts`
- Test: `tests/node/social.test.mjs`

**Interfaces:**
- Consumes: Tasks 2, 6, 9.
- Produces: `search_packs` lines carry runs and rating-where-shown; `pack_details` carries the description, use cases, limitations, requirements, permissions summary, creator handle and rating.

- [ ] **Step 1: Write the failing test** — `pack_details` includes the description and the permissions summary. (The no-12-word-sequence assertion is dropped: instructions are no longer sealed.)
- [ ] **Step 2: Run it and watch it fail** — `npm run test:integration`
- [ ] **Step 3: Widen `packLine` and the `pack_details` response**
- [ ] **Step 4: Run it and watch it pass**
- [ ] **Step 5: Commit** — `feat: an agent shopping the catalog sees what a person sees`

---

## Done when

`npm test` passes, `npm run typecheck` is clean, the seed runs locally, and a pack page for `senior-engineer` shows: byline linking to a creator profile, built-on credit, description, use cases, scenarios, a file tree, limitations, derived permissions, runs and owning orgs, a trial above the buy button, reviews with a distribution, and an ask-the-creator thread that can be published to the FAQ.
