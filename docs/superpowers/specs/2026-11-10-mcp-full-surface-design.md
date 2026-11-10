# The marketplace, fully, as an MCP server

Design document — 2026-11-10
**Status:** blocked, waiting on `2026-11-10-marketplace-listing-parity.md`, which is
in development as of 2026-11-10. Do not start this work until that plan lands.

## Intent

Today our MCP server is a shop window with the door locked. Seven tools let an
agent browse the catalog, see what the organisation owns, pull a pack it has
already bought, and read transcripts of runs someone started on the website.
Every path that would actually do something ends in a URL:
`${ctx.baseUrl}/packs/${slug}`. The header comment in `src/mcp/server.ts` says
so plainly — "nothing here charges money, because a card flow needs a browser."

That was the right call for release one. It is now the thing holding the product
back. An agent that finds exactly the right worker has to hand its user off to a
browser, and the session — the context, the task, the reason it was looking —
dies there.

This document describes the whole marketplace over MCP: find a worker, see what
it touches, pay for it, get it, use it, rate it; and from the other side, write
a pack and publish it, all without leaving the agent.

The benchmark is Agensi (`mcp.agensi.io`), which exposes 24 tools and runs its
entire business through them. We are not cloning it. Two of its design choices
we deliberately invert, and one of its subsystems we deliberately do not build.
Both are recorded below.

## Why now

68 packs shipped. To a search engine they are nearly identical: the same three
declared tools (`bash`, `write`, `edit`), overlapping taglines, most of them
some variation of "make it look like X". Our search is a substring match over
name, tagline and author — it cannot find "code review" when the pack says
"audits", and it returns all 68 for an empty-ish query. The catalog has outgrown
its front door.

## Goals

- An agent can complete the buyer's journey end to end without a browser:
  discover, inspect, pay, load, use, rate.
- An author can publish and update a pack from inside their own agent.
- A worker can be found by what it *can do*, not by the words in its tagline —
  including by the name of a tool the user already has in mind.
- Parity of capability with Agensi's 24 tools, minus what we decided not to
  build, plus what only we can offer (runs on our infrastructure, with the
  receipt).

## Non-goals

- A tool/inference brokerage. We do not hold Kling, Replicate, ElevenLabs or
  search-scraper keys, and we are not going to quote, hold, settle and refund
  third-party inference calls. **Daniel's decision:** "we dont have tools
  currently but agent know how to use the tools anyway." A pack's declared tools
  are metadata for discovery and routing; the buyer's agent supplies the tools.
- Replacing the website. The browser stays the richer surface — this is parity
  of *capability*, not of presentation.
- Changing how runs execute. `src/runtime/run.ts` is unchanged by this work.

## Anti-goals

Things that would make this a failure even if every tool shipped and worked:

- **An agent spending points the user did not agree to.** Every charge —
  buying a pack, starting a run — is confirmed against a price the agent stated
  first. No exceptions, no "the user clearly wanted it".
- **A capability block that lies.** `uses: [kling-v2]` on a pack that never
  touches Kling is worse than no capability data, because it poisons exactly the
  search we are building. Derived blocks are proposals until a human approves
  them.
- **Leaking a paid author's instructions.** Free is free; paid stays paid. A
  bug here is not a bug, it is a breach of the deal we made with authors.
- **A 27-tool surface an agent cannot navigate.** If the model cannot tell
  which tool to call, we have built a worse product than the seven we have.

## Decisions already made

Marked by who made them.

### Execution: hand out the instructions (Daniel)

Over MCP, loading a pack returns its instructions and the agent does the work
in its own session with its own tokens. This is Agensi's model and it is now
ours *for the MCP surface*.

This ends an invariant currently written into the code, in two places:

- `src/packs/types.ts:28` — instructions are "The expertise. This is the
  product and must never reach a buyer verbatim."
- `pack_details`' own tool description — "Never returns the pack's instructions
  — those are the author's property and are not available through any tool."

Both sentences must change. Note `export_pack` already crossed this line for
owners, so the machinery and the licence-notice wrapper exist
(`exportPack`, `src/app/platform.ts:1023`).

### Who gets instructions for free (Daniel)

> "whats free is free, what costs points is agents that cost, and their run
> time if they run it on our servers"

- **Free pack** → instructions to any signed-in agent, no entitlement needed.
  All 68 shipped packs are free, so the shipped catalog's instructions become
  readable by anyone with an account. This is accepted, not overlooked.
- **Paid pack** → costs points. Entitlement required, settled through
  `Pay.buyWithPoints` (already does the whole job, `src/app/server.ts:208`).

### Running on our servers stays available, and explicit (Daniel)

> "which is an option on the UI or even in the MCP but needs to be explicit"

A second, opt-in path: the pack runs on our infrastructure, our key, metered
into `list_cost_cents` as it is today, billed as runtime. It must never be what
happens by default or by inference — the agent asks for it, by name, and the
user has agreed to the cost.

This makes our existing `list_runs` and `run_trace` meaningful over MCP for the
first time: today they read the history of runs started on the website.

### Capabilities get derived for the existing catalog (Daniel)

A pass reads each of the 68 packs' instructions and proposes a capability block;
Daniel approves before anything lands. New packs declare their own.

### Capability vocabulary (proposed by me, Daniel approved the shape)

Added to `PackDefinition` (`src/packs/types.ts`):

```yaml
capabilities:
  reads:   [your files, github.com]
  writes:  [your files, shell]
  needs:   [a repo]
  uses:    [kling-v2, figma-mcp]
```

- `reads` / `writes` / `needs` are a small controlled vocabulary in a buyer's
  words, not `agent_toolset_20260401`. They are what a buyer sees before
  loading, and they are the honest answer to "what will this thing touch".
- `uses` is the routing key: named tools, so "use Kling" resolves to the video
  editor. It also warns an agent that a pack will reach for something it may
  not have.

This block does **not** get its own table. Listing-parity's Task 4 ("Per-pack
tools, persisted") already creates `pack_tools` and `pack_mcp_servers`, and its
Task 13 is the derivation pass over the 68 packs. The capability vocabulary is an
extension of those tables, not a parallel structure beside them — plus a
provenance column, because a block that distinguishes *declared* from *derived*
from *approved* is the only version of the lying-block anti-goal that can be
enforced.

Note what Task 4 is actually fixing, because it changes what the derivation pass
has to do: `src/packs/import.ts` lists `tools` in `KNOWN` and never parses it, and
`mcpServers` reaches `PackInput` with no INSERT or UPDATE behind it. The `tools:`
and `permission_policy:` blocks in all 68 `agent.md` files are **discarded at
import today**. Once Task 4 keeps them, a good deal of the capability data is
simply read rather than inferred, and the model-driven pass is only needed for
`needs:` and for tools the instructions imply but the frontmatter never declared.

The type has more unfilled room next door — `anthropicSkills`,
`web.allowedDomains`, `destructivePolicy`, `PackTool.spending` — which the
derivation pass should populate where the instructions imply them.

## Constraints

- **Stateless MCP.** A fresh server and transport per request
  (`handleMcpRequest`), deliberately, so no per-connection state can leak
  between organisations. Anything new must hold no cross-request state.
- **Org-scoped everything.** `McpContext` is `{ orgId, userId, baseUrl }`.
  `run_trace` already models the rule: another organisation's run is reported
  as simply not found, because confirming it exists leaks.
- **One currency.** Points. `src/billing/points.ts`, `fmt()` for display.
  Do not introduce a second unit or a dollar path.
- **Existing publishing pipeline.** Statuses draft → review → listed, via
  `Au.createPack` / `updatePack` / `setStatus` / `myPacks` / `submittedPacks`,
  with a curator queue at `/curate` gated to the platform org. `POST /api/packs`
  already accepts a whole folder as JSON and its comment says it was built to
  work "from the browser, the CLI and an agent." Wrap this; do not rebuild it.
- **Version pinning (my call).** Ours pins a buyer to the version they bought
  — `platform.ts:1033`, "a buyer gets what they bought, even after the author
  ships a newer version." Agensi tells agents the opposite: never cache, reload
  every time. We keep pinning for paid packs and serve latest for free ones,
  and we say which in the response so the agent knows whether to reload.

## The tool surface

27 tools in six groups. Each line names the existing function it wraps, or NEW.

**Discovery**
- `search_packs` — rewrite. Field-weighted relevance, typo tolerance, sort
  (relevance / trending / newest / most_used / best_rated), filter by category
  or tag, filter by capability. Returns the `touches:` summary per result.
- `pack_details` — extend with capabilities, rating, version, changelog.
- `list_categories` — NEW. Tags, grouped and counted.
- `get_popular` — NEW. Timeframe week / month / all time.
- `get_author` — NEW. Profile and their packs.
- `find_tools` — NEW. The capability index: which workers use a named tool.
  This is the "use Kling → video editor" path, and the only survivor of
  Agensi's six brokerage tools.

**Library and loading**
- `my_library` — keep. Add whether a pinned version is behind latest.
- `load_pack` — NEW. Hands out instructions. Free: any signed-in agent. Paid:
  entitlement required, with the price and the buy path in the refusal.
- `export_pack` — keep. The whole folder tree, for running elsewhere.
- `buy_pack` — NEW. `Pay.buyWithPoints`, `confirm: true`, agent states the
  price first.

**Money**
- `my_balance` — NEW. Points balance and recent activity.
- `top_up` — NEW. Returns the `/ledger/topup` link; the agent never charges.

**Running here (explicit)**
- `run_pack` — NEW. `P.startRun`. Opt-in, priced, confirmed.
- `list_runs`, `run_trace` — keep.
- `run_control` — NEW. Message, decide an approval, raise the budget, end a run
  (routes exist: `msgMatch`, `decMatch`, `topMatch`, `endMatch`).

**Authoring**
- `author_status` — NEW. May this account publish; payout readiness.
- `my_packs` — NEW. `Au.myPacks` with status, uses, rejection reason.
- `submit_pack` — NEW. Files in, draft preview and `draft_id`, then
  `confirm: true` to submit for review. Wraps `Au.createPack` + the JSON upload.
- `update_pack` — NEW. New version plus changelog; live version keeps serving
  until approved.
- `set_pack_capabilities` — NEW. Takes effect immediately, like listing text,
  without re-review.
- `upload_pack_media` — NEW. Logo, screenshots, demo video.
- `edit_changelog` — NEW. Text only, no re-review.

**Feedback**
- `rate_pack` — NEW. The user's stars and words, published under their display
  name. The agent must say so before calling, and must never invent a rating.
- `pack_feedback` — NEW. The agent's own one-line outcome report
  (worked / partly / didn't work). Builds a quality signal without asking the
  user. Must carry nothing from the user's task.

**Demand**
- `list_pack_requests`, `submit_pack_request` — NEW. A failed search becomes a
  lead for authors instead of being thrown away.

**Cross-cutting**
- `reason` on every tool: one short sentence, surfaced to the user, so the
  server narrates why it is being called. Copied from Agensi, cheap, and it is
  most of why their server feels trustworthy.

## Dependency on listing-parity

This design is **second**. `docs/superpowers/plans/2026-11-10-marketplace-listing-parity.md`
builds the data this one reads, and `src/app/db.ts` migrations are append-only and
applied once, so two plans inventing overlapping tables is the expensive kind of
mistake. Specifically, it provides:

| Its task | What it creates | What of mine reads it |
|---|---|---|
| 1, 2 | listing columns, listing module | `pack_details`, `search_packs` |
| 4 | `pack_tools`, `pack_mcp_servers` | `find_tools`, the capability block |
| 6, 8 | `creators`, profile page | `get_author` |
| 9, 10, 11 | ratings, reviews, votes, shelf order | `rate_pack`, `get_popular`, sort modes |
| 13 | the generator and backfill over 68 packs | the capability derivation pass |
| 15 | `pack_changelog` | `edit_changelog`, `update_pack` |

**Its Task 16 ("The MCP catalog catches up") is absorbed into this document and
should be dropped from that plan.** It widens `packLine` and `pack_details`, which
this design rewrites wholesale.

## New storage

Only what listing-parity does not already create: pack requests (the demand
board), the agent's own feedback reports, and provenance on the capability block.
Everything else is a read. Schema is the builder's call; follow `src/app/db.ts`
and `sql.ts` conventions, and append — never edit an existing migration entry.

## Open questions for Daniel

Raised by the builder check, still unanswered, recorded so they are not lost.
They do not block listing-parity; they block this.

1. **Rating eligibility.** Listing-parity requires a completed non-trial run to
   rate, bylined by **org** rather than display name. The MCP journey hands out
   instructions and never creates a run here, so nobody who used a pack via MCP
   could ever rate it and `best_rated` sorts on almost nothing. Does loading a
   pack confer eligibility?
2. **Trials over MCP.** Listing-parity calls the trial "the single strongest
   thing we offer." Is it reachable through `run_pack` for an unowned paid pack,
   and who confirms that metered spend?
3. **Authentication.** `/mcp` takes a bearer token minted at `/tokens` in a
   browser (`A.orgFromApiToken`, `src/app/server.ts:994`). There is no OAuth and
   no dynamic client registration anywhere in `src/`, so most consumer MCP clients
   cannot add this server by signing in, and "end to end without a browser" starts
   with a browser. Is OAuth in scope, or is a pasted token the accepted door?
4. **Who may publish from an agent.** There is no author-eligibility concept to
   wrap: `POST /api/packs` is `ownerOnly()`, roles are only `owner | member`, and
   moderation tooling is an explicit non-goal of listing-parity. Any owner token
   into the curator queue, or Daniel only for now?
5. **`submit_pack` costs real money per attempt.** `setStatus(…, 'review')`
   refuses without a version, so submit must call `publishPack` first — which
   uploads skills, subagents and mounts to the Anthropic runtime. Every
   draft-preview cycle becomes a real external publish. Accepted, or does review
   happen before runtime publish?
6. **Upgrade pricing.** `upgrade_points` is on every pack and nothing charges it.
   Does `buy_pack` on a pack owned at v1 charge full price or the upgrade, and is
   upgrading its own tool? Related: the pinning rule is a comment, not code —
   `exportPack` resolves `latestVersion` then authorizes against *that*, so an org
   pinned to v1 is refused outright once v2 publishes rather than served v1.
7. **Media storage.** `render.yaml` provisions one web service and Postgres — no
   object store, no persistent disk. `packs.image` is a filename under
   `public/assets` committed to the repo. Postgres bytea, a bucket we pay for, or
   the runtime's file API? And base64 inline in a tool argument does not work for
   a demo video either way. This gates `upload_pack_media` entirely.

## Left to the builder

- Relevance scoring algorithm and whether it lives in SQL or TypeScript.
- All schema and migrations.
- Exact controlled vocabulary for `reads` / `writes` / `needs`, proposed from
  what the derivation pass actually finds, then approved.
- How the derivation pass runs (script under `scripts/`, output for review) and
  how approval is recorded.
- Tool grouping and description wording that keeps 27 tools navigable — the
  anti-goal above is a real risk and is the builder's problem to solve.
- Whether `load_pack` subsumes `export_pack` or they stay separate.
- Test strategy, following the existing split: `vitest` unit, `node --test`
  integration, and `scripts/judge.mjs`.
- Whether `run_pack` blocks or returns a `run_id` to poll. `P.startRun`
  (`platform.ts:557`) only creates a session; the work is `sendTurn`, which the web
  fires and forgets while the browser watches SSE. MCP has one request and no
  stream, so polling is the likely answer — in which case `run_trace` must also
  surface pending approvals (`openAsks`, `platform.ts:689`, exposed nowhere today),
  or a run blocked on a hook sits invisible.
- A tool for fetching what a run produced. `runOutputs` and `downloadOutput`
  (`platform.ts:818`, `:847`) exist and appear in neither the current 7 tools nor
  the 27 proposed above, so "runs on our infrastructure, with the receipt"
  currently ends with files the agent cannot retrieve.
