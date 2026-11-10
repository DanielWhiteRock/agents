---
name: engineering-principles
description: Twenty-four engineering principles — root causes, blast radius, idempotency, type discipline, proving it works, subtracting before adding. Read the matching file when a decision turns on one of them; use when choosing between designs, justifying a refactor, or deciding what to verify.
---

# Engineering principles

Twenty-four short principles from pstack, by Poteto, MIT. Each is one page in
`principles/`. They are kept here as references rather than as twenty-four
separate skills on purpose: a skill's description sits in the model's context
for the whole session, so twenty-four of them would cost the same prefix every
turn to say something most turns do not need. One index, read on demand.

Read the file, do not paraphrase from the title. Several of these say the
opposite of what their name suggests at a glance.

## When a decision turns on one of these

**Deciding what to build, or whether to**
- `attack-the-premise` — the question may be wrong before the answer is
- `exhaust-the-design-space` — the second idea is rarely the last one
- `redesign-from-first-principles` — when the constraints have moved
- `subtract-before-you-add` — removal is a feature
- `laziness-protocol` — the least work that fully solves it
- `foundational-thinking` — what has to be true underneath

**Designing it**
- `model-the-domain` — names that match the thing
- `boundary-discipline` — what crosses a seam, and what must not
- `type-system-discipline` — make the invalid state unrepresentable
- `separate-before-serializing-shared-state` — contention is a design choice
- `make-operations-idempotent` — retries are the normal case
- `build-the-lever` — the tool that makes the next ten cheap

**Doing it**
- `sequence-verifiable-units` — each step provable before the next
- `outcome-oriented-execution` — the result, not the activity
- `never-block-on-the-human` — carry on, report what you assumed
- `guard-the-context-window` — attention is the scarce resource
- `migrate-callers-then-delete-legacy-apis` — in that order, always

**Proving it**
- `prove-it-works` — a claim without evidence is a guess
- `test-behavior-not-implementation` — tests that survive a refactor
- `fix-root-causes` — the symptom is not the bug
- `explain-the-number` — a figure you cannot derive is decoration

**Leaving it better than you found it**
- `encode-lessons-in-structure` — a rule nobody can break beats a rule nobody reads
- `minimize-reader-load` — the next reader is the user
- `experience-first` — what it is like to use decides whether it is good
