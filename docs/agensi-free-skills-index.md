# Agensi free-skills index, read against our eight roles

Compiled 2026-11-11 against the live Agensi MCP connector. Every row below was returned by a
`search_skills` call in this session and is free (`pricing_type: "free"`, `price_usd: 0`); the
deep records were confirmed with `get_skill`. Install counts and ratings are copied verbatim.

**This file records metadata about skills. It contains no skill instructions, scripts or bodies.**

---

## 1. Summary, honestly

**What was done.** 50 `search_skills` queries across all 33 Agensi categories plus 14 marketing
sub-channels, one `get_popular` listing, one creator profile, and 6 `get_skill` deep records.
**602 distinct free skills are recorded in the 47 tables below**, across 665 rows — about 40
skills appear in two sections where they genuinely serve both roles. That is a sample, not a
census — see *Method and its limits*.

**The free tier is real, and it is large.** Free is not the bargain bin here. Of the 25
most-used skills on the whole marketplace, 20 are free, including all of the top twelve. The
single most-used skill on Agensi (`code-reviewer`, 1,931 uses) is free, as are #2
(`humanize-writing`, 792) and #3 (`prompt-engineer`, 576). A shelf built only from free
listings would not look like a shelf of leftovers.

**But the numbers are thinner than they look.** Install counts are heavily top-loaded. Below
roughly the 50th most-used skill, essentially everything sits in single digits, and most
listings in the catalogue have `install_count: 0` and `rating: null`. **Of the 602 free skills
here, about 60 have 20+ uses, about 15 have 100+, and only six carry a rating from more than
five reviewers.** Everything else is in single or low double digits. Ratings cluster
at exactly 5.0 on 1–3 reviews, which tells you nothing. **Treat every number under ~20 uses as
noise, and every 5.0 on fewer than 5 reviews as unrated.**

**Three creators account for a large slice of the free tier.** Verified from creator profiles
and recurring naming:

| Creator | Skills | Total uses | Pattern |
|---|---|---|---|
| Roy Yuen | 116 | 2,770 | Owns `humanize-writing` (792) and `security-first` (108); the rest are long-tail |
| Timoranjes (Zicheng Liao) | 107 | 621 | Explicit free→Pro ladder: each free skill upsells a paid twin |
| Joker | 76 | 918 | The "…Engine" family — one free Engine per discipline, across all eight of our roles |
| Samuel Rose | 10 | 3,334 | Agensi's own founder; owns `code-reviewer`, the #1 skill on the marketplace |

So when a role below shows "a dozen free options", several of them are often one creator's
series under different titles. **Breadth in the listings is not breadth in the authorship.**

**Where free is rich:** Writing & Content, Security, Code Quality & Review, Testing &
Debugging (especially Playwright/e2e), Frontend & Web Apps, LinkedIn, YouTube, Reddit, SEO,
Sales & Lead Gen, Agents & Orchestration, Prompt & Skill Engineering, Translation &
Localization (almost 100% free), Trading & Investing.

**Where free is empty or near-empty:** UX & UI Design, Education & Learning, Product
Management, Google Ads, X/Twitter, Pinterest, affiliate marketing, marketing analytics,
customer support, DevOps & Cloud (695 listings, best free one has 9 uses), LLM Ops, Legal &
Compliance. Full accounting in §12.

---

## 2. Method and its limits

Verified constraints, worked around rather than re-litigated:

- **`max_price: 0` does not filter.** Free was determined client-side on
  `pricing_type === "free"`.
- **The catalogue cannot be enumerated** (~17,000 skills; the connector times out on broad
  queries). Everything here comes from targeted per-role and per-sub-role queries.
- **`sort=most_installed` is the key technique.** Default relevance sort gives paid skills a
  1.25× boost, so a relevance query inside a category returns almost nothing free — the first
  `apis-backend` relevance query returned 24 results, 1 of them free. The same category under
  `most_installed` returned 18 results, 15 free. Every table below was built with
  `most_installed`.
- **`most_installed` with an empty query returns `[]`.** It needs a query term.
- **`most_installed` appears to drop most zero-use listings**, which is why result sets are
  short (often 6–25) and why genuinely new free skills are under-represented here.
- **Rate limiting is real.** Two parallel calls triggered `"Agensi is busy for a moment"`
  immediately; sequential calls with a short gap ran clean for the remaining ~45 queries.

**What this means for the counts.** 602 is the number of free skills *surfaced and recorded*,
not the number that exist. The true free population is larger and skewed toward zero-use
listings this method cannot see. Nothing here is extrapolated: if a row is in a table, a search
returned it, and its uses and rating are copied from that response.

---

## 3. Engineer

Mapped categories: APIs & Backend (761), Frontend & Web Apps (543), Mobile Development (180),
Data & Databases (338), Web3 & Crypto (84), Game Development (178).

### 3.1 Backend and APIs

| Skill | Slug | Uses | Rating | Requires | What it does |
|---|---|---|---|---|---|
| backend-pro-max | `backend-pro-max` | 48 | 5.0 (low n) | terminal | Architecture blueprints, production code or reliability audits from a stack |
| api-contract-validator | `api-contract-validator` | 13 | — | terminal, Node, Python, openapi-to-postmanv2 | Validates OpenAPI specs against live responses; reports contract drift |
| stripe-billing-scaffold | `stripe-billing-scaffold` | 7 | — | terminal | Stripe billing with webhooks and metered usage, TS or Python |
| Developing Features — Security-First | `developing-features-security-first-production-code` | 7 | — | read/write files | Spec → feature with tests after security/reuse checks |
| laravel bug finder | `laravel-bug-finder` | 6 | — | — | Diagnoses Laravel errors, returns targeted fixes |
| API Contract Doc Builder | `api-contract-doc-builder` | 5 | — | env, read/write, web | Routes/schemas/middleware → verified reference + machine-readable contract |
| Spring REST Controllers | `spring-rest-controllers` | 4 | — | — | Controllers with DTOs, validation, error handling, HATEOAS |
| REST API Conventions for Spring Boot 4 | `rest-api-conventions-for-spring-boot-4` | 4 | 5.0 (low n) | — | Contract-compatible controller changes against existing routes |
| Threads API | `threads-api` | 4 | — | env, terminal, read/write, web | Validates Threads API code against Meta's publishing/OAuth/quota rules |
| x402-api-paywall | `x402-api-paywall` | 4 | — | env, Python | x402 paywalls on FastAPI/Express routes |
| x402 Paywall | `x402-paywall` | 4 | — | terminal, read, web | Per-call USDC paywalls on HTTP APIs or MCP tools |
| REST API Contract Generator | `rest-api-contract-generator` | 3 | — | — | OpenAPI-ready contracts from route code or descriptions |
| REST API Design: APIs Developers Love | `rest-api-design-apis-developers-love` | 3 | 5.0 (low n) | web | Requirements → OpenAPI 3.1, or audits an existing API |
| Architecture Design: Trade-offs, Failures, Threats | `architecture-design-trade-offs-failures-threats` | 1 | — | — | System idea → quantified trade-offs, failure/threat tables |

**Read:** the free backend tier is competent but shallow — one skill with real use
(`backend-pro-max`, 48) and a long tail at 3–13. API *design* is where the paid listings
concentrate: the relevance query returned eight paid API-contract designers at $5–$39 before
the first free one. `api-contract-validator` is the most interesting free row because it does
something the paid designers don't: checks a spec against a running service.

### 3.2 Frontend and web apps

| Skill | Slug | Uses | Rating | Notes |
|---|---|---|---|---|
| frontend-motion-wizard | `frontend-motion-wizard` | 320 | 4.3 | Static React/Tailwind → Framer Motion transitions. Highest-used free frontend skill |
| cinematic-4k-landing-page | `cinematic-4k-landing-page` | 180 | 4.0 | Builds + deploys a landing page with brand image prompts and GSAP |
| ui-component-architect | `ui-component-architect` | 115 | 5.0 | Responsive Tailwind components and landing sections |
| Design System MD | `design-system-md-brand-quality-ui-via-design-md` | 73 | 5.0 (3 rev) | Pulls 58 brands' design systems via `getdesign` CLI into a DESIGN.md. **See §13** |
| Frontend Development Engine | `frontend-dev-engine` | 34 | — | Routes project type → framework/build/CSS (Joker "Engine" family) |
| Frontend Design — Production-Grade UI | `frontend-design-production-grade-ui-with-distinctive-aesthetics` | 31 | — | HTML/CSS/React/Vue from a named bold aesthetic |
| anti slop design | `anti-slop-design` | 29 | 5.0 | Audits frontend code/briefs → bespoke tokens, platform-specific UI |
| nextjs-app-router-audit | `nextjs-app-router-audit` | 18 | 5.0 | Line-specific findings on a Next.js App Router codebase |
| react-hooks-auditor | `react-hooks-auditor` | 16 | — | Stale closures, missing cleanup, severity-ranked |
| Consistent Web Design | `consistent-web-design` | 14 | 4.0 | Audits pages → unified tokens, Tailwind config or CSS vars |
| Landing Page Component Kit | `landing-page-component-kit` | 12 | — | Accessible token-styled sections from a CSS theme file |
| Responsive Landing Page Auditor | `responsive-landing-page-auditor` | 9 | 4.0 | Responsive issues + copy-paste CSS fixes |
| Frontend Accessibility Reviewer | `frontend-accessibility-reviewer` | 9 | — | WCAG 2.1 AA issues with code fixes |
| typescript-type-auditor | `typescript-type-auditor` | 9 | — | Seven-category type-safety findings and a score |
| UI Art Director | `ui-art-director-composition-first-ui-design-critique` | 8 | — | Attention budgets, composition grammars, hierarchy review |
| responsive ui review assistant | `responsive-ui-review-assistant` | 8 | — | Evidence-based responsive failure points per viewport |
| UI Component Architect (accessible) | `ui-component-architect-reusable-accessible-components` | 8 | 5.0 | Refactors duplicated UI into token-based components with stories/tests |
| Pragmatic React & TypeScript Conventions | `pragmatic-react-typescript-conventions` | 8 | — | Feature modules, typed contracts, Suspense boundaries, MUI v7 |
| TypeScript App Blueprint | `typescript-app-blueprint` | 8 | 5.0 | Scaffolds app/API/package/CLI with pnpm tooling |
| Frontend Design Pro | `frontend-design-pro-uis-that-don-t-look-ai-made` | 7 | 5.0 | Responsive UI on an existing stack with interaction states |
| Prototype Builder | `prototype-builder-idea-to-clickable-demo-fast` | 7 | 5.0 | Idea/screenshot → clickable prototype + user-test script |
| cinematic landing pages | `cinematic-landing-pages` | 7 | 5.0 | Cinematic responsive landing page from a brief |
| Frontend UI Design System | `frontend-ui-design-system-tokens-components-qa` | 7 | — | Shared tokens, component states, verification |
| Fullstack Agent Skills | `fullstack-agent-skills` | 6 | — | React 19 / Next App Router feature modules, parallel fetches |
| Tailwind Type Scale Generator | `tailwind-type-scale-generator` | 5 | 5.0 | Tailwind v4 text scale + h1–h6 from base size and ratio |
| Accessibility Audit Commander | `accessibility-audit-commander` | 5 | 5.0 | WCAG 2.2, severity-ranked, with fixes |
| Premium Universal Tool UI/UX & CSS Designer | `premium-universal-tool-ui-ux-css-designer-agent` | 4 | — | Luxury-styled HTML/CSS tool interfaces |
| Elliot's Creative Redesign | `elliot-s-creative-redesign` | 4 | — | Redesigns an app preserving features/data/permissions |
| Design QA — Why Your UI Looks Like a Template | `design-qa-why-your-ui-looks-like-a-template` | 4 | — | Ranked template-tell, visual and a11y fixes with exact CSS |
| anti slop design frontend | `anti-slop-design-frontend` | 3 | — | Strips generic design tropes from an AI-generated prototype |
| design extractor | `design-extractor` | 1 | — | Live URL → DESIGN.md, CSS vars, Tailwind config |

**Read:** this is the richest Engineer sub-role and, notably, **the real free design shelf
lives here, not in UX & UI Design** (§7.1). Frontend has ~30 free listings with four above 100
uses; UX & UI Design has three free listings, none above 2 uses. Anyone shopping for design
skills on Agensi has to look under Frontend.

Genuinely useful: `frontend-motion-wizard`, `nextjs-app-router-audit`, `react-hooks-auditor`,
`typescript-type-auditor`, `accessibility-audit-commander`. Filler: the "anti-slop /
not-AI-made / template-tell" cluster is five near-identical pitches, and the "cinematic
landing page" idea appears three times by two creators.

### 3.3 Mobile

| Skill | Slug | Uses | Rating | Requires |
|---|---|---|---|---|
| react-native-best-practices-architect | `react-native-best-practices-architect` | 23 | — | terminal |
| Mobile App Design: Native-Feeling iOS & Android | `mobile-app-design-native-feeling-ios-android-uis` | 7 | 5.0 | — |
| liquid-glass | `liquid-glass` | 3 | — | — |
| phone action safety gate | `phone-action-safety-gate` | 2 | — | web |
| Android ADB Control | `android-adb-control` | 1 | — | Node 18+, adb, android-mcp-server |
| Omni-UX | `omni-ux` | 1 | — | read files |
| ADB Pilot | `adb-pilot-android-control-for-mcp-agents` | 1 | — | read/write, Python |
| Google Play Release Guide | `google-play-release-guide-flutter-react-native` | 1 | — | terminal, expo, Node |
| ios-onboarding-flow-designer | `ios-onboarding-flow-designer` | 1 | — | — |
| android phone agent | `android-phone-agent` | 0 | — | read files, Python |

**Read:** thin and lopsided. One usable React Native skill; iOS is almost entirely paid
(`swiftui-modernity-assistant` $5, `ios-native-platform-capabilities` $12,
`ios-app-release-gate` $4.99, `expo-build-doctor` $9). Flutter free: nothing. Three of the ten
free rows are Android ADB wrappers that need an external MCP server.

### 3.4 Data and databases

| Skill | Slug | Uses | Rating | Notes |
|---|---|---|---|---|
| Database Design Engine | `database-design-engine` | 29 | — | Workload → DB type + relational/NoSQL design (Joker) |
| Supabase + Prisma | `supabase-prisma-secure-fast-postgres-backends` | 7 | 5.0 | Schemas, migrations, RLS policies, typed clients |
| Supabase Database Builder | `supabase-database-builder` | 7 | — | Normalized migrations with RLS, triggers, indexes |
| sql-query-optimizer | `sql-query-optimizer` | 6 | — | EXPLAIN plans → rewrites, indexes, verification scripts |
| Supabase Auth Security Reviewer | `supabase-auth-security-reviewer` | 6 | — | Audits RLS + auth code, returns corrective SQL |
| SQL Query Explainer | `sql-query-explainer` | 4 | — | Plain-English logic, join maps, risk flags |
| SQL Query Clinic: Correct & Fast | `sql-query-clinic-correct-fast-queries` | 3 | 5.0 | Engine-specific rewrites with before/after timings |
| Django ORM Lens | `django-orm-lens-n-1-migration-safety-schema-map` | 2 | — | N+1 detection; needs `django-orm-lens` + uv |
| Race Condition Fixer | `race-condition-fixer` | 2 | — | Atomic fixes with live-DB stress tests |
| db explorer | `db-explorer` | 1 | — | Needs DB Explorer MCP |
| Zero-Downtime Migrations | `zero-downtime-migrations` | 1 | — | Additive → backfill → contract staging |
| T-SQL to Databricks Migration Auditor | `t-sql-to-databricks-migration-auditor` | 1 | — | Line-cited risk-ranked fixes |
| CSV Import Preflight | `csv-import-preflight-contracts-and-quarantine` | 1 | — | Validates CSV against a contract, quarantines |
| Import Mapping Review | `import-mapping-review` | 1 | — | Traceable column mappings and exceptions |
| spendguard | `spendguard` | 1 | — | Blocks warehouse queries over a USD cap; needs MCP |
| MySQL MCP Server | `mysql-mcp-server` | 1 | — | PII-masked reads, guarded writes via MCP |
| Firebird Database Explorer | `firebird-database-explorer-basic` | 1 | — | Needs Firebird MCP |
| Voltpeer data | `voltpeer-data` | 1 | — | LAND/NEWARE battery-lab exports |
| sql-query-explainer-skill | `sql-query-explainer-skill` | 1 | — | Duplicate of the above concept |

**Read:** Supabase/Postgres is well covered free; the paid side owns migration *safety*
(`sql-query-clinic` $5 at 81 uses, `DB Migration Guardian` $24, `Database Schema & Query Review
Gate` $14). Free `zero-downtime-migrations` (1 use) is the only free answer to that, and
unproven. SQL explainers are duplicated three times.

### 3.5 Web3 and crypto (84 listings — smallest Engineer category)

| Skill | Slug | Uses | Rating |
|---|---|---|---|
| Audit Solidity Defi SC | `audit-solidity-defi-sc` | 10 | 4.0 |
| MoltNode by Chord | `moltnode-by-chord` | 2 | — |
| Chord Charts | `chord-charts` | 2 | — |
| Token Red Flag Check (Free Quick Screen) | `token-red-flag-check-free-quick-screen` | 2 | — |
| solana sensei | `solana-sensei` | 1 | — |
| Chord Swap | `chord-swap` | 1 | — |
| Solidity Smart Contract Security & Gas Auditor | `solidity-smart-contract-security-gas-auditor` | 0 | — |
| solidity dev | `solidity-dev` | 0 | — |

**Read:** `audit-solidity-defi-sc` (10 uses, 4.0, runs Foundry repro tests) is the only free
row with evidence behind it. Paid dominates audit at $7–$49.99. Three of eight free rows are
one vendor's "Chord" suite.

### 3.6 Game development

| Skill | Slug | Uses | Rating |
|---|---|---|---|
| game-dev | `game-dev` | 29 | — |
| godot-gdscript-architect | `godot-gdscript-architect` | 5 | — |
| Agent Audio — Local Sound Effects & Music | `agent-audio-local-sound-effects-music` | 3 | 5.0 |
| arknights streaming plugin dev | `arknights-streaming-plugin-dev` | 1 | — |
| Unity Screenshot Verify | `unity-screenshot-verify` | 1 | — |
| Godot Safe Change — Guarded MCP Workflow | `godot-safe-change-guarded-mcp-workflow` | 1 | — |
| Kids Game Blueprint Generator | `kids-game-blueprint-generator` | 0 | — |

**Read:** free covers Godot (3 of 7 rows) and nothing else seriously. Unity is one screenshot
utility; Unreal and Roblox are paid-only ($20, $9). Every game *design* blueprint is paid
($6.99–$19) — five near-identical "Game Design Blueprint Architect" listings.

### 3.7 Cross-cutting engineering (no single category)

| Skill | Slug | Uses | Rating | Notes |
|---|---|---|---|---|
| git-commit-writer | `git-commit-writer` | 479 | 4.8 | Staged diffs → Conventional Commits. #4 on the marketplace |
| codex-grade-coding | `codex-grade-coding` | 326 | 4.8 | Classifies a task, returns a scope-limited change with verification evidence |
| env-doctor | `env-doctor` | 256 | 5.0 | Diagnoses startup failures, returns exact fix commands |
| Bug to Regression Test Builder | `bug-to-regression-test-builder` | 24 | 5.0 | Bug report/trace/diff → minimal regression test |
| Python Automation Engine | `python-automation-engine` | 25 | 4.0 | Script templates, error handling, scheduling (Joker) |
| Java Fullstack Development Engine | `java-fullstack-engine` | 14 | — | Spring Boot 3.x / Quarkus routing, JVM tuning (Joker) |
| Test Gap Filler | `test-gap-filler-find-untested-code-write-real-tests` | 11 | 5.0 | Finds uncovered code, writes tests in the project's framework |
| agent-rules-generator | `agent-rules-generator` | 9 | — | Framework-specific agent rules for the detected stack |
| Discord Bot Builder | `discord-bot-builder-slash-commands-to-deploy` | 9 | 5.0 | discord.js / discord.py bot to deploy |
| codegraph-ast-grep | `codegraph-ast-grep` | 8 | — | Call paths and AST patterns → scoped refactor targets |
| agent-self-verification-gate | `agent-self-verification-gate` | 8 | — | Build/test/lint/diff → READY or NEEDS ATTENTION |
| Architecture Improver | `architecture-improver-untangle-codebases-safely` | 7 | 5.0 | Dependency/churn audit → ranked, test-verified refactors |
| MCP Server Builder | `mcp-server-builder-ship-mcp-servers-agents-use-well` | 7 | 5.0 | API spec → tested MCP server in TS or Python |
| codebase-archaeology | `codebase-archaeology` | 7 | — | Dependencies, dead code, risk hotspots → onboarding guide |
| senior engineer mode | `senior-engineer-mode` | 7 | 5.0 | Minimal fix + reproduction test. **Overlaps our pack — §13** |
| CLAUDE.md / AGENTS.md Generator | `claude-md-agents-md-generator-onboard-agents-to-any-repo` | 7 | 5.0 | Scans a repo, verifies its commands, writes the file |
| code reviewer pro | `code-reviewer-pro` | 7 | 5.0 | Evidence-labeled findings by severity and confidence |
| Remotion Video | `remotion-video-make-videos-with-react-code` | 7 | 5.0 | Brief + data → React scenes → rendered MP4 |
| python-best-practice-checker | `python-best-practice-checker` | 6 | 5.0 | Semantic, security and perf findings with fixes |
| decomment | `decomment` | 5 | 5.0 | Strips comments, preserves linter directives and TODOs |
| test driven development | `test-driven-development` | 5 | 5.0 | Failing reproduction test before the fix |

**Read:** the strongest free Engineer material is here, not in any one category.
`git-commit-writer` (479 / 4.8) and `codex-grade-coding` (326 / 4.8) are the two free Engineer
skills with enough reviewers to mean something. Language-specific free coverage: Python ✓,
TypeScript ✓, React ✓, Java ✓ (one Joker Engine), Go ✗ (paid only, `Go Clean Architecture` $12),
Rust ✗, PHP/Laravel ✓ (one, 6 uses), C#/.NET ✗.

---

## 4. QA

Mapped: Testing & Debugging (579), Code Quality & Review (572).

### 4.1 Code review

| Skill | Slug | Uses | Rating | Notes |
|---|---|---|---|---|
| Code Reviewer | `code-reviewer` | 1,931 | **4.2 (17 reviews)** | The most-used skill on Agensi, and the only free one with a statistically meaningful rating. Deep record in §11 |
| Socratic Code Reviewer | `socratic-code-reviewer` | 26 | 4.0 | Findings framed as probing questions |
| Strict Code Review | `strict-code-review` | 22 | 5.0 | Java/Spring PR diffs against repo conventions |
| aaai26-ai-review | `aaai26-ai-review` | 21 | 5.0 | Research-paper PDFs, not code |
| sdd-kit | `sdd-kit` | 21 | 5.0 | Audits specs/ADRs/task lists for contradictions |
| react-hooks-auditor | `react-hooks-auditor` | 16 | — | (also §3.2) |
| cognitive-load-reducer | `cognitive-load-reducer` | 15 | — | Complexity measurement → targeted refactor diffs |
| test-coverage-auditor | `test-coverage-auditor` | 14 | — | Critical-path gaps, missing edge cases, weak assertions |
| tech-debt-scanner | `tech-debt-scanner` | 12 | — | Severity- and churn-ranked debt across five categories |
| sql-query-reviewer | `sql-query-reviewer` | 12 | 5.0 | SQL/ORM security, perf, correctness with ORM-specific fixes |
| AI Code Review: Every Bug Gets a Failing Test | `ai-code-review-skill-every-bug-gets-a-failing-test` | 9 | 4.0 | Runs a failing test for serious bugs before reporting |
| code reviewer pro | `code-reviewer-pro` | 7 | 5.0 | (also §3.7) |

### 4.2 Debugging and root cause

| Skill | Slug | Uses | Rating |
|---|---|---|---|
| lobster-debugging | `lobster-debugging` | 58 | — |
| Bug to Regression Test Builder | `bug-to-regression-test-builder` | 24 | 5.0 |
| prod-bug-hunter | `production-bug-hunter` | 20 | 4.0 |
| Systematic Debugging: Root Cause First | `systematic-debugging-root-cause-first` | 11 | — |
| Effective Debugging with Grok | `effective-debugging-with-grok` | 10 | — |
| Env Doctor: Fix "It Won't Run on My Machine" | `env-doctor-fix-it-won-t-run-on-my-machine` | 8 | 5.0 |
| Root Cause Debugger | `root-cause-debugger-fix-real-causes-not-symptoms` | 7 | 5.0 |
| Offline Package Provenance Check | `offline-package-provenance-check` | 6 | 5.0 |
| Node Debug Inspector | `node-debug-inspector` | 6 | — |

### 4.3 E2E and browser testing — the richest free QA sub-role

| Skill | Slug | Uses | Rating | Requires |
|---|---|---|---|---|
| Local-first memory for AI coding agents (PMB) | `local-first-memory-for-ai-coding-agents-pmb` | 15 | — | browser, env, web |
| Playwright E2E Test Generator | `playwright-e2e-test-generator` | 11 | — | Playwright, Node |
| rf-seleniumlib-to-browser-lib | `rf-seleniumlib-to-browser-lib` | 9 | 5.0 | terminal, browser, Python |
| robot-to-playwright-converter | `robot-to-playwright-converter` | 8 | — | Playwright, Node |
| Playwright Browser QA Autopilot | `playwright-browser-qa-autopilot` | 6 | — | browser, env, read/write |
| Local Web Interface Probe | `local-web-interface-probe` | 4 | — | terminal, browser |
| Browser Automation with Playwright | `browser-automation-with-playwright` | 3 | 5.0 | Playwright, Node, Python |
| Test Follow-up | `test-follow-up` | 3 | — | browser |
| Terminal Browser Operator | `terminal-browser-operator` | 2 | — | Node |
| flaky-test-detector | `flaky-test-detector` | 2 | — | terminal, jest, Node |
| playwright e2e mcp | `playwright-e2e-mcp` | 2 | — | Playwright, Node |
| Browser Access | `browser-access` | 1 | — | Chrome DevTools MCP |
| LaPage Playwright CLI | `lapage-playwright-cli` | 1 | — | playwright-cli, Node, Git |
| Playwright MCP | `playwright-mcp-drive-a-local-browser-from-an-agent` | 1 | — | Playwright MCP, Node |
| use my browser | `use-my-browser` | 1 | — | terminal, browser, web |
| Create Verification: Let Your Agent Run Your App | `create-verification-let-your-agent-run-your-app` | 1 | — | browser, Git |
| Delivery Optimization | `delivery-optimization` | 1 | — | browser |

**Read on QA:** the best-evidenced free skill on the entire marketplace is a QA skill. Below
`code-reviewer`, though, the pattern is nine free code reviewers and nine free root-cause
debuggers saying much the same thing at 5–58 uses. `flaky-test-detector` (free, 2 uses) vs
`Flaky Test Detective` ($9.99/mo subscription, 2 uses) is the clearest free-vs-paid head-to-head
in the catalogue, and neither has traction.

Two listing-hygiene problems worth the owner's attention:
`local-first-memory-for-ai-coding-agents-pmb` is titled as a memory tool but its `best_for`
describes generating Playwright/Cypress/Detox tests — name and function disagree.
`aaai26-ai-review` sits in Code Quality & Review but reviews academic PDFs, not code.

---

## 5. Security

Mapped: Security (744).

| Skill | Slug | Uses | Rating | Requires | Notes |
|---|---|---|---|---|---|
| security-first | `security-first` | 108 | **4.5 (2 rev)** | none | Preventive brief: trust boundaries, assumptions, verification *before* coding. Deep record §11 |
| skill-security-vendor-pack | `skill-security-vendor-pack` | 36 | 5.0 | terminal, web, Python | Audits a *skill folder*, JSON findings + client-ready report |
| Security Code Review | `security-code-review` | 34 | 5.0 | read files | CWE-mapped, severity-rated, with an approval verdict |
| skill-install-safety-gate | `skill-install-safety-gate` | 27 | — | terminal, env, web | Audits a skill package/ZIP, pass/fail |
| ai-security-auditor | `ai-security-auditor` | 21 | — | terminal, read/write, web | Agent prompts, tools, RAG pipelines |
| AI Prompt Injection Defense Shield | `ai-prompt-injection-defense-shield-llm-jailbreak-security-auditor-code-review-agent` | 20 | — | terminal, read/write, env, web | Next.js / Python LLM backends |
| prompt-injection-auditor | `prompt-injection-auditor` | 12 | — | none | SKILL.md injection and capability risks |
| agent-skill-security-auditor | `agent-skill-security-auditor` | 12 | — | web, Python | SKILL.md + companion files, scored |
| dependency-health-check | `dependency-health-check` | 12 | — | terminal, web, Python | CVEs, outdated versions, workspace conflicts |
| appsec review | `appsec-review` | 8 | 5.0 | many (Node, Python 3.10+, Git) | Independently verified vulns scored with CVSS 4.0 |
| dockerfile-hardener | `dockerfile-hardener` | 7 | — | web | 18-rule score + hardened replacement |
| Security Audit: Verified Vulnerabilities, Secrets & Fixes | `security-audit-verified-vulnerabilities-secrets-fixes` | 7 | 5.0 | terminal, read, Git | Verified exploit paths, severity, CWE, applyable fixes |
| prompt-injection-auditor-v2 | `prompt-injection-auditor-v2` | 6 | — | terminal, read, web, Node | Prompts, MCP tool defs, RAG corpora; CVSS + adversarial tests |
| mcp server security audit | `mcp-server-security-audit` | 5 | — | two MCPs | Injection, authz, scope, session vulns in MCP servers |
| kubernetes-manifest-reviewer | `kubernetes-manifest-reviewer` | 4 | — | Python | Security, resource, reliability, secret, network findings |
| OWASP Security Reviewer | `owasp-security-reviewer` | 4 | — | terminal, Python | OWASP Top 10:2025, CWE-mapped |
| Passive Domain Recon | `passive-domain-recon` | 4 | — | web | DNS/CT subdomains, certs, headers, WHOIS → CSV |
| Skill Security Scanner | `skill-security-scanner-check-skills-before-install` | 4 | — | terminal, Python, Git | SAFE / REVIEW / DANGEROUS with file:line evidence |

**Read:** Security has the healthiest free tier of any Develop-group category — 18 free rows,
five with 20+ uses. It also has the most *interesting* free tier, because six of the eighteen
audit skills and agents themselves (SKILL.md injection, skill packages, MCP servers, RAG
pipelines). That is a category Agensi's own marketplace created, and free owns it outright.

For our Security role as written ("looks for the way in, names the risk plainly, says what to do
first"), the three to look at are `security-code-review` (34 / 5.0, CWE-mapped with a verdict),
`security-first` (108 / 4.5, the preventive counterpart), and `appsec-review` (8 / 5.0, the only
one that independently verifies before reporting). Paid holds the heavyweight end: `Bounty
Security Pattern Master Library` ($75, 19 uses, 5.0) and the $14 gates.

---

## 6. DevOps

Mapped: DevOps & Cloud (695), LLM Ops (745).

### 6.1 Containers, cloud, infrastructure

| Skill | Slug | Uses | Rating | Requires |
|---|---|---|---|---|
| docker-compose-linter | `docker-compose-linter` | 9 | — | terminal, web |
| Dockerfile Optimizer | `dockerfile-optimizer-analyzer-hardened-templates` | 3 | — | terminal, web |
| Docker Ops: Small, Secure Containers | `docker-ops-small-secure-containers` | 3 | — | read/write, web |
| dataecho | `dataecho` | 3 | — | terminal, env, web |
| terraform-iac-reviewer | `terraform-iac-reviewer` | 2 | — | — |
| setting-up-sending-domain | `setting-up-sending-domain` | 2 | — | env, web (Mailtrap) |
| Kubernetes k8s mcp server | `kubernetes-k8s-mcp-server` | 1 | — | K8s MCP |
| Infrastructure mcp operator | `infrastructure-mcp-operator` | 1 | — | Infrastructure MCP |
| Production Infrastructure & DevOps | `production-infrastructure-devops` | 1 | — | read/write, web |
| DevOps Engine | `devops-engine` | 12 | — | — (Joker) |
| Cybersecurity Engine | `cybersecurity-engine` | 12 | — | — (Joker) |

### 6.2 CI/CD and release

| Skill | Slug | Uses | Rating | Notes |
|---|---|---|---|---|
| ci-cd-pipeline-validator | `ci-cd-pipeline-validator` | 27 | — (3 votes) | Best-used free DevOps skill. GH Actions / GitLab / CircleCI / Jenkins. Deep record §11 |
| git release automation lite | `git-release-automation-lite` | 8 | 5.0 | Changelog, release notes, semver, readiness verdict |
| RepoSensei | `reposensei` | 8 | 4.7 | Audits a repo, configures OIDC releases with SHA-pinned CI |
| ci-cd-security-audit-lite | `ci-cd-security-audit-lite` | 4 | — | Five high-impact risks in one workflow, JSON out |
| Git Release Composer | `git-release-composer` | 4 | 5.0 | Changelog + commit + PR description, kept consistent |
| ci-cd-pipeline-architect | `ci-cd-pipeline-architect` | 2 | — | Generates security-gated pipelines from manifests |
| zero downtime deploy | `zero-downtime-deploy` | 2 | — | Atomic symlinks, Nginx canary, health-check rollback |
| CI Failure Snapshot | `ci-failure-snapshot` | 2 | — | GH Actions run JSON → failure snapshot + next checks |
| pr-release-notes-architect | `pr-release-notes-architect` | 2 | — | Diffs → PR description, release notes, changelog |
| CI Sunset Guard Lite | `ci-sunset-guard-lite-macos-14-node-20-actions-check` | 1 | — | macOS 14 / Node 20 retirement scan |
| Ship PR | `ship-pr` | 1 | — | Dev deploy → PR-draft approval → `gh pr create` |

### 6.3 LLM Ops (745 listings, 7 free rows surfaced)

| Skill | Slug | Uses | Rating |
|---|---|---|---|
| prompt-engineer | `prompt-engineer` | 576 | 4.7 (also §15.5) |
| Eval Dataset Builder | `eval-dataset-builder-test-your-ai-before-users-do` | 7 | 5.0 |
| Skill Vetter: Is This Skill Safe? | `skill-vetter-is-this-skill-safe` | 3 | 5.0 |
| Production LLM Systems Builder | `production-llm-systems-builder` | 3 | — |
| Inference Indexer | `inference-indexer` | 2 | — |
| Apprentice Capture | `apprentice-capture` | 1 | — |
| Evaluating AI Output — Evals, pass@k & pass^k | `evaluating-ai-output-evals-pass-k-pass-k-graders` | 1 | — |

**Read — this is the weakest mapped role.** DevOps & Cloud lists 695 skills and the best-used
free one has **9 uses**. Terraform free: one reviewer at 2 uses. Kubernetes free: two MCP
wrappers at 1 use each. No free incident/postmortem skill at all — `Incident Postmortem` is $5
with 151 uses, one of the best-used paid skills anywhere. Meanwhile the paid side is dense and
priced seriously (`Multi-Cloud Kubernetes & OpenShift Deploy Pro` $19, `Deploy Automation Pack`
$6.99, `Cloud & Infrastructure Config Security Gate` $14, plus an entire $1-each "Repair <X>"
series). LLM Ops is worse: 745 listings, and apart from `prompt-engineer` the free tier tops out
at 7 uses.

CI/CD is the one bright spot, and `ci-cd-pipeline-validator` is the only free DevOps skill I'd
call shelf-ready — with the caveat in §14 that its listing is an explicit funnel to a $9.99 Pro
twin.

---

## 7. Designer

Mapped: UX & UI Design (142), Branding & Design (198), Image & Video (332).

### 7.1 UX & UI Design — 142 listings, 3 free rows

| Skill | Slug | Uses | Rating |
|---|---|---|---|
| UI Lab: Design Skill (Free) | `ui-lab-design-skill-free` | 2 | — |
| Vary the Premise, Not the Layout | `vary-the-premise-not-the-layout` | 0 | — |
| lawful-ui: Make Your UI Obey the Law | `lawful-ui-make-your-ui-obey-the-law` | 0 | — (macOS only) |
| UI Design Engine | `ui-design-engine` | 54 | — (Joker; filed under Branding) |

**This is the single starkest finding of the whole exercise.** Our Designer role is the one our
shelf is deepest in — 67 of our 68 packs — and the Agensi category that matches it by name is
effectively empty: three free listings, a combined **2 uses**. Everything with traction in that
category is paid ($1–$10) and also barely used. The design work people actually run lives under
Frontend & Web Apps (§3.2).

### 7.2 Branding and design

| Skill | Slug | Uses | Rating |
|---|---|---|---|
| AI Logo & Brand Identity Kit | `ai-logo-brand-identity-kit` | 71 | — |
| logo design feedback | `logo-design-feedback` | 24 | 5.0 |
| Logo Engine AI | `logo-engine-ai` | 8 | — |
| World-Class AI Logo & Brand Identity Designer | `world-class-ai-logo-brand-identity-designer-agent` | 7 | — |
| Brand Asset Proof — Campaign Export QA | `brand-asset-proof-campaign-export-qa` | 6 | — |
| Visual Design, Brand and Presentations | `visual-design-brand-and-presentations` | 5 | — |
| Brand Identity | `brand-identity` | 3 | — |
| AI Logo & Brand Identity Kit Skill | `ai-logo-brand-identity-kit-skill` | 0 | — |
| Data Visualization Engine | `data-visualization-engine` | 24 | — (Joker) |

**Read:** free gets you logo *briefs and critiques*; it does not get you a brand system.
Sixteen of the 25 results were paid brand-guideline builders at $5–$49.99 with **zero uses
between them** — the most crowded, least validated corner I found. `logo-design-feedback`
(24 / 5.0, weighted scorecard + five stress tests) is the one free row that does something
distinctive.

### 7.3 Image and video

| Skill | Slug | Uses | Rating | Requires |
|---|---|---|---|---|
| video enhancement | `video-enhancement` | 177 | **3.7** | terminal, env, web, Node |
| video face swap | `video-face-swap` | 85 | 5.0 | terminal, env, web, Node |
| AI Video Maker — Text and Image to Video | `ai-video-maker-text-and-image-to-video` | 48 | 5.0 | terminal, env, web, Node |
| video-cover-designer | `video-cover-designer` | 47 | 5.0 | — |
| promo-video-script | `promo-video-script` | 47 | — | web |
| Image Prompt Consistency Guard | `image-prompt-consistency-guard` | 24 | 5.0 | — |
| AI Short Film Engine | `ai-short-film-engine` | 16 | — | read (Joker) |
| Video Edit Script Engine | `video-edit-script-engine` | 13 | — | read (Joker) |
| Photorealistic MV Engine | `photorealistic-mv` | 12 | — | — (Joker) |
| Image Prompt Repair Kit | `image-prompt-repair-kit` | 10 | — | — |
| Manim Explainer Videos | `manim-explainer-videos` | 10 | — | terminal, Python |
| best image generation | `best-image-generation` | 8 | 5.0 | read/write, web |
| ink-wash-poster | `ink-wash-poster` | 7 | 5.0 | read/write |
| Media Enhancer | `media-enhancer-shop-ready-photos-cleaner-videos` | 7 | 5.0 | terminal, read |
| ComfyUI Headless | `comfyui-headless-drive-it-from-code` | 7 | — | terminal, web |
| Image Riff | `image-riff-art-in-a-reference-s-style` | 6 | — | terminal, read, web |
| Meme Image Forge | `meme-image-forge` | 6 | — | read files |
| ComfyUI Agent Skill | `comfyui-agent-skill` | 6 | — | terminal, env, read/write, web |
| Video Production Engine | `video-production-engine` | 6 | — | read (Joker) |
| Video Export QA | `video-export-qa` | 5 | — | terminal, read/write |

**Read:** Image & Video is the one Designer sub-role where free is genuinely strong — 20 rows,
five above 40 uses. Note that `video-enhancement` (177 uses) carries the **lowest rating of any
well-used free skill on the marketplace, 3.7**, and several of these need API keys and paid
third-party inference, so "free skill" does not mean "free to run".
`image-prompt-consistency-guard` (24 / 5.0) is the most transferable: it fixes prompt drift
across a set, which is a real production problem.

---

## 8. Marketer — broken down by channel, as asked

Mapped: Marketing & SEO (1000), Social Media (237), Sales & Lead Gen (423), E-commerce (575),
Writing & Content (462).

**The headline answer to the owner's question: yes, marketing splits hard by network, and the
free tier splits with it. Organic/content work on a given network is usually free. Paid-media
work on the same network is almost always paid.** Channel by channel:

| Channel | Free skills found | Best-used free | Verdict |
|---|---|---|---|
| LinkedIn | 12 | `linkedin-outreach-pro-free-starter` (8) | **Rich.** Posts, profile, polls, hooks, sentiment, posting API, outreach |
| YouTube | 8 | `youtube-script-writer` (34 / 5.0) | **Rich.** Scripts, thumbnails, channel strategy, transcripts, chapters |
| Reddit | 3 | `reddit-drafter` (25 / 5.0) | **Good.** All three are rule-compliance-aware |
| SEO | 10 | `seo-audit-agent...` (75 / 5.0) | **Good**, with one big caveat (below) |
| Content / copywriting | 26 | `humanize-writing` (792 / 4.7) | **Richest area on the marketplace** |
| Email | 9 | `email-marketing-engine` (9) | **Moderate.** Cold outreach strong, lifecycle/ESP weak |
| E-commerce / Shopify | 16 | `ecommerce-ops-engine` (22) | **Moderate.** Listing copy yes, store ops no |
| TikTok | 1 TikTok-named (+12 generic short-video) | `tiktok-shop-live-script` (3) | **Weak.** Generic vertical-video only |
| Meta / Facebook / Instagram | 8 | `designer-carousel-post` (132 / 5.0) | **Organic only.** Ads optimization is all paid |
| Pinterest | 1 | `pinterest-pin-engine` (9) | **Near-empty.** 1 free of 6 Pinterest listings |
| Google Ads | 2, both 0 uses | — | **Empty in practice.** See §12 |
| X / Twitter | 1 content + 1 scraper | `x-social-poster` (4) | **Empty in practice.** See §12 |
| Affiliate | **0** | — | **Empty.** See §12 |
| Marketing analytics / attribution | 5, thin | `mmm-budget-optimizer` (8 / 4.0) | **Weak.** See §12 |

### 8.1 LinkedIn

| Skill | Slug | Uses | Rating |
|---|---|---|---|
| LinkedIn Outreach Pro (Free Starter) | `linkedin-outreach-pro-free-starter` | 8 | — |
| LinkedIn Hook Generator | `linkedin-hook-generator` | 8 | — |
| linkedin post polisher | `linkedin-post-polisher` | 7 | — |
| Mamba LinkedIn Profile Optimizer | `mamba-linkedin-profile-optimizer` | 7 | 5.0 |
| LinkedIn Post Writer | `linkedin-post-writer` | 6 | 5.0 |
| Posts Nobody Can Tell Are AI (LinkedIn & X) | `posts-nobody-can-tell-are-ai-free-linkedin-x` | 4 | — |
| LinkedIn Poll Idea Generator | `linkedin-poll-idea-generator` | 4 | — |
| weft linkedin post sentiment | `weft-linkedin-post-sentiment` | 4 | — |
| linkedin post | `linkedin-post` | 4 | — |
| linkedin analytics | `linkedin-analytics` | 4 | — |
| weft linkedin commenter discovery | `weft-linkedin-commenter-discovery` | 3 | — |
| LinkedIn Humanizer | `linkedin-humanizer-posts-that-sound-like-you` | 1 | — |

LinkedIn is the only network where free covers the whole loop — write, polish, post, measure,
and prospect from commenters. `linkedin-post` and `linkedin-analytics` actually touch the
LinkedIn API. Nothing here has real traction (max 8 uses), so pick on fit, not evidence.

### 8.2 Meta: Facebook and Instagram

| Skill | Slug | Uses | Rating |
|---|---|---|---|
| designer-carousel-post | `designer-carousel-post` | 132 | 5.0 |
| Carousel Designer (IG & LinkedIn → PNG/PDF) | `carousel-designer-instagram-linkedin-slides-to-png-pdf` | 7 | 5.0 |
| Instagram Carousel Art Director | `instagram-carousel-art-director` | 5 | — |
| Ultra-Automatic Facebook Content Master | `ultra-automatic-facebook-content-master` | 5 | — |
| instagram post | `instagram-post` | 3 | — |
| Thread Carousel | `thread-carousel` | 2 | 5.0 |
| Facebook Ad Copy | `facebook-ad-copy` | 2 | — |
| Instagram Kiro Skill | `instagram-kiro-skill` | 0 | — |

**Correction to the brief's premise:** it is not true that every Instagram result was paid.
`facebook-ad-copy` is free and does produce Meta ad variations, and `designer-carousel-post`
(132 uses, 5.0) is the best-used social skill on the marketplace. What *is* true is that every
Meta skill that touches **spend** — budget allocation, fatigue diagnosis, scaling, wasted-spend
audit, creative strategy — is paid: `ecom-meta-ads` $9, `meta-ads-architect` $19,
`facebook-ads-creative-strategist` $9.99, `Ad Fatigue Radar` $9.99, `Srednoff Meta Ads Creative
Fatigue Recovery` $7.99, `wasted-spend-audit` $10. Free gets you the post; paid gets you the
media buy.

### 8.3 TikTok and short-form video

| Skill | Slug | Uses | Rating |
|---|---|---|---|
| promo-video-script | `promo-video-script` | 47 | — |
| Product Video Storyboard | `product-video-storyboard` | 20 | — |
| Viral YouTube Shorts SEO & Hook Expert | `viral-youtube-shorts-seo-hook-expert` | 14 | 5.0 |
| Social Post Writer | `social-post-writer-native-posts-in-your-voice` | 11 | 4.0 |
| Product Video Script Generator | `product-video-script-generator` | 4 | — |
| TikTok Shop Live Script | `tiktok-shop-live-script` | 3 | — |
| Short Video Editing Brief | `short-video-editing-brief` | 3 | — |
| AI Shorts & Reels Starter Engine (Free) | `ai-shorts-reels-starter-engine-free` | 3 | — |
| Hook-First AI Video Prompt Studio | `hook-first-ai-video-prompt-studio` | 3 | — |
| shorts-hook-lab | `shorts-hook-lab` | 2 | — |
| Hooks and CTAs for Saudi Video Ads (Free) | `hooks-and-ctas-for-saudi-video-ads-free` | 2 | 5.0 |
| Evidence Story Script | `evidence-story-script` | 2 | — |
| create voiced ad | `create-voiced-ad` | 2 | — |

**Read:** exactly one free skill names TikTok, and it is about TikTok *Shop* livestreams for 3C
accessories (3 uses). Everything else is generic vertical video that happens to suit TikTok.
If the owner wants a TikTok shelf, free will not stock it.

### 8.4 YouTube

| Skill | Slug | Uses | Rating |
|---|---|---|---|
| YouTube Script Writer | `youtube-script-writer` | 34 | 5.0 |
| YouTube Thumbnail Packaging Director | `youtube-thumbnail-packaging-director` | 16 | 5.0 |
| videosays | `videosays` | 14 | — |
| youtube channel strategy growth planner | `youtube-channel-strategy-growth-planner` | 10 | 5.0 |
| YouTube Channel Automation -- It's Free | `youtube-channel-automation-it-s-free` | 8 | — |
| Youtube Transcript Miner | `youtube-transcript-miner` | 5 | — |
| YouTube Script Writer--Free | `youtube-script-writer-free` | 2 | 5.0 |
| VOD Chaptering | `vod-chaptering` | 1 | — |

The best-rounded free network shelf after LinkedIn: scripting, packaging, strategy, transcripts
and chaptering all covered, three of them rated 5.0. Descriptions and chapters are the one gap,
and that is paid (`youtube-description-chapters-builder` $9.99).

### 8.5 X / Twitter, Pinterest, Reddit

| Skill | Slug | Network | Uses | Rating |
|---|---|---|---|---|
| Reddit Drafter | `reddit-drafter` | Reddit | 25 | 5.0 |
| Pinterest Pin Engine | `pinterest-pin-engine` | Pinterest | 9 | — |
| reddit-post-drafter | `reddit-post-drafter` | Reddit | 8 | — |
| X Social Poster | `x-social-poster` | X | 4 | — |
| Reddit Rules First | `reddit-rules-first` | Reddit | 2 | — |
| X Twitter Scraper | `x-twitter-scraper` | X | 1 | — (needs 2 MCPs) |

Reddit free is good and, interestingly, all three free Reddit skills are built around subreddit
rule compliance and removal risk — the actual failure mode. X/Twitter is the opposite: the free
tier is a poster and a scraper, while every content and growth skill is paid (`X Growth Studio`
$9.99, `X Thread Crafter` $7, `X/Twitter Thread Monetization Agent` $9.99, `blog-to-thread` $7),
all at zero uses.

### 8.6 Email marketing

| Skill | Slug | Uses | Rating |
|---|---|---|---|
| Email Marketing Engine | `email-marketing-engine` | 9 | — (Joker) |
| Daily Briefing Pipeline | `daily-briefing-pipeline` | 7 | — |
| Cold Email Subject Generator | `cold-email-subject-generator` | 6 | — |
| converting-email-templates | `converting-email-templates` | 6 | — (Mailtrap) |
| managing-contacts | `managing-contacts` | 5 | — (Mailtrap) |
| Email Deliverability Doctor (Free Starter) | `email-deliverability-doctor-free-starter` | 4 | — |
| Follow-Up Machine (Free Starter) | `follow-up-machine-free-starter` | 4 | — |
| Domain Health Precheck | `domain-health-precheck` | 3 | — |
| listmonk-analytics-mcp | `listmonk-analytics-mcp` | 0 | — |

### 8.7 SEO

| Skill | Slug | Uses | Rating | Caveat |
|---|---|---|---|---|
| seo-optimizer | `seo-optimizer` | **266** | 5.0 | **Not SEO.** `best_for`: scans *Chinese social posts* for ad-law banned words. See §14 |
| SEO Audit Agent — Full Website SEO Checker | `seo-audit-agent-full-website-seo-checker` | 75 | 5.0 | Crawls a site → prioritized technical/on-page/off-page report |
| click-to-convert-audit | `click-to-convert-audit` | 25 | — | Landing page + ad keywords → PPC blockers |
| SEO Optimization Engine | `seo-optimization-engine` | 22 | — | Includes Xiaohongshu SEO (Joker) |
| landing-page-conversion-audit | `landing-page-conversion-audit` | 18 | 4.0 | Conversion blockers, ad-budget leaks |
| content architect pro | `content-architect-pro` | 16 | 5.0 | UX/SEO/messaging findings on text in web code |
| seo-content-quality-gate | `seo-content-quality-gate` | 12 | — | 60+ SEO checks on markdown/HTML |
| Ad-Page Match Auditor | `ad-page-match-auditor` | 6 | — | Message-match gaps between ad and page |
| Marketing Claim Reality Auditor | `marketing-claim-reality-auditor` | 5 | — | Claims vs available evidence |
| SEO Optimizer Skill | `seo-optimizer-skill` | 4 | 5.0 | Headings, metadata, internal links, alt text |
| saas-landing-copywriter | `saas-landing-copywriter` | 3 | — | Nine-section SaaS landing page |

`seo-audit-agent-full-website-seo-checker` (75 / 5.0, needs only web access) is the free SEO
skill I would actually shelve. Keyword *research* is paid across the board, because it needs the
Google Ads API (`keyword-research` $7, `Google Keyword Research` $9, `Keyword Research Skill Pro`
$6.99).

### 8.8 Content and copywriting — the deepest free tier on Agensi

| Skill | Slug | Uses | Rating |
|---|---|---|---|
| humanize-writing | `humanize-writing` | **792** | **4.7 (11 rev)** |
| content-writer | `content-writer` | 138 | 5.0 (Xiaohongshu/Zhihu/WeChat/Douyin) |
| ai-smell-detector | `ai-smell-detector` | 67 | — |
| daily-newspaper | `daily-newspaper` | 46 | 5.0 |
| Deep Content Writer | `deep-content-writer` | 34 | 5.0 |
| critique-loop-writer | `critique-loop-writer` | 32 | 5.0 |
| Humanizer | `humanizer` | 28 | **3.0** |
| marketing-copy-engine (1) | `marketing-copy-engine-1` | 25 | — |
| Novel Master Engine | `novel-master` | 25 | — |
| Blog Post Writer Agent | `blog-post-writer-agent` | 23 | 5.0 |
| Marketing Copy Engine | `marketing-copy-engine` | 20 | 5.0 |
| One Idea Content Multiplier | `one-idea-content-multiplier` | 20 | 5.0 |
| Humanize Writing — Natural AI Text Rewriter | `humanize-writing-natural-ai-text-rewriter` | 18 | — |
| Blog Machine (Free Starter) | `blog-machine-free-starter` | 14 | 5.0 |
| Deslop the Copy | `deslop-the-copy` | 12 | — |
| Xiaohongshu Viral Note Generator | `xiaohongshu-viral-note-generator` | 12 | — |
| Human-Sounding Content Writer | `human-sounding-content-writer` | 11 | 5.0 |
| Stop Slop Writing | `stop-slop-writing` | 11 | — |
| Dark Fiction Engine | `dark-fiction-engine` | 10 | — |
| Resume Optimization Engine | `resume-optimization-engine` | 10 | — |
| Content Marketing Engine | `content-marketing-engine` | 9 | — |
| Humanize Writing: Natural, Human-Sounding Text | `humanize-writing-natural-human-sounding-text` | 9 | 5.0 |
| AI Tell Detector (EN + RU) | `ai-tell-detector-en-ru` | 7 | — |
| Content Writer: Articles That Rank | `content-writer-articles-that-rank-and-get-read` | 7 | 5.0 |
| Copywriting Engine | `copywriting-engine` | 5 | — |
| Content Repurposer Engine | `content-repurposer-engine` | 3 | 5.0 |
| Content Ops Decision Engine | `content-ops-engine` | 3 | — |
| Said My Way | `said-my-way` | 3 | — |

**Read:** nine of these are "remove the AI smell" rewriters. That is the most duplicated idea on
Agensi. Their ratings are the useful signal and they disagree sharply: `humanize-writing` 4.7 on
11 reviews, `Humanizer` **3.0**, the rest unrated 5.0s. If the owner shelves one de-slopper, the
evidence points at exactly one.

### 8.9 Sales and lead generation

| Skill | Slug | Uses | Rating |
|---|---|---|---|
| web-design-lead-qualifier | `web-design-lead-qualifier` | 106 | — |
| lead-generation-agent | `lead-generation-agent` | 72 | 5.0 |
| Lead Enricher | `lead-enricher` | 28 | 5.0 |
| Outreach Writer | `outreach-writer` | 19 | 5.0 |
| Pipeline Reporter | `pipeline-reporter` | 18 | 5.0 |
| Lead Magnet Blueprint | `lead-magnet-blueprint` | 10 | **3.0** |
| local biz outreach finder | `local-biz-outreach-finder` | 9 | 5.0 |
| MoltAwards | `moltawards-revenue-hunting-for-ai-agents` | 9 | — |
| rAInmaker Lite | `rainmaker-lite-blunt-cold-outreach-coach` | 9 | 5.0 |
| commercial proposal generator | `commercial-proposal-generator` | 7 | — |
| b2b-outreach-crafter | `b2b-outreach-crafter` | 6 | 5.0 |
| B2B Dealer Outreach Email | `b2b-dealer-outreach-email` | 6 | — |
| nex-cold-mail-1-template | `nex-cold-mail-1-template` | 5 | — |
| Sales Discovery Questions | `sales-discovery-questions` | 5 | — |
| weft local business leads | `weft-local-business-leads` | 5 | — |
| Cold Call Script Generator | `cold-call-script-generator` | 5 | — |
| Contact Classification | `contact-classification` | 4 | — |
| Lead Magnet Idea Generator | `lead-magnet-idea-generator` | 4 | — |
| Buyer Persona Generator | `buyer-persona-generator` | 4 | — |
| Trade Show Lead Scorecard | `trade-show-lead-scorecard` | 4 | — |
| Multi-Channel Sequencer (Free Starter) | `multi-channel-sequencer-free-starter` | 3 | — |
| Outreach and Prospecting | `outreach-and-prospecting` | 2 | — |
| weft GTM lead enrichment | `weft-gtm-lead-enrichment` | 2 | — |
| recipient research | `recipient-research` | 1 | — |
| Nonprofit Leads: IRS Charities by State | `nonprofit-leads-irs-charities-by-state` | 0 | — |

Strong and practical. `web-design-lead-qualifier` (106) and `lead-generation-agent` (72 / 5.0)
are the two best-used free Marketer skills outside content. Note the `weft-*` family (4 rows) is
one vendor whose skills call a metered external API — free skill, paid data.

### 8.10 E-commerce

| Skill | Slug | Uses | Rating |
|---|---|---|---|
| E-Commerce Ops Engine | `ecommerce-ops-engine` | 22 | — (Joker; Taobao/Douyin/Amazon) |
| AI Automation Income Engine | `ai-automation-income-engine` | 21 | — (Joker) |
| Cross-Border E-Commerce Assistant | `cross-border-ecom-assistant` | 8 | — |
| cold-buyer-listing-audit | `cold-buyer-listing-audit` | 6 | — |
| shopify-headline-tester-free | `shopify-headline-tester-free` | 6 | — |
| etsy-title-fixer | `etsy-title-fixer` | 5 | — |
| PPC Search-Term Miner | `ppc-search-term-miner` | 5 | — |
| Etsy Listing Conversion Scorecard | `etsy-listing-conversion-scorecard` | 4 | — |
| Marketplace Title & Keyword Pack | `marketplace-title-keyword-pack` | 4 | — |
| Product Photo Shot List | `product-photo-shot-list` | 4 | — |
| Product Bundle & Cross-Sell | `product-bundle-cross-sell` | 3 | — |
| Print Shop SEO And Conversion Audit | `print-shop-seo-and-conversion-audit` | 3 | — |
| Etsy Listing Rank Rewriter | `etsy-listing-rank-rewriter` | 3 | — |
| Listing Audit | `listing-audit` | 3 | — |
| Product Listing Copy Generator | `product-listing-copy-generator` | 3 | — |
| Marketplace Bullet Points Writer | `marketplace-bullet-points-writer` | 3 | — |
| Etsy Title Visibility Scorecard | `etsy-title-visibility-scorecard` | 3 | — |

Free e-commerce is *listing copy*, repeated many times, mostly for Etsy and SEA marketplaces.
Shopify itself: one free headline tester; the Shopify API skill is paid ($6.99). Notice how many
of these are "3C accessory" / Shopee / TikTok Shop specific — one creator's regional series.

### 8.11 Social media (cross-network)

| Skill | Slug | Uses | Rating |
|---|---|---|---|
| Social Media Ops Engine | `social-media-ops` | 51 | — | Deep record §11; **see §14 caveat** |
| Social Media Quality Gate | `social-media-quality-gate-pre-publish-checker-for-x-note-linkedin-brain` | 10 | — |
| Post Performance Debrief | `post-performance-debrief` | 9 | 5.0 |
| social post | `social-post` | 9 | — |
| Skill Promo UGC Generator | `skill-promo-ugc-generator` | 8 | 5.0 |
| telegram post | `telegram-post` | 5 | — |
| aidelly social autopilot | `aidelly-social-autopilot` | 3 | — |
| social content calendar planner | `social-content-calendar-planner` | 3 | — |
| KOL Marketing Engine | `kol-marketing-engine` | 9 | 5.0 (Joker) |
| Personal IP Engine | `personal-ip-engine` | 8 | — (Joker) |
| KOL Seeding Outreach | `kol-seeding-outreach` | 2 | — |
| Directory Submission Plan | `directory-submission-plan` | 2 | — |
| TimeToPost Social Scheduler | `timetopost-social-scheduler` | 1 | — |
| Social Metrics Preflight | `social-metrics-preflight` | 1 | — |
| Distribution Channel Picker | `distribution-channel-picker` | 1 | — |

Marketer is by far the largest role here, and the one where sub-role breakdown changes the answer
most.

---

## 9. Support

Mapped: Business & Operations (1572), Productivity (714), Workflow Automation (897),
HR & Recruiting (172).

### 9.1 Customer support and inbox triage — the sub-role our role is named for

| Skill | Slug | Uses | Rating |
|---|---|---|---|
| gmail-checker | `gmail-checker` | 42 | — |
| Product FAQ Generator | `product-faq-generator` | 3 | — |
| Marketplace Q&A Reply | `marketplace-q-a-reply` | 3 | — |
| Ecommerce Customer Support Response Builder | `ecommerce-customer-support-response-builder` | 2 | — |
| Support Triage + Context Pack | `support-triage-context-pack` | 2 | — |
| Support Knowledge Gap Mapper | `support-knowledge-gap-mapper` | 1 | — |
| support ticket investigation | `support-ticket-investigation` | 1 | 5.0 |
| AI Customer Support Resolution | `ai-customer-support-resolution` | 1 | — |
| app-review-response-drafter | `app-review-response-drafter` | 1 | — |

**Read:** our Support role says "reads the inbox and tells you which tickets become problems."
The closest free match, `support-triage-context-pack`, has **2 uses**. Every well-built support
skill I saw is paid: `Customer Support Reply Quality Gate` $9, `Support Response Drafter` $9,
`Inbox Triage Rules` $9, `Customer Support Resolution Agent` $19.99, `SaaS Help Center
Architect` $9.99. `gmail-checker` (42 uses) is the only free row with any evidence, and it is a
Gmail digest tool rather than a support skill.

### 9.2 Workflow automation

| Skill | Slug | Uses | Rating |
|---|---|---|---|
| video enhancement | `video-enhancement` | 177 | 3.7 |
| video face swap | `video-face-swap` | 85 | 5.0 |
| career-expert (alpha) | `career-expert-alpha-version` | 69 | 5.0 |
| paper-reader-heilmeier | `paper-reader-heilmeier` | 30 | — |
| Python Automation Engine | `python-automation-engine` | 25 | 4.0 |
| DOCX Toolkit | `docx-toolkit-create-edit-and-analyze-word-documents` | 23 | — |
| windows-desktop-automation-v2 | `windows-desktop-automation-v2` | 19 | — |
| PDF Toolkit | `pdf-toolkit-extract-merge-split-fill-and-ocr-pdf-files` | 15 | — |
| Agent handoff lite | `agent-handoff-lite` | 13 | 5.0 |
| Video Edit Script Engine | `video-edit-script-engine` | 13 | — |
| Low Code Agentic Workflow Architect | `low-code-agentic-workflow-architect` | 10 | 5.0 |
| lsp-setup-assistant | `lsp-setup-assistant` | 9 | — |
| social post | `social-post` | 9 | — |
| HubSpot Workflow Discipline & Naming | `hubspot-workflow-discipline-naming` | 6 | 5.0 |
| shift scheduler | `shift-scheduler` | 6 | — |
| Career Path Planner | `career-path-planner` | 6 | — |
| Coffee Guide Pro | `coffee-guide-pro` | 6 | — |
| converting-email-templates | `converting-email-templates` | 6 | — |
| china-im-workflow-cli | `china-im-workflow-cli` | 5 | — |
| AI Automation Incident Intake Assistant | `ai-automation-incident-intake-assistant` | 5 | — |
| telegram post | `telegram-post` | 5 | — |

**Note:** Workflow Automation (897 listings) contains almost no n8n or Zapier skills, free or
paid. What the category actually holds is media processing, document toolkits and desktop
automation. Two of its top three free skills are video tools. The category name does not
describe its contents.

### 9.3 Business operations

| Skill | Slug | Uses | Rating |
|---|---|---|---|
| AI Business Solutions Tool - Rostrup | `ai-business-solutions-tool-rostrup` | 71 | 4.5 |
| AI Digital Solutions Tool - Erodex | `ai-digital-solutions-tool-erodex` | 41 | — |
| AI Side Hustle Radar | `ai-side-hustle-radar` | 27 | — |
| Business Analysis Decision Engine | `business-analysis-engine` | 27 | 5.0 |
| quote-proposal-agent | `quote-proposal-agent` | 22 | — |
| Data Analysis Decision Engine | `data-analysis-engine` | 21 | — |
| rtl business documents pro | `rtl-business-documents-pro` | 17 | — |
| pre-mortem | `pre-mortem` | 16 | 5.0 |
| AI Engineering & Workforce Solutions Tool | `ai-engineering-workforce-solutions-tool-advantage-technical` | 16 | — |
| lss-tools | `lss-tools` | 16 | — |
| Job Application Strategist | `job-application-strategist` | 14 | — |
| Project Management Decision Engine | `project-management-engine` | 14 | — |
| HR Management Engine | `hr-management-engine` | 13 | — |
| Business Plan Engine | `business-plan-engine` | 12 | — |
| Meeting Agenda & Minutes Generator | `meeting-agenda-minutes-generator` | 9 | — |
| SaaS Operations Engine | `saas-ops-engine` | 9 | — |
| founder-stage-gate-operator | `founder-stage-gate-operator` | 9 | — |
| Startup Innovation Engine | `startup-innovation-engine` | 8 | — |
| AI Event Planning Tool - Clearwater Events | `ai-event-planning-tool-clearwater-events` | 8 | — |
| AI Facilities Management Tool - CPL Group | `ai-facilities-management-tool-cpl-group` | 8 | — |
| Career Compass | `career-compass` | 8 | — |
| solar-panel-home-system-buying-consultant | `solar-panel-home-system-buying-consultant` | 7 | — |
| Career Development Engine | `career-development-engine` | 7 | — |
| Community Operations Engine | `community-ops-engine` | 5 | — |

**Flag:** the "AI <X> Tool - <CompanyName>" family (Rostrup, Erodex, Advantage Technical,
Clearwater Events, CPL Group) are single-company sales assistants published as general skills —
one of them answers questions using one named property firm's service details. They have
meaningful install counts (8–71) but are not generic skills. Do not shelve them as such.

### 9.4 Productivity

| Skill | Slug | Uses | Rating |
|---|---|---|---|
| task-initiator | `task-initiator` | 43 | — |
| gmail-checker | `gmail-checker` | 42 | — |
| Daily Work Planner | `daily-work-planner` | 14 | **2.0** |
| Task Finisher with Grok | `task-finisher-with-grok` | 14 | 5.0 |
| Topic Tracking Radar | `topic-tracking-radar` | 9 | — |
| Regex Builder | `regex-builder-1` | 9 | 5.0 |
| Editable Word Studio | `editable-word-studio` | 7 | — |
| meeting-action-extractor-free | `meeting-action-extractor-free` | 6 | — |
| Efficiency Tool Engine | `efficiency-tool-engine` | 6 | — |
| my-test-skill | `my-test-skill` | 6 | — |
| qa ledger tracker | `qa-ledger-tracker` | 5 | 5.0 |
| PDF Toolkit Studio | `pdf-toolkit-studio` | 5 | — |
| PDF to Word Studio | `pdf-to-word-studio` | 4 | — |
| Appointment Keeper (Free Starter) | `appointment-keeper-free-starter` | 3 | — |
| Evidence-Guided Troubleshooter | `evidence-guided-troubleshooter` | 3 | — |
| qr code generator | `qr-code-generator` | 3 | — |
| Moodle Student | `moodle-student` | 3 | — |
| Said My Way | `said-my-way` | 3 | — |

`Daily Work Planner` carries a **2.0** — the lowest rating I found anywhere, and a useful
reminder that the free tier is not uniformly fine. Note `my-test-skill` (6 uses) is literally
someone's test upload, live in the catalogue.

### 9.5 HR and recruiting

| Skill | Slug | Uses | Rating |
|---|---|---|---|
| job description magnet | `job-description-magnet` | 12 | 5.0 |
| Interview Coaching Engine | `interview-coaching-engine` | 11 | — |
| Resume Optimization Engine | `resume-optimization-engine` | 10 | — |
| CV Scanner | `cv-scanner` | 8 | — |
| structured interview studio | `structured-interview-studio` | 7 | 5.0 |
| interview prep coach | `interview-prep-coach` | 6 | — |
| WorkorAI | `workorai` | 5 | — (3 MCPs) |
| Career Copilot | `career-copilot-find-verify-track-your-job-search` | 5 | — |
| Campus Navigator | `campus-navigator` | 1 | — |
| Resume to Standardized Matrix Scorer | `resume-to-standardized-matrix-scorer` | 1 | — |
| Interview Feedback Scorecard Draft | `interview-feedback-scorecard-draft-cited-human-approve` | 1 | — |
| agent recruiting machine | `agent-recruiting-machine` | 1 | — |
| job application pipeline | `job-application-pipeline` | 1 | — |
| Job Description: Choose the First Job to Give an AI | `job-description-choose-the-first-job-to-give-an-ai` | 1 | — |
| Interview Question Bank Builder | `interview-question-bank-builder` | 0 | — |

HR & Recruiting (172 listings) splits oddly: the free side mostly serves the *candidate*
(resume, interview prep, job search) while the employer-side screening tools are paid ($5–$20).
`cv-scanner` (free, 8 uses) is the exception and does something unusual — audits the recruiter's
own screening notes for bias and non-compliant language.

---

## 10. Producer

Mapped: Product Management (120), Research & Analysis (793), Digital Products (262),
Technical Documentation (423), Education & Learning (348).

### 10.1 Product management — 120 listings, 6 free rows, 24 uses between them

| Skill | Slug | Uses | Rating |
|---|---|---|---|
| Product Manager Engine | `product-manager-engine` | 16 | — (Joker) |
| PRD Requirement Reality Auditor | `prd-requirement-reality-auditor` | 5 | — |
| Idea to PRD | `idea-to-prd-an-honest-draft-with-every-assumption-flagged` | 1 | — |
| Idea → Requirements Spec (PRD) | `idea-requirements-spec-prd` | 1 | — |
| Writing PRDs — Problem-First Specs | `writing-prds-problem-first-specs-metrics-and-non-goals` | 1 | — |
| Session Intent Scoring (PostHog) | `session-intent-scoring-posthog` | 1 | — |

The `most_installed` query returned only six rows for the whole category, all free. Product
Management is Agensi's smallest category and barely used by anyone, free or paid.

### 10.2 Research and analysis

| Skill | Slug | Uses | Rating |
|---|---|---|---|
| deep-research-team | `deep-research-team` | 248 | 4.8 |
| truth-first | `truth-first` | 185 | 5.0 |
| Marketing Agent Skills | `marketing-agent-skills` | 29 | 5.0 |
| Research-to-Report | `research-to-report` | 17 | — |
| Sourced Research Brief | `sourced-research-brief` | 10 | — |
| Industry Chain Research | `industry-chain-research` | 9 | 5.0 |
| Quick Research Brief | `quick-research-brief` | 8 | 5.0 |
| Competitor Intelligence Radar | `competitor-intelligence-radar` | 7 | — |
| Deep Research: Cited, Cross-Checked Reports | `deep-research-cited-cross-checked-reports` | 7 | 5.0 |
| Market Research: Size, Competitors & Customers | `market-research-size-competitors-customers` | 7 | 5.0 |
| AI Output Evidence Auditor | `ai-output-evidence-auditor` | 7 | 5.0 |
| Idea Market Research | `idea-market-research` | 5 | **1.0** |
| App Niche Scout | `app-niche-scout-app-store-search-data` | 5 | — |
| Competitor Research by SOLIDS FOR YOU | `competitor-research-by-solids-for-you` | 5 | — |
| Scientific Research Copilot | `scientific-research-copilot` | 4 | — |
| Research Synthesis Brief | `research-synthesis-brief` | 3 | — |
| weft competitor pricing | `weft-competitor-pricing` | 3 | — |
| Decision-Ready Analytics Briefs | `decision-ready-analytics-briefs` | 2 | — |

`deep-research-team` (248 / 4.8 on real reviews) is the strongest free Producer skill on the
marketplace and the only free multi-agent research skill with evidence. `Idea Market Research`
carries a **1.0** — the lowest-rated free skill I found; worth avoiding specifically because its
neighbours all show unrated 5.0s.

### 10.3 Technical documentation

| Skill | Slug | Uses | Rating |
|---|---|---|---|
| readme-generator | `readme-generator` | 358 | 5.0 |
| pr-description-writer | `pr-description-writer` | 223 | 5.0 |
| skill-polisher | `skill-polisher` | 76 | 5.0 |
| README Generator | `readme-generator-1` | 39 | 5.0 |
| Research-to-Report | `research-to-report` | 17 | — |
| Git Commit Writer | `git-commit-writer-1` | 14 | 5.0 |
| Academic Writing Assistant | `academic-writing-assistant` | 10 | — |
| api-quickstart-doctor | `api-quickstart-doctor` | 7 | — |
| git-commit-writer-codex | `git-commit-writer-codex` | 7 | 5.0 |
| README First-Screen Generator | `readme-first-screen-generator` | 6 | 5.0 |
| README Generator Skill | `readme-generator-skill` | 5 | 5.0 |
| readme-validator | `readme-validator` | 5 | — |
| Markdown Table Formatter | `markdown-table-formatter` | 4 | — |
| User Guide Outline Generator | `user-guide-outline-generator` | 4 | — |
| readme generator | `readme-generator-2` | 4 | — |
| PR Description Generator | `pr-description-generator` | 3 | — |
| PR Description and Review Prep | `pr-description-and-review-prep` | 1 | — |
| Writing Pull Requests | `writing-pull-requests-conventional-titles-descriptions` | 1 | — |
| NestJS Skills: Git Commit and PR Messages | `nestjs-skills-git-commit-and-pr-messages` | 1 | — |

**Read:** the most duplicated corner of the catalogue. **Six free README generators** (358, 39,
6, 5, 4 and a validator), **five free PR-description writers** and **three free commit-message
writers**. The first of each is overwhelmingly the most used; the rest are redundant.
`readme-generator` (358 / 5.0) and `pr-description-writer` (223 / 5.0) are shelf-ready on the
numbers. API docs proper is paid (`API Docs Writer` $14).

### 10.4 Digital products

| Skill | Slug | Uses | Rating |
|---|---|---|---|
| Digital Product Idea Validator | `digital-product-idea-validator` | 45 | 5.0 |
| Digital Product Packager | `digital-product-packager` | 16 | 5.0 |
| Digital Product Listing Optimiser | `digital-product-listing-optimiser` | 12 | — |
| Knowledge Product Engine | `knowledge-product-engine` | 9 | — (Joker) |
| Fuse Bead Studio | `fuse-bead-studio` | 8 | — |
| Vintage Ephemera Sheet Kit Builder | `vintage-ephemera-sheet-kit-builder` | 7 | — |
| EPUB-Create | `epub-create` | 6 | — |
| Digital Product Funnel Builder | `digital-product-funnel-builder` | 5 | — |
| Product Rebuild Gate | `product-rebuild-gate-score-fix-iterate` | 5 | — |
| Gumroad Image Preflight | `gumroad-image-preflight` | 4 | — |
| Amazon KDP Book Prep | `amazon-kdp-book-prep-spine-cover-and-margins` | 4 | — |
| Printable Bundle Studio | `printable-bundle-studio` | 2 | — |
| Product Paywall with Stripe | `product-paywall-with-stripe` | 1 | — |
| digital-product-launch-board | `digital-product-launch-board` | 1 | — |
| startup-idea-to-pricing | `startup-idea-to-pricing` | 0 | — |

### 10.5 Education & learning — 348 listings, 4 free rows, 9 uses between them

| Skill | Slug | Uses | Rating |
|---|---|---|---|
| Education Training Engine | `education-training-engine` | 7 | — (Joker) |
| Teacher Lesson Plan Generator | `teacher-lesson-plan-generator` | 4 | — |
| Curriculum Architect HS (Free Starter) | `curriculum-architect-hs-free-starter` | 3 | — |
| Code Sensei – Learn Your Codebase | `code-sensei-learn-your-codebase` | 1 | — |
| Code Sensei – Turn Any Codebase Into a Course | `code-sensei-turn-any-codebase-into-a-course` | 1 | — |

Of 21 results, 16 were paid course-builders at $5–$39, **every one of them at 0 uses**. Two of
the free rows are the same Code Sensei skill published twice under different titles, and the
"Free Starter" is the free rung of a $20–$29 bundle ladder.

---

## 11. Deep records (`get_skill`) for the strongest free candidates

Six skills were pulled in full. Metadata only — no instructions, scripts or bodies are
reproduced here.

### code-reviewer — QA
Free · **1,931 uses · 38 votes · 4.2 from 17 reviews** · `agensi.io/skills/code-reviewer`
- **Creator:** Samuel Rose, "Founder of Agensi" — 10 skills, 3,334 total uses
- **Permissions:** tools `terminal`; requirements `Git`; no hosts, no file scopes
- **Compatible agents:** claude-code (listing also claims Copilot CLI, Sourcery, generic SKILL.md)
- **Use cases:** security vulns (SQLi, XSS), perf bottlenecks, logic errors; severity-ordered findings with code examples
- **Stated limitations:** cannot execute code so misses runtime-only bugs; limited context on large monorepos, better on a specific diff; may miss violations of private/internal libraries
- **Tags:** best-practices, bugs, code-review, pull-requests
- **Assessment:** the only free skill on Agensi with enough reviewers for the rating to mean anything, and the rating is 4.2 — good, not stellar. Worth noting for the owner that the #1 skill on the marketplace is published by the marketplace's own founder.

### humanize-writing — Marketer
Free · **792 uses · 7 votes · 4.7 from 11 reviews** · `agensi.io/skills/humanize-writing`
- **Creator:** Roy Yuen, "Ai skill creator" — 116 skills, 2,770 total uses
- **Permissions:** none — no tools, no hosts, no file scopes, no requirements
- **Compatible agents:** claude-code, cursor, codex-cli, github-copilot, windsurf, aider, cline
- **Ships:** `agents/openai.yaml`, `references/rewrite-playbook.md`
- **Stated limitations:** not for academic plagiarism bypass; best under 2k words; struggles with legal/medical jargon
- **Tags:** content-creation, editing, localization, writing
- **Assessment:** the second-most-used free skill, needs no permissions, and is the only de-slopper in a field of nine with a credible rating. One packaging blemish: the shipped file still carries an unfilled authoring-scaffold section with its placeholder guidance left in. Cosmetic, but it says something about how carefully even the top of this catalogue is packaged.

### security-first — Security
Free · **108 uses · 2 votes · 4.5 from 2 reviews** · `agensi.io/skills/security-first`
- **Creator:** Roy Yuen (same as above)
- **Permissions:** none at all
- **Compatible agents:** claude-code, cursor, codex-cli, github-copilot, windsurf, aider, cline
- **Ships:** `agents/openai.yaml`
- **Stated limitations:** not a substitute for pen testing; preventive design not retrospective scanning; scoped to the current task's context
- **Tags:** appsec, backend-security, devsecops-architecture, planning, security
- **Assessment:** sits *before* the code rather than after it, which nothing on our shelf does. Zero permissions makes it trivially safe to trial. The 4.5 is on two reviews — treat as unrated.

### ci-cd-pipeline-validator — DevOps
Free · **27 uses · 3 votes · no reviews** · `agensi.io/skills/ci-cd-pipeline-validator`
- **Creator:** Timoranjes (Zicheng Liao) — 107 skills, 621 total uses; bio states a deliberate free-core / paid-automation model
- **Permissions:** tools `file_write`, `network`; hosts `api.example.com` (a placeholder left in the manifest); requirements Python, Git
- **Compatible agents:** claude-code, cursor, github-copilot, aider, cline, windsurf
- **Ships:** five reference files (GitHub Actions, GitLab CI, CircleCI, Jenkins, security patterns)
- **Stated limitations:** static only — no runtime failures, no flaky tests, no secret-rotation needs; YAML structure but not semantics; multi-file pipelines need sibling scanning
- **Tags:** devops, ci-cd, github-actions
- **Assessment:** the most substantial free DevOps skill, with honest limitations and real reference material. **But its own listing upsells "CI/CD Pipeline Validator Pro ($9.99)"** for auto-fix, spend estimates and maturity tracking. Shelving the free one means shelving the top of someone's funnel. Also note the `api.example.com` host entry is clearly placeholder residue.

### social-media-ops (Social Media Ops Engine) — Marketer
Free · **51 uses · 1 vote · no reviews** · `agensi.io/skills/social-media-ops`
- **Creator:** Joker (verified) — 76 skills, 918 total uses
- **Permissions:** none declared
- **Ships:** `social-media-ops/main.py` (1.3 KB)
- **Stated limitations:** algorithms change so trends need manual input; PR advice is not legal counsel; cannot post to platforms
- **Tags:** social-media, marketing
- **Assessment — read this before shelving it.** The English listing sells "5 major platforms" and names "Douyin, Xiaohongshu, Weibo, Bilibili, WeChat, **LinkedIn**". The actual skill is written entirely in Chinese and its platform matrix covers Douyin, Xiaohongshu, WeChat, Bilibili and Weibo. **There is no LinkedIn in it, and no Instagram, Meta, international TikTok, X or YouTube.** For a Western shelf this is mis-shelved, and the owner should know that before it goes next to our Marketer role.

### Design System MD — Designer
Free · **73 uses · 5 votes · 5.0 from 3 reviews** · `agensi.io/skills/design-system-md-brand-quality-ui-via-design-md`
- **Creator:** Shogun Labs (Shota Nakahira) — 41 skills, 242 total uses
- **Permissions:** tools `terminal`; requirements `getdesign` CLI, Node.js; needs network for `npx`
- **Compatible agents:** claude-code, cursor, windsurf, aider, cline
- **Ships:** `design-system-md/prompt.md`
- **Stated limitations:** needs npx network access; mixing more than two brands is discouraged
- **Tags:** frontend, design-systems, tailwind-css, ui-ux, react
- **Assessment:** this is the free skill that most directly competes with our own shelf — see §13. Body is in Japanese; the brand coverage is not its own, it is whatever the third-party `getdesign` CLI serves (58 brands, including Apple, Stripe, Linear, Notion, Vercel, Supabase, Claude).

---

## 12. Gaps — where free essentially does not exist

Ordered by how much it matters to our shelf.

**1. UX & UI Design — our deepest role, their emptiest category.** 142 listings; three free, a
combined 2 uses; `lawful-ui` is macOS-only and unused. There is no free UX skill on Agensi worth
shelving. The design work lives under Frontend (§3.2).

**2. DevOps & Cloud — 695 listings, best free one has 9 uses.** No proven free Terraform (1
skill, 2 uses), no proven free Kubernetes (two MCP wrappers at 1 use each), no free
incident/postmortem (`Incident Postmortem` is $5 with 151 uses — one of the best-used paid skills
anywhere). CI/CD is the only part of DevOps where free works.

**3. Google Ads — free exists but is unusable as evidence.** Correcting the brief's premise
precisely: there *are* two free Google Ads skills, and both have **0 uses** —
`ads-auditor-campaign-manager-for-google-ads` (requires a Google Ads Plus MCP) and
`google-ads-account-audit` (requires the user to supply CSV exports). Everything with any
traction is paid: `keyword-research` $7 (9 uses), `Google Ads Negative Keyword Predictor` $3,
`Google Ads Search Term Analyzer` $5, `PPC Keyword Profit Finder` $9.99, `Negative Keyword
Hunter` $9.99, `negative-keyword-builder` $5, `ecom-google-ads` $9, `Google Keyword Research` $9,
`wasted-spend-audit` $10, `Amazon PPC Campaign Planner` $19.99. So: not literally "all paid", but
functionally yes — free Google Ads on Agensi is two zero-use listings that both need external
data access you must configure yourself.

**4. Instagram and Meta paid media — organic free, spend paid.** Also a correction:
Instagram/Facebook *content* has eight free listings including `facebook-ad-copy`, and
`designer-carousel-post` (132 uses, 5.0) is the best-used social skill on Agensi. But **every**
Meta skill touching budget, scaling, fatigue or wasted spend is paid ($7.99–$19). The gap is
paid-media management, not Instagram as such.

**5. X / Twitter.** One poster (4 uses), one scraper needing two MCPs (1 use), one shared
LinkedIn+X rewriter (4 uses). Every thread/growth/monetization skill is paid and at zero uses.

**6. Affiliate marketing — genuinely zero.** No free affiliate skill surfaced at all. Three paid
(`affiliate-promo-copy-builder` $9.99, `affiliate-marketing-commander` $7.77, `Affiliate Profit
Intelligence` $9.99) with 1, 1 and 0 uses.

**7. Marketing analytics and attribution.** `mmm-budget-optimizer` (8 uses, 4.0, needs Python +
Git) and `lead-source-roi-attribution` (2 uses, real-estate-specific) are the only real free
rows. GA4 is paid-only (`GA4 Campaign CSV Preflight` $5, `GSC AI Performance` $5).

**8. Customer support — our Support role's core job.** Best free match has 2 uses; five
well-specified competitors at $9–$19.99.

**9. Education & Learning.** 348 listings. Four free rows, 9 uses total, one of them a duplicate
publication. Sixteen paid course-builders at 0 uses each.

**10. Product Management.** 120 listings, six free rows, 24 uses total. Nobody is using this
category at all.

**11. LLM Ops.** 745 listings; apart from `prompt-engineer` (576, and it is really a
prompt-authoring skill) the free tier tops out at 7 uses. No free observability, no free cost
monitoring, no free tracing.

**12. Pinterest.** One free skill of six (`pinterest-pin-engine`, 9 uses). The other five are
$5–$19 at 0 uses.

**13. Mobile iOS and Flutter.** One free React Native skill (23 uses); iOS and Flutter free
coverage is one SwiftUI "Liquid Glass" helper at 3 uses. Everything else is paid.

**14. Languages with no free coverage:** Go, Rust, C#/.NET, Elixir, Ruby. Go has exactly one
listing in the results and it is $12.

---

## 13. Overlaps with what is already on our shelf

Our shelf (read from `packs/*/agent.md` frontmatter): **68 packs, 67 of them `role: designer`**
style systems by `typeui.sh` at `price: 0` — agentic, ant, artistic, basic, bento, bold,
brutalism, cafe, claude, claymorphism, clean, codex, colorful, contemporary, corporate, cosmic,
creative, dithered, doodle, dramatic, editorial, enterprise, expressive, fantasy, fiction, flat,
friendly, futuristic, geometric, glassmorphism, gradient, immersive, impeccable, levels, lingo,
material, matrix, minimal, modern, mono, neobrutalism, neon, neumorphism, pacman, paper,
perspective, power, premium, professional, pulse, refined, retro, riso, roku, sega, shadcn,
sketch, skeumorphism, sleek, spacious, square, stitch, storytelling, terracotta, tetris, vibrant,
vintage — plus **one** `role: engineer` pack, **Senior Engineer** ("Reads your code before
changing it, writes the smallest thing that works").

That shape makes the overlap analysis unusually simple: we are deep in one role and absent in
seven.

### Direct overlaps

| Our pack | Free Agensi skill | Their uses | How it overlaps |
|---|---|---|---|
| All 67 designer packs | **Design System MD** `design-system-md-...` | 73 / 5.0 | Does the job our Designer role describes verbatim — restyle a UI by a named system, to that system's own numbers — but sources tokens from the `getdesign` CLI's 58 brands instead of hand-authored packs. **The closest thing to a competitor for our entire Designer shelf.** Differences: it is a token *fetcher* plus a CLAUDE.md integration step, not a styled design voice; needs Node and network; explicitly discourages mixing more than two brands. Our packs are self-contained and opinionated. |
| `claude`, `codex`, `shadcn`, `material`, `ant`, `premium`, `enterprise` | **Design System MD** (brand list) | 73 | Its brand catalogue directly includes `claude`, `stripe`, `linear.app`, `vercel`, `supabase`, `notion`, `figma`, `apple` — i.e. several named systems we ship as packs, and more besides. If the owner shelves this, it partially substitutes for the brand-named subset of our designer packs. |
| `shadcn`, `minimal`, `clean`, `spacious` | `ui-component-architect` | 115 / 5.0 | Generates responsive Tailwind components and sections. Same output surface as our minimal/clean packs, no design voice of its own. |
| Any designer pack | `consistent-web-design` | 14 / 4.0 | Audits existing pages and returns unified tokens — the reverse direction from our packs (extract rather than impose). Complementary rather than duplicative. |
| Any designer pack | `design-extractor` | 1 | Extracts computed styles from a live URL into DESIGN.md + CSS vars + Tailwind config. Could *produce* new packs for our shelf rather than compete with them. |
| `agentic`, `levels`, `storytelling` | `anti-slop-design`, `anti-slop-design-frontend`, `design-qa-why-your-ui-looks-like-a-template`, `frontend-design-pro-uis-that-don-t-look-ai-made` | 29, 3, 4, 7 | Four free skills all pitched as "make it not look AI-made". Our packs answer the same complaint by supplying a specific voice instead of de-genericizing afterwards. Different method, same customer. |
| **Senior Engineer** | `senior-engineer-mode` | 7 / 5.0 | Near-identical positioning, including the name: minimal change plus a reproduction test. Requires terminal, read files, Git. |
| **Senior Engineer** | `codex-grade-coding` | 326 / 4.8 | "Classifies a coding task and returns a scope-limited change with verification evidence." The best-evidenced free skill in this space and the strongest direct competitor to our one engineer pack. |
| **Senior Engineer** | `code-reviewer` | **1,931 / 4.2** | Our Senior Engineer blurb says it "reviews like someone who maintains it." This is the most-used skill on the whole marketplace doing exactly that, free, with a real rating. |
| **Senior Engineer** | `code-reviewer-pro`, `socratic-code-reviewer`, `strict-code-review`, `ai-code-review-skill-every-bug-gets-a-failing-test` | 7, 26, 22, 9 | Four more free reviewers with distinct angles (confidence labels, Socratic framing, Java/Spring conventions, failing-test-first). |
| **Senior Engineer** | `test-driven-development`, `bug-to-regression-test-builder`, `root-cause-debugger-...` | 5, 24, 7 | The "write the failing test first, fix the real cause" discipline our pack describes, split across three free skills. |

### What this says

1. **Our Designer shelf is defensible but not unique.** One free skill (73 uses, 5.0) attacks the
   whole premise from a different angle — fetch the brand's real tokens rather than author a
   voice. It is worth shelving *and* worth understanding as competition. Our 67 packs cover
   aesthetics no brand catalogue has (dithered, riso, pacman, sega, tetris, doodle,
   skeuomorphism) and that is the part `getdesign` cannot serve.
2. **Our Senior Engineer pack is in the most crowded free space on Agensi.** At least ten free
   skills overlap it, including the #1 and #4 most-used skills on the marketplace, one of them
   with 1,931 uses and 17 reviews. If any single pack on our shelf needs a sharper
   differentiator, it is this one.
3. **Seven of our eight roles have no pack at all**, so for QA, Security, DevOps, Marketer,
   Support and Producer there is nothing to overlap — only to fill. §§4–10 are a shopping list,
   and §12 says which shelves will stay empty.

---

## 14. Caveats the owner should read before shelving anything

1. **Listing text does not always match the skill.** Confirmed by `get_skill`:
   `social-media-ops` advertises LinkedIn in English and delivers five Chinese platforms in
   Chinese. `seo-optimizer` is the 9th most-used skill on the marketplace under an SEO name and
   is actually a Chinese advertising-law banned-word checker. `content-writer` (138 uses) is
   Xiaohongshu/Zhihu/WeChat/Douyin. `local-first-memory-for-ai-coding-agents-pmb` is named as a
   memory tool and described as an e2e test generator. **Check the body language and market
   before shelving anything with a high install count.**
2. **A large share of the free tier is one of four creators.** 299 skills between Roy Yuen (116),
   Timoranjes (107) and Joker (76), plus the founder's 10. The Joker "…Engine" family alone puts
   one free skill into every one of our eight roles. Shelving broadly from free may mean shelving
   one author repeatedly.
3. **Free is often the top of a paid funnel.** `ci-cd-pipeline-validator` openly upsells a $9.99
   Pro twin; Timoranjes' bio states the model outright. "Free Starter" in a title
   (`linkedin-outreach-pro-free-starter`, `blog-machine-free-starter`,
   `curriculum-architect-hs-free-starter`, `email-deliverability-doctor-free-starter`,
   `bookkeeper-s-assistant-free-starter`, `multi-channel-sequencer-free-starter`,
   `follow-up-machine-free-starter`, `appointment-keeper-free-starter`) reliably means a
   deliberately reduced version of a paid skill.
4. **"Free" is not always free to run.** `ai-video-maker`, `video-enhancement`, `video-face-swap`,
   `best-image-generation`, the `weft-*` family and several trading skills need API keys and
   metered third-party inference. Check `requires[]` on every row before calling it free.
5. **Ratings are mostly meaningless, and the exceptions are informative.** Only about six free
   skills have more than five reviewers. The ones worth reading: `code-reviewer` 4.2 (17),
   `humanize-writing` 4.7 (11), `prompt-engineer` 4.7, `git-commit-writer` 4.8,
   `codex-grade-coding` 4.8, `deep-research-team` 4.8, `readme-generator` 5.0,
   `frontend-motion-wizard` 4.3, `security-first` 4.5 (2), `reposensei` 4.7,
   `video-enhancement` **3.7**, `Humanizer` **3.0**, `Daily Work Planner` **2.0**,
   `Idea Market Research` **1.0**. The low ones are as useful as the high ones.
6. **Placeholder and test content is live in the catalogue.** `my-test-skill` (6 uses) is
   someone's test upload. `ci-cd-pipeline-validator` declares `api.example.com` as a permitted
   host. `humanize-writing` ships with unfilled authoring-scaffold text. The marketplace does not
   appear to gate on packaging hygiene.
7. **Duplicate publications are common.** Two identical Code Sensei listings, two
   `ai-logo-brand-identity-kit` listings, two `marketing-copy-engine` listings, three
   `sql-query-explainer` variants, six README generators. Count distinct *capabilities*, not
   listings.
8. **Translation & Localization (61 listings) is 100% free in every result I saw** and sits
   outside the brief's mapping — no role of ours claims it. Sixteen free rows, best-used
   `proofread-translation` at 12 uses, plus `i18n-auditor` (6) and `czech-english-i18n` (2) which
   are really Engineer skills. If the shelf ever grows a ninth role, this category is already
   stocked and uncontested.

---

## 15. The five unmapped and meta categories

### 15.1 Finance & Accounting (574) — unmapped, and a real job we have no role for

| Skill | Slug | Uses | Rating |
|---|---|---|---|
| Financial Analysis Decision Engine | `financial-analysis-engine` | 21 | 5.0 |
| Expense Categoriser Global | `expense-categoriser-global` | 11 | — |
| momsdeklaration-skatteverket | `momsdeklaration-skatteverket` | 10 | 5.0 |
| Invoice Builder Global | `invoice-builder-global` | 8 | — |
| Financial Statement Simplifier | `financial-statement-simplifier` | 7 | — |
| Deferred Revenue Tie-Out Check | `deferred-revenue-tie-out-check` | 5 | 5.0 |
| EU VAT Quick Checker | `eu-vat-quick-checker` | 5 | — |
| Bookkeeper's Assistant (Free Starter) | `bookkeeper-s-assistant-free-starter` | 4 | — |
| schedule-c-deduction-finder-free | `schedule-c-deduction-finder-free` | 4 | — |
| Profit Cashflow Quick Check | `profit-cashflow-quick-check` | 4 | — |
| nex-einvoice-de | `nex-einvoice-de` | 4 | — |
| nex-einvoice-fr | `nex-einvoice-fr` | 3 | — |
| nex-einvoice-es | `nex-einvoice-es` | 3 | — |
| email receipt classifier | `email-receipt-classifier` | 3 | — |
| Accounting Practice Pal (Free Starter) | `accounting-practice-pal-free-starter` | 3 | — |
| stablecoin-invoice-tracker | `stablecoin-invoice-tracker` | 3 | — |
| Proforma Invoice Generator | `proforma-invoice-generator` | 3 | — |
| bank fee analyzer | `bank-fee-analyzer` | 3 | — |
| nex-vzw-admin-pack | `nex-vzw-admin-pack` | 3 | — |
| weft company financial snapshot | `weft-company-financial-snapshot` | 3 | — |

**For the owner's decision:** 20 free rows and almost no paid competition in the
`most_installed` set — unusual. Heavily jurisdictional (Swedish VAT, German/French/Spanish
e-invoicing, Belgian vzw, US Schedule C), which is exactly why one creator cannot own it. If the
shelf wants a ninth role, **Bookkeeper is the best-stocked free candidate of these five.**

### 15.2 Legal & Compliance (234) — unmapped

| Skill | Slug | Uses | Rating |
|---|---|---|---|
| soc2-compliance-pack | `soc2-compliance-pack` | 7 | — |
| nex-coppa-2026-pack | `nex-coppa-2026-pack` | 3 | — |
| quote grounded answer | `quote-grounded-answer` | 2 | — |
| Czech Document Anonymization | `czech-document-anonymization` | 2 | — |
| nex-us-privacy-multistate | `nex-us-privacy-multistate` | 2 | — |
| Public Records Request | `public-records-request` | 1 | — |
| NDA Review Against Your Playbook | `nda-review-against-your-playbook` | 1 | — |
| LexVibe | `lexvibe` | 1 | — |
| Contract Triage Lite | `contract-triage-lite-offline-nda-msa-risk-flags` | 1 | — |
| Verify a Company Before Paying It | `verify-a-company-before-paying-it` | 1 | — |
| Federal Proposal Skills | `federal-proposal-skills` | 1 | — |

**For the owner's decision:** the thinnest of the five. Eleven free rows, 22 uses between them;
contract review — the actual demand — is paid ($9, $14, $15, $29). `soc2-compliance-pack`
(7 uses, maps AWS/GCP/GitHub config to 64 SOC2 controls) is the one free row with substance, and
it arguably belongs to DevOps or Security rather than a Legal role. **Weak case for a role.**

### 15.3 Trading & Investing (442) — unmapped

| Skill | Slug | Uses | Rating |
|---|---|---|---|
| technical-scanner | `technical-scanner` | **214** | 5.0 |
| python-trading-toolkit | `python-trading-toolkit` | 67 | 5.0 |
| EV Calculator | `ev-calculator-expected-value-stock-analyzer` | 51 | 4.0 |
| Investment Analysis Engine | `investment-analysis-engine` | 35 | — |
| longbridge | `longbridge` | 33 | — |
| quantitative-stock-analyzer | `quantitative-stock-analyzer` | 26 | — |
| delay-replay-filter | `delay-replay-filter` | 10 | — |
| Honest Strategy Validation for Trading Bots | `honest-strategy-validation-for-trading-bots` | 5 | — |
| Trade Journal | `trade-journal` | 4 | — |
| Execute a Pre-Committed Trade Plan | `execute-a-pre-committed-trade-plan` | 4 | — |
| Price History and Seasonality | `price-history-and-seasonality` | 2 | — |
| 30-Day Catalyst Screen | `30-day-catalyst-screen` | 1 | — |
| Rebalance Plan | `rebalance-plan` | 1 | — |
| Portfolio Review | `portfolio-review` | 1 | — |
| Trading 212 Portfolio Analysis | `trading-212-portfolio-analysis` | 1 | — |
| flip profit and timeline calculator | `flip-profit-and-timeline-calculator` | 1 | — |
| AlphAI Peer Read-Across | `alphai-peer-read-across` | 1 | — |

**For the owner's decision:** the **strongest free tier of the five by a wide margin**.
`technical-scanner` has 214 uses and a 5.0, which puts it in the marketplace's top 15 overall;
`python-trading-toolkit` (67 / 5.0) and `EV Calculator` (51 / 4.0) follow. Caveats: nearly all
need API keys and live market data, several are region-specific (A-shares, Hong Kong, Longbridge,
Trading 212), and `Honest Strategy Validation for Trading Bots` exists precisely because the rest
of this category over-claims. A real, used, free-rich category — and the one with the most
liability attached to shipping it.

### 15.4 Agents & Orchestration (2001) — meta, and the largest category on Agensi

| Skill | Slug | Uses | Rating |
|---|---|---|---|
| deep-research-team | `deep-research-team` | 248 | 4.8 |
| ai-productivity | `ai-productivity` | 177 | 5.0 |
| skill-router | `skill-router-1` | 80 | 5.0 |
| agent-handoff-orchestrator | `agent-handoff-orchestrator` | 60 | 5.0 |
| Credit Optimizer v5 | `credit-optimizer-v5` | 53 | 5.0 |
| agent-workflow-controller | `agent-workflow-controller` | 30 | — |
| Enterprise Multi-Agent Automation | `enterprise-multi-agent-automation-production-harness-with-denbun-retry-self-healing` | 23 | 5.0 |
| Multi-Agent Workflow Orchestration Architect | `multi-agent-workflow-orchestration-architect` | 18 | — |
| Agent handoff lite | `agent-handoff-lite` | 13 | 5.0 |
| multi-agent-orchestration | `multi-agent-orchestration` | 11 | — |
| Low Code Agentic Workflow Architect | `low-code-agentic-workflow-architect` | 10 | 5.0 |
| lobster-coordinator | `lobster-coordinator` | 8 | — |
| Agent Handoff Contract | `agent-handoff-contract` | 6 | — |
| Multi-Agent Workflow Designer | `multi-agent-workflow-designer` | 5 | 5.0 |
| agent-session-continuity | `agent-session-continuity` | 4 | — |
| BlankVisuals Validator | `blankvisuals-validator-1-0-2` | 4 | — |
| dataecho-memory | `dataecho-memory` | 4 | — |
| Kimi WebBridge Fleet | `kimi-webbridge-fleet` | 3 | — |
| Multi-Agent Story Flow | `multi-agent-story-flow-claude-builds-codex-reviews` | 3 | 5.0 |
| Agent Orchestrator: Parallel Coding Agents | `agent-orchestrator-parallel-coding-agents` | 3 | 5.0 |
| Codex Taskforce | `codex-taskforce` | 2 | — |
| agent constitution audit | `agent-constitution-audit` | 2 | — |
| agent-debug-troubleshooter | `agent-debug-troubleshooter-1` | 1 | — |

**For the owner's decision:** 2,001 listings — more than any other category, and nearly all of
the top of it is free. Five free skills above 50 uses, two above 170. The repeated theme is
*handoff*: five separate free skills exist purely to pass context between agents. That is a
genuine, visible customer need and it has no home on our eight-role shelf. **Strongest case of
the five for becoming a ninth role**, and it is the role our own product is closest to.

### 15.5 Prompt & Skill Engineering (343) — meta

| Skill | Slug | Uses | Rating |
|---|---|---|---|
| prompt-engineer | `prompt-engineer` | 576 | 4.7 |
| skill-creator | `skill-creator` | 280 | 5.0 |
| skill-polisher | `skill-polisher` | 76 | 5.0 |
| Agensi Skill Authoring | `agensi-skill-authoring` | 54 | 4.8 |
| Agent Skill Creator | `agent-skill-creator` | 32 | 5.0 |
| 3D Reference Researcher | `3d-reference-researcher` | 21 | — |
| MD Design System | `md-design-system` | 19 | 4.9 |
| Task Observer | `task-observer-one-skill-to-rule-them-all` | 10 | — |
| Agensi Skill Preflight | `agensi-skill-preflight` | 9 | — |
| awesome student ai skills | `awesome-student-ai-skills` | 9 | — |
| API Spec Researcher | `api-spec-researcher-systematic-external-api-investigation` | 8 | — |
| Skill Creator Pro | `skill-creator-pro-build-skills-that-trigger-work` | 8 | 5.0 |
| Prompt Engineer: Reliable Prompts & System Prompts | `prompt-engineer-reliable-prompts-system-prompts` | 7 | 5.0 |
| skill-description-optimizer | `skill-description-optimizer` | 5 | 5.0 |
| agensi-launch-kit | `agensi-launch-kit` | 2 | 5.0 |
| skill-quality-linter | `skill-quality-linter` | 2 | — |
| Prompt Engineering Engine | `prompt-engineering-engine` | 9 | — (Joker; image models) |

**For the owner's decision:** small (343) but unusually well-used and well-rated for its size —
`prompt-engineer` 576 / 4.7, `skill-creator` 280 / 5.0, `skill-polisher` 76 / 5.0,
`agensi-skill-authoring` 54 / 4.8. Read it together with the six skill-security auditors in §5:
**the marketplace's own supply chain — authoring, linting, packaging, vetting and securing
skills — is a mature free ecosystem.** It is also unambiguously its own role. If the owner wants
a ninth role that our existing audience already needs, this and Agents & Orchestration are the
two to consider, and they may be one role.

---

## 16. Shortlist, if the owner wants one

Free, verified, and with enough evidence behind them to defend putting on a shelf. Install count
and rating as reported; **(low n)** means the rating rests on fewer than five reviewers.

| Role | Skill | Uses | Rating | Why this one |
|---|---|---|---|---|
| QA | `code-reviewer` | 1,931 | 4.2 (17) | Only free skill with a meaningful rating. Needs terminal + Git only |
| Engineer | `codex-grade-coding` | 326 | 4.8 | Scope-limited changes with verification evidence; no permissions |
| Engineer | `git-commit-writer` | 479 | 4.8 | Narrow job, done well, fully evidenced |
| Producer | `readme-generator` | 358 | 5.0 | Reads the repo rather than guessing; six competitors, this is the one used |
| Producer | `pr-description-writer` | 223 | 5.0 | Same discipline, same author pattern |
| Producer | `deep-research-team` | 248 | 4.8 | Best free multi-agent research skill with real reviews |
| Marketer | `humanize-writing` | 792 | 4.7 (11) | Nine competitors; this is the only one with credible reviews |
| Marketer | `seo-audit-agent-full-website-seo-checker` | 75 | 5.0 (low n) | Only needs web access; produces a prioritized report |
| Marketer | `lead-generation-agent` | 72 | 5.0 (low n) | CSV-ready scored prospect list; no permissions |
| Marketer | `designer-carousel-post` | 132 | 5.0 (low n) | Best-used social skill on the marketplace |
| Security | `security-code-review` | 34 | 5.0 (low n) | CWE-mapped with an approval verdict; read-files only |
| Security | `security-first` | 108 | 4.5 (2) | Preventive, pre-code; zero permissions. Nothing on our shelf does this |
| Designer | `frontend-motion-wizard` | 320 | 4.3 | Highest-used free design-adjacent skill |
| Designer | `ui-component-architect` | 115 | 5.0 (low n) | Tailwind components; complements our style packs |
| Designer | `image-prompt-consistency-guard` | 24 | 5.0 (low n) | Fixes prompt drift across a set — a real production problem |
| DevOps | `ci-cd-pipeline-validator` | 27 | — (3 votes) | The only substantial free DevOps skill. Know it funnels to a $9.99 Pro |
| Support | `gmail-checker` | 42 | — | Only free Support row with any evidence, though it is a digest not a triage |
| Meta | `skill-creator` | 280 | 5.0 (low n) | Our audience's own job; mature free ecosystem around it |

**Deliberately not shortlisted despite high install counts:** `seo-optimizer` (266) — mis-titled,
actually a Chinese ad-law checker. `social-media-ops` (51) — English listing names LinkedIn, body
covers Chinese platforms only. `content-writer` (138) — Chinese platforms only.
`video-enhancement` (177) — rated 3.7 and needs paid third-party inference. The
`AI <X> Tool - <Company>` family (8–71 uses) — single-company sales assistants, not general
skills.
