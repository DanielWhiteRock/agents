# Deploying

**Render: yes, verified. Vercel: no, and not by a little.**

Everything below was run, not reasoned about. The commands are in the
commit that added this file.

## Where it deploys from

| | |
|---|---|
| Repository | `github.com/DanielWhiteRock/agents` (public) |
| Branch | `main` |
| Render service | `agents-alphaceo` · `srv-dbpffh8m7kps73apjqa0` |
| URL | https://agents-alphaceo.onrender.com |
| Auto-deploy | on — a push to `main` builds and goes live |

It was moved here from a private repository, `DanielWhiteRock/layer1`, whose
`main` and `openclaw-archive` branches carry an Ed25519 device private key in
an old commit. Only the branch that became this `main` was published, and that
commit is not reachable from it. **If those branches are ever needed here,
rotate the key first** — pushing them as they stand would publish it.

## Why Render and not Vercel

Three things in this app decide it, and all three are load-bearing:

1. **A turn outlives the request that started it.** `POST /runs/:id/message`
   returns `303` immediately and the agent keeps working. Measured on this
   app: a one-sentence answer took **6.5 seconds** of post-response work; the
   run that produced the VAT infographic took **80.8 seconds of active time in
   a single turn**. A research run with tool calls is minutes. Serverless
   functions are killed once they respond — `waitUntil` extends that to a
   bounded ceiling, not to "until the agent is finished".
2. **The live trace is an open SSE connection.** This one is survivable on
   Vercel: the stream tails persisted events after an id and the client sets
   `retry: 2000`, so a cut reconnects without losing anything.
3. **The scheduler ticks every 60 seconds in-process.** On Vercel this would
   have to become a platform cron calling an endpoint.

So Vercel would mean moving every turn onto a queue with a worker somewhere
that is not Vercel — which is the thing Render already is. The SSE and the
cron have answers; the turn driver does not.

## Render

`render.yaml` is a blueprint: one Docker web service, one Postgres. Point a
new Blueprint at the repository, or `render blueprint launch`.

Set in the dashboard, not in the file:

| Variable | Needed | What happens without it |
|---|---|---|
| `ANTHROPIC_API_KEY` | **yes** | No agent can run. Everything else works. |
| `PAYPAL_CLIENT_ID` / `_SECRET` / `_BASE` | no | Purchases settle through the built-in test provider without charging anyone. |

`DATABASE_URL`, `SECURE_COOKIES=1` and `NODE_ENV=production` come from the
blueprint. `PORT` comes from Render.

### What was verified

Built the image, ran it against Postgres on Render's own default port, and
drove it over HTTP:

- **Boots and migrates** on an empty database: schema created, 4 packs seeded.
- **`/healthz`** → `{"ok":true,"store":"postgres","payments":"stub"}`.
- **Binds every interface**, so the host can reach it — proven by it being
  reachable through a container port mapping at all.
- **Auth works**: signup issued a cookie carrying `Secure` under
  `SECURE_COOKIES=1`; an unauthenticated page 303'd to `/login`.
- **Points granted on signup**: 120 per org in the ledger.
- **Published a pack to the live Anthropic API from inside the container**:
  agent `agent_01M99k19zmGo8Qe7z5jrZCcJ`, and the `rendering-pages` platform
  skill uploaded from a cold start as `skill_012rvXBPPCGwYm3YcPAsb8J3`.
- **Ran a real agent and streamed its trace**: SSE opened with
  `text/event-stream` and `x-accel-buffering: no`, and carried
  `run.started → model.request_start → agent.text → model.usage →
  usage.snapshot → run.metered`.
- **Metered it**: 2 in / 83 out, 4¢ list cost against a 40¢ budget, 4¢ billed,
  0.8¢ credited to the author, debited from the 120-point grant.
- **Stops cleanly**: `SIGTERM` → `[SIGTERM] draining` → exit code 0, so a
  deploy is not a `SIGKILL`.
- **Cleans up after a restart**: an orphaned run was metered a final time,
  closed, and its slot freed, with `run.interrupted` in its transcript.

### Three things the deploy made necessary

None of these were visible on a laptop:

- **The store must be durable.** Without `DATABASE_URL` the app falls back to
  SQLite on local disk, which a host replaces on every deploy — the ledger
  would vanish with nothing in the logs. In production it now refuses to start
  and says why.
- **An interrupted run used to hold its slot forever.** `ended_at IS NULL` is
  what the concurrency limit counts, so five deploys mid-turn would have left a
  personal tier unable to start anything, while the abandoned session kept
  spending at the provider. Startup now reconciles them.
- **The scheduler now claims a row before firing it.** The stamp is conditional
  on the value the instance read, so two instances ticking on the same second
  fire a schedule once. Without it the test starts two runs and bills twice.

### Scaling past one instance

Safe for the web service: the scheduler claims its rows, and sessions live in
Postgres. Each instance only drives the turns it started, so a trace follows
whichever instance holds that run — fine with sticky routing or one instance.
Moving turns onto a queue is the change that makes instance count genuinely
irrelevant, and is not needed yet.

## Anywhere else

Any host that runs a container and gives it a Postgres will work: Fly, Railway,
a VM. The requirements are only that the process is long-lived, gets `PORT`,
gets `DATABASE_URL`, and is sent `SIGTERM` rather than killed.
