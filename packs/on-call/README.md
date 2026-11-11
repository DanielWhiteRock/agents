# What this pack is made of

Four skills from one upstream, used under MIT.

| Skill | From | Licence |
|---|---|---|
| `incident-postmortem`, `github-release`, `diagnose-ci-gate`, `devops-rollout-plan` | [github/awesome-copilot](https://github.com/github/awesome-copilot) · `skills/<name>` | MIT |

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

That repository's `CONTRIBUTING.md` lets a contribution declare its own
`license` in the skill's front matter, so the repo licence is the default rather
than a guarantee. None of the four skills here declares one, and none of their
directories carries its own LICENSE file, so repo-level MIT applies to all four.
Checked per skill, not inferred from the repo.

## What we changed

MIT does not require a change statement. These are listed anyway, because a
buyer should be able to tell our edits from the upstream author's work.

| File | Change |
|---|---|
| `skills/incident-postmortem/SKILL.md` | The DOCX row of the output-format table pointed at a sibling skill in the upstream repo (`skills/md-to-docx`) that does not travel with this pack. Replaced with the same instruction the PDF row already gives: convert with a locally available tool, and say so rather than installing one silently. |
| `skills/github-release/SKILL.md` | The two entries under "Reference files" were written as plain backticks; made them markdown links so the bundled files register as references. No wording changed. |

Everything else is byte-for-byte upstream.

## Why these four and not the other 457

`awesome-copilot` ships 461 skills. Most are Azure-, Microsoft- or
framework-specific and belong to somebody else's stack. These four are the
release-and-incident remit this role was narrowed to: plan the rollout, cut the
version, decide whether a red check is yours, and write the post-mortem. The
monitoring half of the old DevOps promise is deliberately absent — we would be
promising a shelf we cannot stock.

`incident-postmortem` is the reason the pack exists. It follows the Google SRE
post-mortem structure, drives cause-finding through a fishbone diagram before 5
Whys, types every action item as Detect / Mitigate / Prevent, and states in its
own description that everything comes from the user and it will not invent
timestamps, metrics, names or causes.

The composition is ours; the skills are theirs.
