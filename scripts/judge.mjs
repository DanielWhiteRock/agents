#!/usr/bin/env node
/**
 * Scores every screen against Apple's interface rules.
 *
 * Each check below is mechanical and names the rule it serves. That is the
 * whole point: a design review that depends on taste cannot be run in CI and
 * cannot tell you whether today is worse than yesterday. Taste decides which
 * checks belong here; the checks themselves either pass or they do not.
 *
 *   node scripts/judge.mjs                 # every screen, summary table
 *   node scripts/judge.mjs --verbose       # every finding, not just failures
 *   node scripts/judge.mjs --min 99        # exit non-zero below this score
 *
 * It drives real Chrome, because the things worth checking — contrast of
 * rendered text, tap target size, overflow at phone width, whether reduced
 * motion actually collapses an animation — only exist once something is laid
 * out. Static analysis of the stylesheet would pass a page that is broken.
 */
import { chromium } from "playwright-core";

const BASE = process.env.JUDGE_BASE ?? "http://localhost:4317";
const EMAIL = process.env.JUDGE_EMAIL ?? "ui-look@example.com";
const PASSWORD = process.env.JUDGE_PASSWORD ?? "look-at-the-ui";
const args = process.argv.slice(2);
const VERBOSE = args.includes("--verbose");
const MIN = Number(args[args.indexOf("--min") + 1]) || 0;

/** Every screen a person can reach, with how to get there. */
const SCREENS = [
  { name: "Catalog", path: "/" },
  { name: "Catalog (searched)", path: "/?q=support" },
  { name: "Catalog (no matches)", path: "/?q=zzzznope" },
  { name: "Pack", path: "/packs/guardrails" },
  { name: "Runs", path: "/runs" },
  { name: "Run trace", path: ":latestRun" },
  { name: "Points", path: "/ledger" },
  { name: "Authoring", path: "/authors" },
  { name: "Schedules", path: "/schedules" },
  { name: "Purchases", path: "/purchases" },
  { name: "MCP access", path: "/tokens" },
  { name: "Team", path: "/team" },
  { name: "Payouts", path: "/payouts" },
  { name: "Limits", path: "/settings" },
  { name: "Sign in", path: "/login", anonymous: true },
  { name: "Create account", path: "/signup", anonymous: true },
];

// --------------------------------------------------------------- contrast

const srgb = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = ([r, g, b]) =>
  0.2126 * srgb(r / 255) + 0.7152 * srgb(g / 255) + 0.0722 * srgb(b / 255);
const contrast = (a, b) => {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};
const parseRgb = (s) => {
  const m = /rgba?\(([^)]+)\)/.exec(s ?? "");
  if (!m) return null;
  const n = m[1].split(",").map((x) => parseFloat(x));
  return n.length >= 3 ? [n[0], n[1], n[2], n[3] ?? 1] : null;
};

// ------------------------------------------------------------- the checks
//
// weight is how much a failure costs. A page cannot reach 99 while something
// weighted 10 is broken, which is the point of weighting at all.

const CHECKS = [
  {
    id: "no-sideways-scroll", weight: 12,
    rule: "Flexibility — it has to work on a phone, and a page that scrolls sideways does not",
    async run(page) {
      await page.setViewportSize({ width: 390, height: 844 });
      const over = await page.evaluate(() => {
        const d = document.documentElement;
        const wide = [...document.querySelectorAll("body *")]
          .filter((el) => el.getBoundingClientRect().right > d.clientWidth + 1)
          .slice(0, 3).map((el) => el.tagName.toLowerCase() + (el.className ? "." + String(el.className).split(" ")[0] : ""));
        return { scrollable: d.scrollWidth > d.clientWidth + 1, wide };
      });
      await page.setViewportSize({ width: 1280, height: 900 });
      return over.scrollable
        ? { pass: false, detail: `page scrolls sideways at 390px${over.wide.length ? ` — ${over.wide.join(", ")}` : ""}` }
        : { pass: true };
    },
  },
  {
    id: "tap-targets", weight: 8,
    rule: "Response — a control too small to hit reliably is a control that feels broken",
    async run(page) {
      await page.setViewportSize({ width: 390, height: 844 });
      const small = await page.evaluate(() => {
        const out = [];
        for (const el of document.querySelectorAll("button, a[href], input:not([type=hidden]), select, textarea")) {
          // A checkbox is hit by its label, so the label is the target. Measuring
          // the box itself would fail a control that is in fact easy to hit, and
          // a check that cries wolf gets switched off.
          const target = (el.tagName === "INPUT" && /^(checkbox|radio)$/.test(el.type) && el.closest("label")) || el;
          const r = target.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;          // not rendered
          if (el.closest("nav") && el.tagName === "A") continue;  // dense nav, judged separately
          if (r.height < 30) out.push((el.textContent || el.tagName).trim().slice(0, 24) + ` (${Math.round(r.height)}px)`);
        }
        return out.slice(0, 4);
      });
      await page.setViewportSize({ width: 1280, height: 900 });
      return small.length === 0 ? { pass: true } : { pass: false, detail: `under 30px tall: ${small.join(", ")}` };
    },
  },
  {
    id: "text-contrast", weight: 12,
    rule: "Craft — text you cannot read is not a style choice",
    async run(page) {
      const bad = await page.evaluate(() => {
        const out = [];
        const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        const seen = new Set();
        let n;
        while ((n = walk.nextNode())) {
          const text = n.textContent.trim();
          if (text.length < 3) continue;
          const el = n.parentElement;
          if (!el || seen.has(el)) continue;
          seen.add(el);
          const cs = getComputedStyle(el);
          if (cs.visibility === "hidden" || cs.display === "none") continue;
          let bg = "rgba(0, 0, 0, 0)", p = el;
          while (p && (bg === "rgba(0, 0, 0, 0)" || bg === "transparent")) { bg = getComputedStyle(p).backgroundColor; p = p.parentElement; }
          out.push({ fg: cs.color, bg, size: parseFloat(cs.fontSize), weight: cs.fontWeight,
            text: text.slice(0, 28), tag: el.tagName.toLowerCase() });
        }
        return out;
      });
      const fails = [];
      for (const s of bad) {
        const fg = parseRgb(s.fg), bg = parseRgb(s.bg);
        if (!fg || !bg || fg[3] < 0.95) continue;
        const large = s.size >= 24 || (s.size >= 18.66 && Number(s.weight) >= 700);
        const need = large ? 3 : 4.5;
        const got = contrast(fg, bg);
        if (got < need) fails.push(`${s.tag} "${s.text}" ${got.toFixed(2)}:1 (needs ${need})`);
      }
      return fails.length === 0
        ? { pass: true }
        : { pass: false, detail: fails.slice(0, 3).join(" · ") + (fails.length > 3 ? ` +${fails.length - 3} more` : "") };
    },
  },
  {
    id: "focus-ring", weight: 8,
    rule: "Agency — someone navigating by keyboard has to be able to see where they are",
    async run(page) {
      const ok = await page.evaluate(() => {
        const el = document.querySelector("a[href], button, input:not([type=hidden])");
        if (!el) return true;
        el.focus();
        const cs = getComputedStyle(el);
        return (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0)
          || cs.boxShadow !== "none";
      });
      return ok ? { pass: true } : { pass: false, detail: "the first focusable element shows no ring" };
    },
  },
  {
    id: "press-feedback", weight: 8,
    rule: "Response — feedback belongs on the press, not the release",
    async run(page) {
      const ok = await page.evaluate(() => {
        const sheet = [...document.styleSheets].flatMap((s) => { try { return [...s.cssRules]; } catch { return []; } });
        return sheet.some((r) => r.selectorText?.includes(":active")
          && /transform|filter|background/.test(r.style?.cssText ?? ""));
      });
      return ok ? { pass: true } : { pass: false, detail: "nothing responds to :active" };
    },
  },
  {
    id: "size-specific-tracking", weight: 6,
    rule: "Typography — one letter-spacing for every size is wrong somewhere",
    async run(page) {
      const r = await page.evaluate(() => {
        const h1 = document.querySelector("h1");
        if (!h1) return { none: true };
        const cs = getComputedStyle(h1);
        const size = parseFloat(cs.fontSize);
        const track = cs.letterSpacing === "normal" ? 0 : parseFloat(cs.letterSpacing) / size;
        return { track, lh: parseFloat(cs.lineHeight) / size };
      });
      if (r.none) return { pass: true };
      if (r.track > -0.005) return { pass: false, detail: `large text is not tightened (tracking ${r.track.toFixed(4)}em)` };
      if (r.lh > 1.3) return { pass: false, detail: `large text leading is loose (${r.lh.toFixed(2)})` };
      return { pass: true };
    },
  },
  {
    id: "reduced-motion", weight: 10,
    rule: "Accessibility — reduced motion means gentler, and it has to actually apply",
    async run(page) {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.reload({ waitUntil: "load" });
      const still = await page.evaluate(() => {
        for (const el of document.querySelectorAll("body *")) {
          const cs = getComputedStyle(el);
          const dur = parseFloat(cs.transitionDuration) || 0;
          const anim = parseFloat(cs.animationDuration) || 0;
          if (dur > 0.05 || anim > 0.05) return el.tagName.toLowerCase() + "." + String(el.className).split(" ")[0];
        }
        return null;
      });
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.reload({ waitUntil: "load" });
      return still ? { pass: false, detail: `${still} still animates under reduced motion` } : { pass: true };
    },
  },
  {
    id: "reduced-transparency", weight: 6,
    rule: "Accessibility — translucency is a preference, so it has to be droppable",
    async run(page) {
      const ok = await page.evaluate(() => {
        const sheet = [...document.styleSheets].flatMap((s) => { try { return [...s.cssRules]; } catch { return []; } });
        return sheet.some((r) => r.conditionText?.includes("prefers-reduced-transparency"))
          || sheet.some((r) => r.media?.mediaText?.includes("prefers-reduced-transparency"));
      });
      return ok ? { pass: true } : { pass: false, detail: "no reduced-transparency rule" };
    },
  },
  {
    id: "one-h1-and-a-real-title", weight: 8,
    rule: "Wayfinding — every screen answers where am I, starting with its own name",
    async run(page, _ctx, screen) {
      const r = await page.evaluate(() => ({
        h1s: document.querySelectorAll("h1").length,
        h1: document.querySelector("h1")?.textContent?.trim() ?? "",
        title: document.title,
      }));
      if (r.h1s !== 1) return { pass: false, detail: `${r.h1s} h1 elements, expected exactly 1` };
      if (!r.title || /^(untitled|document|page)/i.test(r.title)) return { pass: false, detail: `generic title "${r.title}"` };
      if (!r.h1) return { pass: false, detail: "empty h1" };
      return { pass: true };
    },
  },
  {
    id: "current-section-marked", weight: 6,
    rule: "Wayfinding — the current section is stated, not inferred",
    async run(page, _ctx, screen) {
      if (screen.anonymous) return { pass: true, skip: true };
      const marked = await page.evaluate(() => document.querySelectorAll("nav [aria-current=page]").length);
      return marked === 1 ? { pass: true } : { pass: false, detail: `${marked} nav items marked current, expected 1` };
    },
  },
  {
    id: "translucent-chrome", weight: 4,
    rule: "Materials — chrome is a layer content passes under, not a strip that eats the top",
    async run(page) {
      const ok = await page.evaluate(() => {
        const h = document.querySelector("header.top");
        if (!h) return true;
        const cs = getComputedStyle(h);
        return /blur/.test(cs.backdropFilter) || /blur/.test(cs.webkitBackdropFilter ?? "");
      });
      return ok ? { pass: true } : { pass: false, detail: "the header is opaque" };
    },
  },
  {
    id: "scales-with-text-size", weight: 6,
    rule: "Flexibility — raising the text size must move the layout, not break it",
    async run(page) {
      const before = await page.evaluate(() => document.body.scrollHeight);
      await page.addStyleTag({ content: "html{font-size:137.5%}" });
      const r = await page.evaluate(() => ({
        h: document.body.scrollHeight,
        sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      }));
      await page.reload({ waitUntil: "load" });
      if (r.sideways) return { pass: false, detail: "larger text makes the page scroll sideways" };
      if (r.h <= before) return { pass: false, detail: "layout ignored the text size (fixed px somewhere)" };
      return { pass: true };
    },
  },
];

// ------------------------------------------------------------------- run

const bar = (score) => {
  const n = Math.round(score / 5);
  return "█".repeat(n) + "·".repeat(20 - n);
};

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  // Sign in once; the cookie carries across every screen.
  await page.goto(`${BASE}/login`, { waitUntil: "load" });
  await page.fill("input[name=email]", EMAIL);
  await page.fill("input[name=password]", PASSWORD);
  await Promise.all([page.waitForNavigation({ waitUntil: "load" }), page.click("button[type=submit]")]);
  if (page.url().endsWith("/login")) {
    console.error(`Could not sign in as ${EMAIL}. Set JUDGE_EMAIL / JUDGE_PASSWORD.`);
    process.exit(2);
  }

  // The run trace needs a real run, so find the newest one.
  await page.goto(`${BASE}/runs`, { waitUntil: "load" });
  const latestRun = await page.evaluate(() =>
    document.querySelector('a[href^="/runs/run_"]')?.getAttribute("href") ?? null);

  const results = [];
  for (const screen of SCREENS) {
    const path = screen.path === ":latestRun" ? latestRun : screen.path;
    if (!path) { results.push({ screen, skipped: "no run to look at" }); continue; }

    const target = screen.anonymous ? await (await browser.newContext()).newPage() : page;
    await target.goto(BASE + path, { waitUntil: "load" });

    const findings = [];
    let earned = 0, possible = 0;
    for (const check of CHECKS) {
      let r;
      try { r = await check.run(target, screen.anonymous ? target.context() : ctx, screen); }
      catch (e) { r = { pass: false, detail: `check threw: ${e.message.slice(0, 80)}` }; }
      if (r.skip) continue;
      possible += check.weight;
      if (r.pass) earned += check.weight;
      findings.push({ ...check, ...r });
    }
    if (screen.anonymous) await target.context().close();
    results.push({ screen, path, score: Math.round((earned / possible) * 100), findings });
  }

  await browser.close();

  // ------------------------------------------------------------- report
  console.log("\n  Apple design review — every screen\n");
  let worst = 100;
  for (const r of results) {
    if (r.skipped) { console.log(`  ${"—".padEnd(4)} ${r.screen.name.padEnd(22)} skipped: ${r.skipped}`); continue; }
    worst = Math.min(worst, r.score);
    const mark = r.score === 100 ? "✔" : r.score >= 90 ? "•" : "✖";
    console.log(`  ${mark} ${String(r.score).padStart(3)}  ${bar(r.score)}  ${r.screen.name}`);
    for (const f of r.findings) {
      if (f.pass && !VERBOSE) continue;
      console.log(`         ${f.pass ? "ok  " : "FAIL"} ${f.id}${f.pass ? "" : ` — ${f.detail}`}`);
      if (!f.pass) console.log(`              ${f.rule}`);
    }
  }
  const avg = Math.round(results.filter((r) => !r.skipped).reduce((a, r) => a + r.score, 0)
    / results.filter((r) => !r.skipped).length);
  console.log(`\n  average ${avg} · worst ${worst}\n`);
  if (MIN && worst < MIN) {
    console.error(`  Below the bar: worst screen is ${worst}, minimum is ${MIN}.\n`);
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(2); });
