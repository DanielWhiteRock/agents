# agents.alphaceo.ai

A marketplace where domain experts package their method as an **agent pack**, and
buyers hire it as a worker that runs here — under a hard per-run budget, with
every token and cent visible.

Not a skill shop. The skills marketplaces sell files that run inside a buyer's
own agent; this runs the agent for buyers who don't have one.

## Run it

```bash
npm install
npm run build
ANTHROPIC_API_KEY=sk-ant-... npm start
# http://localhost:4317
```

### Storage: Postgres, or SQLite with nothing installed

One async interface, two drivers — `src/app/sql.ts`. SQL is written once in
Postgres dialect with `$1` placeholders; the SQLite driver rewrites them
positionally, and the schema substitutes the two types that genuinely differ.

```bash
docker compose up -d                                             # Postgres 17 on :5433
DATABASE_URL=postgres://agents:agents@localhost:5433/agents npm start
```

With `DATABASE_URL` set it uses Postgres — which is what a deployment needs,
since SQLite cannot live on a serverless host. Without it, `node:sqlite` at
`data/platform.db`, so the app runs with no database to provision at all.
`/healthz` reports which one is live.

A demo organisation, a points grant and four packs are seeded on first boot.

First time through: open a pack, press **Publish to the runtime** (this creates
the agent on Managed Agents), then **Acquire** and send it a brief.

```bash
npm test          # 101 unit (vitest) + 45 integration (node --test, real schema)
npm run typecheck
node scripts/probe.mjs            # what the latest run did and cost
node scripts/probe.mjs --answer   # what the agent actually said
node scripts/costs.mjs            # every run, with cost
node scripts/verify-managed-agents.mjs   # live platform capability check

# against Postgres
export DATABASE_URL=postgres://agents:agents@localhost:5433/agents
node scripts/reset-db.mjs && node --test tests/node/*.test.mjs
node scripts/pg-probe.mjs <run-id> --answer
```

Integration tests run on Node's own test runner against the build, because
Vite's builtin list does not yet include `node:sqlite`. They pass on both
drivers — run them with `DATABASE_URL` set to exercise Postgres.

## How it fits together

| Layer | Where | What it owns |
|---|---|---|
| Runtime interface | `src/runtime/types.ts` | The contract. Nothing above it knows which runtime is underneath. |
| Managed Agents adapter | `src/runtime/managed-agents.ts` | The **only** module importing the Anthropic SDK. |
| Turn loop | `src/runtime/run.ts` | Stream-first turns, approval pauses, resume. |
| Money | `src/runtime/money.ts` | Exact minor units, `bigint` only. Never a float cent. |
| Packs | `src/packs/` | Pack shape, the platform wrapper prompt, the seed catalog. |
| Redaction | `src/transcripts/redact.ts` | Strips pack instructions from anything a buyer sees. |
| Storage | `src/app/sql.ts` | One async interface; Postgres and SQLite drivers. |
| Auth | `src/app/auth.ts` | scrypt passwords, sessions, invitations, roles, seats, API tokens. |
| Payments | `src/billing/provider.ts`, `purchases.ts` | One provider boundary; purchases, refunds, payouts. |
| Schedules | `src/app/schedules.ts` | Standing instructions and the ticker that fires them. |
| MCP | `src/mcp/server.ts` | The catalog as seven tools an agent can call. |
| Export | `src/packs/export.ts` | A bought pack as an `ant apply` file. |
| Ledger | `src/billing/points.ts` | Points as cents of compute; author earnings in millicents. |
| Service | `src/app/platform.ts` | Packs, runs, the transcript, metering. |
| Web | `src/app/server.ts`, `views.ts` | Catalog, runs, live traces, points, limits. |

## Rules the code keeps

- **Every session is created with a budget.** One cannot be added later.
- **Budget exhaustion is detected from the 400 on send**, not from `stop_reason`,
  which is `null` at the cap.
- **Never break a turn on idle alone** — idle with `requires_action` is transient.
- **Stream before you send**, on a turn and on a resume. Events that arrive before
  the stream opens are gone, and the transcript is the billing record.
- **Billing reads the platform's own `list_cost`**, priced at list rates, and only
  the delta since the last reading is charged.
- **Every limit is a settings row**, never a constant. See `/settings`.
- **Buyers never see a raw transcript.**
- **Transcript writes are serialised per run.** Asynchronous writes from a live
  stream would otherwise land out of order, and an out-of-order transcript is
  useless as billing or dispute evidence.
- **Postgres returns `SUM` as a string.** Every aggregate is coerced, never
  trusted to arrive as a number.
- **Domain failures carry a status.** "You do not own that pack" is a 403 with a
  page that says so, not a 500 with a stack trace.
- **Another organisation's anything is 404, not 403.** Confirming it exists is
  itself the leak.

## What works

| | |
|---|---|
| **Accounts** | Signup creates an organisation and its first owner. scrypt passwords, session cookies, owner/member roles, per-tier seat limits, invitations with expiring tokens. An organisation can never be left without an owner. |
| **Catalog** | Four seeded packs. Publishing creates the agent on Managed Agents and pins a local version. |
| **Buying** | An entitlement comes from a paid purchase and nothing else. 14-day refunds that revoke the entitlement *and* terminate open runs. Points bought on the same rails. |
| **Trials** | Three turns and 15c of compute on a pack you do not own, once per organisation, paid for with your own points. |
| **Running** | Hard per-run budget, live trace, token counts and cost per request, approval prompts for destructive tools, top-up-and-resume. |
| **Billing** | Points as cents of compute, three buckets, grant spent first. Authors earn per run in millicents, held until the refund window closes, then payable. |
| **Schedules** | A pack, a brief, a cadence. A 60-second ticker fires them down the ordinary run path, so they are budgeted and traced like any other run. |
| **MCP** | `search_packs`, `pack_details`, `my_library`, `install_pack`, `export_pack`, `list_runs`, `run_trace`. Bearer tokens from `/tokens`. |
| **Export** | A bought pack downloads as an `ant apply` file, from the browser, the CLI or MCP. |

### Not done

- **PayPal is written but unverified.** The stub is the default and says so in the UI; no credentials exist yet.
- **No email.** Invitations are links you pass on yourself.
- **Scheduling is ours, not the platform's.** Managed Agents' cron deployments are the eventual home for it.
- **Seed pack instructions are placeholders**, not an expert's work. Replace them before listing anything to a paying buyer.

Design: `docs/superpowers/specs/2026-11-09-agent-marketplace-design.md`
Plan: `docs/superpowers/plans/2026-11-09-runtime-spine.md`
Status: `docs/MORNING-BRIEF-2026-11-10.md`
