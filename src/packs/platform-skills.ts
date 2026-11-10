import type { SkillUpload } from "../runtime/types.js";

/**
 * Skills the platform attaches to every pack.
 *
 * A capability every agent should have but no author should have to write. They
 * are uploaded once and reused by id, so a hundred packs share one skill rather
 * than a hundred copies.
 *
 * Keep this list short. Every attached skill costs a little context on every
 * session, and the point of a pack is the author's expertise, not ours.
 */
export const PLATFORM_SKILLS: SkillUpload[] = [
  {
    name: "rendering-pages",
    files: [
      {
        path: "SKILL.md",
        content: `---
name: rendering-pages
description: Turns an HTML page, a chart or a document into a PNG, JPEG or PDF image on this machine. Use when the deliverable is a picture of a page rather than the page itself, when the person asks for a screenshot, a preview, a thumbnail, or an image of something you have written, or when a report needs to be delivered as a PDF.
---

# Rendering a page to an image

You cannot see a screen and there is no browser you can look through. You can,
however, rasterise HTML yourself. Two routes are available and they differ in
fidelity, not in difficulty.

## The fast route: wkhtmltoimage

Installed already, no setup, renders in a second or two.

\`\`\`bash
wkhtmltoimage --width 1280 --enable-local-file-access page.html /mnt/session/outputs/page.png
wkhtmltopdf --enable-local-file-access page.html /mnt/session/outputs/page.pdf
\`\`\`

**Its renderer is old QtWebKit, and that matters.** It does not support CSS
custom properties (\`var(--x)\`), CSS grid, \`gap\`, \`color-scheme\`, or
\`prefers-color-scheme\`. A modern page rendered through it comes out unstyled or
wrong, and a blank-looking screenshot is usually this and not a failure of the
command.

So when a page is *for rendering*, write it for this renderer: plain hex colours
rather than variables, tables or floats rather than grid, explicit margins
rather than \`gap\`. See [writing-for-wkhtmltoimage.md](writing-for-wkhtmltoimage.md).

When a page is *for a person to open in a browser*, write it normally — and if
they also want an image of it, use the faithful route below rather than
degrading the page.

## The faithful route: headless Chromium

Full modern CSS. The browser is not installed, so the first run downloads it,
which takes a couple of minutes and needs the network.

\`\`\`bash
python3 -m playwright install --with-deps chromium
python3 /mnt/session/uploads/pack/shot.py page.html /mnt/session/outputs/page.png
\`\`\`

A minimal script is in [shot.py](shot.py); copy it into the sandbox and run it.

Use this when the page uses modern CSS, when the colours have to be right, or
when the person asked for a screenshot of something already written for a
browser. Tell them it is downloading a browser so the wait is expected.

## Afterwards

\`convert\` (ImageMagick) is available for resizing and format changes:

\`\`\`bash
convert page.png -resize 1200x page-small.png
convert page.png page.jpg
\`\`\`

## Rules

- Write the image into \`/mnt/session/outputs/\`. Anywhere else and it is lost.
- **Check the result before reporting it.** \`identify page.png\` gives the
  dimensions; a file of a few hundred bytes, or one a fraction of the height you
  expected, means the render failed or the CSS was dropped. Say so rather than
  announcing a screenshot that is blank.
- Say which route you used and why, so the person knows whether they are looking
  at a faithful rendering or an approximation.
`,
      },
      {
        path: "writing-for-wkhtmltoimage.md",
        content: `# Writing HTML that wkhtmltoimage renders correctly

Its engine is QtWebKit, roughly a browser from 2012. Everything below is about
staying inside what it understands.

## Does not work

| Feature | Instead |
|---|---|
| \`var(--token)\` custom properties | literal hex values |
| \`display: grid\`, \`gap\` | \`<table>\`, floats, or margins |
| \`prefers-color-scheme\`, \`color-scheme\` | pick one palette; light reproduces better |
| \`position: sticky\` | \`static\` or \`absolute\` |
| modern units: \`dvh\`, \`clamp()\`, \`min()\` | \`px\` and \`%\` |
| webfonts over the network | the system stack below |

## Works

- \`display: flex\` in its older form, without \`gap\` — use margins on children
- floats, tables, absolute positioning
- background colours and gradients, borders, border-radius, box-shadow
- \`font-family: Helvetica, Arial, sans-serif\`

## A starting point

\`\`\`html
<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  body { margin: 0; padding: 40px; background: #fbfaf8; color: #1b1d21;
         font-family: Helvetica, Arial, sans-serif; font-size: 15px; line-height: 1.55; }
  .wrap { max-width: 900px; margin: 0 auto; }
  h1 { font-size: 28px; margin: 0 0 8px; }
  .card { background: #ffffff; border: 1px solid #e3e0da; border-radius: 10px;
          padding: 18px; margin-bottom: 14px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #e3e0da; }
  th { color: #5a6069; font-size: 12px; text-transform: uppercase; }
  .num { text-align: right; }
</style></head>
<body><div class="wrap">
  <h1>Title</h1>
  <div class="card">Content</div>
</div></body></html>
\`\`\`

## Width

\`--width 1280\` sets the viewport. The image is as tall as the content, so a
long page gives a tall image. For a thumbnail, render at full size and resize
with \`convert\` rather than rendering small — text stays legible that way.
`,
      },
      {
        path: "shot.py",
        content: `#!/usr/bin/env python3
"""Render a local HTML file to PNG with headless Chromium.

    python3 -m playwright install --with-deps chromium
    python3 shot.py page.html out.png [width] [--viewport-only]

Full page by default, because a screenshot that silently crops is worse than a
tall one.
"""
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) < 2:
        print(__doc__)
        return 2

    source, target = Path(args[0]).resolve(), Path(args[1])
    width = int(args[2]) if len(args) > 2 else 1280
    full_page = "--viewport-only" not in sys.argv

    if not source.exists():
        print(f"no such file: {source}")
        return 1
    target.parent.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": width, "height": 900})
            page.goto(source.as_uri(), wait_until="networkidle")
            page.screenshot(path=str(target), full_page=full_page)
        finally:
            browser.close()

    size = target.stat().st_size
    print(f"wrote {target} ({size} bytes)")
    # A few hundred bytes means a blank page, which is worth saying out loud
    # rather than reporting as a successful screenshot.
    if size < 2000:
        print("WARNING: that is very small — the page probably rendered blank")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
`,
      },
    ],
  },
];
