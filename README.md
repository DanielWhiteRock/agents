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

Storage is `node:sqlite` at `data/platform.db` — nothing to install, no server to
provision. A demo organisation, a points grant and four packs are seeded on first
boot.

First time through: open a pack, press **Publish to the runtime** (this creates
the agent on Managed Agents), then **Acquire** and send it a brief.

```bash
npm test          # 59 tests
npm run typecheck
node scripts/probe.mjs            # what the latest run did and cost
node scripts/probe.mjs --answer   # what the agent actually said
node scripts/costs.mjs            # every run, with cost
node scripts/verify-managed-agents.mjs   # live platform capability check
```

## How it fits together

| Layer | Where | What it owns |
|---|---|---|
| Runtime interface | `src/runtime/types.ts` | The contract. Nothing above it knows which runtime is underneath. |
| Managed Agents adapter | `src/runtime/managed-agents.ts` | The **only** module importing the Anthropic SDK. |
| Turn loop | `src/runtime/run.ts` | Stream-first turns, approval pauses, resume. |
| Money | `src/runtime/money.ts` | Exact minor units, `bigint` only. Never a float cent. |
| Packs | `src/packs/` | Pack shape, the platform wrapper prompt, the seed catalog. |
| Redaction | `src/transcripts/redact.ts` | Strips pack instructions from anything a buyer sees. |
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

Design: `docs/superpowers/specs/2026-11-09-agent-marketplace-design.md`
Plan: `docs/superpowers/plans/2026-11-09-runtime-spine.md`
