# What this pack is made of

Four skills from two upstreams and three copyright holders, used under MIT.

| Skill | From | Author | Licence |
|---|---|---|---|
| `handoff`, `behavior-validator` | [openclaw/agent-skills](https://github.com/openclaw/agent-skills) · `skills/<name>` | openclaw | MIT |
| `agent-architecture` | [github/awesome-copilot](https://github.com/github/awesome-copilot) · `skills/agent-architecture` | Stanislav Bankovskii | MIT |
| `agentic-eval` | [github/awesome-copilot](https://github.com/github/awesome-copilot) · `skills/agentic-eval` | GitHub, Inc. | MIT |

`agent-architecture` is the reason this table has three rows rather than two. It
is a contribution to `awesome-copilot` that ships its own `LICENSE.txt` inside
its skill directory naming a different holder from the repository's. That file
travels with the skill here, unmodified, at
`skills/agent-architecture/LICENSE.txt`. Crediting the repo owner for it would
have been the exact mistake MIT forbids, and it is only visible if you look in
the folder rather than at the repo.

## Upstream licences and notices

All three read directly on 2026-11-11. Each notice is reproduced as its own
LICENSE file writes it.

`openclaw/agent-skills`, read at
`raw.githubusercontent.com/openclaw/agent-skills/main/LICENSE`:

```
MIT License

Copyright (c) 2026 openclaw

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

`skills/agent-architecture`, read at
`github/awesome-copilot/contents/skills/agent-architecture/LICENSE.txt`:

```
MIT License

Copyright (c) 2026 Stanislav Bankovskii

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

`github/awesome-copilot`, read at `github/awesome-copilot/contents/LICENSE`,
which covers `agentic-eval` — it declares no licence of its own and its
directory carries no LICENSE file:

```
MIT License

Copyright GitHub, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## What we changed

MIT does not require a change statement. Listed anyway, so our edits are
distinguishable from the authors' work.

| File | Change |
|---|---|
| `skills/agentic-eval/SKILL.md` | `description` was a YAML block scalar, which our importer reads as a single line and therefore receives as `\|` — the model would never learn when to use the skill. Flattened to one line, keeping the upstream wording and bullet order as a semicolon list. |

Everything else is byte-for-byte upstream, including `agent-architecture`'s
thirteen reference files, its `LICENSE.txt` and its `agents/openai.yaml`.

## Why these four

The role is "builds the worker, not the answer — and tests that it fires when it
should", so the pack is a design half and a proof half.

`agent-architecture` is the design half and the deepest thing here: requirements
discovery, architecture selection, capability design, an architecture contract,
execution continuity, evaluation design and a validation loop, with an audit
path for an agent that already exists. It is explicitly architecture only, which
is why the pack still needs the rest.

`behavior-validator` is the proof half, and it is the one skill on any of the
catalogues we surveyed that tests a built thing the way a customer would: write
the behaviour contract first, then exercise the running product **source-blind**,
with anti-cheat probes for the case where a button reports success and does
nothing. `agentic-eval` carries the quality loop above that — reflection,
evaluator-optimizer, rubric and judge-based scoring.

`handoff` closes the gap the catalogue advertises loudest and answers worst:
five separate free listings exist to pass context between agents, the best of
them at 60 uses, and the paid attempts sit at nothing. This one produces a
standalone prompt that carries existing authority without granting new
authority, and uses portable anchors instead of filesystem paths — which is the
detail every hand-me-down prompt gets wrong.

Left out on purpose: `team-handoff` from the same openclaw repository, which is
excellent and entirely specific to running an OpenClaw Gateway behind Cloudflare
Access — it would be a prerequisite we cannot expect, dressed as a feature.

The composition is ours; the skills are theirs.
