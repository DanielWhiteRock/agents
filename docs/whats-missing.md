# What's missing

State of the marketplace as of 2026-11-11, after the listing work shipped and the role
taxonomy became data. Written to be acted on, not admired — every line is either a thing
to do or a fact that decides whether to do it.

Three things are at three different stages, and conflating them is what makes the state
confusing:

| | Done | Total |
|---|---|---|
| **Taxonomy** — roles exist, changeable without a deploy | 8 | 8 |
| **Definitions** — each role has a tested SKILL.md | 1 | 8 |
| **Stock** — each role has at least one pack | 2 | 8 |

A buyer sees the third row. Today that is two tiles on a shelf of eight roles.

---

## 1. Roles with no packs

`roles()` does not advertise a role with no packs — deliberately, since listing a job we
cannot fill is worse than not listing it. So an empty role is invisible, not merely thin.

Two can be filled by tagging packs that already exist and genuinely fit:

| Role | Pack | Why it fits |
|---|---|---|
| Reviewer | `guardrails` — *"Reads another agent's work before you act on it, and tells you what not to trust."* | Near-exact match, and it is the platform's own pack |
| Writer | `video-brief` — *"Takes an idea and returns a shootable brief a crew could actually turn up to."* | The role is "leaves a document someone can act on" |

Four need something new:

| Role | What would fill it | Source |
|---|---|---|
| Growth | Lead qualification, page/conversion audit | `github/awesome-copilot` (MIT, Copyright GitHub, Inc.) |
| Operator | Incident postmortem in SRE format — closes the gap 151 people paid $5 for, with no free equivalent anywhere | `awesome-copilot` → `skills/incident-postmortem` |
| Security | Security review; the differentiating angle is auditing *skills, prompts, MCP servers and agents*, a category this marketplace invented | `awesome-copilot`, plus our own |
| Agents Engineering | Agent hand-off; and an eval harness, which is a build rather than a package | `openclaw/agent-skills` (MIT) — `handoff` / `team-handoff` |

See `provenance-and-licensing.md` for the verified licence of each upstream and the exact
attribution owed.

## 2. Role definitions — 7 of 8 unwritten

Only **Reviewer** has a `SKILL.md` (`roles/reviewer/SKILL.md`), written against a baseline
that failed first: a fresh agent reviewing a real commit returned "Approve", nine bullets
describing the diff back to its author, and a claim that `tsc` was clean without having run
it. The skill states what a review *is* — verdict, actions worst-first, every check marked
`[ran]` or `[read]`, then the gaps — because the failures were shape, not discipline, and
prohibitions backfire on shaping problems.

Still to write: **Engineer · Designer · Writer · Growth · Operator · Security · Agents
Engineering.** Each needs a genuine failing baseline before the skill is written; batching
them is explicitly forbidden by the method, and would produce skills written against
imagined failures rather than real ones.

**These need real artifacts.** Reviewer worked because it was given an actual commit from
this repo and found actual problems. Writer needs a real document, Operator a real incident.
Synthetic prompts produce synthetic skills.

## 3. Two packs with no honest role

| Pack | Problem |
|---|---|
| `campaign-strategist` | Its tagline *is* the old Marketer blurb, which the evidence killed — campaign planning has no proven demand in the catalogue |
| `support-triage` | The only example of the Support role we dropped; Agensi shows 29 customer-support listings with ~10 uses between them |

Both are listed on production and counted toward no role. Tagging them into Growth or
Reviewer would put a pack under a description that does not fit it — the first lie on the
shelf. Either retire them, or bring a role back deliberately.

## 4. Production has the features and none of the content

71 packs are listed. **Not one has a description, use cases, scenarios, limitations or an
FAQ** — the generator has never been run against production. There is no creator record
either, so every byline is inert text, `built_on` credit renders nowhere, and the creator
profile, the ask-the-creator thread and the publish-to-FAQ loop are all unreachable.

The entire feature set of PR #2 is shipped and unused.

What it needs, in order: a creator record for the owner's org (which also re-attributes
every pack and lights the bylines), then the generator against production, then approval
of each draft before it is public.

## 5. Open pull request

**PR #1 on `DanielWhiteRock/agents`** — the roles table, three research documents, and a fix
for a typecheck error `main` currently carries (`tests/app/front-page.test.ts` cannot pass
`runs` because the helper returns two fields its parameter type refuses). `main` is red on
`tsc --noEmit` until this merges.

## 6. Build opportunities

From `role-design-from-the-catalogue.md` §7, in its order of buildability:

1. **A build verb for the 67 aesthetics.** ~950 proven uses in frontend build and motion; the
   best free motion skill is a single-file prompt; the paid frontend tier is twenty listings
   at zero uses. We already own the scarce half. **Biggest single opportunity.**
2. **A de-slopper with an eval.** 793 uses on one skill, nine competitors, one credible rating
   between them. The claim is measurable and nobody is measuring it.
3. **The incident write-up, free.** See Operator above.
4. **An eval harness for skills and agents.** Every paid attempt ($7.99, $15, $24) has zero
   users; the best-regarded engineering skill in the catalogue is the one shipping a
   benchmark set. Testability is what buyers reward.
5. **A reviewer's gate.** The format flooded the catalogue and almost none of it has users —
   available and un-owned. Bar is `code-reviewer` at 4.2.
6. **Hand-off between agents.** Visible need, no proven answer.

Six places the same document says **not** to build: customer support, paid media, product
management, cloud infrastructure, contract review, data analysis. Those markets are absent,
not unserved.

## 7. Loose ends

- `packs/senior-engineer/README.md` credits pstack to "Poteto"; that LICENSE reads
  `Copyright (c) 2026 Lauren Tan`. MIT requires the notice as written.
- The production API token pasted into the working session should be revoked.
- `deploy-check-…@claude-verification.invalid` is a live account on production, created to
  verify the deploy fix. It has no delete path from outside.
- Commit `f14422f` in isolation leaves the breadcrumb reading the `ROLES` constant and ships
  no test for `putRole` — both fixed by the next two commits, so moot if PR #1 merges whole,
  real if anything is ever bisected or cherry-picked.
- `src/app/sql.ts` has no transaction primitive, and seven call sites now want one. The one
  that can lose content (`packs.faq`) is protected by a compare-and-set instead.

## Shortest path to a full table

1. Tag `guardrails` → Reviewer and `video-brief` → Writer. **Minutes. Four roles visible.**
2. Package four MIT upstreams with attribution for Growth, Operator, Security and Agents
   Engineering. **Hours. Eight roles visible.**
3. Write the seven remaining role SKILL.mds, each against a real failing baseline. **Days.**
4. Build the six opportunities, starting with the build verb for the aesthetics. **Weeks.**
