import { fmt, fmtMilli } from "../billing/points.js";
import type { PackRow, PackVersionRow, RunRow } from "./platform.js";

export const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

const CSS = `
/* ---------------------------------------------------------------- tokens
   Springs, not durations. Both critically-damped curves are the same shape
   sampled over different settle times, which is what a spring actually is:
   damping decides the shape, response decides how long it takes to get there.
   Generated from Apple's two parameters — damping ratio and response — not
   hand-tuned, so every number here is one we can defend.                   */
:root{
--bg:#fbfaf8;--panel:#fff;--ink:#17161a;--muted:#6b6975;--line:#e6e3dd;
--accent:#2f5d50;--accent-ink:#fff;--warn:#8a5a1a;--bad:#8c2f2f;--good:#2f6b4f;
--mono:ui-monospace,SFMono-Regular,Menlo,monospace;
--chrome:rgba(255,255,255,.72);--chrome-edge:rgba(255,255,255,.5);
--lift:0 1px 2px rgba(20,18,24,.05),0 8px 24px -12px rgba(20,18,24,.18);
--lift-hi:0 2px 4px rgba(20,18,24,.06),0 18px 40px -16px rgba(20,18,24,.28);
--spring:linear(0,.0438,.1419,.2604,.3801,.4909,.5883,.6712,.74,.7961,.8412,.8771,.9053,.9274,.9445,.9578,.968,.9758,.9817,.9862,.9896,.9922,.9942,.9956,.9967,.9976,.9982,.9987,.999);
--spring-bounce:linear(0,.039,.1324,.2525,.3805,.504,.6158,.7125,.7927,.8571,.9071,.9446,.9717,.9904,1.0026,1.01,1.0138,1.0151,1.0148,1.0136,1.0119,1.0099,1.008,1.0063,1.0048,1.0035,1.0024,1.0016,1.001);
--dur:588ms;      /* damping 1.0, response 0.4s — move, reposition */
--dur-snappy:441ms;/* damping 1.0, response 0.3s — chrome, small things */
--dur-bounce:540ms;/* damping 0.8, response 0.4s — after momentum only */
--press:100ms;     /* response is instant; this is just the travel */
}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){
--bg:#121214;--panel:#1a1a1e;--ink:#edecea;--muted:#9a98a2;--line:#2b2b32;
--accent:#7fb8a4;--accent-ink:#10231d;--warn:#d9a95c;--bad:#e0847c;--good:#86c9a4;
--chrome:rgba(22,22,26,.72);--chrome-edge:rgba(255,255,255,.08);
--lift:0 1px 2px rgba(0,0,0,.4),0 8px 24px -12px rgba(0,0,0,.6);
--lift-hi:0 2px 4px rgba(0,0,0,.45),0 18px 40px -16px rgba(0,0,0,.7)}}
:root[data-theme=dark]{
--bg:#121214;--panel:#1a1a1e;--ink:#edecea;--muted:#9a98a2;--line:#2b2b32;
--accent:#7fb8a4;--accent-ink:#10231d;--warn:#d9a95c;--bad:#e0847c;--good:#86c9a4;
--chrome:rgba(22,22,26,.72);--chrome-edge:rgba(255,255,255,.08);
--lift:0 1px 2px rgba(0,0,0,.4),0 8px 24px -12px rgba(0,0,0,.6);
--lift-hi:0 2px 4px rgba(0,0,0,.45),0 18px 40px -16px rgba(0,0,0,.7)}
*{box-sizing:border-box}

/* ------------------------------------------------------------ typography
   The system font already ships optical sizing and tracking tables, so it is
   the default rather than a fallback. Tracking is size-specific: large text
   tightens as it grows, small uppercase labels open up. Everything is in rem
   so a reader who raises their text size moves the layout with it.          */
html{font-size:100%}
body{margin:0;background:var(--bg);color:var(--ink);
font:1rem/1.55 system-ui,-apple-system,"Segoe UI",ui-sans-serif,sans-serif;
-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline;text-underline-offset:.15em}
h1{font-size:clamp(1.75rem,1.35rem+1.7vw,2.25rem);line-height:1.08;letter-spacing:-.021em;
font-weight:640;margin:2rem 0 .375rem}
h2{font-size:1.1875rem;line-height:1.3;letter-spacing:-.012em;font-weight:620;margin:2rem 0 .625rem}
h3{font-size:1.0625rem;line-height:1.3;letter-spacing:-.01em;font-weight:600;margin:0 0 .25rem}
p.lede{color:var(--muted);margin:0 0 1.25rem;max-width:62ch;line-height:1.55}
code,.price{font-family:var(--mono);font-size:.9375em}

/* ---------------------------------------------------------------- layout */
.wrap{max-width:62.5rem;margin:0 auto;padding:0 1rem 4rem}

/* ----------------------------------------------------------- the material
   Chrome is a translucent layer the page scrolls underneath, not an opaque
   strip that eats the top of the window. The bottom edge is a short gradient
   rather than a hairline, so content meets the chrome by fading into blur —
   the edge belongs to the material, not to a border.                        */
header.top{position:sticky;top:0;z-index:5;background:var(--chrome);
-webkit-backdrop-filter:blur(20px) saturate(180%);backdrop-filter:blur(20px) saturate(180%);
border-bottom:1px solid var(--chrome-edge)}
header.top::after{content:"";position:absolute;left:0;right:0;top:100%;height:1.5rem;
background:linear-gradient(var(--bg),transparent);pointer-events:none}
header.top .wrap{display:flex;gap:1.25rem;align-items:center;padding:.875rem 1rem;flex-wrap:wrap}
.brand{font-weight:650;letter-spacing:-.02em}
.brand small{color:var(--muted);font-weight:400;margin-left:.5rem;letter-spacing:0}
nav{display:flex;gap:.25rem;margin-left:auto;flex-wrap:wrap;align-items:center}
nav a{color:var(--muted);font-size:.875rem;padding:.3rem .5rem;border-radius:.5rem;
transition:color var(--dur-snappy) var(--spring),background var(--dur-snappy) var(--spring)}
nav a:hover{color:var(--ink);background:color-mix(in oklab,var(--ink) 7%,transparent);text-decoration:none}
nav a:active{background:color-mix(in oklab,var(--ink) 12%,transparent)}
/* Where am I: the current section is stated, not left to be inferred. */
nav a[aria-current=page]{color:var(--ink);background:color-mix(in oklab,var(--ink) 9%,transparent);font-weight:560}

/* ---------------------------------------------------------------- search
   The first thing on the shelf, because finding the right worker is the whole
   job and a curated catalog still has to be searchable to be a catalog.      */
.search{display:flex;gap:.5rem;margin:0 0 1.25rem;max-width:34rem}
.search input{flex:1;background:var(--panel);color:var(--ink);border:1px solid var(--line);
border-radius:.625rem;padding:.625rem .75rem;font:inherit;
transition:border-color var(--dur-snappy) var(--spring),box-shadow var(--dur-snappy) var(--spring)}
.search input:focus{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in oklab,var(--accent) 18%,transparent)}
.search input::-webkit-search-cancel-button{filter:grayscale(1) opacity(.6)}

/* ------------------------------------------------------------- surfaces */
.grid{display:grid;gap:.875rem;grid-template-columns:repeat(auto-fill,minmax(18.125rem,1fr))}
/* Column, so the action sits on the baseline across cards of different
   heights. Ragged buttons are the kind of thing that reads as carelessness. */
.card{background:var(--panel);border:1px solid var(--line);border-radius:.875rem;padding:1.125rem;
box-shadow:var(--lift);display:flex;flex-direction:column;
transition:transform var(--dur) var(--spring),box-shadow var(--dur) var(--spring)}
.card>.row:last-child{margin-top:auto;padding-top:.25rem}
.card:hover{transform:translateY(-2px);box-shadow:var(--lift-hi)}
.card .by{color:var(--muted);font-size:.8125rem;margin:0 0 .625rem;letter-spacing:.005em}
.card p{margin:0 0 .875rem;color:var(--ink);font-size:.9375rem;line-height:1.5}
.row{display:flex;gap:.625rem;align-items:center;flex-wrap:wrap}
.spread{display:flex;justify-content:space-between;align-items:baseline;gap:.75rem}
.price{font-size:.9375rem}

/* --------------------------------------------------------------- controls
   Feedback belongs on the press, not the release: :active fires on
   pointer-down, and 100ms is travel time, not a wait. The spring is only for
   the way back, where there is no finger to keep up with.                   */
.btn{display:inline-block;background:var(--accent);color:var(--accent-ink);border:0;
border-radius:.625rem;padding:.5625rem .875rem;font:inherit;font-size:.875rem;font-weight:560;
letter-spacing:-.003em;cursor:pointer;
transition:transform var(--dur-snappy) var(--spring),filter var(--dur-snappy) var(--spring)}
.btn.ghost{background:transparent;color:var(--ink);border:1px solid var(--line)}
.btn:hover{filter:brightness(1.07);text-decoration:none}
.btn:active{transform:scale(.97);transition:transform var(--press) ease-out}
.btn.ghost:active{background:color-mix(in oklab,var(--ink) 8%,transparent)}
:where(a,button,input,select,textarea,summary):focus-visible{
outline:2px solid var(--accent);outline-offset:2px;border-radius:.375rem}
.tag{display:inline-block;font-size:.71875rem;font-family:var(--mono);color:var(--muted);
border:1px solid var(--line);border-radius:999px;padding:.125rem .5rem;letter-spacing:.01em}
textarea{width:100%;background:var(--panel);color:var(--ink);border:1px solid var(--line);
border-radius:.625rem;padding:.6875rem;font:inherit;min-height:5.25rem;resize:vertical;
transition:border-color var(--dur-snappy) var(--spring)}
textarea:focus{border-color:var(--accent)}
select,input[type=text]{background:var(--panel);color:var(--ink);border:1px solid var(--line);
border-radius:.5rem;padding:.5rem;font:inherit;
transition:border-color var(--dur-snappy) var(--spring)}
select:focus,input[type=text]:focus{border-color:var(--accent)}
form.inline{display:inline}

/* ----------------------------------------------------------------- data */
table{width:100%;border-collapse:collapse;font-size:.875rem}
th,td{text-align:left;padding:.5rem .625rem;border-bottom:1px solid var(--line)}
/* Small text takes positive tracking; this is the one place it opens up. */
th{color:var(--muted);font-weight:560;font-size:.78125rem;text-transform:uppercase;letter-spacing:.055em}
td.num,th.num{text-align:right;font-family:var(--mono);font-variant-numeric:tabular-nums}
tbody tr,table tr{transition:background var(--dur-snappy) var(--spring)}
.meters{display:grid;gap:.625rem;grid-template-columns:repeat(auto-fit,minmax(8.125rem,1fr));margin:0 0 1rem}
.meter{background:var(--panel);border:1px solid var(--line);border-radius:.75rem;padding:.6875rem .8125rem;
box-shadow:var(--lift)}
.meter .k{font-size:.71875rem;color:var(--muted);text-transform:uppercase;letter-spacing:.055em}
.meter .v{font-family:var(--mono);font-size:1.1875rem;font-variant-numeric:tabular-nums;margin-top:.1875rem;
letter-spacing:-.01em}
/* scaleX, not width: the compositor can run it, and it springs to each new
   reading instead of jumping as the numbers arrive. */
.bar{height:.375rem;background:var(--line);border-radius:99px;overflow:hidden;margin-top:.5625rem}
.bar>i{display:block;height:100%;background:var(--accent);width:100%;transform-origin:left center;
transform:scaleX(0);transition:transform var(--dur) var(--spring)}

/* ---------------------------------------------------------------- usage
   One bar, three segments, no legend to decode: each segment names itself in
   the list below with its own colour swatch.                                 */
.ctx{background:var(--panel);border:1px solid var(--line);border-radius:.875rem;
padding:1rem 1.125rem;box-shadow:var(--lift);margin:0 0 1rem}
.ctx .top{display:flex;justify-content:space-between;align-items:baseline;gap:.75rem;flex-wrap:wrap}
.ctx .top b{font-weight:620;letter-spacing:-.01em}
.ctx .pct{font-family:var(--mono);font-variant-numeric:tabular-nums;color:var(--muted);font-size:.875rem}
.ctxbar{display:flex;height:.5rem;border-radius:99px;overflow:hidden;background:var(--line);margin:.625rem 0 .5rem}
.ctxbar span{display:block;height:100%;transform-origin:left center;
transition:flex-basis var(--dur) var(--spring)}
.s-sys{background:var(--accent)}
.s-talk{background:color-mix(in oklab,var(--accent) 45%,var(--muted))}
.ctxlist{list-style:none;margin:.75rem 0 0;padding:0;display:grid;gap:.3125rem}
.ctxlist li{display:flex;align-items:center;gap:.5rem;font-size:.875rem}
.ctxlist .sw{width:.5rem;height:.5rem;border-radius:2px;flex:none}
.ctxlist .nm{flex:1;min-width:0}
.ctxlist .amt{font-family:var(--mono);font-variant-numeric:tabular-nums}
.ctxlist .pc{font-family:var(--mono);font-variant-numeric:tabular-nums;color:var(--muted);
min-width:3.5rem;text-align:right}
.chips{display:flex;flex-wrap:wrap;gap:.375rem;margin:.5rem 0 0}
.chips .tag b{font-weight:600;color:var(--ink)}
.ctx h4{margin:1rem 0 .25rem;font-size:.71875rem;text-transform:uppercase;letter-spacing:.055em;
color:var(--muted);font-weight:560}
.ctx .fine{font-size:.8125rem;color:var(--muted);margin:.625rem 0 0;line-height:1.45}

/* ---------------------------------------------------------------- trace */
#trace{background:var(--panel);border:1px solid var(--line);border-radius:.875rem;padding:.25rem 0;
max-height:60vh;overflow:auto;box-shadow:var(--lift);overscroll-behavior:contain}
.ev{padding:.5625rem .875rem;border-bottom:1px solid var(--line);font-size:.875rem;
animation:arrive var(--dur-snappy) var(--spring) both}
/* What was said is what the buyer paid for; everything else is instrumentation
   and should read like it. Same transcript, two weights. */
.ev.say{padding:.875rem 1rem;font-size:1rem;line-height:1.55}
.ev.say .k{font-size:.8125rem;font-family:inherit;text-transform:none;letter-spacing:0;
font-weight:600;color:var(--ink)}
.ev.say.from-agent .k{color:var(--accent)}
.ev.say pre{margin-top:.375rem}
.ev.sys{padding:.375rem .875rem;font-size:.8125rem;color:var(--muted)}
.ev.sys .k{font-size:.65625rem;opacity:.75}
.ev.sys pre{color:var(--muted)}
/* Hidden, not deleted: the full record is one checkbox away and the costs
   stay visible either way, because that is the promise the product makes. */
#trace.conversation .ev.sys{display:none}
.tracebar{display:flex;gap:.75rem;align-items:center;justify-content:space-between;
margin:0 0 .5rem;flex-wrap:wrap}
.tracebar label{font-size:.8125rem;color:var(--muted);display:flex;gap:.375rem;align-items:center;cursor:pointer}
.ev:last-child{border-bottom:0}
.ev .k{font-family:var(--mono);font-size:.6875rem;color:var(--muted);text-transform:uppercase;letter-spacing:.055em}
.ev pre{margin:.25rem 0 0;white-space:pre-wrap;word-break:break-word;font:inherit;line-height:1.5}
.ev.user{background:color-mix(in oklab,var(--accent) 7%,transparent)}
.ev.meter .k{color:var(--good)}
.ev.err .k{color:var(--bad)}
.ev.warnrow .k{color:var(--warn)}
/* An event arrives from the direction the transcript grows, so the motion
   points where the next one is coming from. */
@keyframes arrive{from{opacity:0;transform:translateY(.5rem)}to{opacity:1;transform:none}}

/* ---------------------------------------------------------------- notes */
.note{border-left:3px solid var(--warn);background:color-mix(in oklab,var(--warn) 9%,transparent);
padding:.625rem .875rem;border-radius:0 .5rem .5rem 0;font-size:.875rem;margin:0 0 1.125rem;line-height:1.5}
.note.bad{border-color:var(--bad);background:color-mix(in oklab,var(--bad) 9%,transparent)}
footer{color:var(--muted);font-size:.8125rem;margin-top:2.5rem;border-top:1px solid var(--line);
padding-top:1rem;line-height:1.5}

/* -------------------------------------------------------- accommodations
   Three independent signals, each answered on its own terms. Reduced motion
   keeps the feedback and drops the travel; it does not mean no feedback.    */
@media (prefers-reduced-motion:reduce){
*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;
transition-duration:.01ms!important;scroll-behavior:auto!important}
.ev{animation:fade 160ms ease both}
@keyframes fade{from{opacity:0}to{opacity:1}}
.card:hover{transform:none}
.btn:active{transform:none;filter:brightness(.92)}}
@media (prefers-reduced-transparency:reduce){
header.top{background:var(--panel);-webkit-backdrop-filter:none;backdrop-filter:none}}
@media (prefers-contrast:more){
:root{--muted:#403e48;--line:#8d8a94}
header.top{background:var(--panel);-webkit-backdrop-filter:none;backdrop-filter:none}
.card,.meter,#trace{border-width:2px;box-shadow:none}
.tag,.btn.ghost{border-width:2px}}
`;

export type Viewer = { name: string; email: string; role: string; orgName: string } | null;

export function layout(
  title: string, body: string,
  opts: { balance?: number; viewer?: Viewer } = {},
): string {
  const v = opts.viewer;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" href="/favicon.ico" type="image/svg+xml">
<title>${esc(title)} · agents.alphaceo.ai</title><style>${CSS}</style></head><body>
<header class="top"><div class="wrap">
<span class="brand">agents.alphaceo.ai<small>hire a worker</small></span>
<nav>
  ${v ? `<a href="/">Catalog</a><a href="/runs">Runs</a><a href="/ledger">Points</a>
  <a href="/authors">Authoring</a><a href="/schedules">Schedules</a><a href="/purchases">Purchases</a><a href="/tokens">MCP</a><a href="/team">Team</a>${v.role === "owner" ? `<a href="/payouts">Payouts</a><a href="/settings">Limits</a>` : ""}
  ${opts.balance !== undefined ? `<span class="tag">${esc(fmt(opts.balance))}</span>` : ""}
  <span class="tag" title="${esc(v.email)}">${esc(v.orgName)} · ${esc(v.name)}${v.role === "owner" ? " (owner)" : ""}</span>
  <form method="post" action="/logout" class="inline"><button class="btn ghost" style="padding:4px 10px;font-size:13px">Sign out</button></form>`
  : `<a href="/login">Sign in</a><a href="/signup">Create an account</a>`}
</nav></div></header>
<script>
// Where am I — marked here rather than threaded through every page's call,
// and it degrades to the plain nav if this never runs.
(function(){var p=location.pathname;var best=null;
for(var a of document.querySelectorAll('nav a')){var h=a.getAttribute('href');
if(h===p||(h!=='/'&&p.indexOf(h)===0)){if(!best||h.length>best.getAttribute('href').length)best=a;}}
if(best)best.setAttribute('aria-current','page');})();
</script>
<div class="wrap">${body}
<footer>Packs run on Anthropic Managed Agents. Spend is the platform's own <code>list_cost</code>, priced at public list rates. Seed pack instructions are placeholders, not an expert's work.</footer>
</div></body></html>`;
}

export function catalogPage(packs: Array<PackRow & { published: boolean; owned: boolean }>, balance: number, viewer: Viewer = null, query = ""): string {
  const cards = packs.map((p) => `<div class="card">
  <div class="spread"><h3>${esc(p.name)}</h3><span class="price">${p.price_cents === 0 ? "free" : esc(fmt(p.price_cents))}</span></div>
  <p class="by">by ${esc(p.author)}</p>
  <p class="row" style="gap:6px;margin:0 0 10px"><span class="tag">${esc(p.model)}</span><span class="tag">effort ${esc(p.effort)}</span></p>
  <p>${esc(p.tagline)}</p>
  <div class="row">
    <a class="btn" href="/packs/${esc(p.slug)}">${p.owned ? "Open" : "View"}</a>
    ${p.published ? "" : `<span class="tag">not yet published</span>`}
  </div></div>`).join("");
  const found = packs.length;
  return layout("Catalog", `<h1>Hire a worker</h1>
<p class="lede">Each pack is an expert's method, packaged. You buy it once, it runs here on your side of the fence, and you see exactly what every run cost.</p>
<form method="get" action="/" class="search" role="search">
  <input type="search" name="q" value="${esc(query)}" autofocus
         placeholder="Search by what you need done, or who wrote it" aria-label="Search packs">
  <button class="btn" type="submit">Search</button>
  ${query ? `<a class="btn ghost" href="/">Clear</a>` : ""}
</form>
${query
  ? `<p class="lede" style="font-size:.875rem">${found === 0
      ? `Nothing matches <strong>${esc(query)}</strong>. The shelf is curated, so it is short on purpose — try a broader word.`
      : `${found} ${found === 1 ? "pack" : "packs"} matching <strong>${esc(query)}</strong>.`}</p>`
  : ""}
${found === 0 && !query ? `<p class="lede">The shelf is empty.</p>` : `<div class="grid">${cards}</div>`}`,
    { balance, viewer });
}

export function packPage(
  p: PackRow, v: PackVersionRow | undefined, owned: boolean, models: string[], balance: number,
  err?: string, viewer: Viewer = null,
  trial: { turns: number; budgetCents: number; used: boolean } | null = null,
  isAuthor = false,
): string {
  const pinned: string[] = JSON.parse(p.pinned_models);
  const choices = (pinned.length ? pinned : models);
  return layout(p.name, `
${err ? `<div class="note bad">${esc(err)}</div>` : ""}
<h1>${esc(p.name)}</h1>
<p class="lede">${esc(p.tagline)}</p>
<div class="row" style="margin-bottom:18px">
  <span class="tag">by ${esc(p.author)}</span>
  <span class="tag">${p.price_cents === 0 ? "free" : esc(fmt(p.price_cents))} one-off</span>
  <span class="tag">updates ${p.upgrade_points} pts</span>
  <span class="tag">default ${esc(p.model)}</span>
  ${v ? `<span class="tag">v${v.version}</span>` : `<span class="tag">unpublished</span>`}
</div>
<div class="note">You can run this pack and read everything it does, but never its instructions — those are the author's. Transcripts are redacted against the pack's own text${isAuthor ? ", except for you: you wrote it, so you see your runs raw" : ""}.</div>
${v ? `
<h2>${owned ? "Start a run" : "Acquire and run"}</h2>
<form method="post" action="${owned ? "/runs" : `/packs/${esc(p.slug)}/acquire`}">
  <input type="hidden" name="packVersionId" value="${esc(v.id)}">
  <div class="row">
    <label>Model <select name="model">${choices.map((m) => `<option value="${esc(m)}"${m === p.model ? " selected" : ""}>${esc(m)}</option>`).join("")}</select></label>
    <button class="btn" type="submit">${owned ? "Start a run" : p.price_cents === 0 ? "Get it free and run" : `Buy for ${fmt(p.price_cents)} and run`}</button>
  </div>
  ${pinned.length ? `<p class="lede" style="margin-top:10px;font-size:14px">The author restricted this pack to ${esc(pinned.join(", "))} — every extraction refusal measured came from Opus, and a weaker model may just comply.</p>` : ""}
</form>
${!owned && trial ? (trial.used
  ? `<p class="lede" style="margin-top:14px;font-size:14px">You have already used your trial of this pack.</p>`
  : `<h2>Or try it first</h2>
<p class="lede" style="font-size:14px">${trial.turns} turns, capped at ${esc(fmt(trial.budgetCents))} of compute, on your own brief. Your points pay for the compute; you keep the output. The pack's instructions stay the author's.</p>
<form method="post" action="/packs/${esc(p.slug)}/trial">
  <button class="btn ghost" type="submit">Try it — ${trial.turns} turns</button>
</form>`) : ""}` : `<form method="post" action="/packs/${esc(p.slug)}/publish"><button class="btn" type="submit">Publish to the runtime</button></form>`}
${owned ? `<h2>Take it with you</h2>
<p class="lede" style="font-size:14px">You bought it, so you can run it yourself. The download is an agent definition
<code>ant apply</code> accepts directly — the author's instructions are inside it, which is the honest cost of the
developer path.</p>
<p><a class="btn ghost" href="/packs/${esc(p.slug)}/export">Download ${esc(p.slug)}.md</a></p>` : ""}
<h2>What runs cost</h2>
<table><tr><th>Item</th><th class="num">Measured</th></tr>
<tr><td>A short turn (refusal, 288 output tokens, 6.5k cached prompt)</td><td class="num">$0.05</td></tr>
<tr><td>Default budget per run, before it pauses</td><td class="num">$0.50</td></tr>
<tr><td>Session running time</td><td class="num">$0.08/hr active</td></tr>
</table>`, { balance, viewer });
}

export function runsPage(runs: Array<RunRow & { pack: string }>, balance: number, viewer: Viewer = null): string {
  return layout("Runs", `<h1>Runs</h1>
<p class="lede">Every run, what it consumed, and what it cost you. The cost column is the platform's own figure.</p>
<table><tr><th>Started</th><th>Pack</th><th>Model</th><th>Status</th><th class="num">In</th><th class="num">Out</th><th class="num">Active</th><th class="num">Cost</th><th></th></tr>
${runs.map((r) => `<tr>
<td>${esc(r.started_at.slice(5, 16).replace("T", " "))}</td>
<td>${esc(r.pack)}</td><td><span class="tag">${esc(r.model)}</span></td>
<td>${esc(r.stop_reason ?? r.status)}</td>
<td class="num">${r.input_tokens}</td><td class="num">${r.output_tokens}</td>
<td class="num">${r.active_seconds.toFixed(1)}s</td><td class="num">${esc(fmt(r.list_cost_cents))}</td>
<td><a href="/runs/${esc(r.id)}">trace</a></td></tr>`).join("") || `<tr><td colspan="9">No runs yet.</td></tr>`}
</table>`, { balance, viewer });
}

export type RunUsageView = {
  window: number; used: number; systemTokens: number; conversation: number;
  cacheRead: number; cacheCreation: number; outputTokens: number;
  skills: Array<{ name: string }>; tools: Array<{ name: string; calls: number }>;
  requests: number;
};

const tok = (n: number): string =>
  n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);

/**
 * Where the context went, and what the worker reached for.
 *
 * Every number here is measured. The pack's prompt was counted against the
 * tokenizer when it was published; the rest comes from what the provider
 * reported per request. Nothing is split further than the measurements allow,
 * which is why "conversation and tools" is one line rather than two.
 */
export function usagePanel(u: RunUsageView): string {
  if (u.used === 0) {
    return `<div class="ctx"><div class="top"><b>Context</b><span class="pct">nothing sent yet</span></div>
    <p class="fine">Send a brief and this fills in: how much of the window the pack's own instructions
    take, what the conversation adds, and every tool the worker reaches for.</p></div>`;
  }
  const pct = (n: number): string => `${((n / u.window) * 100).toFixed(1)}%`;
  const free = Math.max(0, u.window - u.used);
  const row = (cls: string, name: string, n: number, note = ""): string =>
    `<li><i class="sw ${cls}"></i><span class="nm">${esc(name)}${note ? ` <span class="pc" style="min-width:0">${esc(note)}</span>` : ""}</span>
     <span class="amt">${tok(n)}</span><span class="pc">${pct(n)}</span></li>`;
  return `<div class="ctx">
  <div class="top"><b>Context window</b>
    <span class="pct">${((u.used / u.window) * 100).toFixed(1)}% used · ${tok(u.used)} of ${tok(u.window)}</span></div>
  <div class="ctxbar">
    <span class="s-sys" style="flex:0 0 ${((u.systemTokens / u.window) * 100).toFixed(2)}%"></span>
    <span class="s-talk" style="flex:0 0 ${((u.conversation / u.window) * 100).toFixed(2)}%"></span>
  </div>
  <ul class="ctxlist">
    ${row("s-sys", "The pack's instructions", u.systemTokens, "measured at publish")}
    ${row("s-talk", "Conversation and tool definitions", u.conversation)}
    <li><i class="sw" style="background:var(--line)"></i><span class="nm">Free</span>
      <span class="amt">${tok(free)}</span><span class="pc">${pct(free)}</span></li>
  </ul>
  <h4>Cache</h4>
  <ul class="ctxlist">
    <li><i class="sw" style="background:var(--good)"></i><span class="nm">Read from cache</span>
      <span class="amt">${tok(u.cacheRead)}</span><span class="pc">${u.cacheRead > 0 ? "cheap" : "—"}</span></li>
    <li><i class="sw" style="background:var(--warn)"></i><span class="nm">Written to cache</span>
      <span class="amt">${tok(u.cacheCreation)}</span><span class="pc">${u.cacheCreation > 0 ? "paid once" : "—"}</span></li>
  </ul>
  ${u.skills.length ? `<h4>Skills loaded</h4><div class="chips">
    ${u.skills.map((k) => `<span class="tag">${esc(k.name)}</span>`).join("")}</div>` : ""}
  <h4>Tools used</h4>
  ${u.tools.length
    ? `<div class="chips">${u.tools.map((t) =>
        `<span class="tag">${esc(t.name)} <b>×${t.calls}</b></span>`).join("")}</div>`
    : `<p class="fine">None yet — it answered from what it already knew.</p>`}
  <p class="fine">Context is the last request's, not a running total: it is what the model was holding
  when it last answered. ${u.requests} model ${u.requests === 1 ? "request" : "requests"} so far.</p>
</div>`;
}

export type Ask = { event_id: string; name: string; input: string };

export function runPage(
  run: RunRow, packName: string, balance: number, exhausted: boolean, asks: Ask[] = [], viewer: Viewer = null,
  trial: { turns: number; slug: string; priceCents: number } | null = null,
  outputs: Array<{ file_id: string; filename: string; size_bytes: number }> = [],
  usage: RunUsageView | null = null,
): string {
  return layout(`Run · ${packName}`, `
<h1>${esc(packName)}</h1>
<p class="lede">Live trace, down to the token. <span class="tag">${esc(run.model)}</span> <span class="tag">session ${esc(run.session_id.slice(0, 18))}</span>${run.is_trial ? ` <span class="tag" style="color:var(--warn)">trial</span>` : ""}</p>
${run.is_trial && trial ? `<div class="note">
  <strong>This is a trial</strong> — ${Math.max(0, trial.turns - run.turn_count)} of ${trial.turns} turns left, capped at ${esc(fmt(run.budget_cents))}.
  ${run.turn_count >= trial.turns ? `The trial is used up.` : ""}
  <form method="post" action="/packs/${esc(trial.slug)}/acquire" class="inline">
    <button class="btn" style="margin-left:10px">Buy it for ${esc(fmt(trial.priceCents))} and keep going</button></form>
</div>` : ""}
<div id="asks">${asks.map((a) => `<div class="note" style="border-color:var(--accent);background:color-mix(in oklab,var(--accent) 9%,transparent)">
  <strong>The worker is asking permission</strong> to run <code>${esc(a.name)}</code>:
  <pre style="margin:8px 0;white-space:pre-wrap;font-size:13px">${esc(a.input)}</pre>
  <form method="post" action="/runs/${esc(run.id)}/decide" class="row">
    <input type="hidden" name="eventId" value="${esc(a.event_id)}">
    <button class="btn" name="result" value="allow">Allow</button>
    <button class="btn ghost" name="result" value="deny">Deny</button>
    <input type="text" name="denyMessage" placeholder="why not (optional, the agent sees it)" size="34">
  </form></div>`).join("")}</div>
${exhausted ? `<div class="note" id="capnote">This run hit its budget. The platform refuses further messages until the cap is raised — top up and it resumes in the same session.
<form method="post" action="/runs/${esc(run.id)}/topup" class="inline"><button class="btn" style="margin-left:10px">Top up and resume</button></form></div>` : ""}
<div class="meters">
  <div class="meter"><div class="k">Cost so far</div><div class="v" id="m-cost">${esc(fmt(run.list_cost_cents))}</div>
    <div class="bar"><i id="m-bar" style="transform:scaleX(${Math.min(1, run.list_cost_cents / Math.max(1, run.budget_cents)).toFixed(4)})"></i></div></div>
  <div class="meter"><div class="k">Budget</div><div class="v">${esc(fmt(run.budget_cents))}</div></div>
  <div class="meter"><div class="k">Input tokens</div><div class="v" id="m-in">${run.input_tokens}</div></div>
  <div class="meter"><div class="k">Output tokens</div><div class="v" id="m-out">${run.output_tokens}</div></div>
  <div class="meter"><div class="k">Active</div><div class="v" id="m-sec">${run.active_seconds.toFixed(1)}s</div></div>
  <div class="meter"><div class="k">Billed to you</div><div class="v" id="m-billed">${esc(fmt(run.billed_cents))}</div></div>
</div>
<form method="post" action="/runs/${esc(run.id)}/message">
  <textarea name="text" placeholder="Give the worker a brief…" required></textarea>
  <div class="row" style="margin-top:10px">
    <button class="btn" type="submit">Send</button>
    <form method="post" action="/runs/${esc(run.id)}/end" class="inline"><button class="btn ghost">End run</button></form>
    <span class="tag" id="live">connecting…</span>
  </div>
</form>
${outputs.length ? `<h2>What it produced</h2>
<p class="lede" style="font-size:14px">Files the agent wrote to <code>/mnt/session/outputs</code>. Yours to keep.</p>
<table><tr><th>File</th><th class="num">Size</th><th></th></tr>
${outputs.map((o) => `<tr><td><a href="/runs/${esc(run.id)}/outputs/${esc(o.file_id)}">${esc(o.filename)}</a></td>
<td class="num">${(o.size_bytes / 1024).toFixed(1)} KB</td>
<td><a href="/runs/${esc(run.id)}/outputs/${esc(o.file_id)}" download>download</a></td></tr>`).join("")}
</table>` : ""}
${usage ? `<h2>Where the context and the money went</h2>${usagePanel(usage)}` : ""}
<h2>Trace</h2>
<div class="tracebar">
  <label><input type="checkbox" id="onlytalk"> Just the conversation</label>
  <span class="tag" id="evcount">0 events</span>
</div>
<div id="trace"></div>
<script>
const trace = document.getElementById('trace');
const live = document.getElementById('live');
const PACK = ${JSON.stringify(packName).replace(/</g, "\\u003c")};
const SAY = {'user.message':'You','agent.text':PACK};
const KIND = {'user.message':'user','user.decision':'user','run.metered':'meter',
  'usage.snapshot':'meter','workflow.run':'meter','workflow.phase':'meter','run.error':'err','error':'err',
  'run.interrupted':'err','run.budget_reached':'warnrow','tool.use':'warnrow','hook.decision':'warnrow',
  'run.topped_up':'meter'};
function render(e){
  const d = document.createElement('div');
  const said = SAY[e.kind];
  d.className = 'ev ' + (said ? 'say' + (e.kind === 'agent.text' ? ' from-agent' : '') : 'sys')
    + ' ' + (KIND[e.kind] || '');
  let body = '';
  try {
    const p = JSON.parse(e.payload);
    if (e.kind === 'user.message') body = p.text;
    else if (e.kind === 'agent.text') body = p.text;
    else if (e.kind === 'run.outputs') body = 'produced ' + p.files.map((f) => f.name + ' (' + (f.bytes/1024).toFixed(1) + 'KB)').join(', ');
    else if (e.kind === 'run.metered') body = 'cost ' + (p.list_cost_cents/100).toFixed(2) + ' (+' + (p.delta_cents/100).toFixed(2) + ') · in ' + p.input_tokens + ' · out ' + p.output_tokens + ' · ' + p.active_seconds.toFixed(1) + 's · author earned $' + (p.author_millicents/100000).toFixed(4);
    else if (e.kind === 'tool.use') body = p.name + ' [' + p.permission + '] ' + JSON.stringify(p.input);
    else if (e.kind === 'tool.result') body = p.name + (p.isError ? ' FAILED ' : ' ok ') + (p.preview||'').slice(0,400);
    else if (e.kind === 'agent.thinking') body = 'thinking…';
    else if (e.kind === 'model.usage') body = 'request: in ' + p.inputTokens + ' · out ' + p.outputTokens + ' · cache read ' + p.cacheReadTokens + ' · cache write ' + p.cacheCreationTokens;
    else if (e.kind === 'status') body = p.status + (p.stopReason ? ' (' + p.stopReason + ')' : '');
    else if (e.kind === 'user.decision') body = p.result.toUpperCase() + ' ' + p.name + (p.deny_message ? ' — ' + p.deny_message : '');
    else if (e.kind === 'usage.snapshot') body = 'platform total: $' + (p.usage.listCost.amount/100).toFixed(2) + ' · in ' + p.usage.inputTokens + ' · out ' + p.usage.outputTokens + ' · ' + p.usage.activeSeconds.toFixed(1) + 's' + (p.budget ? ' · budget $' + (p.budget.amount/100).toFixed(2) : '');
    else if (e.kind === 'model.request_start') body = 'model request started';
    else if (e.kind === 'thread.status') body = (p.agentName ? p.agentName + ': ' : '') + p.status + (p.stopReason ? ' (' + p.stopReason + ')' : '');
    else if (e.kind === 'workflow.run') body = p.state + (p.name ? ' — ' + p.name : '') + (p.phases ? ' (' + p.phases + ' phases)' : '') + (p.result ? ' — ' + p.result : '') + '  ' + p.runId;
    else if (e.kind === 'workflow.phase') body = 'phase ' + p.state + '  ' + p.phaseId;
    else if (e.kind === 'thread.created') body = 'thread for ' + (p.agentName || 'an agent') + (p.runId ? ' in run ' + p.runId : '');
    else if (e.kind === 'echo') body = 'echo ' + p.of + (p.text ? ' — ' + p.text.slice(0,120) : '');
    else if (e.kind === 'run.started') body = 'run started on ' + p.model + ' · budget $' + (p.budget_cents/100).toFixed(2) + (p.trial ? ' · trial' : '') + ' · ' + p.session;
    else if (e.kind === 'run.ended') body = 'run ended';
    else if (e.kind === 'run.interrupted') body = p.message;
    else if (e.kind === 'run.error') body = p.message;
    else if (e.kind === 'run.budget_reached') body = 'budget reached — the platform refuses further messages until the cap is raised';
    else if (e.kind === 'run.topped_up') body = 'topped up · $' + (p.headroom_cents/100).toFixed(2) + ' of new headroom';
    else if (e.kind === 'hook.decision') body = p.result.toUpperCase() + ' ' + p.tool + (p.reason ? ' — ' + p.reason : '') + '  (a hook decided this, not a person)';
    else if (e.kind === 'raw') body = (p.payload && p.payload.type) ? p.payload.type : JSON.stringify(p).slice(0,200);
    else body = JSON.stringify(p);
  } catch { body = e.payload; }
  d.innerHTML = '<div class="k"></div><pre></pre>';
  d.querySelector('.k').textContent = (said || e.kind) + ' · ' + e.created_at.slice(11,19);
  d.querySelector('pre').textContent = body || '';
  trace.appendChild(d);
  evcount.textContent = trace.children.length + ' events';
  trace.scrollTop = trace.scrollHeight;
}
const only = document.getElementById('onlytalk');
const evcount = document.getElementById('evcount');
only.addEventListener('change', () => {
  trace.classList.toggle('conversation', only.checked);
  trace.scrollTop = trace.scrollHeight;
});
const src = new EventSource('/runs/${run.id}/stream');
src.addEventListener('open', () => { live.textContent = 'live'; });
src.addEventListener('event', (m) => render(JSON.parse(m.data)));
src.addEventListener('meters', (m) => {
  const s = JSON.parse(m.data);
  document.getElementById('m-cost').textContent = '$' + (s.list_cost_cents/100).toFixed(2);
  document.getElementById('m-in').textContent = s.input_tokens;
  document.getElementById('m-out').textContent = s.output_tokens;
  document.getElementById('m-sec').textContent = s.active_seconds.toFixed(1) + 's';
  document.getElementById('m-billed').textContent = '$' + (s.billed_cents/100).toFixed(2);
  document.getElementById('m-bar').style.transform = 'scaleX(' + Math.min(1, s.list_cost_cents / Math.max(1,s.budget_cents)).toFixed(4) + ')';
  if (s.stop_reason === 'budget_reached' && !document.getElementById('capnote')) location.reload();
});
let askSig = '';
src.addEventListener('asks', (m) => {
  const sig = m.data;
  if (askSig && sig !== askSig) { location.reload(); return; }
  askSig = sig;
});
src.addEventListener('error', () => { live.textContent = 'reconnecting…'; });
</script>`, { balance, viewer });
}

export function ledgerPage(rows: Array<{ bucket: string; delta_cents: number; reason: string; created_at: string; run_id: string | null }>,
  buckets: Record<string, number>, balance: number, viewer: Viewer = null): string {
  return layout("Points", `<h1>Points</h1>
<p class="lede">A point is a cent of compute, not a token — so the model a buyer picks cannot wreck the economics. The monthly grant expires; top-ups and earnings do not.</p>
<div class="meters">
  <div class="meter"><div class="k">Balance</div><div class="v">${esc(fmt(balance))}</div></div>
  <div class="meter"><div class="k">Grant (expires)</div><div class="v">${esc(fmt(buckets["grant"] ?? 0))}</div></div>
  <div class="meter"><div class="k">Top-ups</div><div class="v">${esc(fmt(buckets["topup"] ?? 0))}</div></div>
  <div class="meter"><div class="k">Earnings</div><div class="v">${esc(fmt(buckets["earning"] ?? 0))}</div></div>
</div>
<form method="post" action="/ledger/topup"><div class="row">
  <label>Buy points <input type="text" name="cents" value="500" size="6"></label>
  <button class="btn">Add top-up</button></div></form>
<h2>Every movement</h2>
<table><tr><th>When</th><th>Bucket</th><th>Reason</th><th class="num">Change</th></tr>
${rows.map((r) => `<tr><td>${esc(r.created_at.slice(5, 16).replace("T", " "))}</td><td><span class="tag">${esc(r.bucket)}</span></td>
<td>${esc(r.reason)}${r.run_id ? ` <a href="/runs/${esc(r.run_id)}">trace</a>` : ""}</td>
<td class="num" style="color:${r.delta_cents < 0 ? "var(--bad)" : "var(--good)"}">${r.delta_cents < 0 ? "−" : "+"}${esc(fmt(Math.abs(r.delta_cents)))}</td></tr>`).join("")}
</table>`, { balance, viewer });
}

export function authorsPage(args: {
  mine: Array<{
    id: string; slug: string; name: string; status: string; runs: number; trials: number; failures: number;
    cost_cents: number; millicents: number; paid_millicents: number; payout_email: string | null;
  }>;
  catalog: Array<{ name: string; author: string; runs: number; millicents: number; mine: boolean }>;
  recent: Array<{ run_id: string; pack: string; stop_reason: string | null; cost_cents: number; started_at: string }>;
  balance: number; viewer: Viewer; err?: string; isCurator: boolean;
}): string {
  return layout("Authors", `
<h1>Authoring</h1>
<p class="lede">An author earns on every run of their pack, not only when it sells. Earned points are cashable, which is
why the ledger is an accounting system rather than a counter — and why a share is held until the buyer's refund window closes.</p>
${args.err ? `<div class="note bad">${esc(args.err)}</div>` : ""}

<p><a class="btn" href="/authors/new">Write a new pack</a>${args.isCurator ? ` <a class="btn ghost" href="/curate">Curate the catalog</a>` : ""}</p>
<h2>Packs you wrote</h2>
${args.mine.length === 0
  ? `<p class="lede">None yet — <a href="/authors/new">write one</a> or upload a folder. You can also claim a seeded pack below.</p>`
  : `<table><tr><th>Pack</th><th class="num">Runs</th><th class="num">Trials</th><th class="num">Failed</th><th class="num">Compute</th><th class="num">Earned</th><th class="num">Paid</th><th>Payout to</th></tr>
${args.mine.map((m) => `<tr>
  <td><a href="/packs/${esc(m.slug)}/edit">${esc(m.name)}</a> <span class="tag">${esc(m.status)}</span></td>
  <td class="num">${m.runs}</td><td class="num">${m.trials}</td>
  <td class="num"${m.failures > 0 ? ` style="color:var(--bad)"` : ""}>${m.failures}</td>
  <td class="num">${esc(fmt(m.cost_cents))}</td>
  <td class="num">${esc(fmtMilli(m.millicents))}</td>
  <td class="num">${esc(fmtMilli(m.paid_millicents))}</td>
  <td>${m.payout_email ? esc(m.payout_email) : `<span class="tag" style="color:var(--warn)">none set</span>`}</td>
</tr>`).join("")}
</table>`}

${args.recent.length ? `<h2>Recent runs of your packs</h2>
<p class="lede" style="font-size:14px">Where a pack failed is the only thing that tells you what to fix in version two.</p>
<table><tr><th>When</th><th>Pack</th><th>Ended</th><th class="num">Cost</th><th></th></tr>
${args.recent.map((r) => `<tr><td>${esc(r.started_at.slice(5, 16).replace("T", " "))}</td>
<td>${esc(r.pack)}</td>
<td>${r.stop_reason ? `<span class="tag" style="color:var(--warn)">${esc(r.stop_reason)}</span>` : "normally"}</td>
<td class="num">${esc(fmt(r.cost_cents))}</td>
<td><a href="/runs/${esc(r.run_id)}">trace</a></td></tr>`).join("")}
</table>` : ""}

<h2>Claim a pack you wrote</h2>
<p class="lede" style="font-size:14px">Claiming links a pack to this organisation: its earnings become yours, and you
see its runs unredacted. Only an owner can claim.</p>
<form method="post" action="/authors/claim" class="row">
  <input type="text" name="slug" placeholder="pack-slug" size="22" required>
  <input type="text" name="payoutEmail" placeholder="where to pay you" size="24" required>
  <button class="btn" type="submit">Claim</button>
</form>

<h2>Whole catalog</h2>
<table><tr><th>Pack</th><th>Author</th><th class="num">Runs</th><th class="num">Earned</th></tr>
${args.catalog.map((r) => `<tr><td>${esc(r.name)}${r.mine ? ` <span class="tag">yours</span>` : ""}</td>
<td>${esc(r.author)}</td><td class="num">${r.runs}</td><td class="num">${esc(fmtMilli(r.millicents))}</td></tr>`).join("")}
</table>`, { balance: args.balance, viewer: args.viewer });
}

export function settingsPage(rows: Array<{ key: string; value: string }>, balance: number, viewer: Viewer = null): string {
  return layout("Limits", `<h1>Limits</h1>
<p class="lede">Every limit is a row, never a constant. The subsidy on the current tiers is deliberate, so it has to be dialable without a deploy.</p>
<table><tr><th>Key</th><th>Value</th><th></th></tr>
${rows.map((r) => `<tr><td><code>${esc(r.key)}</code></td>
<td><form method="post" action="/settings" class="row">
  <input type="hidden" name="key" value="${esc(r.key)}">
  <input type="text" name="value" value="${esc(r.value)}" size="28">
  <button class="btn ghost" type="submit">Save</button></form></td><td></td></tr>`).join("")}
</table>`, { balance, viewer });
}

// ------------------------------------------------------------------ account

const authShell = (title: string, inner: string): string => layout(title, `
<div style="max-width:420px;margin:48px auto">${inner}</div>`);

export function loginPage(err?: string, email = ""): string {
  return authShell("Sign in", `
<h1>Sign in</h1>
<p class="lede">Hire an expert's method as a worker that runs on your side.</p>
${err ? `<div class="note bad">${esc(err)}</div>` : ""}
<form method="post" action="/login" class="card">
  <p><label>Email<br><input type="text" name="email" value="${esc(email)}" style="width:100%" autocomplete="username" required></label></p>
  <p><label>Password<br><input type="password" name="password" style="width:100%" autocomplete="current-password" required></label></p>
  <button class="btn" type="submit">Sign in</button>
</form>
<p class="lede" style="margin-top:14px">No account? <a href="/signup">Create one</a>.</p>`);
}

export function signupPage(err?: string, values: Record<string, string> = {}): string {
  return authShell("Create an account", `
<h1>Create an account</h1>
<p class="lede">This creates your organisation and makes you its owner. You can invite your team afterwards.</p>
${err ? `<div class="note bad">${esc(err)}</div>` : ""}
<form method="post" action="/signup" class="card">
  <p><label>Your name<br><input type="text" name="name" value="${esc(values["name"] ?? "")}" style="width:100%" required></label></p>
  <p><label>Email<br><input type="text" name="email" value="${esc(values["email"] ?? "")}" style="width:100%" autocomplete="username" required></label></p>
  <p><label>Organisation<br><input type="text" name="orgName" value="${esc(values["orgName"] ?? "")}" style="width:100%" placeholder="Your company"></label></p>
  <p><label>Password <span style="color:var(--muted);font-size:13px">(8 characters or more)</span><br>
    <input type="password" name="password" style="width:100%" autocomplete="new-password" required></label></p>
  <button class="btn" type="submit">Create account</button>
</form>
<p class="lede" style="margin-top:14px">Already have one? <a href="/login">Sign in</a>.</p>`);
}

export function invitePage(inv: { email: string; role: string }, orgName: string, token: string, err?: string): string {
  return authShell("Join", `
<h1>Join ${esc(orgName)}</h1>
<p class="lede">You have been invited as a <strong>${esc(inv.role)}</strong> using ${esc(inv.email)}.</p>
${err ? `<div class="note bad">${esc(err)}</div>` : ""}
<form method="post" action="/invite/${esc(token)}" class="card">
  <p><label>Your name<br><input type="text" name="name" style="width:100%" required></label></p>
  <p><label>Choose a password <span style="color:var(--muted);font-size:13px">(8 characters or more)</span><br>
    <input type="password" name="password" style="width:100%" autocomplete="new-password" required></label></p>
  <button class="btn" type="submit">Join</button>
</form>`);
}

export function teamPage(args: {
  members: Array<{ id: string; name: string; email: string; role: string; created_at: string }>;
  invites: Array<{ token: string; email: string; role: string; expires_at: string }>;
  seatsUsed: number; seatLimit: number; tier: string;
  viewer: Viewer; youId: string; balance: number; err?: string;
}): string {
  const isOwner = args.viewer?.role === "owner";
  return layout("Team", `
<h1>Team</h1>
<p class="lede">Packs, points and running agents belong to the organisation, not to whoever bought them — so a departure never takes the inventory with it.</p>
${args.err ? `<div class="note bad">${esc(args.err)}</div>` : ""}
<div class="meters">
  <div class="meter"><div class="k">Tier</div><div class="v">${esc(args.tier)}</div></div>
  <div class="meter"><div class="k">Seats used</div><div class="v">${args.seatsUsed} / ${args.seatLimit}</div></div>
</div>
<h2>Members</h2>
<table><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr>
${args.members.map((m) => `<tr>
  <td>${esc(m.name)}${m.id === args.youId ? ` <span class="tag">you</span>` : ""}</td>
  <td>${esc(m.email)}</td>
  <td>${isOwner && m.id !== args.youId ? `<form method="post" action="/team/role" class="row">
      <input type="hidden" name="userId" value="${esc(m.id)}">
      <select name="role"><option value="member"${m.role === "member" ? " selected" : ""}>member</option><option value="owner"${m.role === "owner" ? " selected" : ""}>owner</option></select>
      <button class="btn ghost" style="padding:5px 10px">Save</button></form>` : `<span class="tag">${esc(m.role)}</span>`}</td>
  <td>${isOwner && m.id !== args.youId ? `<form method="post" action="/team/remove" class="inline">
      <input type="hidden" name="userId" value="${esc(m.id)}">
      <button class="btn ghost" style="padding:5px 10px">Remove</button></form>` : ""}</td>
</tr>`).join("")}
</table>
${args.invites.length ? `<h2>Pending invitations</h2>
<table><tr><th>Email</th><th>Role</th><th>Link</th><th></th></tr>
${args.invites.map((i) => `<tr><td>${esc(i.email)}</td><td><span class="tag">${esc(i.role)}</span></td>
<td><code style="font-size:12px">/invite/${esc(i.token.slice(0, 12))}…</code></td>
<td>${isOwner ? `<form method="post" action="/team/revoke" class="inline">
  <input type="hidden" name="token" value="${esc(i.token)}">
  <button class="btn ghost" style="padding:5px 10px">Revoke</button></form>` : ""}</td></tr>`).join("")}
</table>` : ""}
${isOwner ? `<h2>Invite someone</h2>
<form method="post" action="/team/invite" class="row">
  <input type="text" name="email" placeholder="them@company.com" size="28" required>
  <select name="role"><option value="member">member</option><option value="owner">owner</option></select>
  <button class="btn" type="submit">Send invitation</button>
</form>
<p class="lede" style="margin-top:10px;font-size:14px">There is no email delivery yet — the invitation link appears above for you to pass on.</p>`
  : `<p class="lede">Only an owner can invite or change roles.</p>`}`,
  { balance: args.balance, viewer: args.viewer });
}

// ---------------------------------------------------------------- purchases

export function purchasesPage(rows: Array<{
  id: string; kind: string; what: string; amount_cents: number; status: string;
  provider: string; refundable_until: string | null; created_at: string;
}>, providerName: string, providerReal: boolean, balance: number, viewer: Viewer = null): string {
  const nowIso = new Date().toISOString();
  return layout("Purchases", `
<h1>Purchases</h1>
<p class="lede">What this organisation has bought. A pack's entitlement comes from a paid purchase and nothing else.</p>
${providerReal ? "" : `<div class="note">Payments are running on the <strong>${esc(providerName)}</strong> provider: records are written and entitlements granted, but <strong>no money moves</strong>. Set <code>PAYPAL_CLIENT_ID</code> and <code>PAYPAL_CLIENT_SECRET</code> to charge for real.</div>`}
<table><tr><th>When</th><th>What</th><th class="num">Amount</th><th>Status</th><th>Refundable</th><th></th></tr>
${rows.map((r) => {
  const open = r.status === "paid" && r.kind === "pack" && r.refundable_until !== null && r.refundable_until > nowIso;
  return `<tr>
  <td>${esc(r.created_at.slice(0, 16).replace("T", " "))}</td>
  <td>${esc(r.what)} <span class="tag">${esc(r.kind)}</span></td>
  <td class="num">${esc(fmt(r.amount_cents))}</td>
  <td><span class="tag" style="color:${r.status === "paid" ? "var(--good)" : r.status === "refunded" ? "var(--warn)" : "var(--muted)"}">${esc(r.status)}</span></td>
  <td>${r.kind === "points" ? "—" : open ? esc(r.refundable_until!.slice(0, 10)) : "closed"}</td>
  <td>${open ? `<form method="post" action="/purchases/${esc(r.id)}/refund" class="inline">
      <button class="btn ghost" style="padding:5px 10px">Refund</button></form>` : ""}</td>
</tr>`;
}).join("") || `<tr><td colspan="6">Nothing bought yet.</td></tr>`}
</table>`, { balance, viewer });
}

export function payoutsPage(args: {
  due: Array<{ pack_id: string; name: string; recipient: string | null; millicents: number }>;
  history: Array<{ name: string; recipient: string; millicents: number; status: string; created_at: string }>;
  windowDays: number; providerName: string; providerReal: boolean;
  balance: number; viewer: Viewer; err?: string;
}): string {
  return layout("Payouts", `
<h1>Author payouts</h1>
<p class="lede">An author's share is held until the buyer's ${args.windowDays}-day refund window closes, then becomes payable. Paying sooner would mean clawing money back from an author because a buyer changed their mind.</p>
${args.err ? `<div class="note bad">${esc(args.err)}</div>` : ""}
${args.providerReal ? "" : `<div class="note">Provider is <strong>${esc(args.providerName)}</strong> — payouts are recorded, no money moves.</div>`}
<h2>Due now</h2>
<table><tr><th>Pack</th><th>Payout address</th><th class="num">Owed</th><th></th></tr>
${args.due.map((d) => `<tr>
  <td>${esc(d.name)}</td>
  <td>${d.recipient ? esc(d.recipient) : `<span class="tag" style="color:var(--warn)">none on file</span>`}</td>
  <td class="num">${esc(fmtMilli(d.millicents))}</td>
  <td>${d.recipient ? `<form method="post" action="/payouts/pay" class="inline">
      <input type="hidden" name="packId" value="${esc(d.pack_id)}">
      <button class="btn" style="padding:5px 12px">Pay</button></form>` : ""}</td>
</tr>`).join("") || `<tr><td colspan="4">Nothing has cleared the refund window yet.</td></tr>`}
</table>
<h2>Paid</h2>
<table><tr><th>When</th><th>Pack</th><th>To</th><th class="num">Amount</th><th>Status</th></tr>
${args.history.map((h) => `<tr><td>${esc(h.created_at.slice(0, 16).replace("T", " "))}</td>
<td>${esc(h.name)}</td><td>${esc(h.recipient)}</td><td class="num">${esc(fmtMilli(h.millicents))}</td>
<td><span class="tag">${esc(h.status)}</span></td></tr>`).join("") || `<tr><td colspan="5">No payouts yet.</td></tr>`}
</table>`, { balance: args.balance, viewer: args.viewer });
}

// ------------------------------------------------------------------- tokens

export function tokensPage(
  tokens: Array<{ token: string; name: string; created_at: string; last_used_at: string | null }>,
  base: string, justCreated: string | undefined, balance: number, viewer: Viewer = null,
): string {
  return layout("MCP access", `
<h1>Shop from inside your own agent</h1>
<p class="lede">The catalog is also an MCP server. Add one endpoint to whatever agent you already run, and it can
search packs, read what you own, and pull up any run's transcript and cost without opening this site.</p>

${justCreated ? `<div class="note" style="border-color:var(--good);background:color-mix(in oklab,var(--good) 10%,transparent)">
  <strong>Your new token — copy it now, it is not shown again.</strong>
  <pre style="margin:8px 0;white-space:pre-wrap;word-break:break-all;font-size:13px">${esc(justCreated)}</pre>
</div>` : ""}

<h2>Connect it</h2>
<p class="lede" style="font-size:14px">Endpoint and authentication:</p>
<pre class="card" style="white-space:pre-wrap;word-break:break-all;font-size:13px">${esc(base)}/mcp
Authorization: Bearer &lt;your token&gt;</pre>
<p class="lede" style="font-size:14px">Seven tools: <code>search_packs</code>, <code>pack_details</code>,
<code>my_library</code>, <code>install_pack</code>, <code>export_pack</code>, <code>list_runs</code>,
<code>run_trace</code>.
Nothing here spends money — buying needs a browser, so <code>install_pack</code> hands back a link instead.
Running a pack you already own needs the browser too, for now.</p>

<h2>Tokens</h2>
<table><tr><th>Name</th><th>Created</th><th>Last used</th><th></th></tr>
${tokens.map((t) => `<tr><td>${esc(t.name)}</td>
<td>${esc(t.created_at.slice(0, 10))}</td>
<td>${t.last_used_at ? esc(t.last_used_at.slice(0, 16).replace("T", " ")) : "never"}</td>
<td><form method="post" action="/tokens/revoke" class="inline">
  <input type="hidden" name="token" value="${esc(t.token)}">
  <button class="btn ghost" style="padding:5px 10px">Revoke</button></form></td></tr>`).join("")
  || `<tr><td colspan="4">No tokens yet.</td></tr>`}
</table>
<form method="post" action="/tokens" class="row" style="margin-top:14px">
  <input type="text" name="name" placeholder="What is it for — e.g. my laptop" size="30" required>
  <button class="btn" type="submit">Create a token</button>
</form>
<p class="lede" style="margin-top:10px;font-size:14px">A token acts for this whole organisation. Revoking one takes effect immediately.</p>`,
  { balance, viewer });
}

// ----------------------------------------------------------------- schedules

export function schedulesPage(args: {
  rows: Array<{
    id: string; name: string; pack: string; prompt: string; cadence: string;
    enabled: number; last_run_at: string | null; last_run_id: string | null; last_error: string | null;
  }>;
  owned: Array<{ id: string; name: string }>;
  balance: number; viewer: Viewer; err?: string;
}): string {
  return layout("Schedules", `
<h1>Standing instructions</h1>
<p class="lede">A pack, a brief, and a cadence. The agent runs on its own and the result is waiting for you — which is
the honest reason to pay every month rather than once. Scheduled runs are budgeted, metered and traced exactly like
the ones you start by hand.</p>
${args.err ? `<div class="note bad">${esc(args.err)}</div>` : ""}

<table><tr><th>Name</th><th>Pack</th><th>When</th><th>Last run</th><th></th><th></th></tr>
${args.rows.map((r) => `<tr>
  <td>${esc(r.name)}${r.enabled ? "" : ` <span class="tag">paused</span>`}
    <div style="color:var(--muted);font-size:12.5px;max-width:34ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.prompt)}</div></td>
  <td>${esc(r.pack)}</td>
  <td>${esc(r.cadence)}</td>
  <td>${r.last_run_at ? esc(r.last_run_at.slice(5, 16).replace("T", " ")) : "never"}
    ${r.last_run_id ? ` · <a href="/runs/${esc(r.last_run_id)}">trace</a>` : ""}
    ${r.last_error ? `<div class="tag" style="color:var(--bad)">${esc(r.last_error)}</div>` : ""}</td>
  <td><form method="post" action="/schedules/toggle" class="inline">
    <input type="hidden" name="id" value="${esc(r.id)}">
    <input type="hidden" name="enabled" value="${r.enabled ? "0" : "1"}">
    <button class="btn ghost" style="padding:5px 10px">${r.enabled ? "Pause" : "Resume"}</button></form></td>
  <td><form method="post" action="/schedules/delete" class="inline">
    <input type="hidden" name="id" value="${esc(r.id)}">
    <button class="btn ghost" style="padding:5px 10px">Delete</button></form></td>
</tr>`).join("") || `<tr><td colspan="6">Nothing scheduled yet.</td></tr>`}
</table>

<h2>Add one</h2>
${args.owned.length === 0
  ? `<p class="lede">You need to own a pack first — a schedule is a standing commitment to spend money, so it is only
offered on packs this organisation owns.</p>`
  : `<form method="post" action="/schedules" class="card">
  <p><label>Name<br><input type="text" name="name" placeholder="Monday competitor sweep" style="width:100%" required></label></p>
  <p><label>Pack<br><select name="packVersionId" style="width:100%">
    ${args.owned.map((o) => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join("")}
  </select></label></p>
  <p><label>The brief it sends every time<br>
    <textarea name="prompt" placeholder="What the worker should do, as if you were typing it yourself." required></textarea></label></p>
  <div class="row">
    <label>Cadence <select name="cadence">
      <option value="daily">daily</option><option value="weekly">weekly</option><option value="hourly">hourly</option>
    </select></label>
    <label>Hour (UTC) <select name="hour">
      ${Array.from({ length: 24 }, (_, h) => `<option value="${h}"${h === 9 ? " selected" : ""}>${String(h).padStart(2, "0")}:00</option>`).join("")}
    </select></label>
    <label>Weekday <select name="weekday">
      ${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
        .map((d, i) => `<option value="${i}"${i === 1 ? " selected" : ""}>${d}</option>`).join("")}
    </select></label>
    <button class="btn" type="submit">Schedule it</button>
  </div>
  <p class="lede" style="margin-top:10px;font-size:13.5px">Times are UTC so a schedule does not drift. Hourly ignores the hour and weekday.</p>
</form>`}`, { balance: args.balance, viewer: args.viewer });
}

// ----------------------------------------------------------------- authoring

const STATUS_NOTE: Record<string, string> = {
  draft: "Only you can see this. Publish it to the runtime, then submit it for the catalog.",
  review: "Submitted. The curating organisation decides whether it goes on the shelf.",
  listed: "On the shelf and buyable.",
  unlisted: "Withdrawn from the catalog. Anyone who already bought it keeps it and can still run it.",
};

export function packEditorPage(args: {
  pack: (PackRow & { version?: number }) | null;
  models: string[]; balance: number; viewer: Viewer; err?: string; isCurator: boolean;
}): string {
  const p = args.pack;
  const pinned: string[] = p ? JSON.parse(p.pinned_models) : [];
  const action = p ? `/packs/${esc(p.slug)}/edit` : "/authors/packs";
  return layout(p ? `Edit ${p.name}` : "New pack", `
<h1>${p ? `Edit ${esc(p.name)}` : "Write a pack"}</h1>
<p class="lede">A pack is one expert's method, packaged as a worker. The instructions are the product — everything else
is how it is sold.</p>
${args.err ? `<div class="note bad">${esc(args.err)}</div>` : ""}
${p ? `<div class="note"><strong>${esc(p.status)}</strong> — ${esc(STATUS_NOTE[p.status] ?? "")}
  ${p.version ? `Published version ${p.version}.` : "Not published to the runtime yet."}</div>` : ""}

${p ? "" : `<h2>Start from a file or a folder</h2>
<p class="lede" style="font-size:14px">Already written it? Drop in an <code>agent.md</code> — the same format this site
exports and <code>ant apply</code> reads — or a whole folder, where <code>agent.md</code> is the definition and the
other markdown files are appended in filename order.</p>
<div class="card">
  <div class="row">
    <label class="btn ghost">Choose files<input id="files" type="file" multiple accept=".md,.markdown,.txt" hidden></label>
    <label class="btn ghost">Choose a folder<input id="folder" type="file" multiple webkitdirectory hidden></label>
    <span class="tag" id="uploadState">nothing selected</span>
  </div>
  <p class="lede" style="margin:10px 0 0;font-size:13.5px">It arrives as a draft you can finish below. Nothing is listed until it is submitted and approved.</p>
</div>
<script>
const state = document.getElementById('uploadState');
async function send(files) {
  const picked = [...files].filter((f) => /\.(md|markdown|txt)$/i.test(f.name));
  if (picked.length === 0) { state.textContent = 'no markdown or text files in that selection'; return; }
  state.textContent = 'reading ' + picked.length + ' file(s)…';
  const payload = { files: await Promise.all(picked.map(async (f) => ({
    path: f.webkitRelativePath || f.name, text: await f.text(),
  }))) };
  state.textContent = 'uploading…';
  const res = await fetch('/api/packs', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) { state.textContent = out.error || ('upload failed: ' + res.status); return; }
  location.href = '/packs/' + out.slug + '/edit';
}
document.getElementById('files').addEventListener('change', (e) => send(e.target.files));
document.getElementById('folder').addEventListener('change', (e) => send(e.target.files));
</script>`}

<h2>${p ? "Details" : "Or write it here"}</h2>
<form method="post" action="${action}" class="card">
  <p><label>Name<br><input type="text" name="name" value="${esc(p?.name ?? "")}" style="width:100%" required></label></p>
  <p><label>One line a buyer would recognise<br>
    <input type="text" name="tagline" value="${esc(p?.tagline ?? "")}" style="width:100%"></label></p>
  <p><label>Shown as the author<br>
    <input type="text" name="author" value="${esc(p?.author ?? "")}" style="width:100%"></label></p>
  ${p ? `<p><label>Address<br><input type="text" value="/packs/${esc(p.slug)}" style="width:100%" disabled></label>
    <span class="tag">an address never changes — buyers and traces point at it</span></p>`
    : `<p><label>Address <span style="color:var(--muted);font-size:13px">(blank to take it from the name)</span><br>
    <input type="text" name="slug" placeholder="pricing-reviewer" style="width:100%"></label></p>`}
  <div class="row">
    <label>Price <input type="text" name="priceCents" value="${p?.price_cents ?? 0}" size="7"> <span class="tag">cents, 0 = free</span></label>
    <label>Update cost <input type="text" name="upgradePoints" value="${p?.upgrade_points ?? 0}" size="5"> <span class="tag">points</span></label>
  </div>
  <div class="row" style="margin-top:12px">
    <label>Default model <select name="model">
      ${args.models.map((m) => `<option value="${esc(m)}"${m === (p?.model ?? "claude-opus-5") ? " selected" : ""}>${esc(m)}</option>`).join("")}
    </select></label>
    <label>Effort <select name="effort">
      ${["", "low", "medium", "high", "xhigh", "max"].map((e) => `<option value="${esc(e)}"${e === (p?.effort ?? "high") ? " selected" : ""}>${e || "(none)"}</option>`).join("")}
    </select></label>
    <label>Payout address <input type="text" name="payoutEmail" value="${esc(p?.author_payout_email ?? "")}" size="22"></label>
  </div>
  <p style="margin-top:12px"><label>Restrict to these models <span style="color:var(--muted);font-size:13px">(comma separated, blank for any)</span><br>
    <input type="text" name="pinnedModels" value="${esc(pinned.join(", "))}" style="width:100%"></label>
    <span class="tag">every extraction refusal measured came from Opus; a weaker model may simply comply</span></p>
  <p><label>The method — this is the product, and buyers never see it<br>
    <textarea name="instructions" style="min-height:300px" required>${esc(p?.instructions ?? "")}</textarea></label></p>
  <button class="btn" type="submit">${p ? "Save" : "Create as a draft"}</button>
</form>

${p ? `<h2>Lifecycle</h2>
<div class="row">
  <form method="post" action="/packs/${esc(p.slug)}/publish" class="inline">
    <button class="btn ghost">${p.version ? `Publish version ${p.version + 1}` : "Publish to the runtime"}</button></form>
  ${p.status === "draft" || p.status === "unlisted" ? `<form method="post" action="/packs/${esc(p.slug)}/submit" class="inline">
    <button class="btn">Submit for the catalog</button></form>` : ""}
  ${args.isCurator ? `<form method="post" action="/packs/${esc(p.slug)}/status" class="inline">
    <input type="hidden" name="status" value="${p.status === "listed" ? "unlisted" : "listed"}">
    <button class="btn ghost">${p.status === "listed" ? "Withdraw from the catalog" : "List it"}</button></form>` : ""}
  <form method="post" action="/packs/${esc(p.slug)}/delete" class="inline">
    <button class="btn ghost">Delete</button></form>
  <a class="btn ghost" href="/packs/${esc(p.slug)}">View as a buyer</a>
</div>
<p class="lede" style="margin-top:12px;font-size:14px">Saving changes the <em>next</em> version. Anyone who already
bought this keeps running the version they bought, because a version carries its own copy of the method — which is
what lets you fix a mistake without quietly rewriting work somebody paid for.</p>` : ""}`,
  { balance: args.balance, viewer: args.viewer });
}

export function curatePage(args: {
  queue: Array<{ slug: string; name: string; author: string; tagline: string; price_cents: number }>;
  listed: Array<{ slug: string; name: string; author: string }>;
  balance: number; viewer: Viewer;
}): string {
  return layout("Curate", `
<h1>Curating the catalog</h1>
<p class="lede">A thin curated shelf beats a full unreliable one — marketplaces die of bad inventory faster than of
empty inventory. You are the taste.</p>
<h2>Waiting for a decision</h2>
${args.queue.length === 0 ? `<p class="lede">Nothing submitted.</p>` : `<table><tr><th>Pack</th><th>Author</th><th class="num">Price</th><th></th></tr>
${args.queue.map((q) => `<tr>
  <td><a href="/packs/${esc(q.slug)}/edit">${esc(q.name)}</a><div style="color:var(--muted);font-size:13px">${esc(q.tagline)}</div></td>
  <td>${esc(q.author)}</td><td class="num">${esc(fmt(q.price_cents))}</td>
  <td><form method="post" action="/packs/${esc(q.slug)}/status" class="row">
    <button class="btn" name="status" value="listed">List it</button>
    <button class="btn ghost" name="status" value="draft">Send back</button></form></td>
</tr>`).join("")}</table>`}
<h2>On the shelf</h2>
<table><tr><th>Pack</th><th>Author</th><th></th></tr>
${args.listed.map((l) => `<tr><td><a href="/packs/${esc(l.slug)}">${esc(l.name)}</a></td><td>${esc(l.author)}</td>
<td><form method="post" action="/packs/${esc(l.slug)}/status" class="inline">
  <input type="hidden" name="status" value="unlisted">
  <button class="btn ghost" style="padding:5px 10px">Withdraw</button></form></td></tr>`).join("")
  || `<tr><td colspan="3">Nothing listed.</td></tr>`}
</table>`, { balance: args.balance, viewer: args.viewer });
}
