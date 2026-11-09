# Morning brief — 10 Nov 2026

**It's built and it works.** `npm start`, open `localhost:4317`, publish a pack,
acquire it, send it a brief. You'll watch the trace arrive live with token counts
and cost per request, and see the points come off your balance.

Total spent against the live API all night: **about 35 cents**, including three
probe spikes and two real runs.

---

## What actually runs

Two packs exercised end to end against live Managed Agents:

| Pack | Model | Output | Active | Cost |
|---|---|---|---|---|
| Guardrails Reviewer (pack zero) | claude-opus-5 | 1,129 tok | 19.5s | $0.04 |
| Support Triage | claude-haiku-4-5 (buyer override) | 636 tok | 7.6s | $0.01 |

I gave pack zero a deliberately poisoned agent output — a fabricated churn
figure, an invented "SaaS benchmark", and a headcount cut justified by arithmetic
nobody had done. It opened with **DO NOT USE**, caught all three, noticed that
1,200 × £41 is £49,200/month and two CS salaries don't fund that, spotted the
causation trap (cutting the team that may be *causing* the low churn), and
flagged the redundancy as needing HR and legal before anyone acts. That is the
pipeline working: authoring, publishing, versioning, budgeting, running,
metering, billing, author credit.

**Everything in the app:** catalog, pack pages with prices, acquire, start a run,
live trace with a spend meter, token counters, budget bar, approval prompts,
top-up-and-resume, the points ledger with three buckets, author earnings, and a
`/settings` page where every limit is editable without a deploy.

59 tests, typecheck clean, no errors in the log, 1,991 lines of source.

---

## Six bugs the live API found that no amount of reading would have

This is the part worth your time. Every one of these was wrong in my own
documents before I ran it.

1. **A session model override is not a top-level `model`.** It nests inside
   `agent` as `{type: "agent_with_overrides", id, version, model}`. A top-level
   `model` is rejected as an unknown field.
2. **`stop_reason` is an object**, not a string — `{type: "requires_action"}`.
3. **Budget exhaustion is invisible on the session.** At the cap the session sits
   `idle` with `stop_reason: null` and `list_cost` exactly equal to the budget.
   The only reliable signal is the **400 on the next send**.
4. **Never break a turn on idle.** Idle with `requires_action` is transient —
   between parallel tool calls and whenever it's waiting on a human.
5. **Resuming after an approval must open the stream before sending the
   confirmation.** Otherwise the agent's continuation lands before anyone is
   listening and the turn looks like it ended at the pause.
6. **Pending approvals must be persisted as they arrive.** Recording them when
   the turn ends is a deadlock: the turn cannot end until they're answered.

Plus: **Haiku 4.5 rejects `model.effort` outright**, so effort is a per-model
capability, not a default. And **`always_ask` genuinely fires** — a run asked
permission before `ls`, which is the §9.4 approval promise actually kept.

---

## What I made up, as you said to

Flagging each one because none of it is your judgement:

- **Pack zero's instructions** — the guardrails reviewer's method. Marked
  `DRAFT — owner review required` in `src/packs/pack-zero.ts`. It performs well,
  but it's mine.
- **Three seed packs** — Campaign Strategist, Video Producer's Brief, Support
  Triage, with placeholder authors. The design says the first ten packs are built
  by hand with the actual expert. None of these were. Replace the instructions
  before any of them is listed to a paying buyer.
- **Author share: 20%** of what a run costs, as a settings row.
- **Default run budget: 50¢**, top-up headroom 50¢.
- **Grant spend order** — the expiring monthly grant is consumed before top-ups
  and earnings, so nobody loses purchasable points to an avoidable expiry.
- **Author earnings in millicents.** A 20% share of a 2¢ turn is 0.4¢, which
  floors to zero in whole cents — an author doing real work on cheap turns would
  be paid nothing forever.
- **14-day refunds, VAT from day one, workspace-per-organisation** for credential
  isolation, read-only MCP in release one.

---

## What is NOT built — read this before you show anyone

- **No payments.** "Acquire" grants the entitlement and charges nothing. Prices
  render but no money moves. PayPal isn't wired.
- **No real auth.** One seeded demo organisation, no login. Anyone who reaches
  the port is the owner.
- **Orgs are schema-only.** Tables for memberships and roles exist; no invites,
  no second user, no permission checks.
- **No marketplace MCP server**, no folder export, no hosted trials, no scheduled
  runs, no author dashboard.
- **SQLite, local.** Fine tonight, wrong for Vercel — that needs Postgres.
- **The approval UI is polling-reloaded**, not pushed. It works; it's not elegant.

---

## Yours to decide

1. **Ask Anthropic the reseller question** — may one org run sessions for many
   paying third parties and resell that inference? Nothing in the docs addresses
   it. §9.6 means a "no" switches the runtime adapter rather than killing the
   company, but you want the answer before you're deep in. Also read their
   branding guidelines, since this ships under alphaCEO.
2. **A pack's price.** Rendered everywhere, decided nowhere.
3. **The author's per-use rate and the points-to-cash rate.** Earned points are
   cashable, which makes the ledger a financial liability, not a counter.
4. **Rewrite pack zero**, then pick the first real expert.
5. **PayPal business account and the entity question** (Israeli vs US LLC). Both
   have lead times; start them.

## One number to sit with

A single short turn costs about 4¢ on Opus and 1¢ on Haiku. Your Personal tier is
$5/month with allowances worth roughly $50 of inference. The subsidy is real and
deliberate — you said so twice — and now it's a settings row you can change in an
afternoon rather than a constant in the code. `/settings`.
