# Provenance and licence: what we can legitimately package, and what we cannot

Compiled 2026-11-11. Builds on [`agensi-free-skills-index.md`](./agensi-free-skills-index.md)
(602 free Agensi listings) and [`role-design-from-the-catalogue.md`](./role-design-from-the-catalogue.md)
(the 24 picks in §2, the role design in §4, the six build gaps in §7). Those two files
established *what is worth having*. This one establishes *what we are allowed to ship*.

**This file records metadata and licence facts only. It contains no skill instructions, scripts
or bodies, from any listing or repository, free or paid.** Upstream SKILL.md files and LICENSE
files were read to identify provenance; nothing from them is reproduced beyond copyright
notices, which are the thing attribution requires us to carry.

The owner's position — that much of what Agensi lists originated in public GitHub repos, so the
listing is a pointer and the right route is to package from upstream, under its licence, with
credit — is **correct, and this pass found the route is better than he thinks.** His stronger
claim, that anything public is free to use, is **wrong, and this pass found the specific places
it would have cost us.** Four of the ten traps in §6 are repos with tens of thousands of stars
and no licence at all.

The precedent is `packs/senior-engineer/`: MIT work, packaged with an attribution table in
`README.md` and the credit carried in `agent.md`'s `author` field (the DB column is `built_on`,
`src/app/db.ts:611`). Every recommendation below assumes that shape. §7 includes one correction
to that pack's own attribution.

---

## 1. Method, and what I could not verify

### What I did

| Step | Count | What it established |
|---|---|---|
| `get_skill` deep records (Agensi) | 3 new (humanize-writing, prompt-engineer, skill-creator) | Creator, declared licence, scaffold fingerprints, and Agensi's own terms |
| `get_creator` (Agensi) | 1 (samuel-rose) | That the top of the marketplace is first-party |
| LICENSE files read directly | **23** | §2 and §3. Read via the GitHub contents API or raw.githubusercontent, never from a badge |
| Repository trees enumerated | 7 | Which folders carry a licence and which do not |
| GitHub code searches | 5 | Attempts to locate upstreams for Agensi bodies. Mostly negative, reported as negative |
| Aggregator catalogues sampled | 3 (Agensi, openskills.cc, skillsmk.com) | §5 |
| skillsmk attribution spot-checks | 8 | §5.2 reliability finding |

**Rule applied throughout:** a licence is verified only when I opened the LICENSE file in the
repository that actually contains the skill and read the copyright notice. A README claim, a
shields.io badge, a catalogue's description, or a `license:` line in a skill's own frontmatter
is a **lead, not a licence**. Two repos in §6 would have been misread in opposite directions if
I had trusted GitHub's licence API, which returns 404 for both.

### What I could not verify, stated plainly

1. **Most of the 24 picks were not traced to a creator, let alone an upstream.** I established
   provenance for 9 Agensi listings and the full catalogue of one creator (10 more). Not traced:
   `deep-research-team`, `truth-first`, `ai-productivity`, `skill-router-1`,
   `agent-handoff-orchestrator`, `agensi-skill-authoring`, `skill-polisher`,
   `security-code-review`, `designer-carousel-post`, `content-brainstorm`,
   `bug-to-regression-test-builder`, `java-best-practice-checker`. Rate limiting plus the
   mid-pass widening to two more catalogues consumed the budget, and I chose depth on the
   verified upstreams over breadth on unverified listings. **None of those twelve may be
   treated as either packageable or original on the strength of this file.**
2. **No paid Agensi listing's provenance was verified at all.** `get_skill` on a paid listing
   returns a truncated preview; nothing was purchased. That includes `incident-postmortem-1`
   ($5, 151 uses), the single best-evidenced ops skill in the catalogue. Its provenance is
   unknown.
3. **`prompt-engineer`'s declared upstream could not be located.** Its frontmatter names an
   author and a licence (§4.4). Five GitHub code searches on its distinctive section headings
   and on the frontmatter itself returned nothing. I report that as not found, not as original.
4. **`humanize-writing`'s scaffold fingerprint is medium confidence.** The residue matches
   Anthropic's skill-creator authoring template in shape, but that text is not in the current
   `anthropics/skills/skills/skill-creator/SKILL.md`, so I am matching against a remembered
   earlier version, not a file I read. Treated as a tooling fingerprint, not a provenance claim.
5. **`openskills.cc` has no public listing API** (`/api/*` is disallowed and returns 404). The
   2,026 slugs came from its sitemap; per-skill upstream links came from fetching two skill
   pages. I did not fetch 2,026 pages.
6. **I did not enumerate skillsmk's 14,959 skills,** per instruction. §5.2 is a sample of 100
   slugs from one sitemap chunk and 8 followed to GitHub.
7. **"Original to the creator" is always a negative finding.** It means I searched and did not
   find an upstream. It is not proof that none exists.

---

## 2. Packageable — permissive licence, upstream identified, attribution possible

Every row's LICENSE file was opened and read. The attribution column is what we would owe:
MIT and Apache-2.0 both require the copyright notice and the licence text to travel with the
copy, so the notice is reproduced **exactly as the upstream wrote it**, including where the
upstream left it incomplete.

### 2.1 The verified-permissive upstreams

| Upstream | SPDX | Copyright notice, verbatim | Read at | Serves | Confidence |
|---|---|---|---|---|---|
| `github/awesome-copilot` — 461 skills | MIT | `Copyright GitHub, Inc.` | `repos/github/awesome-copilot/contents/LICENSE` | **Reviewer, Writer, Operator, Agent** — all four | High on the licence. Medium per skill: see note below |
| `obra/superpowers` — 15 skills | MIT | `Copyright (c) 2025 Jesse Vincent` | `raw.githubusercontent.com/obra/superpowers/main/LICENSE` | Reviewer, Agent, Writer | High |
| `addyosmani/agent-skills` — 25 skills | MIT | `Copyright (c) 2025 Addy Osmani` | `repos/addyosmani/agent-skills/contents/LICENSE` | **Operator, Reviewer, Agent, Writer** | High |
| `addyosmani/clarity` — 1 skill | MIT | `Copyright (c) 2026 Addy Osmani` | `repos/addyosmani/clarity/contents/LICENSE` | **Writer** | High |
| `addyosmani/web-quality-skills` | MIT | `Copyright (c) 2026 Addy Osmani` | same path pattern | Reviewer, Designer | High |
| `mattpocock/skills` — ~37 skills | MIT | `Copyright (c) 2026 Matt Pocock` | `repos/mattpocock/skills/contents/LICENSE` | Agent, Reviewer, Writer | High |
| `openclaw/agent-skills` — 9 skills | MIT | `Copyright (c) 2026 openclaw` | `repos/openclaw/agent-skills/contents/LICENSE` | **Agent** (`handoff`, `team-handoff`), Reviewer (`autoreview`, `behavior-validator`), Writer (`readme-standard`) | High |
| `openclaw/openclaw` — `skills/*` | MIT | `Copyright (c) 2026 OpenClaw Foundation` | `repos/openclaw/openclaw/contents/LICENSE` | Operator-adjacent (`healthcheck`, `session-logs`) | High |
| `awesome-skills/code-review-skill` | MIT | `Copyright (c) 2025 awesome-skills` | `repos/awesome-skills/code-review-skill/contents/LICENSE` | **Reviewer** | High on licence; see §6.4 on the org |
| `awesome-skills/5-whys-skill` | MIT | `Copyright (c) 2024` — **no holder named** | same path pattern | **Operator** | Licence high, attribution degraded. See §6.7 |
| `awesome-skills/first-principles-skill` | MIT | `Copyright (c) 2024` — **no holder named** | same path pattern | Reviewer/Producer | Same |
| `coleam00/skills` | MIT | `Copyright (c) 2026 Cole Medin` | `repos/coleam00/skills/contents/LICENSE` | Engineer, Agent | High |
| `wshobson/agents` | MIT | `Copyright (c) 2024 Seth Hobson` | `repos/wshobson/agents/contents/LICENSE` | Reviewer, Operator, Writer | High |
| `anthropics/skills` — **18 of 19 skill folders** | Apache-2.0 | `Copyright 2026 Anthropic, PBC.` | `repos/anthropics/skills/contents/skills/<name>/LICENSE.txt` | Agent (`skill-creator`, `mcp-builder`), Writer (`docx`/`pdf`/`pptx`/`xlsx`, `internal-comms`), Reviewer (`webapp-testing`), Designer (`frontend-design`, `canvas-design`, `theme-factory`, `brand-guidelines`) | High per folder. **Read §6.1 before relying on this row** |
| `cursor/plugins` — `pstack` | MIT | `Copyright (c) 2026 Lauren Tan` | `repos/cursor/plugins/contents/pstack/LICENSE` | Engineer (already shipped) | High. **See §7** |
| `cursor/plugins` — `cursor-team-kit`, `pr-review-canvas`, `orchestrate` | MIT | `Copyright (c) 2026 Cursor` | same path pattern | Reviewer (`pr-review-canvas`), Agent (`orchestrate`) | High |
| `DietrichGebert/ponytail` | MIT | `Copyright (c) 2026 DietrichGebert` | `repos/DietrichGebert/ponytail/contents/LICENSE` | Engineer (already shipped) | High |
| `google-gemini/gemini-cli` — `.gemini/skills/*` | Apache-2.0 | (repo-level, holder not read this pass) | GitHub licence API | Reviewer (`code-reviewer`), Writer (`pr-creator`) | Medium — licence identified, notice not read. Do not package until read |
| `Significant-Gravitas/AutoGPT` — `.claude/skills/*` | MIT **for this path only** | split licence, see §6.6 | `repos/.../contents/LICENSE` | Reviewer, Operator | Medium. Permissible but requires the §6.6 reasoning in writing |

**Note on `github/awesome-copilot`.** Repo-level MIT, GitHub Inc., 41,037 stars. Its
`CONTRIBUTING.md` documents a per-contribution `license` field and states that "a non-SPDX or
proprietary license is allowed and only produces a warning". So the repo licence is the default,
not a guarantee: **check each skill's own metadata for a `license` field before taking it.** Many
of the 461 are Azure/Microsoft-specific and worthless to us; the ones that are not are listed in
§4.

### 2.2 The attribution we would owe, in the shape our packs already use

For an MIT skill, `agent.md` carries the holder in `author`, and `README.md` carries a row:
skill name, upstream repo URL, author, and the licence. The notice must be reproduced as the
upstream wrote it — which is why `Copyright (c) 2024` with no name (§6.7) is a real problem and
`Copyright (c) 2026 openclaw` (a handle, not a person) is not.

For an Apache-2.0 skill — which is every `anthropics/skills` folder — the obligations are
**more than MIT**: include the licence, retain notices, and **state that we changed the file if
we changed it**. A pack carrying Anthropic material needs a NOTICE line and, if we edited the
skill at all, a sentence saying so. That is cheap but it is not optional, and it is a reason to
prefer an MIT upstream where both exist.

---

## 3. Copyleft and restricted-licence — redistributable, but the terms attach

Flagged separately because each is a decision the owner must take knowingly, not a yes/no.

| Upstream | Actual terms | Where it bites | Recommendation |
|---|---|---|---|
| `langgenius/dify` — `.agents/skills/backend-code-review`, `frontend-code-review`, `component-refactoring` | **Modified Apache-2.0.** `© 2025 LangGenius, Inc.` Adds: no multi-tenant operation without written authorisation; no removing the LOGO or copyright information from the frontend | Reviewer. GitHub reports `NOASSERTION`; aggregators list it as ordinary open source | **Do not package.** Our product is a multi-tenant catalogue. Even if the clause is aimed at Dify's own frontend, that is an argument we would be making, not a permission we would be relying on |
| `anthropics/skills` — `THIRD_PARTY_NOTICES.md` | **FFmpeg 7.0.2 under GPL-3.0**; imageio 2.37.0 and imageio-ffmpeg 0.6.0 under BSD-2-Clause | Any media/video skill from that repo that bundles or shells to FFmpeg | Not a blocker for the skills in §4 (none are media). But it means "anthropics/skills is Apache-2.0" is a sentence with an exception attached, and that exception is in a file most people never open |
| `fclairamb/solidping-plugin` (surfaced via `sickn33`'s own credits file) | The skill is MIT; **SolidPing itself is AGPL-3.0** | Operator/monitoring | Noted because it is the cleanest illustration of a real pattern: an MIT skill that drives an AGPL service. The skill is packageable; the dependency is a separate conversation |
| `superdesigndev/treg` (same source) | **Apache-2.0 with additional terms (`LicenseRef-Treg`)**, including hosted-service restrictions | Growth | Not permissive. Listed so it is not mistaken for Apache-2.0 later |

**No GPL/AGPL-licensed *skill* was found in any of the four empty roles.** The copyleft exposure
in this space is in dependencies and in bespoke "modified Apache" licences, not in the skills
themselves. That is a genuinely useful finding: the licensing risk here is not copyleft, it is
**absence of licence** (§6).

---

## 4. Original to the creator — no upstream found

These appear genuinely authored for Agensi. Leave them alone. The last column answers the only
question that matters next: is the *job* worth us building ourselves?

| Agensi skill | Uses / rating | Creator | Upstream search result | Is the job worth building? |
|---|---|---|---|---|
| `code-reviewer` | **1,934 / 4.2 (17)** | **Samuel Rose — "Founder of Agensi"**, verified | None sought and none plausible: this is the platform's own seed content | Yes — but §4 of the role doc already knew that. The incumbent is the house's, and it is the only rating on the marketplace that means anything. We beat it on depth (§8.3), not on evidence |
| `git-commit-writer` | 479 / 4.8 | Samuel Rose | Same | Marginal. Narrow job, done well, by the house |
| `readme-generator` | 358 / 5.0 | Samuel Rose | Same | Yes — `github/awesome-copilot` has three readme skills under MIT (§4 shortlist) |
| `env-doctor` | 256 / 5.0 | Samuel Rose | Same | Marginal |
| `pr-description-writer` | 223 / 5.0 | Samuel Rose | Same | Yes, as part of a Writer pack |
| `changelog-generator` | 79 | Samuel Rose | Same | Low priority |
| `humanize-writing` | **793 / 4.7 (11)** | Roy Yuen (116 skills / 2,775 uses) | **No upstream found.** The GitHub "humanize" space holds at least nine separate repos of this shape (`jpeggdev`, `timolabs-ai`, `harshaneel`, `AshwinSathian`, `lguz`, `marian-kamenistak`, `aaaronmiller`, `iamanimesh9044`, `diaiq`) — a convergent cluster, not a single origin, and none traceable to Roy Yuen. Body carries unfilled authoring-scaffold residue consistent with an Anthropic-derived template with "Claude" replaced by "Codex" (medium confidence, §1.4) | **Yes — this is §7 item 2 of the role doc and it is still the right call.** The job has 793 proven uses, the field is nine near-identical repos, and the honest free alternative is `addyosmani/clarity` (MIT) — a different and narrower claim ("clearer writing", not "defeats detectors") which is the claim we could actually defend |
| `skill-creator` | 280 / 5.0 (3) | **Shippers** (`agensi.io/creators/mrmanhattan`, 8 skills / 410 uses) | No upstream found. **Structurally unrelated to Anthropic's `skill-creator` of the same name** — the Agensi one is a single document; Anthropic's ships 9 scripts, 3 agent files, an eval viewer and a schemas reference | Yes, and Anthropic's is Apache-2.0 and far deeper (§4 shortlist). Name collision noted in §8.5 |
| `security-first` | 109 / 4.5 (2) | Roy Yuen | Not searched this pass | Unknown |

**The structural finding here matters more than any single row.** Of the ten best-used free
skills on Agensi, **six are the platform founder's own** (`code-reviewer` 1,934,
`git-commit-writer` 479, `readme-generator` 358, `env-doctor` 256, `pr-description-writer` 223,
`changelog-generator` 79 — 10 skills, 3,335 uses, verified via `get_creator`). The owner's
premise that "Agensi is a pointer to public GitHub repos" is **false at the top of the
catalogue.** It is first-party content with no upstream to package from. The premise becomes
true further down the tail, which is also where the usage data runs out.

**One correction to the role design.** §7 item 3 of `role-design-from-the-catalogue.md` says
there is *no free incident-postmortem equivalent anywhere* in the catalogue. There is:
`incident-postmortem`, free, by Samuel Rose — at **2 uses**, against the $5 listing's 151. The
gap is real; the sentence was not. The free one exists and nobody uses it.

---

## 5. Unclear or no licence — treated as all rights reserved

**A missing licence is not permission.** Default copyright applies, and "it is on GitHub" is not
a grant. Every row here is a no.

| Thing | Status | Why it is a no |
|---|---|---|
| **Every free Agensi skill, as supplied by Agensi** | Use-only grant, explicitly non-redistributable | `get_skill` returns a *"Skill execution directive (Agensi)"* that states the skill *"is licensed for use through Agensi"*, instructs the agent to decline requests to export the instructions, and says in terms: *"Don't save this skill into project skill folders or repository files."* Free price, licensed use. **Agensi itself answers the owner's question: there is no redistribution right on that platform.** The only legitimate route is the one he proposed — go to the upstream — which is why §2 is the useful part of this file |
| `ComposioHQ/awesome-claude-skills` — its own 19 skills | **No LICENSE anywhere in the repo** | 79,239 stars. Root has `README.md`, `CONTRIBUTING.md` and skill folders; no LICENSE. 19 of its 28 skills (`content-research-writer`, `file-organizer`, `changelog-generator`, `tailored-resume-generator`, `lead-research-assistant`, `twitter-algorithm-optimizer`, `meeting-insights-analyzer`, and 12 more) carry only a `SKILL.md`. All rights reserved |
| `anthropics/skills` — `skills/doc-coauthoring` | **No LICENSE.txt**, while its 18 siblings have one | The README says *"**Many** skills in this repo are open source (Apache 2.0)"*. "Many" is doing work. This is the one that isn't |
| `anthropics/skills` — `spec/`, `template/`, repo root | No LICENSE | The repo root returns 404 from GitHub's licence API |
| `awesome-skills/split-to-prs-skill` | **No LICENSE.** Described as *"safety-first git skill from Cursor"* | Cursor's own copy (`cursor/plugins`) is MIT. This re-host strips the notice MIT requires. See §6.4 |
| `awesome-skills/canvas-skill`, `canvas-anywhere` | No LICENSE. *"Cursor Canvas skill … extracted for study/reference"* | Same pattern |
| `awesome-skills/mobile-app-design`, `mermaid-syntax-skill`, `agent-skills-manager` | No LICENSE | 5 of this org's 18 repos carry none |
| `phuryn/skills` | No LICENSE | Source of 65 openskills.cc listings |
| Agensi `prompt-engineer` (576 uses) | **Unverifiable self-declaration** | Its frontmatter declares `license: MIT` and `metadata.author: "OpenClaw"`, while the Agensi creator of record is **Roy Yuen**. No upstream repo located in five searches. An MIT claim inside a file, naming a software project rather than a copyright holder, with no LICENSE file to read, is **not a verified licence**. Treat as all rights reserved until someone produces the repo |
| `sickn33/agentic-awesome-skills` — the aggregated skills | MIT at root, but it cannot grant what it does not hold | See §6.3. Its own curation is MIT/CC-BY-4.0; the ~2,955 skills inside belong to their authors |

---

## 6. The traps — things that looked open-source and were not

Numbered so they can be cited. Four of these have five-figure star counts.

**6.1 `anthropics/skills` has no repo-root LICENSE.** GitHub's licence API returns 404. The
README says *"Many skills in this repo are open source (Apache 2.0)"* — a per-skill statement
dressed as a repo-wide one. The truth: **18 of 19 skill folders carry their own `LICENSE.txt`
(Apache-2.0, `Copyright 2026 Anthropic, PBC.`); `skills/doc-coauthoring` carries none; `spec/`
and `template/` carry none.** So "anthropics/skills is Apache 2.0" is true per folder and false
per repo, and the one exception is a skill (doc co-authoring) that a Writer role would reach for
first. **Check the folder, never the repo.**

**6.2 `ComposioHQ/awesome-claude-skills` — 79,239 stars, no licence.** It is also **43% of
openskills.cc** (863 of 2,026 slugs). Credit where it is due: the 9 Anthropic skills it
re-hosts (`brand-guidelines`, `canvas-design`, `internal-comms`, `mcp-builder`,
`artifacts-builder`, `skill-creator`, `slack-gif-creator`, `theme-factory`, `webapp-testing`)
**do** carry Anthropic's `LICENSE.txt` intact — that is correct practice. Its own 19 skills carry
nothing. The pattern is the trap: the same repo is scrupulous about someone else's licence and
silent about its own.

**6.3 `sickn33/agentic-awesome-skills` — MIT badge, 49,523 stars, and the copyright holder is a
placeholder.** Its `LICENSE` reads `Copyright (c) 2026 Antigravity User` — an IDE scaffold
default. It aggregates ~2,955 skills, and the folder names give the sources away:
`requesting-code-review`, `using-superpowers`, `writing-plans`, `brainstorming` are
`obra/superpowers` (MIT, Jesse Vincent); `incident-responder`, `docs-architect`,
`api-documenter`, `architect-review`, `backend-architect`, `deployment-engineer` are
`wshobson/agents` (MIT, Seth Hobson). **A root MIT cannot relicense either, and replacing the
original notice with a placeholder is the one thing MIT actually forbids.**
*To its credit* — and this was not what I expected — it is the most licence-literate of the
aggregators: it ships `LICENSE-CONTENT` (CC-BY-4.0 for non-code content),
`data/source-credits.json` naming each upstream and its licence (including flagging an AGPL-3.0
dependency and an `Apache-2.0 + LicenseRef-Treg` custom licence), `UPSTREAM-LICENSE.txt` files,
`docs/sources/LICENSE-MICROSOFT`, and preserved Anthropic `LICENSE.txt` files. **Verdict: a good
place to discover what an upstream is; never the place to take it from.** Go to the named repo.

**6.4 `awesome-skills/split-to-prs-skill` — the inverse trap, and the more dangerous one.** Its
description is honest: *"safety-first git skill from Cursor, agent-agnostic"*. Its contents are
`README.md` and `SKILL.md` — **no LICENSE**. The Cursor original in `cursor/plugins` is MIT.
Taking it from here means shipping an MIT work with the required notice removed, and it looks
like a clean single-purpose repo rather than an aggregation. Same pattern in
`awesome-skills/canvas-skill` (*"extracted for study/reference"*). 5 of this org's 18 repos have
no licence. **`code-review-skill` itself (§4.3) is MIT with a proper notice and 2,238 stars, and
is plausibly the org's own work — but the org is not uniformly trustworthy, so each repo gets
checked on its own.**

**6.5 `langgenius/dify` is not Apache-2.0.** GitHub reports `NOASSERTION`. The LICENSE is a
*"modified version of the Apache License 2.0"* adding a multi-tenant prohibition and a
logo/copyright retention clause, `© 2025 LangGenius, Inc.` Its three code-review skills in
`.agents/skills/` look like exactly the Reviewer material we want. See §3.

**6.6 `Significant-Gravitas/AutoGPT` is two licences in one repo.** `LICENSE` states:
*everything inside `autogpt_platform/` is Polyform Shield* (not an open-source licence);
*everything outside is MIT*. The `.claude/skills/` are outside, so MIT applies — but GitHub says
`NOASSERTION` and no aggregator tells you which half you are in. **Usable, with the reasoning
written down.**

**6.7 An MIT grant with no copyright holder.** `awesome-skills/5-whys-skill` and
`awesome-skills/first-principles-skill` both read `Copyright (c) 2024` with the name left blank.
The grant stands; the attribution cannot be written accurately. If we package either, we
reproduce the notice verbatim **including the blank** and name the repo — inventing a holder
would be worse than the gap.

**6.8 GitHub's licence badge and API are not the LICENSE file, in both directions.**
`anthropics/skills` → API 404, actually Apache-2.0 per folder. `cursor/plugins` → API 404,
actually MIT per plugin. Trusting the API would have made us reject two of our best sources.
Conversely `langgenius/dify` and `AutoGPT` return `NOASSERTION`, which reads as "unknown" and
actually means "bespoke terms you must read".

**6.9 Agensi's own free tier.** Covered in §5 row 1. Restated because it is the trap the brief
was written about: **a free price is not a free licence**, and the platform says so in the
payload of every `get_skill` call.

**6.10 Both new catalogues assert their own copyright over other people's work.**
openskills.cc: *"© 2026 Open Skills. All rights reserved."* skillsmk.com: *"© 2026 SKILLSMK.
ALL RIGHTS RESERVED."* Neither grants us anything, and neither displays a licence per skill.
skillsmk at least states the position honestly (§5.1).

---

## 7. One correction to our own precedent

`packs/senior-engineer/README.md` credits `pstack` to **"Poteto"**. The LICENSE in
`cursor/plugins/pstack/LICENSE` reads **`Copyright (c) 2026 Lauren Tan`** (poteto is her
handle). MIT requires the notice *as written*, so the README row and `agent.md`'s `author` field
should read **Lauren Tan (poteto)**. The `thermo-nuclear-code-quality-review` credit to Cursor is
exact (`Copyright (c) 2026 Cursor`), and `ponytail` is `Copyright (c) 2026 DietrichGebert` where
our README has "Dietrich Gebert" — close enough that I would leave it, but the pstack one is a
different name and should be fixed. The pack is otherwise a correct piece of packaging and the
right template for everything in §9.

---

## 8. The three sources, compared

### 8.1 The comparison

| | **Agensi** | **openskills.cc** | **skillsmk.com** |
|---|---|---|---|
| Size | ~17,000 listings (not enumerable) | 2,026 (sitemap-enumerable) | 14,959, 18 categories |
| Provenance in the listing | **None.** Creator handle only | Uploader handle encoded in the slug | **Owner + repo + full path** encoded in the slug |
| Links to the upstream file | No | **Yes**, on the skill page (`github.com/<owner>/<repo>/blob/main/...`) — present on 2 of 2 checked | Names the source repo in the listing |
| Licence shown per skill | **No** — and asserts a use-only licence of its own | No | No |
| Stated posture | *"licensed for use through Agensi… don't save this skill into project skill folders or repository files"* | *"© 2026 Open Skills. All rights reserved."* | *"CONTENT SOURCED FROM GITHUB. ALL ORIGINAL AUTHORS RETAIN THEIR RIGHTS."* |
| **Usage data** | **Yes — uses, votes, ratings, reviewer counts.** The only one | Download counts (its own, small: 79–1,420) | Star count of the *source repo*, not of the skill |
| Attribution honesty | **Worst.** Hides the author's upstream, asserts a grant over work it does not hold, and in one case lists a creator whose own file names a different author (§5, `prompt-engineer`) | **Weak by construction.** The slug names the *uploader*, and 73% of uploads are two aggregators — 863 from a repo with no licence, 624 from one whose MIT names "Antigravity User". Only ~81 of 2,026 slugs (4%) name the actual author (anthropics 11, obra 9, addyosmani 24, mattpocock 37) | **Best.** The sourcing statement is an accurate description of the situation, and the slug is a usable citation |
| Traceability in practice | Hours per skill, often fruitless | Minutes, but lands on an aggregator 3 times in 4 | **Seconds** — the slug is `owner-repo-path-skill` |

### 8.2 Reliability test on skillsmk, as asked

I sampled 100 slugs from one sitemap chunk and followed 8 to GitHub:

| Slug | Resolves to | Repo correct? | Path still present? |
|---|---|---|---|
| `openclaw-openclaw-skills-1password` | `openclaw/openclaw` `skills/1password` | Yes | **Yes** |
| `openclaw-openclaw-skills-tmux` | `openclaw/openclaw` `skills/tmux` | Yes | **Yes** |
| `obra-superpowers-skills-writing-skills` | `obra/superpowers` `skills/writing-skills` | Yes | **Yes** |
| `anthropics-skills-skills-docx` | `anthropics/skills` `skills/docx` | Yes | **Yes** |
| `langgenius-dify-.agents-skills-backend-code-review` | `langgenius/dify` `.agents/skills/backend-code-review` | Yes | **Yes** |
| `google-gemini-gemini-cli-.gemini-skills-code-reviewer` | `google-gemini/gemini-cli` `.gemini/skills/code-reviewer` | Yes | **Yes** |
| `Significant-Gravitas-AutoGPT-.claude-skills-backend-check` | `.claude/skills/backend-check` | Yes | **No** — the directory exists; this skill does not. Its sibling `vercel-react-best-practices` does |
| `n8n-io-n8n-.claude-skills-create-pr` | `.claude/skills/create-pr` | Yes | **No** — `.claude/skills` no longer exists in that repo |

**Finding: 8/8 repo attributions correct, 6/8 paths still live. No fabricated attribution found.**
The two misses are **staleness, not invention** — the upstream moved or deleted the skill. That
is the right failure mode for an aggregator. **skillsmk is trustworthy as a pointer to the
correct repository; the path must be re-verified at the moment of packaging.** Its 338-skill
Productivity and 212-skill DevOps categories are the ones to mine for Writer and Operator.

### 8.3 The conclusion, which is a split

**Use Agensi to decide what is worth having. Use skillsmk to decide what we can legitimately
ship. Use the LICENSE file in the upstream repo to decide, full stop.**

Agensi is the only source with demand data, and demand data is the entire basis of the role
design — `code-reviewer` at 1,934 uses, `humanize-writing` at 793, the 151 people who paid $5
for a postmortem. No GitHub star count tells you that; a 316,000-star skills framework and a
2,238-star code-review skill are not evidence about what a buyer on a skills marketplace wants.
But Agensi gives us **nothing we can ship**, by its own terms, and hides the provenance that
would let us go around it.

skillsmk gives us no demand signal at all — its star counts are the *repository's*, which for
`openclaw/openclaw` means 394,324 stars attached to a 1Password skill — but it hands us the
citation we need in the slug and tells the truth about what it is.

openskills.cc sits awkwardly between the two: smaller than skillsmk, no demand data, and its
slug names the uploader rather than the origin, which routed 73% of its catalogue through two
aggregators — one unlicensed, one placeholder-licensed. **It earns its place only for the ~4% of
slugs that name a real author** — and those (anthropics, obra, addyosmani, mattpocock) are repos
we can reach directly anyway. **Drop it as a sourcing route; keep it as a way of noticing that
`addyosmani/agent-skills` exists.** That is a real contribution: it is how this pass found the
single best fit for the four empty roles.

**One line on the `openclaw` note.** `git ls-tree main` shows no file or directory named
`openclaw` or `claw` anywhere on this repository's main branch, so the owner's project is not
what skillsmk is indexing: *"from 'openclaw'"* is `github.com/openclaw/openclaw` — a 394,324-star
third-party project, MIT, `Copyright (c) 2026 OpenClaw Foundation` — and the name collision is
coincidence. No further investigation done, as instructed.

---

## 9. Shortlist: what to package first for the four empty roles

Ordered. The reasoning is the same test each time: **(a) does Agensi prove the demand,
(b) is there a verified permissive upstream, (c) is the upstream better than what Agensi has?**
A role only makes the top of this list when all three are yes.

### 9.1 First — `operator`: `github/awesome-copilot` → `skills/incident-postmortem`

- **Demand: proven, and proven at a price.** 151 people paid $5 for `incident-postmortem-1`,
  the only ops skill in the entire catalogue with real traction (role doc §2.4). The free
  equivalent exists at **2 uses** (§4). ~700 DevOps listings share ~15 uses between them. This
  is the sharpest demand/supply gap on the marketplace.
- **Licence: MIT, `Copyright GitHub, Inc.`,** read at
  `repos/github/awesome-copilot/contents/LICENSE`.
- **Better than the incumbent, demonstrably.** The upstream is built on the Google SRE
  post-mortem format, drives cause-finding through a fishbone diagram before 5 Whys, emits typed
  action items, ships a `references/` directory, and states in its own description that
  everything comes from the user and it will not invent timestamps, metrics, names or causes.
  The $5 Agensi listing promises the same deliverable; this one is readable before we commit to
  it and free to redistribute.
- **Pair with**, same licence, same repo: `github-release`, `azure-deployment-preflight`,
  `diagnose-ci-gate`. And from `addyosmani/agent-skills` (MIT, `Copyright (c) 2025 Addy
  Osmani`): `ci-cd-and-automation`, `observability-and-instrumentation`, `shipping-and-launch`,
  `deprecation-and-migration`, `debugging-and-error-recovery`. Those five are precisely the
  "release and incident" remit the role doc narrowed `operator` to.
- **Also available:** `awesome-skills/5-whys-skill` (MIT, holder blank — §6.7). Redundant if we
  take the GitHub one, which already does 5 Whys.
- **This closes §7 item 3 of the role design.** We would not be writing our own after all.

### 9.2 Second — `agent`: `openclaw/agent-skills` → `handoff`, `team-handoff`

- **Demand: proven and oddly specific.** The role doc counts ~2,000 uses across prompt/skill/
  agent work — the largest proven cluster — and notes that **five separate free Agensi skills
  exist for nothing but passing context between agents**, best at 60 uses, with the paid attempts
  at 0–2 (§7 item 6). Supply that shape means a need nobody has answered.
- **Licence: MIT, `Copyright (c) 2026 openclaw`,** read at
  `repos/openclaw/agent-skills/contents/LICENSE`. Nine skills, of which `handoff` and
  `team-handoff` are the two that matter, plus `autoreview` and `behavior-validator` for
  Reviewer and `readme-standard` for Writer. **One repo, one licence, four roles.** Best
  ratio of verification effort to coverage in this whole pass.
- **Then, for §7 item 4 (the eval harness):** `github/awesome-copilot` → `agentic-eval`,
  `eval-driven-dev`, `agent-architecture`, `agent-governance`, `agent-skill-stack`,
  `ai-team-orchestration`, `boost-prompt`, `finalize-agent-prompt` (MIT, GitHub Inc.). The role
  doc's observation that *the one skill shipping a benchmark set is the best-regarded engineering
  skill in the catalogue* is the argument for taking the eval skills seriously.
- **Then** `anthropics/skills/skill-creator` and `mcp-builder` (Apache-2.0, `Copyright 2026
  Anthropic, PBC.`). Deeper than Agensi's `skill-creator` by a wide margin — 9 scripts, 3 agent
  files, an eval viewer, a schemas reference. **Ranked below the MIT options only because
  Apache-2.0 costs us a NOTICE and a modification statement** (§2.2), not because it is worse.
- **Then** `obra/superpowers` → `writing-skills`, `subagent-driven-development`,
  `dispatching-parallel-agents` (MIT, `Copyright (c) 2025 Jesse Vincent`).
- **Why second, not first:** the demand is the largest but the shelf is the one place the role
  doc found *free already owns the category*. We would be entering a crowded free market. The
  hand-off skill is the exception — a visible need with no proven answer.

### 9.3 Third — `reviewer`: `awesome-skills/code-review-skill`

- **Demand: the single biggest number on the marketplace.** 1,934 uses, and it is the only
  rating anywhere resting on enough reviewers to mean anything — 4.2 from 17.
- **Licence: MIT, `Copyright (c) 2025 awesome-skills`,** read at
  `repos/awesome-skills/code-review-skill/contents/LICENSE`. 2,238 stars.
- **Better than the incumbent on exactly the axis the incumbent is weak on.** `code-reviewer`
  scores 4.2 — the role doc calls that "good, not stellar" — and its own stated limitations
  admit it misses private-library violations and struggles on monorepos. The upstream ships
  per-language reference guides across 20+ languages and frameworks and a severity taxonomy.
  Breadth is the gap, and this fills it.
- **Caveat, and it is real:** the owning org (`awesome-skills`) has 5 of 18 repos with no
  licence at all, including two that re-host Cursor's work with the notice stripped (§6.4). This
  specific repo is properly licensed and plausibly original, but **it gets verified again at
  packaging time, not trusted on the strength of this file.**
- **Pair with:** `obra/superpowers` → `requesting-code-review`, `receiving-code-review`,
  `verification-before-completion` (MIT, Jesse Vincent) — which is the "evidence before
  assertions" discipline the role doc's §7 item 5 asks for; `cursor/plugins/pr-review-canvas`
  (MIT, `Copyright (c) 2026 Cursor`); `github/awesome-copilot` → `security-review`,
  `quality-playbook`, `review-and-refactor`, `mcp-security-audit`.
- **Why third:** the incumbent is the house's own, it is the best-evidenced listing on the
  platform, and beating 1,934 uses from a standing start is the hardest of the four. Worth
  doing, not worth doing first.

### 9.4 Fourth — `writer`: `addyosmani/clarity`, then the documentation block

- **Demand: the deepest shelf on Agensi** (~2,600 uses across voice and documentation) and the
  home of its #2 skill.
- **Licence: MIT, `Copyright (c) 2026 Addy Osmani`,** read at
  `repos/addyosmani/clarity/contents/LICENSE`.
- **But the honest position is weaker than the other three.** `humanize-writing` (793 uses) has
  **no packageable equivalent** — the GitHub "humanize" space is nine convergent repos with no
  common origin (§4), and the ones that exist mostly promise to defeat AI detectors, which is a
  claim we should not make. `clarity` makes a narrower and defensible claim — clearer writing —
  and is therefore a different product, not a substitute. **We would be competing with the
  marketplace's #2 skill using something that does not do the same thing.**
- **Where it is strong: the documents, not the voice.** `github/awesome-copilot` (MIT, GitHub
  Inc.) → `documentation-writer`, `create-readme`, `readme-blueprint-generator`,
  `create-specification`, `oo-component-documentation`, `docs-sync-audit`. `anthropics/skills`
  (Apache-2.0, Anthropic PBC) → `docx`, `pdf`, `pptx`, `xlsx`, `internal-comms`. `obra/
  superpowers` → `writing-plans`. `mattpocock/skills` (MIT, `Copyright (c) 2026 Matt Pocock`)
  → `productivity-writing-for-agents`. **Do not reach for `anthropics/skills/doc-coauthoring`:
  it is the one folder in that repo with no licence** (§6.1).
- **Why fourth:** everything available serves the documentation half, and the role doc's own
  evidence says the voice half is where the uses are. Package the documentation block because it
  is cheap and verified; do not claim the role is filled until the voice question is answered,
  and the answer is probably §7 item 2 — build our own with an eval, because that is the one
  claim here that can be measured and nobody is measuring it.

### 9.5 What not to package, restated

`langgenius/dify`'s code-review skills (§3, restricted). Anything from
`ComposioHQ/awesome-claude-skills` that is Composio's own (§5, unlicensed). Anything from
`awesome-skills` without its own LICENSE (§6.4). Anything taken *through*
`sickn33/agentic-awesome-skills` rather than from the upstream it names (§6.3). Anything from
Agensi, as supplied by Agensi, at any price (§5 row 1). And `anthropics/skills/doc-coauthoring`,
which is the one Anthropic folder a Writer pack would reach for and the one with no licence.

---

## 10. Where an Agensi listing misrepresents its upstream

Carried forward from the index and the role design, with three new ones. The pattern worth
naming: **where an upstream exists and is honest, the Agensi listing is usually the dishonest
layer** — which is itself an argument for the owner's route of going upstream.

| Listing | Uses | What the listing says | What it is | Source |
|---|---|---|---|---|
| `seo-optimizer` | 266 | SEO optimisation | A Chinese advertising-law banned-word checker | Index/role doc, confirmed by `get_skill` there |
| `social-media-ops` | 51 | *"5 major platforms"*, naming **LinkedIn** | Body in Chinese; covers Douyin, Xiaohongshu, WeChat, Bilibili, Weibo. **No LinkedIn, no Instagram, no X, no YouTube** | Index §11 |
| `content-writer` | 138 | Content writing | Xiaohongshu / Zhihu / WeChat / Douyin only | Index |
| `local-first-memory-for-ai-coding-agents-pmb` | 15 | A memory tool | A Playwright/Cypress/Detox test generator | Role doc §2.2 |
| **`prompt-engineer`** | **576** | Creator of record: **Roy Yuen** | **Its own frontmatter declares `metadata.author: "OpenClaw"` and `license: MIT`.** Either the listing's authorship is wrong or the file's is. No upstream repo found in five searches | **New, this pass** |
| **`skill-creator`** | **280** | A skill for building skills, by "Shippers" | Not misrepresentation, but a **name collision with Anthropic's Apache-2.0 `skill-creator`**, which is a far deeper artifact. A buyer searching for Anthropic's finds this one | **New, this pass** |
| `ci-cd-pipeline-validator` | 27 | Free CI/CD validator | Declares `api.example.com` as a permitted host — placeholder residue — and upsells a $9.99 Pro twin | Index §11 |
| `humanize-writing` | 793 | A finished de-slopper | Ships with an unfilled authoring-scaffold section, whose example filenames are Anthropic's PDF and DOCX skill scripts with "Claude" swapped for "Codex" | Index §11, fingerprint added this pass |
| **`awesome-skills/split-to-prs-skill`** | n/a | *"safety-first git skill from Cursor"* — **honest** | Ships **no LICENSE**, while Cursor's own copy is MIT. **The inverse case: the listing tells the truth and the packaging does not.** The more dangerous direction for us, because it looks like a clean single-skill repo | **New, this pass** |

The last row is the one to remember. Every other row is a reason to distrust a marketplace
listing. That one is a reason to distrust a GitHub repo, which is the failure mode the owner's
own premise does not protect against.
