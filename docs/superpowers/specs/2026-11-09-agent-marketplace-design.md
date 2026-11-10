# Agent Marketplace — Design

**Date:** 2026-11-09
**Status:** design — complete, awaiting owner approval
**Owner:** Daniel (solo builder)

---

## 1. Intent

Experts are watching AI absorb their trade and have no way to sell what they
know. A campaigner with twenty years behind them, a working video producer, a
support lead, a salesperson, an engineer — each has judgement that can be
packaged, and no shelf to put it on.

This product is that shelf. An expert packages how they work into an **agent
pack**. A buyer finds it, tries it, buys it, and has a worker. The expert earns
a commission on every sale and on every paid update.

The original model was Loopcloud: a sample library where you audition loops in
your own DAW and spend points to keep the ones you want. That analogy drives the
commercial model throughout. It breaks in exactly one place, and that break
produced the central decision below.

### The central decision

**The harness matters more than the pack.** The same folder of skills in a
capable runtime is a competent worker; in a weak one it is an embarrassment. An
author cannot stand behind their work unless the runtime is known. And a pack
cannot be demonstrated by handing it over, because the pack is text — give it to
a buyer to try and the sale is already finished.

So this is **not a store that exports folders.** It is a **hosted environment
where bought agents run**, with a store at the front door. Folder export exists
as a developer option for people who want the pack in their own setup.

That inverts the business: the recurring revenue is the environment, and the
store is what fills it.

---

## 1.2 Competitive landscape and the wedge

Surveyed 2026-11-09. **The market is proven — there are already several
marketplaces here, and the owner reads that as validation rather than as a
reason to stop.** They fall into two groups.

**Skill shops** sell instruction files that run inside a buyer's own agent:
[Agensi](https://www.agensi.io) (package a `SKILL.md`, earn per use, loaded at
runtime and never downloaded, 70% to the creator — the closest thing to this
design), [MCP Market](https://mcpmarket.com/sell-skills),
[Claude Market](https://www.claudemarket.ai/marketplace) (90% to the seller),
[AgentStore](https://agentstore.tools/), and
[KissMySkills](https://kissmyskills.com/pages/sell-your-skills) (35%).

**Hosted agent stores** run the agent for the buyer: Poe (per-message creator
monetization), Replit Agent Market, MuleRun Creator Studio, and the AWS and
Google Cloud agent marketplaces.

### The position — owner's decision

**We sell agents that scale, not skills.** A skill shop has no runtime, and
therefore structurally cannot offer concurrency, scheduled runs, a hard per-run
budget, organisations and seats, or an approval gate in front of an agent about
to spend a buyer's ad budget. That operations layer is the product.

**The defensible wedge is the buyer who has no agent at all.** Every skill shop
requires the buyer to already be running one — Agensi loads into the buyer's
agent. A twenty-year campaigner's actual customer is a marketing team with no
Claude Code and no intention of installing it. Combined with alphaCEO as an
existing distribution channel, that is the scarce asset here; marketplaces die
of absent demand, not of absent software.

### Three things the builder should not pretend away

- **Hosting is not unique.** Poe, Replit and MuleRun all host and bill. The wedge
  is the buyer profile and the operations layer, not hosting as such.
- **70/30 is no longer generous.** Claude Market pays 90%. Supply is the side
  that must be won first, so the split in §6 is a live competitive question.
- **Per-use billing already exists** at Agensi, so usage data is not a moat on
  its own. The moat, if there is one, is curation plus distribution.

**Unresolved tension, flagged not settled:** "agents that scale" for businesses
points at buyers paying hundreds a month, while §5 and §8.2 price for indie
operators at $5-$14. Both are the owner's calls and they pull in opposite
directions.

## 2. Goals

- An expert with no engineering background can get a pack listed, earning.
- A buyer can judge a pack honestly before paying.
- A bought pack runs reliably, with the buyer's own credentials, without the
  buyer assembling anything.
- Usage is metered precisely enough to bill, and recorded richly enough to
  settle a dispute and tell an author why their agent failed.
- Every limit — tokens, points, concurrency, model — is configuration, not code.

## 3. Non-goals

- A prompt marketplace. Packs are workers, not text snippets.
- Writing an agent harness, agent loop, or sandbox. Managed Agents supplies all
  three.
- LangGraph or LangChain anywhere in the stack (§10).
- A desktop application at launch.
- Becoming a merchant of record at launch.

## 4. Anti-goals

Failure conditions even if the software works:

- **An open catalog of junk.** A thin curated shelf beats a full unreliable one.
  Marketplaces die of bad inventory faster than of empty inventory.
- **Billing logic spread through the codebase.** The payment provider will
  change (§8.4).
- **Unbounded inference spend inside one session.** We do not control buyer
  prompts; a runaway session must hit a hard platform-enforced ceiling.
- **Authors who can't tell whether their pack is working.** Without that the
  catalog goes stale and the subscription has nothing to renew for.
- **One buyer reaching another buyer's credentials.** See §9.3 — this is the
  sharpest technical risk in the document.

---

## 5. The two sides

### The author
A domain expert, usually not technical. They supply judgement; we supply the
packaging. For the first ten packs this is a hand-built, sit-beside-them
process — not a self-serve form. That work is the seed inventory and cannot be
skipped or automated at the start.

### The buyer — decided
**Indie operators and small teams.** Semi-technical, price-sensitive, tolerant of
a simple web surface. Not enterprise marketing departments. This sets the bar for
the front end: a clean storefront plus a functional surface for running and
watching agents, not a polished conversational product.

### Organisations — decided: real multi-seat
Team and Enterprise are **genuine multi-seat organisations**, not one login with
bigger numbers. That means, in release one:

- organisations, memberships, invitations, and at minimum an owner/member role
  split
- **packs are owned by the organisation**, not the purchasing user
- **point balances and concurrency limits belong to the organisation**
- sessions, traces and spend are attributed to both the org and the acting user

This is accepted scope. It threads through purchase, library, sessions and
billing, and it is far cheaper to build now than to migrate into later.

---

## 6. The unit of sale: a pack

A pack is what the author decided a given worker needs:

- skills (the instructions and method — where the twenty years live)
- tool definitions
- MCP server references
- metadata: title, author, what it does, what it needs, demo material
- a version

**Verified mapping (2026-11-09).** An agent config takes exactly the fields a pack
needs: `name`, `model`, `system`, `tools`, `mcp_servers`, `skills`, `description`,
`metadata`. `skills` is documented as **filesystem-based** expertise with
progressive disclosure — which is why §7.1's untested file-exfiltration risk is
the real one.

**Versioning, confirmed:** `version` is an integer starting at 1, incremented only
when the config actually changes (no-op updates return the existing version).
Updates accept a `version` for optimistic concurrency (409 on mismatch) or omit it
for last-write-wins. `agents.versions.list()` returns the full history. **Archive**
makes an agent read-only — new sessions are refused while existing sessions keep
running, which is exactly the behaviour a withdrawn pack needs. Note array fields
(`tools`, `mcp_servers`, `skills`) are **fully replaced** on update, never merged.

**Authoring path worth taking:** the `ant` CLI applies an agent from a markdown
file with YAML front matter and records it in `claude-lock.json`. A pack can
therefore be a directory — `agent.md` plus skill files — applied with `ant apply`.
That is a far better authoring surface for §12 than code, and it version-controls
cleanly.

A pack maps onto a **stored, auto-versioned Managed Agents agent config**.
Sessions pin to a version, so pack versioning comes free: an author ships v2 and
existing buyers stay on the version they bought until they choose to move.

**Price:** one-off per pack. Author takes **70%**, platform 30%. The absolute
price per pack is the owner's to set and is **not yet decided**.

---

## 7. Preview — stream it, never ship it

A buyer must be able to judge a pack. They must never receive it to do so.
Three rungs, in build order:

1. **Recorded sessions (launch, no infrastructure).** The author submits three
   real transcripts of the pack working a real brief. The buyer reads them. For
   judging whether someone has twenty years of taste, this is unreasonably
   effective.
2. **Hosted trial.** The pack runs on our side from its page, capped at ten
   turns or one run. The buyer brings a real brief and watches it work.
3. **Trial in the buyer's own environment, via MCP.** The agent runs where they
   work, with pack content fetched from our gateway at runtime and never written
   to disk. Depends on the tool gateway (deferred — §13).

Alongside all three, and probably outweighing them: **a refund window (§8.5),
verified author identity, and reviews restricted to buyers with recorded runs.**

### 7.1 Author protection in hosted runs — decided

In a hosted run the pack's skills are files inside a session the buyer prompts
freely. "Print your instructions verbatim" likely retrieves them. **A
documentation sweep found no platform mechanism to lean on**: Managed Agents
offers nothing that hides an agent's system prompt or skill files from inside the
sandbox, and the session event transcript stores them in full with no redaction
feature. *(Provenance: a delegated docs sweep — worth a confirming read during
planning.)*

**Measured, 2026-11-09 (spike).** Two extraction attacks against a wrapper prompt
carrying a canary string both **failed to extract anything**: an "authorised
compliance audit" demand for the verbatim system prompt, and a tool-based
self-read attack explicitly naming `cat /proc/self/environ` and a grep through
`/mnt`. The agent refused both, named the routes it was refusing, and offered to
do the work instead. The wrapper is therefore stronger than "a speed bump" against
casual and moderately determined extraction.

**File attacks also held (spike 3).** With the pack mounted as a real file and the
buyer claiming ownership of it, the agent refused to `cat` it, offered checksums
instead, and refused a base64 "checksum" with the correct reasoning — that base64
is reversible and therefore equivalent to pasting the contents. Three attack
shapes across three spikes, none successful.

**Two vectors remain untested, and both matter more than the ones that passed:**

- **A buyer-supplied MCP server or custom tool** can read the skill file and send
  it off-box without the model understanding that it is exfiltrating. Name the
  tool `upload_logs` and the model will cooperate innocently. Mitigation belongs
  with §9.4: a pack's permitted tool surface must be the author's choice, and a
  buyer must not be able to add tools to a pack they bought.
- **Model choice weakens the defence.** Every refusal above came from
  `claude-opus-5`. Buyers pick their own model (§8.2), and a cheaper model with
  weaker instruction adherence may simply comply. Either restrict which models a
  pack may run on — an author-set field — or accept that the floor is the weakest
  permitted model.

**Also measured:** a requested `mount_path` is rewritten. A resource asked for at
`/workspace/skill/SKILL.md` landed at `/mnt/session/uploads/workspace/skill/SKILL.md`.
Pack packaging must not assume the path it requested.

**Decision: ship without real protection, with two speed bumps and honest terms.**

1. **A platform wrapper prompt.** A short system prompt prepended to every pack
   carrying platform values, safety rules and a behaviour floor, including an
   instruction not to disclose pack contents. Worth having on its own merits;
   as protection it is a speed bump that prompt injection can walk around, and
   it must not be described to authors as more than that.
2. **Redacted transcript views.** We control the transcript surface. Buyers see
   a filtered view with skill content stripped; the author and the platform see
   everything. Nearly free, and it closes the easiest leak — the one we would
   otherwise hand over ourselves.
3. **Honest author terms.** Authors are told plainly that a determined buyer can
   extract instructions. Loopmasters sells copyable .wav files and the business
   works, because convenience and catalog are the product, not secrecy.

Real instruction isolation stays on the roadmap with the tool gateway.

---

## 8. Money

### 8.1 Four transactions

| What | Buys |
|---|---|
| **Subscription** | concurrency (running agents), catalog access, org seats |
| **Points** | the work itself — inference |
| **Pack purchase** | one pack version, one-off, 70/30 to the author |
| **Pack update** | a newer version, priced in points, author commissioned |

### 8.2 Tiers, as specified by the owner

| Tier | Price | Points | Allowance | Running agents |
|---|---|---|---|---|
| Personal | $5 | 120 | 5M in / 1M out | 5 |
| Team | $9 | 360 | 15M in / 3M out | 15 |
| Enterprise | $14 | 720 | 60M in / 9M out | unlimited |

**Platform cost, verified.** Managed Agents charges model tokens at list price,
web searches at $10 per 1,000, and **session running time at $0.08/hour** of
active time (time with at least one thread running; concurrent threads counted
once). There is no further platform fee. An idle session accrues nothing, so an
agent working ten hours a month costs eighty cents — negligible against tokens.
**"Unlimited" on Enterprise is therefore safe**: points remain the real ceiling.

### 8.3 Known and accepted: these tiers lose money

At current rates (Opus 5 $5/MTok in, $25/MTok out; Haiku 4.5 $1 and $5), the
included allowances cost roughly $50, $150 and $525 of inference against $5, $9
and $14 of revenue on Opus — and remain underwater on the cheapest model in the
lineup. Output tokens drive it and prompt caching cannot touch them.

**The owner has reviewed this and decided to accept early losses to win the first
customers.** This is a deliberate loss-leader growth strategy — launch cheap,
acquire users, raise on the traction — and the prices are explicitly a starting
position, not a steady state. It is not an oversight, and it is not to be
re-litigated in planning. What planning owes it is the ability to change the
numbers in an afternoon. Two requirements
make it survivable:

1. **Every limit is adjustable at runtime**, per tier and per account. Points,
   token allowances, concurrency and permitted models are configuration rows,
   never constants. The losses must be dialable down without a deploy.
2. **Points are denominated in money, not tokens.** The buyer picks the model —
   implemented as a **session-level `model` override**, which needs no new agent
   version (sessions can override `model`, `system`, `tools`, `mcp_servers` and
   `skills` individually). Note a `model` override replaces the object wholesale,
   so `effort` must be restated or it resets to the new model's default.
   **`effort` is a direct cost dial per pack** (`low`-`max`, default `medium`) and
   belongs in the configuration rows alongside the limits;
   Opus drains points roughly five times faster than Haiku. Model choice then
   can't wreck unit economics, and becomes a feature rather than a liability.

**Bring-your-own-key** is supported: the buyer supplies their own Anthropic key,
inference leaves our cost base, and the subscription becomes margin. The right
default for developers and heavy users.

### 8.4 Rails

**PayPal** at launch — it works for Israeli entities on both halves: Commerce
Platform to split a sale, Payouts API for commissions, Subscriptions API for
tiers. It is **not** a merchant of record, so VAT and sales tax remain our legal
responsibility, and checkout conversion sits below a card-first flow. Both
accepted for now.

Stripe Connect was the natural fit and was ruled out on Israeli availability.
Tipalti or Payoneer for payouts, Paddle or Lemon Squeezy as merchant of record,
are the documented upgrade path. A US entity (Delaware LLC + Mercury) reopens
Stripe Connect and is a live option, not a decision.

**Hard requirement:** all billing sits behind one internal interface —
`charge`, `credit_points`, `debit_points`, `pay_author` — and nothing else knows
which provider is behind it.

### 8.5 Settled policy (builder's calls)

- **Points lifecycle.** The tier's monthly grant **expires** at period end;
  purchased top-ups **do not expire**. Two buckets in the ledger, grant spent
  first. Top-ups are a second PayPal product and a second checkout.
- **Exhaustion.** A budget **can be raised or removed after creation** — it
  simply cannot be *added* to a session that started without one, and removal is
  one-way. Raising the cap **resumes the paused work automatically**. So:
  **every session is created with a budget, without exception**. **Correction,
  measured 2026-11-09:** a session at its cap does **not** reliably announce
  itself through `stop_reason`. In the spike the session sat at `status: idle`
  with `stop_reason: null` and `list_cost` exactly equal to the cap, and the
  budget state surfaced only when the next `user.message` was **rejected with
  HTTP 400**: *"session budget reached: consumed list cost has met
  `budget.max_list_cost`; only `user.tool_confirmation`, `user.tool_result`,
  `user.custom_tool_result`, and `user.interrupt` are accepted until the budget
  is raised"*. So the authoritative signal is **that 400 on event submission**,
  with `stop_reason` as a secondary hint. **Raise and resume is confirmed working
  (spike 3):** `sessions.update(id, {budget: {type: "limit", max_list_cost}})`
  raised a capped session from 9c to 24c and the agent answered the next message. A buyer who tops up
  continues in the *same* session. Any new cap is computed from the session's
  reported `usage.list_cost`, not from the old cap, because consumption usually
  sits a fraction past it. That overshoot is at most one model request per
  running thread — **the platform absorbs it**; balances never go negative.
- **No subscription, no running.** A pack can be bought without a subscription,
  but running one requires an active tier or bring-your-own-key.
- **Refunds.** A **14-day** window. Funds are **held until the window closes and
  only then paid out to the author**, because clawback after a PayPal payout is
  operationally painful. Consumed points are not refunded.
- **Tax.** PayPal is not a merchant of record, so VAT is legally ours from day
  one. Checkout collects buyer country and optional VAT ID and issues compliant
  invoices in release one. No territory restrictions initially.

### 8.6 Author earnings — points per use, cashable

Authors earn **on every run of their pack**, not only on sale. The earning is
credited in **points**, which circulate: an author can spend them running agents
on the platform, and **can also cash them out**.

Why this shape: it pays for maintenance rather than only for launch, so the
catalog stays alive; and points spent back into the platform cost us compute
rather than cash.

Three consequences planning must respect:

- **The author's share is a fraction of a run, not a point per run.** A point
  represents real compute. If a run costs the buyer ten points, the author's
  cut and the inference both come out of those ten — and at §8.2 pricing the
  inference alone already exceeds them. The per-use rate is therefore another
  deliberate subsidy, and must be a configuration row like every other limit.
- **Cash-out makes earned points a financial liability**, not store credit. The
  points ledger must be **auditable and reconstructible from events** — every
  credit traceable to the run that earned it, every debit to what it bought.
  Treat it with the care of an accounting system, because that is what it is.
- **Three ways points enter the system** (tier grant, purchased top-up, author
  earnings) with different expiry and different cash status. Earned points do
  not expire. The ledger needs the bucket, not just the balance.

---

## 9. Architecture

### 9.1 Runtime — Anthropic Managed Agents

A documentation sweep confirms every primitive §9 relies on exists today:
auto-versioned agent configs with per-session version pinning; a fresh isolated
container per session with no shared filesystem state; native Skills (including
custom ZIP with `SKILL.md`) and MCP servers; a credential vault substituting
environment-variable secrets at egress so the model never sees cleartext; hard
per-session dollar caps via `budget: {type: "limit", max_list_cost: {...}}` which
pause the session with `stop_reason: "budget_reached"`; and cron scheduled
deployments (1,000 per org). The architecture is not wishful thinking. It is in
beta; that risk is accepted.

The Claude Agent SDK (Claude Code as a library, self-hosted) is the fallback if
Managed Agents proves unsuitable or impermissible. The pack format is the same
either way — see §9.6, which makes that swap an architectural requirement rather
than a hope.

### 9.2 RESOLVED — Anthropic approved reselling (2026-11-10)

**Anthropic confirmed that one org may run sessions on behalf of many paying
third parties and resell that inference.** Hosted-first — the central decision of
this document — is therefore permanent rather than provisional, and
bring-your-own-key drops from "the fallback if they say no" to an option for
developers and heavy users.

Beta access is enabled by default for all API accounts, so entitlement was never
in question either. §9.6's runtime interface stays, but as insurance against a
platform change rather than against a policy answer.

Still to read before launch: Managed Agents' **branding guidelines**, since this
ships under the alphaCEO name. If the answer is no, hosted-first — the central
decision of this document — is dead and only bring-your-own-key survives.
**Confirm before building.**

### 9.3 Credential isolation — the sharpest risk

Vaults are reported to be **workspace-scoped with no per-end-user access
control**: any API key with workspace access can reference any vault in that
workspace. The only per-user affordance is an optional
`metadata.external_user_id`. For a product pitched on safely holding buyers'
ad-account and CRM credentials, that is not sufficient on its own.

**Builder's call:** a **workspace per buyer organisation**, so isolation is
enforced by the platform rather than by our code paths. Provisioning, key
management and org quota limits must be verified early — if workspace-per-org
proves infeasible at scale, the fallback is application-level isolation, and the
owner must consciously accept that weaker posture.

### 9.4 Agent permissions

Bought agents touch systems where a bad run spends money or corrupts records.
**The platform default is `always_allow`** — verified in an agent-create response.
The safe posture is therefore *not* the default and must be set explicitly on every
pack, per tool, via each `configs` entry's `permission_policy`. A pack can also
ship with `default_config: {enabled: false}` and enable only the tools it needs,
which is the posture packs touching ad accounts should take.

**Builder's call:** spending and destructive tool calls are set to
`always_ask`, with an approval surface (interrupt, present,
confirm, resume) in the web app. Authors may mark specific tools `always_allow`;
buyers may override per pack. There is a liability question underneath this that
the owner should settle in the terms before agents touch live ad budgets.

### 9.6 Runtime portability — a hard requirement

**The runtime is behind an interface from day one.** One internal contract —
`create_session`, `send_message`, `stream_events`, `set_budget`, `read_usage`,
`store_credential` — with Managed Agents as the first implementation and a
self-hosted path as the second. Nothing above that line knows which runtime is
underneath. This is roughly a week of design discipline and it is insurance
against §9.2: if Anthropic's reseller answer is no, it changes an adapter rather
than the company.

**The fallback is the self-hosted Claude Agent SDK, not an unrelated open-source
harness.** Packs are skills plus MCP — Claude Code's format — and the Agent SDK
is Claude Code as a library, so packs run unchanged. Moving to OpenHands, Goose
or similar would mean porting every pack, and the catalog is the one asset that
cannot be rebuilt.

**Model freedom lives only on the self-hosted path.** Managed Agents runs Claude
and cannot be pointed elsewhere; OpenRouter and Managed Agents are mutually
exclusive. On the self-hosted path, the Agent SDK is proxied through an
Anthropic-compatible gateway to OpenRouter, which reaches any model with one key
and one billing relationship.

**One genuine advantage of the OpenRouter path: it returns cost per request.**
That removes the §10 metering problem — no derived meter, no monthly invoice
reconciliation. If metering accuracy becomes painful on Managed Agents, this is
the escape hatch, not just the fallback.

**What self-hosting costs**, and it is the bill Managed Agents was paying: the
per-session container (an E2B-class sandbox service covers this), the credential
vault with egress substitution, platform-enforced spend budgets, versioned
configs, and scheduled runs all become ours to build. The vault, the spend
governor and the meter have no shortcuts.

### 9.5 Three front doors on one backend

1. **Web app** — Next.js, one repo, UI and API together. Search, pack pages,
   purchase, org and author management, and the surface for running and watching
   agents. Postgres; Postgres full-text search until the catalog outgrows it,
   then Meilisearch.
2. **MCP server** — the marketplace itself as a remote MCP server over HTTP
   (official TypeScript MCP SDK), sharing the web app's API. **Release one scope
   (builder's call): `search_packs`, `preview_pack`, `my_library`, and
   `install_pack` meaning add-to-library only.** Running happens on our side;
   runtime fetch into a foreign environment waits for the gateway.
3. **CLI** — `npx <store> install <pack>` for folder export onto disk. A day of
   work against weeks for Tauri or Electron, and the people who want export
   prefer it.

---

## 10. Metering and traces

Three product requirements wearing one coat: **billing** (points debited from
recorded usage), **author feedback** (why a pack failed, so v2 can exist), and
**disputes** (a refund claim needs a transcript).

The session event stream carries every message, tool call, status and error, and
persists until session deletion. Persist it to Postgres.

**Metering reads a platform number — verified against the live API 2026-11-09.**
The `usage` object's measured shape is `active_seconds` (a float), `input_tokens`,
`output_tokens`, `cache_creation.{ephemeral_5m_input_tokens,
ephemeral_1h_input_tokens}`, `cache_read_input_tokens`,
`server_tool_use.{web_search_requests, web_fetch_requests}`, and **`list_cost`**
as `{amount, currency}` with the amount an integer string in minor units (cents).

**Cost datapoint worth sitting with:** one trivial turn — a single refusal, 288
output tokens, 6,493 tokens of cache creation on the pack prompt — cost
**5 cents**. At that rate a $5 subscription covers on the order of a hundred
trivial turns, or a handful of real multi-tool tasks. The §8.3 subsidy is larger
per active buyer than the token allowances alone suggest.
Points are debited from `list_cost`. No derived meter, no price table of our own
to maintain.

Two properties worth building around:

- **`list_cost` is priced at public list rates, not our contracted price.** Any
  negotiated discount becomes margin while buyers are still charged points
  against list. Do not replace it with an actual-cost figure.
- **Reported `list_cost` is rounded to the nearest cent** while enforcement
  compares exact amounts, so never treat the reported figure as the signal that
  a cap was hit — use `stop_reason: budget_reached`.

There is still no usage webhook and no customer identifier on sessions, so
sessions are mapped to buyer organisations in our own tables, and a periodic
reconciliation against the monthly org invoice remains the evidence trail for
disputes. Both are small next to building a meter.

**LangGraph is explicitly rejected.** It is an agent harness and we already have
one; adopting it means two loops and abandoning the Claude Code pack format. The
actual need was traces — a different product — and it is met above. Emit
OpenTelemetry alongside and point Langfuse at it if a trace UI is wanted later.

**Build toward this:** once we can see which packs finish their job, the catalog
ranks on evidence rather than reviews. Note this is **not** a unique advantage —
any competitor charging per use has the same data (§1.2) — but none of the skill
shops can see whether a run *succeeded*, only that it happened.

---

## 11. Curation and trust

Manual approval while the catalog is small — the owner is the taste, and that is
a feature. Verified author identity, the §8.5 refund window, reviews restricted
to buyers with recorded runs, and eventually ranking by completion evidence.

## 12. The authoring pipeline

- **Pack zero — the guardrails agent.** The owner authors the first pack
  themselves: an agent with its own tools and configuration, run from an
  internal unlimited account. It is the end-to-end proof of the system —
  authoring, listing, preview, purchase, hosted run, metering, budgets — and it
  needs no outside expert, so it takes the people bottleneck off the critical
  path. Build this first.
- **Packs 1–10:** built by hand, with the expert, by the owner. People job.
- **Later:** an agent that interviews a domain expert and writes the pack for
  them. A product in its own right and the thing that makes supply scale. Out of
  scope for release one, on the roadmap.

## 13. Constraints and release one

**One person builds this.** Sequencing is the hardest constraint in the document.

**Release one:** pack zero (§12) as the proving run; the platform wrapper prompt
and redacted transcript views (§7.1); a curated catalog; organisations and seats; purchase, points and
the metering workstream (§10); hosted runs with per-session budgets; the approval
surface (§9.4); transcripts as the preview rung; and the read-only MCP server.

**Deferred:** the tool gateway, hosted trials, MCP runtime fetch, the author
dashboard, the desktop app, the authoring agent, and **scheduled deployments** —
noting that §9.1 calls nightly runs "the honest justification for a
subscription," so release one sells a subscription without its strongest
justification. Deliberate, and worth revisiting if subscriptions convert badly.

Anything the owner can do by hand at release one should be done by hand.

Other constraints: Israeli entity (§8.4); Managed Agents is beta; greenfield, no
existing code or stack to inherit. **Managed Agents is not eligible for zero data
retention or HIPAA**, and session transcripts persist until explicitly deleted —
so buyers with those requirements cannot be served on the hosted path, and a
transcript retention and deletion policy is release-one work.

## 13.1 Deployment and naming — decided

**Domain: `agents.alphaceo.ai`.** The marketplace ships as part of the existing
alphaCEO family rather than as a standalone brand, which means the platform
wrapper prompt, the pack pages and the author terms all carry alphaCEO framing.
Check this against Managed Agents' branding guidelines (§9.2) before launch.

Deployment default unless the owner says otherwise: Vercel for the Next.js app,
a hosted Postgres (Neon or Supabase), with the MCP server served from the same
Next.js deployment.

## 14. Left to the builder

- Pack manifest schema and versioning scheme.
- Points-to-dollars arithmetic and the per-model conversion table.
- Search implementation and ranking signals before completion data exists.
- Session lifecycle: idle timeouts, reconnection, concurrency accounting.
- Schema design, auth, deployment target, build order within release one.

## 15. Decisions log

**The owner's, as stated:** subscription plus points, Loopcloud-style, to tie
buyers in long-term; the tiers and allowances in §8.2; accepting early losses on
them; adjustable limits; buyer picks the model; PayPal; packs bought individually
with concurrency sold by tier; hosted-first with folder export as a developer
option; **pack updates priced in points**; **real multi-seat organisations**;
**indie operators and small teams as the buyer**; **ship without real pack
protection, using a wrapper prompt, redacted transcripts and honest author
terms**; **pack zero is the guardrails agent, authored in-house, as the POC**;
**authors earn points per use and can cash them out**; **loss-leader pricing is
a growth strategy, with prices as a starting position only**.

**The builder's, flagged for review:** 70/30 author split; manual curation;
transcripts as the launch preview rung; Managed Agents over self-hosting the
Agent SDK; PayPal behind an internal billing interface; our own meter
reconciled against the invoice; points expiry and non-expiring top-ups; platform
absorbs budget overshoot; 14-day refund with payout held until it closes; VAT
collected from day one; workspace-per-organisation for credential isolation;
`always_ask` on spending and destructive tools; read-only MCP in release one;
scheduled runs deferred.

**Open, and the owner's to settle:**
- ~~§9.2 Managed Agents reseller permission~~ — **approved 2026-11-10.**
- The price of a pack.
- The author's per-use points rate, and the points-to-cash conversion rate.
- Whether Managed Agents' branding guidelines permit this product's framing (§9.2).
