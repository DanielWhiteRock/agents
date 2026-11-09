import { fmt, fmtMilli } from "../billing/points.js";
import type { PackRow, PackVersionRow, RunRow } from "./platform.js";

export const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

const CSS = `
:root{--bg:#fbfaf8;--panel:#fff;--ink:#17161a;--muted:#6b6975;--line:#e6e3dd;--accent:#2f5d50;--accent-ink:#fff;--warn:#8a5a1a;--bad:#8c2f2f;--good:#2f6b4f;--mono:ui-monospace,SFMono-Regular,Menlo,monospace}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#121214;--panel:#1a1a1e;--ink:#edecea;--muted:#9a98a2;--line:#2b2b32;--accent:#7fb8a4;--accent-ink:#10231d;--warn:#d9a95c;--bad:#e0847c;--good:#86c9a4}}
:root[data-theme=dark]{--bg:#121214;--panel:#1a1a1e;--ink:#edecea;--muted:#9a98a2;--line:#2b2b32;--accent:#7fb8a4;--accent-ink:#10231d;--warn:#d9a95c;--bad:#e0847c;--good:#86c9a4}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
.wrap{max-width:1000px;margin:0 auto;padding:0 16px 64px}
header.top{border-bottom:1px solid var(--line);background:var(--panel);position:sticky;top:0;z-index:5}
header.top .wrap{display:flex;gap:20px;align-items:center;padding:14px 16px;flex-wrap:wrap}
.brand{font-weight:650;letter-spacing:-.02em}
.brand small{color:var(--muted);font-weight:400;margin-left:8px}
nav{display:flex;gap:16px;margin-left:auto;flex-wrap:wrap}
nav a{color:var(--muted);font-size:14px}nav a:hover{color:var(--ink)}
h1{font-size:28px;letter-spacing:-.02em;margin:28px 0 6px}
h2{font-size:18px;margin:28px 0 10px;letter-spacing:-.01em}
p.lede{color:var(--muted);margin:0 0 20px;max-width:62ch}
.grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(290px,1fr))}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px}
.card h3{margin:0 0 4px;font-size:17px}
.card .by{color:var(--muted);font-size:13px;margin:0 0 10px}
.card p{margin:0 0 14px;color:var(--ink);font-size:14.5px}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.spread{display:flex;justify-content:space-between;align-items:baseline;gap:12px}
.price{font-family:var(--mono);font-size:15px}
.btn{display:inline-block;background:var(--accent);color:var(--accent-ink);border:0;border-radius:8px;padding:9px 14px;font:inherit;font-size:14px;font-weight:550;cursor:pointer}
.btn.ghost{background:transparent;color:var(--ink);border:1px solid var(--line)}
.btn:hover{filter:brightness(1.07)}
.tag{display:inline-block;font-size:11.5px;font-family:var(--mono);color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:2px 8px}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line)}
th{color:var(--muted);font-weight:550;font-size:12.5px;text-transform:uppercase;letter-spacing:.04em}
td.num,th.num{text-align:right;font-family:var(--mono);font-variant-numeric:tabular-nums}
.meters{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));margin:0 0 16px}
.meter{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:11px 13px}
.meter .k{font-size:11.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
.meter .v{font-family:var(--mono);font-size:19px;font-variant-numeric:tabular-nums;margin-top:3px}
.bar{height:6px;background:var(--line);border-radius:99px;overflow:hidden;margin-top:9px}
.bar>i{display:block;height:100%;background:var(--accent);width:0}
#trace{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:4px 0;max-height:60vh;overflow:auto}
.ev{padding:9px 14px;border-bottom:1px solid var(--line);font-size:14px}
.ev:last-child{border-bottom:0}
.ev .k{font-family:var(--mono);font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
.ev pre{margin:4px 0 0;white-space:pre-wrap;word-break:break-word;font:inherit}
.ev.user{background:color-mix(in oklab,var(--accent) 7%,transparent)}
.ev.meter .k{color:var(--good)}
.ev.err .k{color:var(--bad)}
.ev.warnrow .k{color:var(--warn)}
textarea{width:100%;background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:10px;padding:11px;font:inherit;min-height:84px;resize:vertical}
select,input[type=text]{background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:8px;font:inherit}
.note{border-left:3px solid var(--warn);background:color-mix(in oklab,var(--warn) 9%,transparent);padding:10px 14px;border-radius:0 8px 8px 0;font-size:14px;margin:0 0 18px}
.note.bad{border-color:var(--bad);background:color-mix(in oklab,var(--bad) 9%,transparent)}
footer{color:var(--muted);font-size:13px;margin-top:40px;border-top:1px solid var(--line);padding-top:16px}
form.inline{display:inline}
`;

export function layout(title: string, body: string, opts: { balance?: number } = {}): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · agents.alphaceo.ai</title><style>${CSS}</style></head><body>
<header class="top"><div class="wrap">
<span class="brand">agents.alphaceo.ai<small>hire a worker</small></span>
<nav>
  <a href="/">Catalog</a><a href="/runs">Runs</a><a href="/ledger">Points</a>
  <a href="/authors">Authors</a><a href="/settings">Limits</a>
  ${opts.balance !== undefined ? `<span class="tag">balance ${esc(fmt(opts.balance))}</span>` : ""}
</nav></div></header>
<div class="wrap">${body}
<footer>Packs run on Anthropic Managed Agents. Spend is the platform's own <code>list_cost</code>, priced at public list rates. Seed pack instructions are placeholders, not an expert's work.</footer>
</div></body></html>`;
}

export function catalogPage(packs: Array<PackRow & { published: boolean; owned: boolean }>, balance: number): string {
  const cards = packs.map((p) => `<div class="card">
  <div class="spread"><h3>${esc(p.name)}</h3><span class="price">${p.price_cents === 0 ? "free" : esc(fmt(p.price_cents))}</span></div>
  <p class="by">by ${esc(p.author)} · <span class="tag">${esc(p.model)}</span> <span class="tag">effort ${esc(p.effort)}</span></p>
  <p>${esc(p.tagline)}</p>
  <div class="row">
    <a class="btn" href="/packs/${esc(p.slug)}">${p.owned ? "Open" : "View"}</a>
    ${p.published ? "" : `<span class="tag">not yet published</span>`}
  </div></div>`).join("");
  return layout("Catalog", `<h1>Hire a worker</h1>
<p class="lede">Each pack is an expert's method, packaged. You buy it once, it runs here on your side of the fence, and you see exactly what every run cost.</p>
<div class="grid">${cards}</div>`, { balance });
}

export function packPage(p: PackRow, v: PackVersionRow | undefined, owned: boolean, models: string[], balance: number, err?: string): string {
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
<div class="note">You can run this pack and read everything it does, but never its instructions — those are the author's. Transcripts you see are redacted against the pack's own text.</div>
${v ? `
<h2>${owned ? "Start a run" : "Acquire and run"}</h2>
<form method="post" action="${owned ? "/runs" : `/packs/${esc(p.slug)}/acquire`}">
  <input type="hidden" name="packVersionId" value="${esc(v.id)}">
  <div class="row">
    <label>Model <select name="model">${choices.map((m) => `<option value="${esc(m)}"${m === p.model ? " selected" : ""}>${esc(m)}</option>`).join("")}</select></label>
    <button class="btn" type="submit">${owned ? "Start a run" : `Acquire for ${p.price_cents === 0 ? "free" : fmt(p.price_cents)}`}</button>
  </div>
  ${pinned.length ? `<p class="lede" style="margin-top:10px;font-size:14px">The author restricted this pack to ${esc(pinned.join(", "))} — every extraction refusal measured came from Opus, and a weaker model may just comply.</p>` : ""}
</form>` : `<form method="post" action="/packs/${esc(p.slug)}/publish"><button class="btn" type="submit">Publish to the runtime</button></form>`}
<h2>What runs cost</h2>
<table><tr><th>Item</th><th class="num">Measured</th></tr>
<tr><td>A short turn (refusal, 288 output tokens, 6.5k cached prompt)</td><td class="num">$0.05</td></tr>
<tr><td>Default budget per run, before it pauses</td><td class="num">$0.50</td></tr>
<tr><td>Session running time</td><td class="num">$0.08/hr active</td></tr>
</table>`, { balance });
}

export function runsPage(runs: Array<RunRow & { pack: string }>, balance: number): string {
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
</table>`, { balance });
}

export type Ask = { event_id: string; name: string; input: string };

export function runPage(run: RunRow, packName: string, balance: number, exhausted: boolean, asks: Ask[] = []): string {
  return layout(`Run · ${packName}`, `
<h1>${esc(packName)}</h1>
<p class="lede">Live trace, down to the token. <span class="tag">${esc(run.model)}</span> <span class="tag">session ${esc(run.session_id.slice(0, 18))}</span></p>
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
    <div class="bar"><i id="m-bar" style="width:${Math.min(100, (run.list_cost_cents / Math.max(1, run.budget_cents)) * 100)}%"></i></div></div>
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
<h2>Trace</h2>
<div id="trace"></div>
<script>
const trace = document.getElementById('trace');
const live = document.getElementById('live');
const KIND = {'user.message':'user','user.decision':'user','run.metered':'meter','run.error':'err',
  'error':'err','run.budget_reached':'warnrow','tool.use':'warnrow'};
function render(e){
  const d = document.createElement('div');
  d.className = 'ev ' + (KIND[e.kind] || '');
  let body = '';
  try {
    const p = JSON.parse(e.payload);
    if (e.kind === 'user.message') body = p.text;
    else if (e.kind === 'agent.text') body = p.text;
    else if (e.kind === 'run.metered') body = 'cost ' + (p.list_cost_cents/100).toFixed(2) + ' (+' + (p.delta_cents/100).toFixed(2) + ') · in ' + p.input_tokens + ' · out ' + p.output_tokens + ' · ' + p.active_seconds.toFixed(1) + 's · author earned ' + (p.author_cents/100).toFixed(2);
    else if (e.kind === 'tool.use') body = p.name + ' [' + p.permission + '] ' + JSON.stringify(p.input);
    else if (e.kind === 'tool.result') body = p.name + (p.isError ? ' FAILED ' : ' ok ') + (p.preview||'').slice(0,400);
    else if (e.kind === 'agent.thinking') body = 'thinking…';
    else if (e.kind === 'model.usage') body = 'request: in ' + p.inputTokens + ' · out ' + p.outputTokens + ' · cache read ' + p.cacheReadTokens + ' · cache write ' + p.cacheCreationTokens;
    else if (e.kind === 'status') body = p.status + (p.stopReason ? ' (' + p.stopReason + ')' : '');
    else if (e.kind === 'user.decision') body = p.result.toUpperCase() + ' ' + p.name + (p.deny_message ? ' — ' + p.deny_message : '');
    else if (e.kind === 'raw') body = (p.payload && p.payload.type) ? p.payload.type : JSON.stringify(p).slice(0,200);
    else body = JSON.stringify(p);
  } catch { body = e.payload; }
  d.innerHTML = '<div class="k">' + e.kind + ' · ' + e.created_at.slice(11,19) + '</div><pre></pre>';
  d.querySelector('pre').textContent = body || '';
  trace.appendChild(d);
  trace.scrollTop = trace.scrollHeight;
}
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
  document.getElementById('m-bar').style.width = Math.min(100, (s.list_cost_cents / Math.max(1,s.budget_cents)) * 100) + '%';
  if (s.stop_reason === 'budget_reached' && !document.getElementById('capnote')) location.reload();
});
let askSig = '';
src.addEventListener('asks', (m) => {
  const sig = m.data;
  if (askSig && sig !== askSig) { location.reload(); return; }
  askSig = sig;
});
src.addEventListener('error', () => { live.textContent = 'reconnecting…'; });
</script>`, { balance });
}

export function ledgerPage(rows: Array<{ bucket: string; delta_cents: number; reason: string; created_at: string; run_id: string | null }>,
  buckets: Record<string, number>, balance: number): string {
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
</table>`, { balance });
}

export function authorsPage(rows: Array<{ name: string; author: string; runs: number; millicents: number }>, balance: number): string {
  return layout("Authors", `<h1>Author earnings</h1>
<p class="lede">An author earns on every run of their pack, not only when it sells — a configurable share of what the run cost. Earned points are cashable, which is why the ledger is an accounting system rather than a counter.</p>
<table><tr><th>Pack</th><th>Author</th><th class="num">Runs</th><th class="num">Earned</th></tr>
${rows.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.author)}</td><td class="num">${r.runs}</td><td class="num">${esc(fmtMilli(r.millicents))}</td></tr>`).join("")}
</table>`, { balance });
}

export function settingsPage(rows: Array<{ key: string; value: string }>, balance: number): string {
  return layout("Limits", `<h1>Limits</h1>
<p class="lede">Every limit is a row, never a constant. The subsidy on the current tiers is deliberate, so it has to be dialable without a deploy.</p>
<table><tr><th>Key</th><th>Value</th><th></th></tr>
${rows.map((r) => `<tr><td><code>${esc(r.key)}</code></td>
<td><form method="post" action="/settings" class="row">
  <input type="hidden" name="key" value="${esc(r.key)}">
  <input type="text" name="value" value="${esc(r.value)}" size="28">
  <button class="btn ghost" type="submit">Save</button></form></td><td></td></tr>`).join("")}
</table>`, { balance });
}
