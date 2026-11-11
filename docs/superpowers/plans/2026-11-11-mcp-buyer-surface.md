# MCP Buyer Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A buyer's agent can find the right worker, see what it touches, pay for it and receive its instructions without ever opening a browser.

**Architecture:** `src/mcp/server.ts` is split into a thin builder plus one module per tool group, so a 7-tool file does not become a 27-tool file. Every discovery tool reads the tables listing-parity merged (`pack_tools`, `pack_mcp_servers`, `pack_reviews`, `pack_votes`, `creators`, listing columns on `packs`) and reuses `rankPacks`, `ratingOf`, `packStats` and `permissionSummary` rather than reimplementing them. Acquisition wraps `exportPack` and `Pay.buyWithPoints`, which already work.

**Tech Stack:** TypeScript (ESM, NodeNext), `@modelcontextprotocol/sdk` `McpServer` + `StreamableHTTPServerTransport`, `zod` input schemas, Postgres/node:sqlite via `src/app/sql.ts`. Tests: `vitest` for pure modules (`tests/**/*.test.ts`), Node's own runner against the build for anything touching the DB (`tests/node/*.test.mjs`).

**Test harness note.** `/mcp` authenticates with a bearer token, not a cookie (`A.orgFromApiToken`, `src/app/server.ts:994`). Every `tests/node/mcp-*.test.mjs` file begins by calling `startServer()` and `signUpCookie()` from `tests/node/server-harness.mjs`, POSTing `/tokens` with that cookie to mint a token, and defining one local helper — `callTool(name, args) -> string`, which POSTs a JSON-RPC `tools/call` to `/mcp` with `Authorization: Bearer <token>` and returns `result.content[0].text`. Task 2 writes it first; later tasks reuse it. `orgId` and `seededCreatorHandle` in the tests below come from the same setup.

**Spec:** `docs/superpowers/specs/2026-11-10-mcp-full-surface-design.md`

## Scope

The spec describes 27 tools across six groups. This plan is **the first of four** and covers the buyer's journey only — discovery and acquisition. The others follow as their own plans: running here (`run_pack`, run outputs, run control), the author's desk (the six publishing tools), and social plus demand (`rate_pack`, `pack_feedback`, the request board). Each produces working software on its own; this one closes the browser handoff.

Four of the spec's open questions block the later plans, not this one. **Open question 1 (rating eligibility) is now settled in code against us:** `mayReview` (`src/app/social.ts:58`) requires a finished, non-trial run, and the MCP journey creates none — so `rate_pack` stays out of this plan and needs a decision before plan 4.

## Global Constraints

- **One currency: points.** Pack prices and run costs render with `pts()` from `src/billing/points.ts`, called as `pts(price_points * 1000)` exactly as `src/app/views.ts` does. `fmt()` renders dollars and must not appear in `src/mcp/` — the current server prints `$1.20` where the web prints `120 points`, and this plan fixes that.
- **Stateless.** A fresh `McpServer` and transport per request (`handleMcpRequest`). No module-level mutable state; nothing cached between requests.
- **Org-scoped, and silent about what it refuses.** Anything belonging to another organisation is reported as not found, never as forbidden. `run_trace` is the existing model.
- **Only `listed` packs are visible or loadable.** `P.listPacks()` filters `status = 'listed'`; `P.getPack()` does not. Every tool that takes a slug must apply the filter itself.
- **Free is free, paid is paid.** A `listed` pack with `price_points = 0` returns its instructions to any signed-in org. A paid pack returns them only to an org with an entitlement.
- **Schema changes are additive only.** New columns and tables go on the end of the `MIGRATIONS` array in `src/app/db.ts`. This plan adds none.
- **`reason` is echoed, not stored.** Every tool accepts an optional `reason` string and renders it as the response's first line. No table, no run event. *(My call, recorded in the spec's open questions as a smaller item.)*

## Review Focus

1. **A paid pack's instructions requested by a non-owner.** `load_pack` must refuse with the price and the buy path, and the response must contain no fragment of `instructions`. Test in Task 7.
2. **A pack that is not `listed`, requested by exact slug.** Draft and in-review packs must be "no such pack" to every discovery and load tool, not merely absent from lists. Test in Task 2.
3. **A stale agreed price.** `buy_pack` called with an `agreed_price_points` that no longer matches the pack must refuse, restate the live price, and leave no `purchases` row. Test in Task 8.
4. **Insufficient balance.** `buy_pack` must refuse with the top-up link and grant no entitlement; a partially-applied purchase is the worst outcome here. Test in Task 8.
5. **A query that matches everything or nothing.** An empty query must return a bounded, ranked page rather than all 68 rows in table order, and a `tool` filter naming something no pack declares must return none rather than everything. Test in Task 2.

---

### Task 1: Split the server, fix the unit

**Files:**
- Create: `src/mcp/reply.ts`
- Create: `src/mcp/shelf.ts`
- Create: `src/mcp/acquire.ts`
- Modify: `src/mcp/server.ts`
- Test: `tests/mcp/reply.test.ts`

**Interfaces:**
- Produces:
  - `text(s: string, reason?: string): { content: [{ type: "text"; text: string }] }` — prepends `reason` as its own first line when given.
  - `price(pricePoints: number): string` — `"free"` at 0, otherwise `pts(pricePoints * 1000)`.
  - `REASON` — the shared zod field, `z.string().optional().describe(...)`, spread into every tool's `inputSchema`.
  - `registerShelf(server: McpServer, ctx: McpContext): void` in `shelf.ts` — holds `search_packs`, `pack_details` and every discovery tool added later.
  - `registerAcquire(server: McpServer, ctx: McpContext): void` in `acquire.ts` — holds `my_library`, `install_pack`, `export_pack` and the acquisition tools added later.
  - `src/mcp/server.ts` keeps `buildServer`, `handleMcpRequest`, `McpContext` and the run tools, and calls the two registrars.

- [ ] **Step 1: Write the failing test**

```ts
// tests/mcp/reply.test.ts
test("price renders points, never dollars", () => {
  expect(price(0)).toBe("free");
  expect(price(120)).toBe(pts(120 * 1000));
  expect(price(120)).not.toContain("$");
});
test("text puts reason on its own first line", () => {
  expect(text("body", "Checking the price").content[0].text).toBe("Checking the price\n\nbody");
  expect(text("body").content[0].text).toBe("body");
});
```

- [ ] **Step 2: Run it and watch it fail** — `npx vitest run tests/mcp/reply.test.ts`
- [ ] **Step 3: Write `reply.ts`, then move the seven existing tools into `shelf.ts` and `acquire.ts` unchanged except that every `fmt(...)` of a pack price or run cost becomes `price(...)` or `pts(... * 1000)`**

Move only; no behaviour change beyond the unit. `packLine` moves to `shelf.ts`.

- [ ] **Step 4: Run the suite** — `npm run typecheck && npm run test:unit && npm run test:integration`. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/mcp tests/mcp
git commit -m "refactor: the MCP server in modules, and prices in points like everywhere else"
```

---

### Task 2: `search_packs`, ranked and filtered

**Files:**
- Create: `src/mcp/relevance.ts`
- Modify: `src/mcp/shelf.ts`
- Test: `tests/mcp/relevance.test.ts`, `tests/node/mcp-shelf.test.mjs`

**Interfaces:**
- Consumes: Task 1's `text`, `price`, `REASON`.
- Produces:
  - `score(query: string, fields: { name: string; tagline: string; author: string; description: string; useCases: string[]; tags: string; tools: string[] }): number` in `relevance.ts` — field-weighted, case-insensitive, 0 when nothing matches.
  - `type SearchArgs = { query?: string; sort?: "relevance" | "trending" | "newest" | "most_used" | "best_rated"; category?: string; tool?: string; limit?: number }`
  - `type ScoredPack = PackRow & RankingInputs & { score: number; owned: boolean; tools: string[] }` — `PackRow` and `RankingInputs` from `src/app/platform.ts`.
  - `searchRows(ctx: McpContext, args: SearchArgs): Promise<{ rows: ScoredPack[]; matched: number }>` in `shelf.ts` — `matched` is the count before `limit`, for the "N of M match" line the current tool already prints.

Weights: name 8, tags 5, tools 5, tagline 3, author 3, use cases 2, description 1. A whole-phrase hit scores above the sum of its words. `sort` defaults to `relevance` with a query and `trending` without; `trending` delegates to `rankPacks` with `RankingInputs` resolved exactly as the shelf does, including `ratingOf`'s visibility threshold. `limit` defaults to 20, max 50.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/mcp/relevance.test.ts
test("a name hit outranks a description hit", …)
test("the whole phrase outranks its separate words", …)
test("a declared tool name is matchable", …)   // tools: ["playwright"] matches "playwright"
test("no match scores zero", …)
```

```js
// tests/node/mcp-shelf.test.mjs
test("an empty query returns a bounded ranked page, not the whole table", …)
  // <= 20 lines; first line is the top-ranked pack, not the first row by id
test("a tool filter nothing declares returns nothing", …)
  // tool: "kling-v2" -> "Nothing in the catalog", not 68 packs
test("a pack in review is invisible by name and by exact slug", …)
```

- [ ] **Step 2: Run them and watch them fail** — `npx vitest run tests/mcp/relevance.test.ts` and `npm run test:integration`
- [ ] **Step 3: Implement `score` and `searchRows`, and rewrite the `search_packs` registration to use them**

The `tool` filter joins `pack_tools` and `pack_mcp_servers` on name. `category` matches a tag in `packs.tags`. Result lines carry name, slug, tagline, author, price, run count, rating-where-shown and `OWNED`.

- [ ] **Step 4: Run them and watch them pass**
- [ ] **Step 5: Commit** — `feat: a catalog you can actually search`

---

### Task 3: `pack_details`, widened

**Files:**
- Modify: `src/mcp/shelf.ts`
- Test: `tests/node/mcp-shelf.test.mjs`

**Interfaces:**
- Consumes: Task 1, Task 2's `searchRows` for the not-found message.
- Produces: `touches(pack: PackRow): Promise<string[]>` in `shelf.ts` — `permissionSummary`'s lines for one pack, with `tools` and `mcpServers` read from `pack_tools` and `pack_mcp_servers`, `web` from `P.packExtras(pack)` (`src/app/platform.ts:449`), and `policy` from the platform's destructive-policy setting.

Adds to the response: `description`, `use_cases`, `limitations`, `requirements`, the `touches` lines, the creator handle from `creators`, rating-where-shown from `ratingOf`, and `packStats`' runs, buyers and version. Drops the sentence promising instructions are unavailable — they are available now, from `load_pack`, and the response says so.

- [ ] **Step 1: Write the failing test**

```js
test("pack_details carries the listing, the permissions rail and the creator", async () => {
  const out = await callTool("pack_details", { slug: "senior-engineer" });
  for (const needle of ["Reads your code", "bash, write, edit", "runs", "version"])
    assert.match(out, new RegExp(needle));
});
test("pack_details points at load_pack and no longer refuses to reveal instructions", async () => {
  const out = await callTool("pack_details", { slug: "senior-engineer" });
  assert.match(out, /load_pack/);
  assert.doesNotMatch(out, /not available through any tool/);
});
```

- [ ] **Step 2: Run it and watch it fail** — `npm run test:integration`
- [ ] **Step 3: Implement `touches` and widen the `pack_details` registration**
- [ ] **Step 4: Run it and watch it pass**
- [ ] **Step 5: Commit** — `feat: an agent reading a pack page sees what a person sees`

---

### Task 4: `list_categories` and `get_popular`

**Files:**
- Modify: `src/mcp/shelf.ts`
- Test: `tests/node/mcp-shelf.test.mjs`

**Interfaces:**
- Consumes: Tasks 1-2.
- Produces: `categories(): Promise<Array<{ tag: string; packs: number }>>` in `shelf.ts`.

`list_categories` counts tags across `listed` packs only, ordered by count then name. `get_popular` takes `timeframe: "week" | "month" | "all_time"` (default `all_time`) and `limit` (default 10, max 50), ranks with `rankPacks`, and windows the run count by `runs.started_at` for the two bounded timeframes.

- [ ] **Step 1: Write the failing tests**

```js
test("categories count only listed packs", async () => {
  // a pack in review carrying tag "engineering" must not be counted
  const out = await callTool("list_categories", {});
  assert.match(out, /engineering · 1\b/);
});
test("get_popular week ignores a run from last month", async () => {
  // same pack, one run 40 days old
  assert.doesNotMatch(await callTool("get_popular", { timeframe: "week" }), /senior-engineer/);
  assert.match(await callTool("get_popular", { timeframe: "all_time" }), /senior-engineer/);
});
```

- [ ] **Step 2: Run them and watch them fail** — `npm run test:integration`
- [ ] **Step 3: Implement `categories` and register both tools**
- [ ] **Step 4: Run them and watch them pass**
- [ ] **Step 5: Commit** — `feat: browse by category, and by what people actually use`

---

### Task 5: `get_author`

**Files:**
- Modify: `src/mcp/shelf.ts`
- Test: `tests/node/mcp-shelf.test.mjs`

**Interfaces:**
- Consumes: Task 1; `creatorByHandle`, `creatorStats`, `creatorRating` from `src/app/creators.ts` and `src/app/social.ts`.
- Produces: nothing later tasks consume.

Takes `handle`. Returns the creator's name, blurb, links, `creatorStats`' packs/runs/orgs, `creatorRating`, and their `listed` packs one per line. An unknown handle is "no such creator".

- [ ] **Step 1: Write the failing test**

```js
test("get_author lists the creator's packs and their stats", async () => {
  const out = await callTool("get_author", { handle: seededCreatorHandle });
  assert.match(out, /senior-engineer/);
  assert.match(out, /\d+ packs?/);
});
test("an unknown handle is not found, not an empty profile", async () => {
  assert.match(await callTool("get_author", { handle: "nobody" }), /no such creator/i);
});
```

- [ ] **Step 2: Run it and watch it fail** — `npm run test:integration`
- [ ] **Step 3: Register `get_author`**
- [ ] **Step 4: Run it and watch it pass**
- [ ] **Step 5: Commit** — `feat: a creator is a person an agent can look up`

---

### Task 6: `find_tools` — the routing index

**Files:**
- Modify: `src/mcp/shelf.ts`
- Test: `tests/node/mcp-shelf.test.mjs`

**Interfaces:**
- Consumes: Tasks 1-2.
- Produces: `toolIndex(query?: string): Promise<Array<{ tool: string; kind: "tool" | "mcp"; packs: Array<{ slug: string; name: string }> }>>` in `shelf.ts`.

The spec's "use Kling surfaces the video editor" path. With no `query`, lists every distinct name in `pack_tools` and `pack_mcp_servers` across `listed` packs with the packs that declare each. With a `query`, matches tool names substring-insensitively and returns only those. Each line names the tool, how many packs declare it, and those packs. This is discovery only — nothing here runs or quotes a tool, per the spec's non-goal.

- [ ] **Step 1: Write the failing tests**

```js
test("find_tools names the packs that declare a tool", async () => {
  const out = await callTool("find_tools", { query: "bash" });
  assert.match(out, /bash/);
  assert.match(out, /senior-engineer/);
});
test("find_tools with no query lists the whole index", async () => {
  const out = await callTool("find_tools", {});
  for (const n of ["bash", "write", "edit"]) assert.match(out, new RegExp(n));
});
test("find_tools reaches MCP servers as well as tools", async () => {
  // a seeded pack declaring mcpServers: [{ name: "figma", url: … }]
  assert.match(await callTool("find_tools", { query: "figma" }), /figma/);
});
```

- [ ] **Step 2: Run them and watch them fail** — `npm run test:integration`
- [ ] **Step 3: Implement `toolIndex` and register `find_tools`**
- [ ] **Step 4: Run them and watch them pass**
- [ ] **Step 5: Commit** — `feat: find the worker by the tool you had in mind`

---

### Task 7: `load_pack` — hand out the instructions

**Files:**
- Modify: `src/mcp/acquire.ts`
- Modify: `src/packs/types.ts:25` (the comment that says instructions must never reach a buyer)
- Test: `tests/node/mcp-acquire.test.mjs`

**Interfaces:**
- Consumes: Task 1; `P.getPack`, `P.latestVersion`, `P.entitled`, `P.exportPack`, `Pay.buyWithPoints`.
- Produces: `loadPack(ctx: McpContext, slug: string): Promise<{ ok: true; markdown: string } | { ok: false; message: string }>` in `acquire.ts`.

Rules, in order: not `listed` → not found. Free → `Pay.buyWithPoints` with `pricePoints: 0`, which already calls `grant` and creates the entitlement row, then return `exportPack`'s markdown. Paid and entitled → return it. Paid and not entitled → refuse, naming `price(...)` and `buy_pack`, with **no** fragment of `instructions` in the message. The response states which version was served and whether a newer one exists, so the agent knows whether to reload.

- [ ] **Step 1: Write the failing tests**

```js
test("a free pack hands its instructions to any signed-in org", …)
  // and an entitlements row now exists for that org
test("a paid pack refuses a non-owner and leaks nothing", …)
  // response names the price and buy_pack; shares no 12-word run with instructions
test("a paid pack serves an owner", …)
test("a pack in review is not found", …)
```

- [ ] **Step 2: Run them and watch them fail** — `npm run test:integration`
- [ ] **Step 3: Implement `loadPack`, register `load_pack`, and rewrite the stale comment at `src/packs/types.ts:25`**
- [ ] **Step 4: Run them and watch them pass**
- [ ] **Step 5: Commit** — `feat: the pack arrives in the session that asked for it`

---

### Task 8: `buy_pack` — the echoed price

**Files:**
- Modify: `src/mcp/acquire.ts`
- Test: `tests/node/mcp-acquire.test.mjs`

**Interfaces:**
- Consumes: Task 7's `loadPack`; `pricePoints` and `buyWithPoints` from `src/billing/purchases.ts`, `balanceMillipoints` from `src/billing/points.ts`.
- Produces: `buyPack(ctx: McpContext, args: { slug: string; agreed_price_points: number; confirm: true }): Promise<string>` in `acquire.ts`.

The server cannot know what the agent told its user, so the enforceable version is an echo it validates: `agreed_price_points` must equal the live `Pay.pricePoints(pack)` or the call is refused and restates the live price. `confirm` must be `true`. Insufficient balance refuses with the `${ctx.baseUrl}/ledger/topup` link. On success, grant and return the same payload `load_pack` would.

- [ ] **Step 1: Write the failing tests**

```js
test("a stale agreed price is refused and restated", …)
  // and no purchases row was written
test("too little balance refuses with the top-up link and grants nothing", …)
test("an agreed price and confirm buys once and hands the pack over", …)
test("buying the same pack twice does not charge twice", …)
```

- [ ] **Step 2: Run them and watch them fail** — `npm run test:integration`
- [ ] **Step 3: Implement `buyPack` and register `buy_pack`**
- [ ] **Step 4: Run them and watch them pass**
- [ ] **Step 5: Commit** — `feat: buying a worker without leaving the session`

---

### Task 9: `my_balance`, `top_up`, and a library that knows it is behind

**Files:**
- Modify: `src/mcp/acquire.ts`
- Test: `tests/node/mcp-acquire.test.mjs`

**Interfaces:**
- Consumes: Task 1; `balanceMillipoints` from `src/billing/points.ts`, `P.latestVersion`.
- Produces: nothing later tasks consume.

`my_balance` reports the org's points with `pts()` and its recent ledger lines. `top_up` takes `amount_points` and returns the `${ctx.baseUrl}/ledger/topup` link — the server never charges, matching the spec. `my_library` gains a `· behind latest (version N)` marker per row by comparing the entitled version to `P.latestVersion`.

- [ ] **Step 1: Write the failing tests**

```js
test("my_balance reports points, not dollars", async () => {
  const out = await callTool("my_balance", {});
  assert.doesNotMatch(out, /\$/);
});
test("top_up returns a link and charges nothing", async () => {
  const before = await balanceMillipoints(orgId);
  assert.match(await callTool("top_up", { amount_points: 500 }), /\/ledger\/topup/);
  assert.equal(await balanceMillipoints(orgId), before);
});
test("my_library marks a row whose pack has a newer version", async () => {
  // org entitled at v1; author publishes v2
  assert.match(await callTool("my_library", {}), /behind latest \(version 2\)/);
});
```

- [ ] **Step 2: Run them and watch them fail** — `npm run test:integration`
- [ ] **Step 3: Register `my_balance` and `top_up`, and widen `my_library`**
- [ ] **Step 4: Run them and watch them pass**
- [ ] **Step 5: Commit** — `feat: what you can spend, and what you are owed an update on`

---

### Task 10: `reason` everywhere, and the tool descriptions

**Files:**
- Modify: `src/mcp/shelf.ts`, `src/mcp/acquire.ts`, `src/mcp/server.ts`
- Test: `tests/node/mcp-acquire.test.mjs`

**Interfaces:**
- Consumes: Task 1's `REASON` and `text`.
- Produces: nothing.

Spread `REASON` into every tool's `inputSchema` including the three run tools, and pass it through every `text(...)`. Then re-read every tool description against what the tools now do: `pack_details` no longer refuses to reveal instructions, `install_pack` no longer sends a buyer to a browser, and the module header comment in `server.ts` no longer says nothing here charges money.

- [ ] **Step 1: Write the failing test**

```js
test("every registered tool accepts a reason and echoes it", …)
  // iterate the tools/list response; call each read-only tool with reason
test("no tool description tells a buyer to finish in a browser except top_up", …)
```

- [ ] **Step 2: Run it and watch it fail** — `npm run test:integration`
- [ ] **Step 3: Add `REASON` to every registration and rewrite the stale descriptions**
- [ ] **Step 4: Run it and watch it pass**
- [ ] **Step 5: Commit** — `feat: every call says why, and no description lies about the browser`
