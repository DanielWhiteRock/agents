#!/usr/bin/env node
/**
 * Render a reference card for each design system, from that system's own tokens.
 *
 * A design system's reference image should be the system, not a picture of one.
 * Generated art gives an impression of a style; this takes the palette, the
 * type scale, the spacing scale and the typeface the system actually specifies
 * and lays out a card with them. If a card looks wrong, the reading of the
 * system is wrong — which is a useful thing for an image to be able to tell you.
 *
 *   node scripts/render-system-cards.mjs [tokens.json] [outDir]
 */
import { chromium } from "playwright-core";
import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const tokensPath = process.argv[2] ?? "/tmp/designers/tokens.json";
const outDir = process.argv[3] ?? "/tmp/designers/cards";
mkdirSync(outDir, { recursive: true });
const systems = JSON.parse(readFileSync(tokensPath, "utf8"));

/** Relative luminance, so the card can pick a legible ink for its own accent. */
const lum = (hex) => {
  const n = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const onAccent = (hex) => (lum(hex) > 0.45 ? "#111111" : "#FFFFFF");
const mix = (hex, pct) => `color-mix(in srgb, ${hex} ${pct}%, transparent)`;

function card(s) {
  const [t1, t2, t3, t4, t5, t6] = [...s.scale, ...s.scale].slice(0, 6);
  const [s1, s2, s3, s4, s5, s6] = [...s.spacing, ...s.spacing].slice(0, 6);
  const families = [s.font, s.mono].filter(Boolean)
    .map((f) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}:wght@400;600;700`).join("&");
  const dark = lum(s.surface) < 0.4;
  const line = dark ? "rgba(255,255,255,.16)" : "rgba(0,0,0,.14)";
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${families}&display=swap">
<style>
  :root{ --primary:${s.primary}; --surface:${s.surface}; --text:${s.text};
    --on-primary:${onAccent(s.primary)}; --line:${line};
    --secondary:${s.secondary || s.primary}; }
  *{box-sizing:border-box;margin:0}
  body{width:1120px;height:840px;display:grid;place-items:center;
    background:${dark ? "#07090C" : "#EEF0F2"};font-family:"${s.font}",system-ui,sans-serif}
  .card{width:860px;background:var(--surface);color:var(--text);
    border:1px solid var(--line);border-radius:${s3}px;overflow:hidden;
    box-shadow:0 ${s3}px ${s6 * 2}px rgba(0,0,0,${dark ? ".6" : ".12"})}
  .bar{background:var(--primary);color:var(--on-primary);
    padding:${s4}px ${s5}px;display:flex;align-items:center;gap:${s3}px}
  .dot{width:${t2}px;height:${t2}px;border-radius:50%;background:var(--on-primary);opacity:.9}
  .bar .w{height:${t2}px;width:190px;background:var(--on-primary);opacity:.85;border-radius:${s1}px}
  .body{padding:${s5}px ${s5}px ${s5}px}
  .h{height:${t6}px;width:62%;background:var(--text);border-radius:${s1}px;margin-bottom:${s3}px}
  .sub{height:${t3}px;width:84%;background:${mix(s.text, 34)};border-radius:${s1}px;margin-bottom:${s5}px}
  .field{border:1px solid var(--line);border-radius:${s2}px;height:${t5 + s4 * 2}px;
    margin-bottom:${s3}px;display:flex;align-items:center;padding:0 ${s4}px}
  .field .w{height:${t2}px;width:40%;background:${mix(s.text, 26)};border-radius:${s1}px}
  .row{display:flex;gap:${s3}px;align-items:center;margin-top:${s4}px}
  .btn{background:var(--primary);color:var(--on-primary);border-radius:${s2}px;
    padding:${s3}px ${s5}px;height:${t4 + s4 * 2}px;display:flex;align-items:center}
  .btn .w{height:${t2}px;width:72px;background:var(--on-primary);opacity:.95;border-radius:${s1}px}
  .btn.ghost{background:transparent;border:1px solid var(--line)}
  .btn.ghost .w{background:${mix(s.text, 50)};opacity:1}
  .swatches{display:flex;gap:${s2}px;margin-top:${s5}px;padding-top:${s4}px;border-top:1px solid var(--line)}
  .sw{width:${s6}px;height:${s4}px;border-radius:${s1}px}
  .scale{display:flex;gap:${s3}px;align-items:flex-end;margin-left:auto}
  .scale i{display:block;width:${s2}px;background:${mix(s.text, 40)};border-radius:1px}
</style></head><body>
  <div class="card">
    <div class="bar"><span class="dot"></span><span class="w"></span></div>
    <div class="body">
      <div class="h"></div><div class="sub"></div>
      <div class="field"><span class="w"></span></div>
      <div class="field"><span class="w"></span></div>
      <div class="row">
        <span class="btn"><span class="w"></span></span>
        <span class="btn ghost"><span class="w"></span></span>
      </div>
      <div class="swatches">
        <span class="sw" style="background:var(--primary)"></span>
        <span class="sw" style="background:var(--secondary)"></span>
        <span class="sw" style="background:${s.danger}"></span>
        <span class="sw" style="background:${mix(s.text, 70)}"></span>
        <span class="scale">${[t1, t2, t3, t4, t5, t6].map((n) => `<i style="height:${n}px"></i>`).join("")}</span>
      </div>
    </div>
  </div>
</body></html>`;
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1120, height: 840 }, deviceScaleFactor: 1 });
let n = 0;
for (const s of systems) {
  await page.setContent(card(s), { waitUntil: "load" });
  // Webfonts arrive after load; a card rendered in the fallback face is a card
  // that shows the wrong system.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(220);
  await page.screenshot({ path: join(outDir, `${s.slug}.png`) });
  n += 1;
  if (n % 10 === 0) console.log(`  ${n}/${systems.length}`);
}
await browser.close();
console.log(`rendered ${n} cards to ${outDir}`);
