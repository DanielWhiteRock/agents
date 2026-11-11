# The roles our shelf should hire for, argued from the catalogue

Compiled 2026-11-11 against the live Agensi MCP connector, **free and paid**, following the
owner's instruction: *"review all the ones found and create roles only from the best of the
best, not at all price, there are many sources."*

Baseline: [`agensi-free-skills-index.md`](./agensi-free-skills-index.md) — 602 free skills across
all 33 categories. That file's findings are treated here as established and built on, not
re-derived. This pass adds the paid tier and converts the result into a role design.

**This file records metadata and judgements. It contains no skill instructions, scripts or
bodies, from any listing, free or paid. Where a capability is worth having, it says what the
capability is and what we would have to build ourselves.**

---

## 1. Method, and what I discounted

### What I did this pass

| Call | Count | Purpose |
|---|---|---|
| `get_popular` (all_time, 50) | 1 | The proven top of the whole marketplace, paid included |
| `search_skills` (relevance sort) | 13 | One per contested domain. Relevance gives paid a 1.25× boost, so this is the sort that *surfaces* paid listings — the mirror image of the index's `most_installed` technique |
| `get_skill` deep records | 10 new (16 total with the index's 6) | Judging substance on finalists |

**265 listing rows were read this pass**, of which roughly 210 were paid listings absent from
the free index. Combined with the index's 602 free skills, the two passes have looked at
something like 800 distinct listings. **24 cleared the bar** set below. That ratio is the single
most important number in this document.

Rate limiting was hit twice and backed off from; no call was retried in parallel.

### How I judged

The owner removed price as a filter, which removes the only easy signal. With `rating: null` on
~98% of listings and `install_count: 0` on most, I ranked on this, in order:

1. **Proven use.** `code-reviewer` — 1,934 uses, 4.2 from 17 reviews — is the benchmark for
   "proven". Anything under ~20 uses is noise. Any 5.0 on fewer than 5 reviewers is unrated.
2. **Method or wrapper.** On every finalist I called `get_skill` and read what it actually
   ships. A skill that classifies the work, names its passes, ships reference material or a
   dataset, and states what it will *not* do is a method. A skill whose body restates its own
   title is a wrapper. Several finalists were demoted on this test alone.
3. **Does the page match the thing.** A mismatch is disqualifying, not a caveat.
4. **Creator track record**, read as *uses per skill*, not skills published.
5. **Would it survive our own bar** — does it do something a competent person would pay for,
   and does its page avoid out-promising it.

### What I discounted, and why

- **Price, in both directions.** Paid is not a quality signal here: of the 210 paid listings
  read this pass, **196 had zero recorded uses**, including a $67 paid-media audit, a $69
  QA department, a $50 DFIR pack and a $39.99 copy gate. Price is a seller's opinion of a
  listing nobody has bought.
- **Listing volume.** The flood is the loudest thing in the catalogue and it means nothing. One
  relevance query for landing-page copy returned **twenty paid skills doing the same job, nineteen
  of them at zero uses**, including four near-identical "Landing Page & Conversion Copy Gate"
  listings at $14, $14.99, $39.99 and $39.99. Supply is not demand.
- **Prolific creators.** Three creators own ~299 of the free tier (index §14.2); on the paid
  side the pattern repeats harder. The $5 series in the marketplace top 50 — Incident
  Postmortem, Dependency Upgrade Planner, Git History Archaeologist, CLI UX Doc Builder, Meeting
  Decision Log, SQL Query Clinic, Docker Ops Playbook — is **one creator with 184 listings and
  1,445 total uses**. Another, whose house format is the "gate", has **256 listings and 479
  total uses — 1.9 uses each**. I counted distinct capabilities, and weighted creators by uses
  per skill: the best ratios found were 1 skill / 248 uses, 1 skill / 115 uses, 3 skills / 137
  uses, 8 skills / 215 uses. Those four are worth more attention than the four with 700+
  listings between them.
- **Ratings on fewer than five reviewers**, which is nearly all of them. Where a rating does
  rest on real reviewers I used it in both directions — the lows are as informative as the highs.
- **Two premises in my own brief.** Both are contradicted by the evidence; see §5.

---

## 2. The best of the best, by our current eight roles

Evidence format: uses / rating (reviewers). Deep-read means `get_skill` was called and the
shipped material judged.

### 2.1 Engineer — the strongest shelf in the catalogue

**Picks.**

| Skill | Price | Evidence | Why it clears |
|---|---|---|---|
| `code-reviewer` | free | **1,934 / 4.2 (17)** | The only listing on Agensi with a statistically meaningful rating. Severity-ranked findings with file locations. Needs only terminal + Git. Published by the marketplace's founder, which is worth knowing |
| `codex-grade-coding` | free | 326 / 4.8 (4) | **Deep-read.** The clearest "method, not wrapper" in the catalogue: it classifies the task by risk, picks a matching verification level, constrains scope, and reports against a fixed contract of objective / assumptions / changes / verification / residual risk. Ships 23 supporting files including an eight-task benchmark set and a judging guide, so the skill can be scored rather than believed. Zero permissions |
| `env-doctor` | free | 256 / 5.0 | Narrow job — why won't this project start — with a verifiable output: exact fix commands. The kind of thing that either works or visibly doesn't |

**Also cleared:** `git-commit-writer` (479 / 4.8), `java-best-practice-checker` (91 / 5.0),
`git-history-archaeologist` ($5, 89 / 5.0 — traces regressions across renames),
`dependency-upgrade-planner` ($5, 91), `sql-query-clinic` ($5, 81).

**Rejected after checking.**

- **Every paid frontend skill surfaced.** `Next.js 16 + React 19 Production Pack` ($24),
  `React / Next.js Production Audit` ($15), `Production-Ready API Builder` ($19.99),
  `build screaming frontend features` ($5), `react spa frontend architect` ($6.99) and eleven
  more: **all zero uses**. The paid build tier is entirely unproven.
- `prompt-dataset-builder` ($9.90, **162 uses, rating 1.0**). The best-used paid skill in the
  marketplace top 20 and the worst-rated thing I found anywhere. 162 people bought it and the
  reviewers hated it. Disqualified, and worth remembering as the strongest argument against
  treating install counts as quality.

### 2.2 QA — one giant, then nothing

The best-evidenced skill on the entire marketplace is a reviewer. Below it, the testing shelf
collapses: the whole e2e/testing corner tops out at **15 uses free**, and the paid side —
`Playwright E2E Test Writer and Flaky Test Fixer` ($5), `QA SDET-ISTQB` ($5),
`Add Endtoend Tests Automatically` ($1), `Quality Department — Idea to Production QA` ($69) —
is **four listings, zero uses between them**.

**Picks.** `code-reviewer` (above, counted once). `bug-to-regression-test-builder` (free, 24 /
5.0) as the only test-side listing with any evidence at all.

**Rejected:** `local-first-memory-for-ai-coding-agents-pmb` (15 uses) — titled as a memory tool,
described as a Playwright/Cypress/Detox generator. Name and function disagree, which is
disqualifying under rule 3. `flaky-test-detector` (free, 2) and `Flaky Test Detective`
($9.99/mo, 2) — the cleanest free-vs-paid head-to-head in the catalogue, and neither side has
customers.

### 2.3 Security — small, honest, and quietly the most interesting

**Picks.**

| Skill | Price | Evidence | Why it clears |
|---|---|---|---|
| `security-first` | free | 109 / 4.5 (2) | Sits *before* the code: trust boundaries, assumptions and verification tests for work not yet written. Nothing on our shelf does this. Zero permissions, so trivially safe to trial |
| `Bounty Security Pattern Master Library` | **$75** | 19 / 5.0 (1) | **Deep-read.** The most expensive thing with any traction. Ships a machine-readable library of 399 vulnerability patterns with CWE mapping, false-positive checklists and exploit hypotheses — a dataset, not a prompt, which is why it can charge $75. States plainly that it contains patterns, not exploits, and that findings need manual verification. Low n, and DeFi-weighted |
| `security-code-review` | free | 34 / 5.0 (low n) | CWE-mapped, severity-rated, ends in an approval verdict. Read-files only |

**The category Agensi created.** Six free skills audit *skills and agents* — SKILL.md injection,
skill packages, MCP servers, RAG pipelines — with ~91 uses between them. Free owns that outright
and it did not exist eighteen months ago. It belongs to the meta role, not to Security.

**Rejected:** the other fourteen paid vulnerability auditors surfaced ($1 to $50), all zero uses.

### 2.4 DevOps — the proven work is the write-up, not the infrastructure

This is the sharpest correction this pass produced. DevOps & Cloud lists 695 skills. Across
free and paid, infrastructure work has **essentially no customers**: Terraform best free, 2
uses; Kubernetes, two MCP wrappers at 1 use each; `Multi-Cloud Kubernetes & OpenShift Deploy
Pro` ($19), `DevSecOps Expert` ($9.99), `production-deploy-gate` ($7), `Vargr Tracer — AI SRE`
($24), `Production SRE & Host Incident Triage 3-in-1 Pack` ($39) — zero uses, every one.

What people actually run is the paperwork and the repair.

**Picks.**

| Skill | Price | Evidence | Why it clears |
|---|---|---|---|
| `incident-postmortem-1` | $5 | **151 uses**, 13 votes, no reviews | **Deep-read.** The only proven ops skill in the catalogue, free or paid. Turns chat logs, alert history and deploy commits into a blameless postmortem: minute-by-minute timeline, 5-Whys, quantified SLO/SLA impact, action items split into prevention / detection / response. Explicitly refuses real-time response, blame attribution and liability documents. Zero permissions. **There is no free equivalent anywhere** |
| `ci-cd-pipeline-validator` | free | 27, 3 votes | Still the only substantial free DevOps skill. Ships four CI-platform reference sets, honest static-only limitations. Know that its listing upsells a $9.99 Pro twin, and that it declares a placeholder host in its manifest |
| `docker-ops-playbook` | $5 | 79 | Narrow and verifiable: volume backup and restore via helper containers. Boring in the way ops should be |

**Rejected:** everything cloud-shaped, on evidence. If we list a DevOps role as written — "ships
it, watches it, makes the next deploy boring" — the catalogue cannot stock the watching half.

### 2.5 Marketer — splits into two different jobs, only one of which anyone pays for

The index found marketing splits by channel. This pass finds a deeper split: **content voice has
real demand; channel work does not; paid media has none at all.**

**Picks — the content half.**

| Skill | Price | Evidence | Why it clears |
|---|---|---|---|
| `humanize-writing` | free | **793 / 4.7 (11)** | The second-most-used skill on the marketplace and the only credible one of nine de-sloppers. No permissions. One packaging blemish: ships with unfilled authoring-scaffold text still in it |
| `designer-carousel-post` | free | 132 / 5.0 (low n) | The best-used social skill on Agensi, and it is a *format* skill — slide-by-slide carousel copy and visual concepts — not a channel skill |
| `content-brainstorm` | free | 105 / 5.0 (low n) | Seven-day calendar balanced across trend, evergreen and opinion. Needs only web access |

**Picks — the demand half.**

| Skill | Price | Evidence | Why it clears |
|---|---|---|---|
| `GEO-SEO Suite — AI Search Optimization` | $9.99 | 115 / 5.0 (1), 20 votes | **Deep-read, and the strongest paid skill found.** A weighted six-dimension rubric (citability, brand authority, E-E-A-T, technical, structured data, per-platform) producing a 0–100 score, citing published research for its weightings; 15 routed playbooks; subagents for parallel audit; and — the part that explains the 115 buyers — a client deliverable, a proposal generator and a month-over-month comparison. One creator, one skill, 115 uses |
| `web-design-lead-qualifier` | free | 106, unrated | Analyses a prospect's site and returns a sourced five-signal fit report plus the outreach email. Same shape as above: evidence in, sellable document out |
| `seo-audit-agent-full-website-seo-checker` | free | 75 / 5.0 (low n) | Crawls a site, returns a prioritised report. Needs only web access |

**Also cleared:** `lead-generation-agent` (free, 72 / 5.0 low n),
`Landing Page & Conversion Copy Gate` ($14, 20 / 5.0 (1)) — **deep-read**, and the one honest
member of a cloned family: five named passes, read-only, and an explicit refusal to rewrite the
copy it judges.

**Rejected after checking.**

- `seo-optimizer` (266 uses, 5.0) — ninth most-used skill on the marketplace, named as SEO, and
  it is a Chinese advertising-law banned-word checker. Confirmed by `get_skill`.
- `social-media-ops` (51) — English listing names LinkedIn; the skill is in Chinese and covers
  five Chinese platforms. `content-writer` (138) — Xiaohongshu/Zhihu/WeChat/Douyin only.
- **All 18 paid-media skills surfaced**, from `ad-creative-director` ($5) to `Paid Media Audit`
  ($67): zero uses, every single one. Meta ads, Google Ads, YouTube ads, budget pacing, fatigue
  diagnosis, wasted spend — nobody on this marketplace buys media-buying help.
- **All 15 paid LinkedIn skills surfaced** ($5–$39): zero uses. The free LinkedIn shelf tops out
  at 8.

### 2.6 Designer — our deepest role, and the catalogue's thinnest category

UX & UI Design: 142 listings, three free, **2 uses between them**. That stands from the index.
What this pass adds is where the design money and traction actually are.

**Picks.**

| Skill | Price | Evidence | Why it clears |
|---|---|---|---|
| `LLM becomes an Award-Winning App & Site Designer` | $9.99 | **125 / 4.5 (6), 29 votes** | **Deep-read.** The best-evidenced design skill at any price, and the most direct intellectual challenge to our 67 packs. Its argument: do not pick a style, *derive* one — research the category first, take the palette from materials that physically exist in the subject's world, produce three competing directions and justify the winner against the other two, then run a check script of known AI design tells over its own output before you see it. A real method, by a creator with 8 skills and 215 uses. **Flag:** the description sells a V4 native-mobile module while its own Known Limitations still say "built for web UI, less useful for native mobile." The page out-promises its own small print |
| `frontend-motion-wizard` | free | 320 / 4.3 (6) | **Deep-read.** Highest-used design-adjacent free skill. An ordered four-pass sweep over a static React/Tailwind codebase — overlays, shared layout tracks, tactile feedback, repaint and reduced-motion audit — with opinions about spring parameters, a restriction to GPU-accelerated properties, and honest limits around server components. It matches its listing. It is a single file with no references or verification step, and 4.3 is the lowest rating among the well-reviewed free skills: a prompt with real opinions, not an encoded method. It clears on evidence and honesty, not depth |
| `clone-site-to-elementor` | $9 | 137 / 5.0 (1) | **Deep-read.** The most-used paid build skill on the marketplace, and it is WordPress, not React. Genuine engineering: it understands Elementor's own data structure rather than emitting HTML blocks, sideloads assets, captures mobile overrides and verifies by screenshot comparison. **Caveat:** requires the creator's own MCP plugin plus Elementor Pro and macOS — proven, but a funnel into the author's product |

**Also cleared:** `ui-component-architect` (free, 115 / 5.0 low n), `Design System MD` (free, 74 /
5.0 (3)) — which fetches 58 brands' real tokens via a third-party CLI and remains the closest
thing to a competitor for our whole Designer shelf.

**Rejected:** the "anti-slop / not-AI-made / template-tell" cluster — five near-identical free
pitches at 3–29 uses. `cinematic-4k-landing-page` (180 / **4.0**) is real demand with a mediocre
rating and a deploy step I would not hand a stranger. Sixteen paid brand-guideline builders at
$5–$49.99 with zero uses between them.

### 2.7 Support — the honest finding is that there is nothing here

Our Support role says it "reads the inbox and tells you which tickets become problems." I
surveyed 20 paid support listings and 9 free ones. **The best-used paid support skill on Agensi
has 4 uses.** The best free one has 2. The listings are not bad — several are well specified,
policy-grounded, with escalation packets and SEND/REVISE/ESCALATE verdicts — they simply have no
customers. `Customer Support Resolution Agent` is $19.99 at zero; `AI Customer Support
(Fintech)` is $39 at zero; a $9/month subscription reply pack, zero.

**Nothing here clears the bar.** Twenty-nine listings, roughly ten recorded uses between them.
This is not an unserved market; it is an absent one.

### 2.8 Producer — half of it is the deadest category on Agensi, half of it is thriving

**Product management is dead.** 120 listings — the smallest category. Six free rows, 24 uses
between them. On the paid side: `PRD: Product Requirements Document` ($14.29),
`Product Discovery Experiment Planner` ($17.99), `Product Requirements Clarity Auditor`
($19.99), `Roadmap Prioritizer` ($9.99), `AI Agent Feature Prioritization Assistant` ($24.99) —
fifteen listings, **three recorded uses between all of them.**

**Documentation and research are alive.**

| Skill | Price | Evidence | Why it clears |
|---|---|---|---|
| `readme-generator` | free | 358 / 5.0 | Reads the project's files, dependencies, env example, Dockerfiles and CI rather than guessing. Six free README generators exist; this is the one anyone uses |
| `pr-description-writer` | free | 223 / 5.0 | Branch diffs, names and commits into a description plus a testing checklist |
| `deep-research-team` | free | 248 / 4.8 (5) | **Deep-read.** A genuine orchestration architecture: a planning phase that designs the research structure, parallel specialist agents dispatched in one round, a synthesis pass that hunts contradictions, a scored review gate, then assembly — with agents relaying through the file system instead of a shared thread, a per-role model assignment, and a rule that every fact carries a source file. By a creator with exactly one skill and 248 uses, the best ratio in the catalogue |

**Also cleared:** `meeting-decision-log` ($5, 82), `cli-ux-doc-builder` ($5, 85),
`truth-first` (free, 185 / 5.0 — labels claims Verified / Inferred / Unknown).

### 2.9 Unclaimed by any of our roles — and one of them is the best-stocked shelf on Agensi

**Agents, prompts and skill engineering.** Agents & Orchestration is the largest category on the
marketplace (2,001 listings) and Prompt & Skill Engineering (343) is the best-used for its size.
This is the one domain with proven demand on **both** sides of the paywall.

| Skill | Price | Evidence | Why it clears |
|---|---|---|---|
| `prompt-engineer` | free | **576 / 4.7** | Fourth most-used skill on the marketplace. Requirements into injection-resistant prompts and structured schemas |
| `skill-creator` | free | 280 / 5.0 (3) | **Deep-read.** A build loop — capture intent, write, test, evaluate, optimise the trigger — that treats *triggering* as the real engineering problem, with separate remedies for under- and over-triggering, a five-criterion evaluation table, and hard rules forbidding data collection and silent network calls. Method, not wrapper |
| `temporal-reasoning-sleuth` | $15 | 118 / 5.0 (1) | **Deep-read.** The proof that the meta role monetises. Architecture patterns for reasoning over event histories — event graphs with causal edges, pre-computed chain indexes, windowed synthesis — aimed at three named query types. States honestly that it provides the architecture and does not populate the graph, and points at another skill for that |

**Also cleared:** `ai-productivity` (free, 177 / 5.0), `skill-router` (free, 80 / 5.0),
`agent-handoff-orchestrator` (free, 60 / 5.0), `agensi-skill-authoring` (free, 54 / 4.8),
`skill-polisher` (free, 76 / 5.0). Plus the six skill-security auditors in §2.3. **Five separate
free skills exist purely to hand context from one agent to the next** — that is a customer
need visible in the supply.

**Rejected:** the paid orchestration tier — `subagent-orchestration` ($15 and $10),
`context-engineering` ($12), `Agent Skill Authoring Pack` ($24), `Agent Evaluation & Regression
Suite` ($15), `harness-engineering` ($8) and a dozen more: 0–2 uses each. Free owns this.

**Finance & Accounting.** 20 free rows at 3–21 uses, and on the paid side fifteen reconciliation
and close skills at $5–$39.99 with **zero uses between them**. Real breadth, heavily
jurisdictional, no demand. Not a role; a watch item.

**Legal & Compliance.** Fifteen contract reviewers surveyed at $1–$39 plus a subscription;
**fourteen at zero uses**, the best being a free one at 8. The index called this the weakest of
the unmapped five and the paid tier confirms it. Not a role.

**Trading & Investing.** `technical-scanner` (free, 214 / 5.0) is genuinely in the marketplace
top 15, with `python-trading-toolkit` (67 / 5.0) behind it. Real, used, free-rich — and the one
domain where shipping a role attaches liability to us. Recommend not shipping.

**Image and video.** `video-enhancement` (177, **3.7**), `background-removal` (113 / 5.0),
`video-face-swap` (85 / 5.0), `ai-video-maker` (48 / 5.0). Real usage, roughly 520 uses across
the cluster. But the best-used member is the worst-rated well-used skill on the marketplace,
most of them need API keys and metered third-party inference — "free skill" does not mean free
to run — and one of them is a face swapper. Recommend holding.

**Data and analytics.** Fifteen listings surveyed, best 4 uses. Nothing clears.

---

## 3. What the demand actually looks like

Proven use, summed by the job being done rather than by category. Only listings with verified
descriptions are counted; the mislabelled ones (`seo-optimizer`, `social-media-ops`,
`content-writer`) are excluded.

| The job | Roughly | The proof |
|---|---|---|
| Review and judge code | ~2,000 uses | `code-reviewer` 1,934 |
| Build the worker — prompts, skills, agents, orchestration | ~2,000 uses | `prompt-engineer` 576, `skill-creator` 280, `deep-research-team` 248, `ai-productivity` 177, `temporal-reasoning-sleuth` 118 |
| Make the words not sound like a machine wrote them | ~1,100 uses | `humanize-writing` 793, `designer-carousel-post` 132, `content-brainstorm` 105 |
| Write the artifact around the work | ~1,500 uses | `git-commit-writer` 479, `readme-generator` 358, `pr-description-writer` 223, `incident-postmortem` 151, `cli-ux-doc-builder` 85, `meeting-decision-log` 82 |
| Make the interface look designed and move right | ~950 uses | `frontend-motion-wizard` 320, `cinematic-4k-landing-page` 180, `clone-site-to-elementor` 137, `llm-becomes-an-award-winning-designer` 125, `ui-component-architect` 115 |
| Change code with discipline and verification | ~700 uses | `codex-grade-coding` 326, `env-doctor` 256, `java-best-practice-checker` 91 |
| Produce media | ~520 uses | `video-enhancement` 177, `background-removal` 113, `video-face-swap` 85 |
| Find who would buy it | ~370 uses | `GEO-SEO Suite` 115, `web-design-lead-qualifier` 106, `seo-audit-agent` 75, `lead-generation-agent` 72 |
| Trade | ~330 uses | `technical-scanner` 214, `python-trading-toolkit` 67 |
| Secure it | ~200 uses | `security-first` 109, `skill-security-vendor-pack` 36, `security-code-review` 34 |
| **Support a customer** | **~10 uses** | 29 listings, best 4 |
| **Manage a product** | **~25 uses** | 135 listings, best 16 |
| **Buy media** | **0 uses** | 18 listings, zero |
| **Run infrastructure** | **~15 uses** | ~700 listings, best 9 |
| **Review a contract** | **~22 uses** | 26 listings, best 8 |
| **Analyse data** | **~5 uses** | 15 listings, best 4 |

---

## 4. The proposed role design

Eight roles again, but not the same eight. Each is argued from §3. Icons are drawn from the set
`views.ts` actually defines (`catalog runs points search download trash stop send trace clock
tokens cost file info warn check inbox`), so nothing here needs new artwork.

### Keep as they are

**`engineer` — Engineer** · icon `tokens`
> Reads the code before changing it, and reviews like someone who maintains it.

*The blurb survives untouched, which is the strongest thing I can say about it.* A worker here
takes a change request, localises it, makes the narrowest change that works, and proves it ran.
**Evidence:** the largest and best-rated cluster in the catalogue, ~2,700 uses across review and
disciplined change. **Shape-setters:** `code-reviewer` (1,934 / 4.2), `codex-grade-coding`
(326 / 4.8), `env-doctor` (256 / 5.0).

**`security` — Security** · icon `warn`
> Looks for the way in, names the risk plainly, and says what to do first.

Unchanged, with one retarget: its growth is in auditing *skills, prompts, MCP servers and agents*
— a category this marketplace invented — not in web-app pen testing. **Evidence:** ~200 proven
uses; small but real, and the only role where a $75 listing has buyers. **Shape-setters:**
`security-first` (109 / 4.5), `Bounty Security Pattern Master Library` ($75, 19 / 5.0),
`security-code-review` (34 / 5.0).

### Keep the id, widen the remit

**`designer` — Designer** · icon `file`
> Picks the look on purpose, then builds the interface that wears it.

*Changed blurb.* Today the role is "restyles an interface by a named system, to that system's own
numbers" — which describes our 67 packs exactly and describes the catalogue's demand not at all.
Design work with customers lives under Frontend & Web Apps: building the thing, animating it,
componentising it. A worker in the widened role picks or receives a visual position and ships
the interface — markup, tokens, components, motion, states — not just a palette.
**Why keep the id:** 67 packs carry `role: designer` in frontmatter; renaming costs 67 file edits
and breaks any saved link, for no gain the blurb cannot buy.
**Evidence:** ~950 proven uses in build-and-motion versus 2 uses in the category that matches the
old blurb by name. **Shape-setters:** `llm-becomes-an-award-winning-app-site-designer` ($9.99,
125 / 4.5), `frontend-motion-wizard` (320 / 4.3), `ui-component-architect` (115 / 5.0).

### Change

**`reviewer` — Reviewer** (was `qa` — QA) · icon `check`
> Reads it as the last person before the customer, and says ship, fix or stop.

A worker here never writes the thing; it judges the thing and returns a verdict with the
highest-impact fixes first. The rename follows the evidence: QA-as-testing has no customers
(e2e tops out at 15 uses free, zero paid), while QA-as-review is the single biggest job on the
marketplace. It also matches the one format the whole catalogue has converged on — the gate, with
a PASS / REVISE / BLOCK verdict, now published for code, copy, deploys, support replies,
contracts and month-end closes. **Be sceptical about that last part:** of the gates I read, only
the code reviewer and one copy gate have any users. The role is justified by code review plus a
format worth owning, not by the gate flood.
**Shape-setters:** `code-reviewer` (1,934 / 4.2), `Landing Page & Conversion Copy Gate` ($14,
20 / 5.0), `security-code-review` (34 / 5.0).

**`growth` — Growth** (was `marketer` — Marketer) · icon `runs`
> Finds who would buy it, and audits the page that has to sell it.

Marketer was one label over two unrelated jobs, and splitting it is the clearest win in this
design. `growth` keeps the demand half: qualify a prospect, audit the site or page that converts,
produce the document you can send a client. **Evidence:** ~370 proven uses — modest, but it is
the only marketing work anyone pays for, and the shape is consistent across all four picks
(evidence in, sellable deliverable out). The old blurb's promise — "a campaign with one outcome
and one audience" — is campaign planning, which has no proven demand at all.
**Shape-setters:** `GEO-SEO Suite` ($9.99, 115 / 5.0), `web-design-lead-qualifier` (106),
`lead-generation-agent` (72 / 5.0).

**`operator` — Operator** (was `devops` — DevOps) · icon `catalog`
> Gets it out, and writes up honestly what happened when it broke.

*Narrowed deliberately.* The old blurb promised shipping, watching and boring deploys; the
catalogue can stock the shipping and the write-up, and cannot stock the watching — ~700
infrastructure listings with ~15 uses between them, against one $5 postmortem skill with 151.
A worker here cuts the release, repairs the environment, plans the upgrade, and turns an incident
into a timeline with causes, impact and actions.
**Shape-setters:** `incident-postmortem-1` ($5, 151), `ci-cd-pipeline-validator` (free, 27),
`dependency-upgrade-planner` ($5, 91).

### Add

**`writer` — Writer** · icon `send`
> Writes it the way a person would, and leaves a document someone can act on.

The role the catalogue most obviously wants and we most obviously lack. It absorbs Marketer's
content half and Producer's documentation half, because the evidence says they are one hire: the
job is prose that does not read as machine-made, and documents — README, PR description,
postmortem, decision log, carousel, calendar — that someone acts on afterwards.
**Evidence:** ~2,600 proven uses across the two clusters, the deepest shelf on Agensi by a
distance, and the home of the second-most-used skill on the marketplace.
**Shape-setters:** `humanize-writing` (793 / 4.7, 11 reviewers), `readme-generator` (358 / 5.0),
`pr-description-writer` (223 / 5.0).

**`agent` — Agent Engineer** · icon `trace`
> Builds the worker, not the answer — and tests that it fires when it should.

The meta role. A worker here writes prompts and skills, designs the hand-off between agents,
builds the eval that scores them, and vets a skill before it is installed.
**Evidence:** ~2,000 proven uses; the largest category on the marketplace (2,001 listings); the
only domain with proven demand free *and* paid; five separate free skills whose only job is
passing context between agents; and six more that audit skills for injection. **It is also our
own audience's job** — the people shopping our shelf are building workers.
**Shape-setters:** `prompt-engineer` (576 / 4.7), `skill-creator` (280 / 5.0),
`temporal-reasoning-sleuth` ($15, 118 / 5.0).

### Drop

**`support` — Support.** Twenty-nine listings surveyed across free and paid; roughly ten
recorded uses between all of them; the best-funded entries ($19.99, $39, $9/month) have no
buyers at all. A shelf label with nothing to put under it costs us a slot and some credibility.
Drop it, and revisit if the number ever moves.

**`producer` — Producer.** Its product-management half is the deadest corner of the marketplace
(135 listings, ~25 uses). Its live halves move: documentation and briefs to `writer`, research
orchestration to `agent`. The blurb — "takes an idea and returns a brief a crew could turn up
to" — is good writing about work nobody buys.

### Held, with reasons, not shipped

- **`studio`** (image and video, ~520 uses). Real demand. Held because its best-used member is
  rated 3.7, because most of the cluster bills third-party inference, and because one of them is
  a face swapper — a shelf decision, not a data one.
- **`analyst`** (trading, ~330 uses, `technical-scanner` at 214 / 5.0). The best-stocked unmapped
  shelf. Held on liability.
- **`bookkeeper`** (finance, 20 free rows). Held on demand: breadth without buyers, and
  jurisdictional enough that each listing serves one country.

### The eight, in one block

| id | name | icon | status |
|---|---|---|---|
| `engineer` | Engineer | tokens | keep, unchanged |
| `reviewer` | Reviewer | check | renamed from `qa`, widened to the gate |
| `designer` | Designer | file | id kept, remit widened to building the interface |
| `writer` | Writer | send | **new** — absorbs content + documentation |
| `agent` | Agent Engineer | trace | **new** — the meta role |
| `growth` | Growth | runs | renamed from `marketer`, demand half only |
| `operator` | Operator | catalog | renamed from `devops`, narrowed to release and incident |
| `security` | Security | warn | keep, retargeted at agents and skills |
| ~~`support`~~ | — | — | dropped: no demand at any price |
| ~~`producer`~~ | — | — | dropped: split into `writer` and `agent` |

---

## 5. Two premises in the brief the evidence does not support

I was asked to be sceptical, which has to include the brief.

**"LinkedIn and e2e testing are where the demand actually is."** They are where the *supply* is.
LinkedIn: twelve free listings covering the whole loop, best 8 uses; fifteen paid listings
$5–$39, **all zero**. E2E: seventeen free listings, best 15 uses; four paid, **all zero**. Both
are rich shelves nobody shops. The demand in that sentence is real but it sits one level up:
not LinkedIn, but **voice** (`humanize-writing`, 793); not e2e, but **review**
(`code-reviewer`, 1,934).

**"Content/copywriting and Frontend & Web Apps are where the demand is."** Those two hold. They
are the second and fourth largest proven clusters, and both are now first-class roles here.

---

## 6. Where our 68 packs sit against this design

Read from `packs/*/agent.md` frontmatter: 68 packs, **all at `price: 0`**.

| Pack set | Count | Author | Frontmatter role | Lands in |
|---|---|---|---|---|
| The style systems — agentic, ant, artistic, basic, bento, bold, brutalism, cafe, claude, claymorphism, clean, codex, colorful, contemporary, corporate, cosmic, creative, dithered, doodle, dramatic, editorial, enterprise, expressive, fantasy, fiction, flat, friendly, futuristic, geometric, glassmorphism, gradient, immersive, impeccable, levels, lingo, material, matrix, minimal, modern, mono, neobrutalism, neon, neumorphism, pacman, paper, perspective, power, premium, professional, pulse, refined, retro, riso, roku, sega, shadcn, sketch, skeumorphism, sleek, spacious, square, stitch, storytelling, terracotta, tetris, vibrant, vintage | 67 | `typeui.sh` | `designer` | `designer` — the *style* half of a role whose proven demand is the *build* half |
| **Senior Engineer** — "Reads your code before changing it, writes the smallest thing that works, and reviews like someone who has to maintain it" (eleven bundled skills: architect, blast-radius, correct, engineering-principles, interrogate, tdd, show-me-your-work, thermo-nuclear-code-quality-review, why, how, ponytail) | 1 | Dietrich Gebert, Cursor, Poteto — MIT | `engineer` | `engineer` and `reviewer` — it spans both, which is itself an argument the two are one hire |

**The honest accounting.**

1. **Our whole shelf serves one and a half of eight roles.** `writer`, `agent`, `growth`,
   `operator`, `security` and most of `reviewer` have nothing on them. Five of those six are in
   the top six of §3.
2. **67 packs sit on the thin side of their own role.** The style systems supply a visual
   position, which is the part the catalogue's best design skill
   (`llm-becomes-an-award-winning-app-site-designer`, 125 / 4.5) explicitly argues you should
   *derive* rather than pick. The 950 proven uses in that space are for building and animating,
   which no pack of ours does. Our packs answer a question the market asks less loudly than the
   one next to it.
3. **But the aesthetics are a real asset and nobody else has them.** `Design System MD` (74 /
   5.0) fetches 58 brands' tokens from a third-party CLI; that catalogue can serve Stripe, Linear
   and Notion and will never serve riso, dithered, pacman, sega, tetris, doodle or skeuomorphism.
   The asset is fine. It is attached to the wrong verb.
4. **Senior Engineer is in the most contested space on the marketplace** — at least ten free
   skills overlap it, including the #1 (1,934 uses) and #4 (479) listings. Its eleven bundled
   skills are a real differentiator; its listing does not say so.

---

## 7. Honest gaps — where demand is proven and nothing good exists

Ordered by how buildable they are for us.

1. **A build verb for our 67 aesthetics.** Demand proven (~950 uses in frontend build and
   motion); supply proven thin (the best free motion skill is a single-file prompt rated 4.3; the
   paid frontend tier is twenty listings at zero uses). We already own the scarce half — the
   aesthetics. What we would need to build, ourselves: a pass that takes one of our style
   positions and emits tokens, component states, motion with reduced-motion fallbacks, and a
   check that the result was actually applied. **Biggest single opportunity on the list.**
2. **A de-slopper we would stand behind.** 793 uses on one skill, nine competitors, exactly one
   credible rating among them, and that one ships with its own authoring scaffold left in. The
   job is proven and the field is weak. What we would need: a detector with a defensible rubric
   and a rewrite that provably preserves facts, links and code — plus an eval, because this is a
   claim that can be measured and nobody is measuring it.
3. **The incident write-up, free.** 151 people paid $5 for a postmortem skill and **there is no
   free equivalent in the catalogue at all** — the index found none and this pass found none. The
   method is not secret: timeline from evidence, causes without blame, quantified impact, actions
   split by prevention / detection / response. We would write our own.
4. **An eval harness for skills and agents.** Proven demand (`skill-creator` 280,
   `agensi-skill-authoring` 54, and six free skill-security auditors at ~91 uses between them),
   and the paid attempts — `eval-harness-builder` $7.99, `Agent Evaluation & Regression Suite`
   $15, `Agent Skill Authoring Pack` $24 — have **zero** users. The one skill that does ship a
   benchmark set (`codex-grade-coding`) is the best-regarded engineering skill in the catalogue,
   which suggests testability is what buyers reward. It is also our own audience's job.
5. **A reviewer's gate we can defend.** The format has flooded the catalogue and almost none of
   it has users, which means the format is available and un-owned. The bar is set by
   `code-reviewer` at 4.2 from 17 reviewers — good, not stellar. A gate that runs the failing
   test before it reports, and labels proven versus inferred, would beat the field.
6. **Hand-off between agents.** Five free skills exist for nothing else, the best at 60 uses, and
   the paid attempts sit at 0–2. A visible need with no proven answer.

### Gaps that are not opportunities

Said plainly, because a padded list would be worse than a short one:

- **Customer support.** 29 listings, ~10 uses. The market is absent, not unserved.
- **Paid media.** 18 listings, zero uses, up to $67. Do not build here.
- **Product management.** 135 listings, ~25 uses. The deadest corner of the marketplace.
- **Cloud infrastructure.** ~700 listings, ~15 uses. Everything with traction nearby is the
  paperwork, not the infrastructure.
- **Contract review.** 26 listings, ~22 uses, prices to $39. Demand is not there, and the
  liability is.
- **Data analysis.** 15 listings, best 4 uses.

---

## 8. Caveats on this pass specifically

1. **`install_count` is the only signal with any weight, and it is a weak one.** It counts uses,
   not satisfaction. `prompt-dataset-builder` has 162 uses and a 1.0 rating. Every conclusion
   above that rests on use counts inherits that weakness.
2. **Relevance sort cannot be enumerated either.** Thirteen queries is thirteen windows onto
   ~17,000 listings. A domain I did not query could hold something good. The zero-use pattern was
   so consistent across thirteen unrelated domains — frontend, e2e, copy, support, paid media,
   orchestration, legal, finance, devops, product, data, LinkedIn, security — that I am
   confident in the shape, not in any single absence.
3. **Paid skills were judged from their preview, not their body.** `get_skill` on a paid listing
   returns the description, use cases, permissions, limitations, creator and a truncated preview;
   nothing was purchased, so for paid finalists I judged the page's specificity and honesty — how
   precisely it names its passes, whether it states what it will not do — not the shipped
   instructions. Free finalists were read in full. That asymmetry favours free skills on
   substance and should be remembered when reading §2.
4. **The marketplace's own hygiene is still poor.** Placeholder hosts in manifests, an unfilled
   authoring scaffold in the second-most-used skill, a V4 description contradicting its own
   Known Limitations, four clones of one copy gate at four prices, a creator with 256 listings
   averaging 1.9 uses. Nothing here should be shelved sight-unseen.
5. **Capability, not content.** Every capability described above exists in several places and is
   nobody's to own; none of it is Agensi's. No instructions, scripts or bodies from any listing
   are reproduced in this file, and nothing above proposes republishing someone else's skill as
   ours. Where §7 says a capability is worth having, it says what we would have to build.
