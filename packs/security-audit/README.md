# What this pack is made of

Five skills from one upstream, used under MIT.

| Skill | From | Licence |
|---|---|---|
| `security-review`, `mcp-security-audit`, `agent-supply-chain`, `agent-owasp-compliance`, `ai-prompt-engineering-safety-review` | [github/awesome-copilot](https://github.com/github/awesome-copilot) · `skills/<name>` | MIT |

## Upstream licence and notice

`github/awesome-copilot`, read at `github/awesome-copilot/contents/LICENSE` on
2026-11-11. The notice is reproduced as that file writes it:

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

A contribution to that repository may declare its own `license` in front
matter, which would override the repo default. None of these five does, and none
of their directories carries its own LICENSE file, so repo-level MIT applies.
Checked per skill.

## What we changed

MIT does not require a change statement. These are listed anyway, so our edits
are distinguishable from the upstream author's work.

| File | Change |
|---|---|
| `skills/mcp-security-audit/SKILL.md`, `skills/agent-owasp-compliance/SKILL.md`, `skills/agent-supply-chain/SKILL.md` | Each wrote `description` as a YAML block scalar. Our importer reads a single-line value, so a block arrives as `\|` and the model never learns when to use the skill. Flattened to one line, keeping the upstream wording and bullet order; the bullets became a semicolon list, and `mcp-security-audit`'s stray `keywords:` line — indented inside the description block rather than beside it — was dropped. |
| `skills/security-review/SKILL.md` | The five entries under "Reference Files" were plain backticks; made them markdown links so the bundled files register as references. No wording changed. |

Everything else is byte-for-byte upstream.

## Why these five

The role is "looks for the way in" aimed at what this marketplace actually
sells: skills, prompts, MCP servers and agents, not web-app pen testing. So the
pack covers the code (`security-review`), the agent's configuration
(`mcp-security-audit`), whether what runs is what was reviewed
(`agent-supply-chain`), the standard a review gets measured against
(`agent-owasp-compliance`), and the prompt itself as the artifact under test
(`ai-prompt-engineering-safety-review`).

`security-review` is the depth: five reference files covering per-language
vulnerability patterns, secret detection heuristics, a CVE watchlist across five
package managers, the category reference, and a report format. It also runs a
self-verification pass before reporting, which is the part most scanners skip.

Left out on purpose: `secret-scanning`, which configures GitHub Advanced
Security rather than auditing anything, and `threat-model-analyst`, which is
excellent and ships 300KB of references — a pack of its own, not a member of
this one.

The composition is ours; the skills are theirs.
