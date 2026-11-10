import { fmt, fmtMilli, pts } from "../billing/points.js";
import type { PackRow, PackVersionRow, RunRow } from "./platform.js";

export const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

const CSS = `
/* ---------------------------------------------------------------- tokens
   Perspective, by its own numbers: type 12/14/16/20/24/32, spacing
   4/8/12/16/24/32, primary #00BD7D, text #111827 on #FFFFFF. Named, never
   inlined — the system says semantic tokens over raw values and that is the
   rule that keeps the other rules enforceable.

   Motion stays as it was: springs sampled from a damping ratio and a response
   time. Perspective says how this looks; it says nothing about how it behaves
   under a thumb, and the two have no quarrel.                               */
:root{
--primary:#00BD7D;--success:#16A34A;--warning:#D97706;--danger:#DC2626;
--surface:#FFFFFF;--text:#111827;
--bg:#F7F8F8;--panel:var(--surface);--ink:var(--text);--muted:#5B6472;--line:#E3E6EA;
--accent:#009166;--accent-ink:#04231A;
--mono:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
--sans:"Poppins",system-ui,-apple-system,"Segoe UI",sans-serif;
--display:"Oswald","Poppins",system-ui,sans-serif;

/* spacing: 4 8 12 16 24 32, and the two larger steps the scale implies */
--s1:.25rem;--s2:.5rem;--s3:.75rem;--s4:1rem;--s5:1.5rem;--s6:2rem;--s7:3rem;--s8:4rem;

/* type: 12 14 16 20 24 32 */
--t1:.75rem;--t2:.875rem;--t3:1rem;--t4:1.25rem;--t5:1.5rem;--t6:2rem;

/* three planes and no more: page, lifted, floating. A shadow says which
   plane a thing is on; it is not a texture. */
--plane1:0 1px 2px rgba(17,24,39,.04),0 1px 3px rgba(17,24,39,.06);
--plane2:0 2px 4px rgba(17,24,39,.04),0 12px 24px -8px rgba(17,24,39,.12);
--plane3:0 4px 8px rgba(17,24,39,.06),0 24px 48px -12px rgba(17,24,39,.18);
--chrome:rgba(255,255,255,.78);--chrome-edge:rgba(17,24,39,.08);
--spring:linear(0,.0438,.1419,.2604,.3801,.4909,.5883,.6712,.74,.7961,.8412,.8771,.9053,.9274,.9445,.9578,.968,.9758,.9817,.9862,.9896,.9922,.9942,.9956,.9967,.9976,.9982,.9987,.999);
--spring-bounce:linear(0,.039,.1324,.2525,.3805,.504,.6158,.7125,.7927,.8571,.9071,.9446,.9717,.9904,1.0026,1.01,1.0138,1.0151,1.0148,1.0136,1.0119,1.0099,1.008,1.0063,1.0048,1.0035,1.0024,1.0016,1.001);
--dur:588ms;--dur-snappy:441ms;--dur-bounce:540ms;--press:100ms;
}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){
--surface:#13171C;--text:#ECEFF3;
--bg:#0C0F12;--panel:var(--surface);--ink:var(--text);--muted:#9BA5B3;--line:#242B33;
--accent:#00BD7D;--accent-ink:#04231A;
--plane1:0 1px 2px rgba(0,0,0,.5);
--plane2:0 2px 4px rgba(0,0,0,.45),0 12px 24px -8px rgba(0,0,0,.6);
--plane3:0 4px 8px rgba(0,0,0,.5),0 24px 48px -12px rgba(0,0,0,.7);
--chrome:rgba(19,23,28,.78);--chrome-edge:rgba(255,255,255,.08)}}
:root[data-theme=dark]{
--surface:#13171C;--text:#ECEFF3;--bg:#0C0F12;--panel:var(--surface);--ink:var(--text);
--muted:#9BA5B3;--line:#242B33;--accent:#00BD7D;--accent-ink:#04231A;
--plane1:0 1px 2px rgba(0,0,0,.5);
--plane2:0 2px 4px rgba(0,0,0,.45),0 12px 24px -8px rgba(0,0,0,.6);
--plane3:0 4px 8px rgba(0,0,0,.5),0 24px 48px -12px rgba(0,0,0,.7);
--chrome:rgba(19,23,28,.78);--chrome-edge:rgba(255,255,255,.08)}
*{box-sizing:border-box}

/* ------------------------------------------------------------ typography
   Poppins for reading, Oswald for the one thing on the screen that should
   feel like a headline. Tracking is still size-specific: the display face
   tightens as it grows, body sits near zero, small caps open up.            */
html{font-size:100%}
body{margin:0;background:var(--bg);color:var(--ink);
font:var(--t3)/1.55 var(--sans);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
a{color:var(--ink);text-decoration:none}
a:hover{text-decoration:underline;text-underline-offset:.15em}
h1{font-family:var(--display);font-size:var(--t6);line-height:1.04;letter-spacing:-.01em;
font-weight:600;margin:var(--s6) 0 var(--s2);text-transform:none}
h2{font-family:var(--display);font-size:var(--t5);line-height:1.15;letter-spacing:-.005em;
font-weight:500;margin:var(--s6) 0 var(--s3)}
h3{font-size:var(--t4);line-height:1.3;letter-spacing:-.01em;font-weight:600;margin:0 0 var(--s1)}
h4{font-size:var(--t1);text-transform:uppercase;letter-spacing:.08em;color:var(--muted);
font-weight:600;margin:var(--s4) 0 var(--s1)}
p.lede{color:var(--muted);margin:0 0 var(--s5);max-width:62ch;font-size:var(--t3)}
code,.price{font-family:var(--mono);font-size:.9375em}

/* --------------------------------------------------------------- layout
   Mobile is the base case, not a breakpoint. Everything below is what a
   390px screen gets; wider screens get more room through min-width, never
   less through max-width.                                                   */
.wrap{max-width:72rem;margin:0 auto;padding:0 var(--s4) var(--s8)}
@media (min-width:48rem){.wrap{padding:0 var(--s5) var(--s8)}}

/* ----------------------------------------------------------- the chrome */
header.top{position:sticky;top:0;z-index:20;background:var(--chrome);
-webkit-backdrop-filter:blur(20px) saturate(180%);backdrop-filter:blur(20px) saturate(180%);
border-bottom:1px solid var(--chrome-edge);box-shadow:var(--plane1)}
header.top::after{content:"";position:absolute;left:0;right:0;top:100%;height:var(--s5);
background:linear-gradient(var(--bg),transparent);pointer-events:none}
header.top .wrap{display:flex;gap:var(--s2);align-items:center;padding:var(--s2) var(--s4);
flex-wrap:nowrap;min-width:0}
.brand{flex:none}
@media (min-width:48rem){header.top .wrap{gap:var(--s3)}}
.brand{display:inline-flex;align-items:center;gap:var(--s2);color:var(--ink);text-decoration:none;
min-height:2.75rem;padding:0 var(--s1);margin-left:calc(var(--s1) * -1);border-radius:var(--s2)}
.brand .logo{width:1.75rem;height:1.75rem;flex:none}
.brand b{font-family:var(--display);font-weight:600;letter-spacing:.01em;font-size:var(--t4)}
nav{display:flex;gap:var(--s1);margin-left:auto;align-items:center;flex-wrap:nowrap;min-width:0}
.menu{min-width:0}
nav a{display:inline-flex;align-items:center;justify-content:center;color:var(--muted);
min-width:2.75rem;min-height:2.75rem;border-radius:var(--s3);
transition:color var(--dur-snappy) var(--spring),background var(--dur-snappy) var(--spring)}
nav a:hover{color:var(--ink);background:color-mix(in oklab,var(--ink) 6%,transparent);text-decoration:none}
nav a:active{background:color-mix(in oklab,var(--ink) 12%,transparent)}
nav a[aria-current=page]{color:var(--accent-ink);background:var(--primary)}
/* On a phone the balance sits next to the Points icon that already goes to
   the same page, and together they are the 22px that pushed the bar off the
   screen. The number comes back as soon as there is room for it. */
.bal{display:none}
@media (min-width:26rem){.bal{display:inline-flex;align-items:center}}
.bal{font-family:var(--mono);font-size:var(--t2);color:var(--ink);
border:1px solid var(--line);border-radius:999px;padding:var(--s1) var(--s3);
font-variant-numeric:tabular-nums;min-width:auto;min-height:2rem}
.bal:hover{background:color-mix(in oklab,var(--primary) 16%,transparent);text-decoration:none}

/* ----------------------------------------------------------------- menu */
.menu{position:relative}
/* The label becomes the current section's name, which on a phone is the
   difference between a bar that fits and one that pushes the page sideways.
   It truncates; the full name is still the accessible one. */
.menu>summary{list-style:none;cursor:pointer;font-size:var(--t2);color:var(--muted);
min-height:2.75rem;display:inline-flex;align-items:center;padding:0 var(--s3);
border:1px solid var(--line);border-radius:999px;
max-width:7.5rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
transition:color var(--dur-snappy) var(--spring),background var(--dur-snappy) var(--spring)}
.menu>summary::-webkit-details-marker{display:none}
.menu>summary:hover,.menu[open]>summary{color:var(--ink);background:color-mix(in oklab,var(--ink) 6%,transparent)}
.menu>div{position:absolute;right:0;top:calc(100% + var(--s2));z-index:30;min-width:13rem;
background:var(--panel);border:1px solid var(--line);border-radius:var(--s4);
box-shadow:var(--plane3);padding:var(--s1);display:flex;flex-direction:column;gap:2px;
transform-origin:top right;animation:menu var(--dur-snappy) var(--spring) both}
@keyframes menu{from{opacity:0;transform:scale(.96) translateY(-.25rem)}to{opacity:1;transform:none}}
.menu .who{margin:var(--s1) var(--s2) var(--s2);font-size:var(--t1);color:var(--muted);
border-bottom:1px solid var(--line);padding-bottom:var(--s2)}
.menu>div a{color:var(--ink);font-size:var(--t2);padding:var(--s2) var(--s2);border-radius:var(--s2);
min-height:2.5rem;display:flex;align-items:center}
.menu>div a:hover{background:color-mix(in oklab,var(--ink) 6%,transparent);text-decoration:none}
.menu>div a[aria-current=page]{background:color-mix(in oklab,var(--primary) 18%,transparent);font-weight:600}
.menu>div form{margin-top:var(--s1);border-top:1px solid var(--line);padding-top:var(--s1)}
.menu>div .btn{width:100%;justify-content:flex-start}

/* ---------------------------------------------------------------- icons */
.ic{display:inline-flex;align-items:center;gap:var(--s2);position:relative}
.ic svg{width:1.25em;height:1.25em;flex:none;fill:none;stroke:currentColor;
stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}
.ic.only .lbl{position:absolute;width:1px;height:1px;margin:-1px;padding:0;
overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0}

/* --------------------------------------------------------------- search */
.search{display:flex;gap:var(--s2);margin:0 0 var(--s5)}
@media (min-width:48rem){.search{max-width:36rem}}
.search input{flex:1;min-width:0;background:var(--panel);color:var(--ink);
border:1px solid var(--line);border-radius:var(--s3);padding:var(--s3) var(--s4);
font:inherit;min-height:3rem;box-shadow:var(--plane1);
transition:border-color var(--dur-snappy) var(--spring),box-shadow var(--dur-snappy) var(--spring)}
.search input:focus{border-color:var(--primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--primary) 28%,transparent)}

/* ---------------------------------------------------------------- roles
   The shelf leads with jobs. A skills marketplace has to lead with topics
   because a skill is a part, not a hire; a worker is already the assembly, so
   this reads the way hiring does — pick the job, then pick which one. The
   blurb is there because a job title is not self-explanatory to somebody who
   has not hired for it before. */
.roles{display:grid;gap:var(--s3);margin:0 0 var(--s5);grid-template-columns:1fr}
@media (min-width:36rem){.roles{grid-template-columns:repeat(2,1fr)}}
@media (min-width:60rem){.roles{grid-template-columns:repeat(4,1fr)}}
.roles a{display:grid;grid-template-columns:auto 1fr auto;gap:var(--s2) var(--s3);
align-items:center;padding:var(--s4);border:1px solid var(--line);border-radius:var(--s4);
background:var(--panel);color:var(--ink);box-shadow:var(--plane1);
transition:transform var(--dur) var(--spring),box-shadow var(--dur) var(--spring),
border-color var(--dur-snappy) var(--spring)}
.roles a:hover{transform:translateY(-2px);box-shadow:var(--plane2);
border-color:color-mix(in oklab,var(--primary) 50%,var(--line));text-decoration:none}
.roles a:active{transform:scale(.99);transition:transform var(--press) ease-out}
.roles .ic svg{width:1.25rem;height:1.25rem;color:var(--primary)}
.roles b{font-size:var(--t3);font-weight:600;letter-spacing:-.01em}
.roles small{font-family:var(--mono);font-size:var(--t1);color:var(--muted);
border:1px solid var(--line);border-radius:999px;padding:1px var(--s2);
justify-self:end;white-space:nowrap}
.roles span{grid-column:1 / -1;font-size:var(--t1);color:var(--muted);line-height:1.45}

/* ----------------------------------------------------------- categories
   A horizontal rail on a phone, a grid once there is room. Scrolling
   sideways through categories is a choice; the page doing it is not.        */
.cats{display:flex;gap:var(--s2);margin:0 0 var(--s5);overflow-x:auto;
scroll-snap-type:x proximity;-webkit-overflow-scrolling:touch;
padding-bottom:var(--s1);scrollbar-width:none}
.cats::-webkit-scrollbar{display:none}
@media (min-width:48rem){.cats{display:grid;overflow:visible;
grid-template-columns:repeat(auto-fit,minmax(7rem,1fr))}}
.cats a{flex:0 0 auto;scroll-snap-align:start;min-width:6rem;
display:flex;flex-direction:column;align-items:center;gap:var(--s2);
padding:var(--s4) var(--s3);border:1px solid var(--line);border-radius:var(--s4);
background:var(--panel);color:var(--ink);text-align:center;box-shadow:var(--plane1);
transition:transform var(--dur) var(--spring),box-shadow var(--dur) var(--spring),
border-color var(--dur-snappy) var(--spring)}
.cats a:hover{transform:translateY(-2px);box-shadow:var(--plane2);
border-color:color-mix(in oklab,var(--primary) 50%,var(--line));text-decoration:none}
.cats a:active{transform:scale(.98);transition:transform var(--press) ease-out}
.cats .ic svg{width:1.5rem;height:1.5rem;stroke-width:1.5;color:var(--primary)}
.cats b{font-size:var(--t1);font-weight:600;text-transform:capitalize;letter-spacing:.01em}
.cats small{font-family:var(--mono);font-size:var(--t1);color:var(--muted)}

/* ------------------------------------------------------------- the shelf
   One column on a phone. The card is a plane lifting off the page, and it
   lifts further under a pointer — the depth is the hierarchy, not a
   decoration applied afterwards.                                            */
.grid{display:grid;gap:var(--s4);grid-template-columns:1fr}
@media (min-width:36rem){.grid{grid-template-columns:repeat(auto-fill,minmax(17rem,1fr))}}
.card{background:var(--panel);border:1px solid var(--line);border-radius:var(--s5);
padding:var(--s5);box-shadow:var(--plane1);display:flex;flex-direction:column;
transition:transform var(--dur) var(--spring),box-shadow var(--dur) var(--spring)}
.card>.row:last-child{margin-top:auto;padding-top:var(--s1)}
.gig{padding:0;overflow:hidden;text-decoration:none;color:inherit;position:relative}
.gig:hover{text-decoration:none;transform:translateY(-3px);box-shadow:var(--plane3)}
.gig:active{transform:translateY(-1px) scale(.995);transition:transform var(--press) ease-out}
.thumb{display:block;width:100%;height:auto;aspect-ratio:16/9;object-fit:cover;flex:none;
background:linear-gradient(135deg,hsl(var(--h,160) 46% 62%),hsl(calc(var(--h,160) + 42) 52% 46%))}
.gig .meta{padding:var(--s4);display:flex;flex-direction:column;flex:1;gap:var(--s2)}
.gig .who{display:flex;align-items:center;gap:var(--s2);margin:0;font-size:var(--t1);color:var(--muted)}
.av{width:1.5rem;height:1.5rem;border-radius:999px;flex:none;
background:hsl(var(--h) 44% 42%);color:#fff;font-size:var(--t1);font-weight:600;
display:inline-flex;align-items:center;justify-content:center}
.gig h3{margin:0;font-size:var(--t4);line-height:1.25}
.gig .line{margin:0;color:var(--muted);font-size:var(--t2);line-height:1.5}
.gig .foot{margin:auto 0 0;padding-top:var(--s3);display:flex;align-items:center;
justify-content:space-between;gap:var(--s3)}
.gig .proof{font-size:var(--t1);color:var(--muted)}
.gig .proof .ic svg{width:1rem;height:1rem}
.gig .proof.new{font-family:var(--mono);font-size:var(--t1);border:1px solid var(--line);
border-radius:999px;padding:2px var(--s2)}
.gig .price{font-family:var(--mono);font-size:var(--t4);font-weight:600;color:var(--ink);
font-variant-numeric:tabular-nums}
.gig .price small{font-size:var(--t1);color:var(--muted);font-weight:400}

/* -------------------------------------------------------------- controls */
.row{display:flex;gap:var(--s3);align-items:center;flex-wrap:wrap}
.spread{display:flex;justify-content:space-between;align-items:baseline;gap:var(--s3)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:var(--s2);
background:var(--primary);color:var(--accent-ink);border:0;border-radius:var(--s3);
padding:var(--s3) var(--s4);font:inherit;font-size:var(--t2);font-weight:600;
min-height:2.75rem;cursor:pointer;box-shadow:var(--plane1);
transition:transform var(--dur-snappy) var(--spring),box-shadow var(--dur-snappy) var(--spring),
filter var(--dur-snappy) var(--spring)}
.btn.ghost{background:transparent;color:var(--ink);border:1px solid var(--line);box-shadow:none}
.btn:hover{filter:brightness(1.05);box-shadow:var(--plane2);text-decoration:none}
.btn:active{transform:translateY(1px) scale(.97);box-shadow:var(--plane1);
transition:transform var(--press) ease-out}
.btn.ghost:active{background:color-mix(in oklab,var(--ink) 8%,transparent)}
:where(a,button,input,select,textarea,summary):focus-visible{
outline:2px solid var(--primary);outline-offset:2px;border-radius:var(--s1)}
.tag{display:inline-block;font-size:var(--t1);font-family:var(--mono);color:var(--muted);
border:1px solid var(--line);border-radius:999px;padding:2px var(--s2)}
textarea{width:100%;background:var(--panel);color:var(--ink);border:1px solid var(--line);
border-radius:var(--s3);padding:var(--s3);font:inherit;min-height:6rem;resize:vertical;
box-shadow:var(--plane1);transition:border-color var(--dur-snappy) var(--spring)}
textarea:focus{border-color:var(--primary)}
select,input[type=text],input[type=email],input[type=password],input[type=search],
input[type=number],input[type=url],input[type=tel]{
background:var(--panel);color:var(--ink);border:1px solid var(--line);
border-radius:var(--s3);padding:var(--s3);font:inherit;min-height:2.75rem;max-width:100%;
transition:border-color var(--dur-snappy) var(--spring)}
select:focus,input:focus{border-color:var(--primary)}
label:has(input[type=checkbox]),label:has(input[type=radio]){
min-height:2.5rem;display:inline-flex;align-items:center;gap:var(--s2)}
input[type=checkbox],input[type=radio]{width:1.125rem;height:1.125rem;accent-color:var(--primary)}
form.inline{display:inline}
td a,p a,.lede a,.fine a,li a{display:inline-block;padding:var(--s2) var(--s1);
margin:calc(var(--s2) * -1) calc(var(--s1) * -1);border-radius:var(--s1);
color:var(--ink);text-decoration:underline;text-decoration-color:color-mix(in oklab,var(--primary) 60%,transparent);
text-underline-offset:.2em}
td a:hover,p a:hover,.lede a:hover,li a:hover{background:color-mix(in oklab,var(--primary) 12%,transparent);
text-decoration:none}
td a:active,p a:active,li a:active{transform:scale(.97);transition:transform var(--press) ease-out}

/* ----------------------------------------------------------------- data */
.scroller{overflow-x:auto;overscroll-behavior-x:contain;margin:0 0 var(--s3);
-webkit-overflow-scrolling:touch}
.scroller table{min-width:32rem}
table{width:100%;border-collapse:collapse;font-size:var(--t2)}
th,td{text-align:left;padding:var(--s3);border-bottom:1px solid var(--line)}
th{color:var(--muted);font-weight:600;font-size:var(--t1);text-transform:uppercase;letter-spacing:.08em}
td.num,th.num{text-align:right;font-family:var(--mono);font-variant-numeric:tabular-nums}
.meters{display:grid;gap:var(--s3);grid-template-columns:repeat(2,1fr);margin:0 0 var(--s4)}
@media (min-width:48rem){.meters{grid-template-columns:repeat(auto-fit,minmax(9rem,1fr))}}
.meter{background:var(--panel);border:1px solid var(--line);border-radius:var(--s4);
padding:var(--s3) var(--s4);box-shadow:var(--plane1)}
.meter .k{font-size:var(--t1);color:var(--muted);display:flex;align-items:center}
.meter .k .ic svg{width:1rem;height:1rem;opacity:.75}
.meter .v{font-family:var(--mono);font-size:var(--t4);font-variant-numeric:tabular-nums;
margin-top:var(--s1);letter-spacing:-.01em}
.bar{height:6px;background:var(--line);border-radius:99px;overflow:hidden;margin-top:var(--s2)}
.bar>i{display:block;height:100%;background:var(--primary);width:100%;transform-origin:left center;
transform:scaleX(0);transition:transform var(--dur) var(--spring)}

/* Opened deliberately: attaching a repository is a decision, and a token field
   should not sit open on a page by default. */
.repo{margin-top:var(--s4);border:1px solid var(--line);border-radius:var(--s3);
padding:var(--s3) var(--s4);background:var(--panel)}
.repo>summary{cursor:pointer;font-size:var(--t2);font-weight:600;min-height:2.25rem;
display:flex;align-items:center;list-style:none}
.repo>summary::-webkit-details-marker{display:none}
.repo>summary::before{content:"+";font-family:var(--mono);margin-right:var(--s2);color:var(--primary)}
.repo[open]>summary::before{content:"\u2212"}
.repo .fine{font-size:var(--t1);color:var(--muted);margin:var(--s3) 0 0;line-height:1.5;max-width:62ch}

/* ---------------------------------------------------------------- usage */
.ctx{background:var(--panel);border:1px solid var(--line);border-radius:var(--s5);
padding:var(--s4);box-shadow:var(--plane1);margin:0 0 var(--s4)}
.ctx .top{display:flex;justify-content:space-between;align-items:baseline;gap:var(--s3);flex-wrap:wrap}
.ctx .pct{font-family:var(--mono);font-variant-numeric:tabular-nums;color:var(--muted);font-size:var(--t2)}
.ctxbar{display:flex;height:8px;border-radius:99px;overflow:hidden;background:var(--line);margin:var(--s3) 0 var(--s2)}
.ctxbar span{display:block;height:100%;transition:flex-basis var(--dur) var(--spring)}
.s-sys{background:var(--primary)}
.s-talk{background:color-mix(in oklab,var(--primary) 42%,var(--muted))}
.ctxlist{list-style:none;margin:var(--s3) 0 0;padding:0;display:grid;gap:var(--s2)}
.ctxlist li{display:flex;align-items:center;gap:var(--s2);font-size:var(--t2)}
.ctxlist .sw{width:8px;height:8px;border-radius:2px;flex:none}
.ctxlist .nm{flex:1;min-width:0}
.ctxlist .amt{font-family:var(--mono);font-variant-numeric:tabular-nums}
.ctxlist .pc{font-family:var(--mono);font-variant-numeric:tabular-nums;color:var(--muted);
min-width:3.5rem;text-align:right}
.chips{display:flex;flex-wrap:wrap;gap:var(--s2);margin:var(--s2) 0 0}
.chips .tag b{font-weight:600;color:var(--ink)}
.ctx .fine{font-size:var(--t1);color:var(--muted);margin:var(--s3) 0 0;line-height:1.5}

/* ---------------------------------------------------------------- trace */
#trace{background:var(--panel);border:1px solid var(--line);border-radius:var(--s5);
padding:var(--s1) 0;max-height:60vh;overflow:auto;box-shadow:var(--plane1);
overscroll-behavior:contain}
.ev{padding:var(--s2) var(--s4);border-bottom:1px solid var(--line);font-size:var(--t2);
animation:arrive var(--dur-snappy) var(--spring) both}
.ev:last-child{border-bottom:0}
.ev .k{font-family:var(--mono);font-size:var(--t1);color:var(--muted);letter-spacing:.06em}
.ev pre{margin:var(--s1) 0 0;white-space:pre-wrap;word-break:break-word;font:inherit;line-height:1.5}
.ev.say{padding:var(--s4);font-size:var(--t3);line-height:1.55}
.ev.say .k{font-family:var(--sans);font-size:var(--t2);letter-spacing:0;font-weight:600;color:var(--ink)}
.ev.say.from-agent .k{color:var(--primary)}
.ev.say pre{margin-top:var(--s2)}
.ev.sys{padding:var(--s1) var(--s4);font-size:var(--t1);color:var(--muted)}
.ev.sys pre{color:var(--muted)}
#trace.conversation .ev.sys{display:none}
.tracebar{display:flex;gap:var(--s3);align-items:center;justify-content:space-between;
margin:0 0 var(--s2);flex-wrap:wrap}
.tracebar label{font-size:var(--t2);color:var(--muted);display:flex;gap:var(--s2);
align-items:center;cursor:pointer}
.ev.user{background:color-mix(in oklab,var(--primary) 7%,transparent)}
.ev.meter .k{color:var(--success)}
.ev.err .k{color:var(--danger)}
.ev.warnrow .k{color:var(--warning)}
@keyframes arrive{from{opacity:0;transform:translateY(var(--s2))}to{opacity:1;transform:none}}

/* ---------------------------------------------------------------- notes */
.note{border-left:3px solid var(--warning);background:color-mix(in oklab,var(--warning) 10%,transparent);
padding:var(--s3) var(--s4);border-radius:0 var(--s3) var(--s3) 0;font-size:var(--t2);
margin:0 0 var(--s4);line-height:1.5}
.note.bad{border-color:var(--danger);background:color-mix(in oklab,var(--danger) 10%,transparent)}
footer{color:var(--muted);font-size:var(--t1);margin-top:var(--s7);
border-top:1px solid var(--line);padding-top:var(--s4)}
footer details summary{list-style:none;cursor:pointer;color:var(--muted);
display:inline-flex;min-height:2.5rem;align-items:center}
footer details summary::-webkit-details-marker{display:none}
footer details p{margin:var(--s2) 0 0}

/* -------------------------------------------------------- accommodations */
@media (prefers-reduced-motion:reduce){
*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;
transition-duration:.01ms!important;scroll-behavior:auto!important}
.ev{animation:fade 160ms ease both}
@keyframes fade{from{opacity:0}to{opacity:1}}
.card:hover,.gig:hover,.cats a:hover{transform:none}
.btn:active{transform:none;filter:brightness(.92)}}
@media (prefers-reduced-transparency:reduce){
header.top{background:var(--panel);-webkit-backdrop-filter:none;backdrop-filter:none}}
@media (prefers-contrast:more){
:root{--muted:#2B3340;--line:#6B7280}
header.top{background:var(--panel);-webkit-backdrop-filter:none;backdrop-filter:none}
.card,.meter,#trace,.ctx,.cats a{border-width:2px;box-shadow:none}
.tag,.btn.ghost{border-width:2px}}
`;

/**
 * Put every table in a box that can scroll on its own.
 *
 * Done here rather than at seventeen call sites, so a table written tomorrow
 * is covered without anybody remembering to wrap it. The page is the thing
 * that must not slide sideways under a thumb; a table that does is fine.
 */
const scrollable = (html: string): string =>
  html.replace(/<table>/g, '<div class="scroller"><table>').replace(/<\/table>/g, "</table></div>");


/**
 * One stroke weight, one grid, drawn not downloaded.
 *
 * Icons carry a name every time. An icon alone is a guess the viewer has to
 * make, so the label is always in the markup — shown where there is room,
 * read aloud where there is not, and surfaced as a tooltip on hover. Hiding
 * the word is a layout decision; removing it is an accessibility bug.
 */
const ICONS: Record<string, string> = {
  catalog: '<path d="M3 7h7v7H3zM14 7h7v7h-7zM3 17h7v4H3zM14 17h7v4h-7z"/>',
  runs: '<path d="M3 12h4l3 8 4-16 3 8h4"/>',
  points: '<circle cx="12" cy="12" r="8"/><path d="M12 8v8M9.5 10.5h5M9.5 13.5h5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  download: '<path d="M12 4v11M8 11l4 4 4-4M5 20h14"/>',
  trash: '<path d="M4 7h16M10 7V5h4v2M6 7l1 13h10l1-13"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  send: '<path d="M4 12l16-8-6 16-2-6-8-2z"/>',
  trace: '<path d="M4 6h16M4 12h10M4 18h7"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  tokens: '<path d="M4 8h16M4 16h16M9 4v16M15 4v16"/>',
  cost: '<path d="M12 4v16M8 8a3 3 0 013-3h2a3 3 0 010 6h-2a3 3 0 000 6h2a3 3 0 003-3"/>',
  file: '<path d="M6 3h8l4 4v14H6zM14 3v4h4"/>',
  info: '<circle cx="12" cy="12" r="8"/><path d="M12 11v5M12 8h.01"/>',
  warn: '<path d="M12 4l9 16H3zM12 10v4M12 17h.01"/>',
  check: '<path d="M4 12l5 5L20 6"/>',
};

/** An icon with its name beside it; `only` hides the word but keeps it readable. */
export function icon(name: string, label: string, only = false): string {
  const d = ICONS[name] ?? ICONS["info"]!;
  return `<span class="ic${only ? " only" : ""}"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${d}</svg>`
    + `<span class="lbl">${esc(label)}</span></span>`;
}

/** The mark. Two arcs and a dot: a worker, and the thing it is working on. */
const LOGO = `<svg class="logo" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
<rect width="32" height="32" rx="8" fill="var(--accent)"/>
<circle cx="16" cy="16" r="7.5" fill="none" stroke="var(--accent-ink)" stroke-width="2.25" opacity=".55"/>
<circle cx="16" cy="16" r="3" fill="var(--accent-ink)"/>
<path d="M16 4.5v4M16 23.5v4" stroke="var(--accent-ink)" stroke-width="2.25" stroke-linecap="round"/>
</svg>`;

export type Viewer = { name: string; email: string; role: string; orgName: string } | null;

export function layout(
  title: string, body: string,
  opts: { balance?: number; viewer?: Viewer } = {},
): string {
  const v = opts.viewer;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" href="/favicon.ico" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600&family=Oswald:wght@500;600&family=JetBrains+Mono:wght@400;500&display=swap">
<title>${esc(title)} · agents.alphaceo.ai</title><style>${CSS}</style></head><body>
<header class="top"><div class="wrap">
<a class="brand" href="/" aria-label="agents.alphaceo.ai, home">${LOGO}<b>agents</b></a>
<nav>
  ${v ? `<a href="/" title="Catalog">${icon("catalog", "Catalog", true)}</a>
  <a href="/runs" title="Runs">${icon("runs", "Runs", true)}</a>
  <a href="/ledger" title="Points">${icon("points", "Points", true)}</a>
  ${opts.balance !== undefined ? `<a class="bal" href="/ledger" title="${esc(pts(opts.balance))} left">${esc(pts(opts.balance).replace(" points", "").replace(" point", ""))}</a>` : ""}
  <details class="menu"><summary>${esc(v.name)}</summary><div>
    <p class="who" title="${esc(v.email)}">${esc(v.orgName)}${v.role === "owner" ? " · owner" : ""}</p>
    <a href="/authors">Authoring</a><a href="/schedules">Schedules</a><a href="/purchases">Purchases</a>
    <a href="/tokens">MCP</a><a href="/team">Team</a>${v.role === "owner" ? `<a href="/payouts">Payouts</a><a href="/settings">Limits</a>` : ""}
    <form method="post" action="/logout"><button class="btn ghost">Sign out</button></form>
  </div></details>`
  : `<a href="/login">Sign in</a><a href="/signup">Create an account</a>`}
</nav></div></header>
<script>
// Where am I — marked here rather than threaded through every page's call,
// and it degrades to the plain nav if this never runs.
(function(){var p=location.pathname;
// A pack page is part of the catalog and a run page part of Runs: the section
// a screen belongs to is not always the prefix of its URL.
var SECTION={'/packs':'/','/runs':'/runs','/invite':'/'};
for(var k in SECTION){if(p.indexOf(k+'/')===0){p=SECTION[k];break;}}
var best=null;
for(var a of document.querySelectorAll('nav a')){var h=a.getAttribute('href');
if(h===p||(h!=='/'&&p.indexOf(h)===0)){if(!best||h.length>best.getAttribute('href').length)best=a;}}
if(best){best.setAttribute('aria-current','page');
// A section hidden inside the menu still has to answer "where am I".
var d=best.closest('details.menu');
if(d)d.querySelector('summary').textContent=best.textContent;}})();
</script>
<div class="wrap">${scrollable(body)}
<footer><details><summary aria-label="About this platform">${icon("info", "About", true)}</summary>
<p>Runs on Anthropic Managed Agents. Seed packs are placeholder text, not an expert's work.</p></details></footer>
</div></body></html>`;
}


/**
 * An author's face, drawn from their name.
 *
 * A marketplace card needs a person on it, and the alternative to initials is
 * a stock photograph of somebody who did not write the pack. The hue is taken
 * from the name so the same author is the same colour everywhere, which is
 * what makes it recognisable rather than decorative.
 */
export function avatar(name: string): string {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] ?? "").join("").toUpperCase() || "?";
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `<span class="av" style="--h:${h}" aria-hidden="true">${esc(initials)}</span>`;
}

/**
 * A mark per category, with a shrug for tags we have not drawn yet.
 *
 * Categories come from what authors tag, so the list is open-ended and this
 * table will always be behind it. Falling back to a generic mark keeps a new
 * category usable the day it appears instead of waiting on an icon.
 */
const CATEGORY_ICON: Record<string, string> = {
  marketing: "runs", strategy: "trace", growth: "runs",
  video: "file", media: "file", production: "clock",
  support: "info", operations: "catalog", triage: "warn",
  research: "search", quality: "check", engineering: "tokens",
  sales: "cost", design: "file", writing: "trace", data: "tokens",
  "web design": "catalog", "app design": "file",
};

/**
 * Where a pack's hero image lives.
 *
 * A bare filename is ours, served from /assets. Anything with a scheme is an
 * author's own URL on their own storage, and is passed through — only over
 * https, because a card is not worth mixed content on every page it appears.
 */
export function heroSrc(image: string): string {
  if (/^https:\/\//i.test(image)) return image;
  if (/^[a-z][a-z0-9+.-]*:/i.test(image)) return "";  // any other scheme: refuse
  return `/assets/${image.replace(/^\/+/, "")}`;
}

/** A band of colour per pack, so a card is recognisable before it is read. */
export function thumb(slug: string): string {
  let h = 0;
  for (const ch of slug) h = (h * 17 + ch.charCodeAt(0)) % 360;
  return `<div class="thumb" style="--h:${h}" aria-hidden="true"></div>`;
}

export function catalogPage(
  packs: Array<PackRow & { published: boolean; owned: boolean; pricePoints: number;
    stats: { runs: number; buyers: number; version: number } }>,
  balance: number, viewer: Viewer = null, query = "",
  cats: Array<{ tag: string; count: number }> = [],
  roles: Array<{ id: string; name: string; blurb: string; icon: string; count: number }> = [],
): string {
  // Name, face, one line, price. Everything else is on the pack's own page.
  const cards = packs.map((p) => `<a class="card gig" href="/packs/${esc(p.slug)}">
  ${p.image
    ? `<img class="thumb" src="${esc(heroSrc(p.image))}" alt="" loading="lazy" decoding="async" width="640" height="480">`
    : thumb(p.slug)}
  <div class="meta">
    <p class="who">${avatar(p.author)}<span>${esc(p.author.split(" — ")[0] ?? p.author)}</span></p>
    <h3>${esc(p.name)}</h3>
    <p class="line">${esc(p.tagline)}</p>
    <p class="foot">
      ${p.stats.runs > 0
        ? `<span class="proof" title="${p.stats.runs} runs, ${p.stats.buyers} buyers">${icon("runs", `${p.stats.runs} runs`)}</span>`
        : `<span class="proof new">new</span>`}
      <span class="price">${p.pricePoints === 0 ? "free" : `${p.pricePoints.toLocaleString("en-US")}<small> pts</small>`}</span>
    </p>
  </div></a>`).join("");
  const found = packs.length;
  return layout("Catalog", `<h1>Hire a worker</h1>
<p class="lede">Buy once. It runs here. You see what every run cost.</p>
<form method="get" action="/" class="search" role="search">
  <input type="search" name="q" value="${esc(query)}" autofocus
         placeholder="Search by what you need done, or who wrote it" aria-label="Search packs">
  <button class="btn" type="submit" title="Search">${icon("search", "Search", true)}</button>
  ${query ? `<a class="btn ghost" href="/" title="Clear the search">${icon("stop", "Clear", true)}</a>` : ""}
</form>
${(() => {
  // Two levels, and only ever one of them on screen. At the root you are
  // choosing a job; inside a job you are choosing which one, and the topics
  // that were the whole taxonomy a moment ago are the specialisation now.
  const inRole = roles.find((r) => r.id === query.trim().toLowerCase());
  if (!query && roles.length) {
    return `<nav class="roles" aria-label="Roles">
  ${roles.map((r) => `<a href="/?q=${encodeURIComponent(r.id)}">
    ${icon(r.icon, r.name, true)}
    <b>${esc(r.name)}</b><small>${r.count}</small>
    <span>${esc(r.blurb)}</span></a>`).join("")}
</nav>`;
  }
  if (inRole && cats.length) {
    const shown = cats.slice(0, 10);
    const counts = shown.some((c) => c.count > 1);
    return `<nav class="cats" aria-label="Within ${esc(inRole.name)}">
  ${shown.map((c) => `<a href="/?q=${encodeURIComponent(c.tag)}">
    ${icon(CATEGORY_ICON[c.tag] ?? "catalog", c.tag, true)}
    <b>${esc(c.tag)}</b>${counts ? `<small>${c.count}</small>` : ""}</a>`).join("")}
</nav>`;
  }
  return "";
})()}
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
  <span class="tag">${p.price_points === 0 ? "free" : esc(pts(p.price_points * 1000))} one-off</span>
  ${p.upgrade_points > 0 ? `<span class="tag">updates ${p.upgrade_points} pts</span>` : ""}
  <span class="tag">default ${esc(p.model)}</span>
  ${v ? `<span class="tag">v${v.version}</span>` : `<span class="tag">unpublished</span>`}
</div>
<div class="note">You see everything it does, never how it was told to do it.${isAuthor ? " Except you — you wrote it." : ""}</div>
${v ? `
<h2>${owned ? "Start a run" : "Acquire and run"}</h2>
<form method="post" action="${owned ? "/runs" : `/packs/${esc(p.slug)}/acquire`}">
  <input type="hidden" name="packVersionId" value="${esc(v.id)}">
  <div class="row">
    <label>Model <select name="model">${choices.map((m) => `<option value="${esc(m)}"${m === p.model ? " selected" : ""}>${esc(m)}</option>`).join("")}</select></label>
    <button class="btn" type="submit">${owned ? "Start a run" : p.price_points === 0 ? "Get it free and run" : `Buy for ${pts(p.price_points * 1000)} and run`}</button>
  </div>
  <details class="repo">
    <summary>Give it a repository to read</summary>
    <div class="row" style="margin-top:.75rem">
      <label>Repository <input type="url" name="repoUrl" placeholder="https://github.com/owner/repo" size="30"></label>
    </div>
    <div class="row" style="margin-top:.5rem">
      <label>Token <input type="password" name="repoToken" placeholder="ghp_… only for a private repo" size="26" autocomplete="off"></label>
    </div>
    <p class="fine">Cloned to <code>/workspace/repo</code> in the sandbox, where the worker reads it,
    runs its tests and edits it, on the default branch. Nothing reaches your own repository.
    <strong>We never store the token.</strong> It starts the session and is then forgotten — the run
    records the URL, not the credential. Revoke it at GitHub when you are done; that is
    the only guarantee worth having. Leave blank for a public repo.</p>
  </details>
  ${pinned.length ? `<p class="lede" style="margin-top:10px;font-size:14px">The author restricted this pack to ${esc(pinned.join(", "))} — every extraction refusal measured came from Opus, and a weaker model may just comply.</p>` : ""}
</form>
${!owned && trial ? (trial.used
  ? `<p class="lede" style="margin-top:14px;font-size:14px">You have already used your trial of this pack.</p>`
  : `<h2>Or try it first</h2>
<p class="lede" style="font-size:14px">${trial.turns} turns, ${esc(pts(trial.budgetCents))}, your own brief. You keep the output.</p>
<form method="post" action="/packs/${esc(p.slug)}/trial">
  <button class="btn ghost" type="submit">Try it — ${trial.turns} turns</button>
</form>`) : ""}` : `<form method="post" action="/packs/${esc(p.slug)}/publish"><button class="btn" type="submit">Publish to the runtime</button></form>`}
${owned ? `<h2>Take it with you</h2>
<p class="lede" style="font-size:14px">An agent definition <code>ant apply</code> takes directly. The author's instructions are inside it.</p>
<p><a class="btn ghost" href="/packs/${esc(p.slug)}/export" title="Download ${esc(p.slug)}.md">${icon("download", `Download ${p.slug}.md`)}</a></p>` : ""}
`, { balance, viewer });
}

export function runsPage(runs: Array<RunRow & { pack: string }>, balance: number, viewer: Viewer = null): string {
  return layout("Runs", `<h1>Runs</h1>
<p class="lede">Every run, and what it cost.</p>
<table><tr><th>Started</th><th>Pack</th><th>Model</th><th>Status</th><th class="num">In</th><th class="num">Out</th><th class="num">Active</th><th class="num">Cost</th><th></th></tr>
${runs.map((r) => `<tr>
<td>${esc(r.started_at.slice(5, 16).replace("T", " "))}</td>
<td>${esc(r.pack)}</td><td><span class="tag">${esc(r.model)}</span></td>
<td>${esc(r.stop_reason ?? r.status)}</td>
<td class="num">${r.input_tokens}</td><td class="num">${r.output_tokens}</td>
<td class="num">${r.active_seconds.toFixed(1)}s</td><td class="num">${esc(pts(r.list_cost_cents))}</td>
<td><a href="/runs/${esc(r.id)}" title="Open the trace">${icon("trace", "Trace", true)}</a></td></tr>`).join("") || `<tr><td colspan="9">No runs yet.</td></tr>`}
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
  trial: { turns: number; slug: string; pricePoints: number } | null = null,
  outputs: Array<{ file_id: string; filename: string; size_bytes: number }> = [],
  usage: RunUsageView | null = null,
  retentionDays = 0,
): string {
  return layout(`Run · ${packName}`, `
<h1>${esc(packName)}</h1>
<p class="lede"> <span class="tag">${esc(run.model)}</span> <span class="tag">session ${esc(run.session_id.slice(0, 18))}</span>${run.is_trial ? ` <span class="tag" style="color:var(--warn)">trial</span>` : ""}</p>
${run.is_trial && trial ? `<div class="note">
  <strong>This is a trial</strong> — ${Math.max(0, trial.turns - run.turn_count)} of ${trial.turns} turns left, capped at ${esc(pts(run.budget_cents))}.
  ${run.turn_count >= trial.turns ? `The trial is used up.` : ""}
  <form method="post" action="/packs/${esc(trial.slug)}/acquire" class="inline">
    <button class="btn" style="margin-left:10px">Buy it for ${esc(pts(trial.pricePoints * 1000))} and keep going</button></form>
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
  <div class="meter"><div class="k">${icon("cost", "Cost so far")}</div><div class="v" id="m-cost">${esc(pts(run.list_cost_cents))}</div>
    <div class="bar"><i id="m-bar" style="transform:scaleX(${Math.min(1, run.list_cost_cents / Math.max(1, run.budget_cents)).toFixed(4)})"></i></div></div>
  <div class="meter"><div class="k">${icon("points", "Budget")}</div><div class="v">${esc(pts(run.budget_cents))}</div></div>
  <div class="meter"><div class="k">${icon("tokens", "In")}</div><div class="v" id="m-in">${run.input_tokens}</div></div>
  <div class="meter"><div class="k">${icon("tokens", "Out")}</div><div class="v" id="m-out">${run.output_tokens}</div></div>
  <div class="meter"><div class="k">${icon("clock", "Active")}</div><div class="v" id="m-sec">${run.active_seconds.toFixed(1)}s</div></div>
  <div class="meter"><div class="k">${icon("check", "Billed")}</div><div class="v" id="m-billed">${esc(pts(run.billed_cents))}</div></div>
</div>
<form method="post" action="/runs/${esc(run.id)}/message">
  <textarea name="text" placeholder="Give the worker a brief…" required></textarea>
  <div class="row" style="margin-top:10px">
    <button class="btn" type="submit" title="Send">${icon("send", "Send")}</button>
    <form method="post" action="/runs/${esc(run.id)}/end" class="inline"><button class="btn ghost" title="End run">${icon("stop", "End run", true)}</button></form>
    <span class="tag" id="live">connecting…</span>
  </div>
</form>
${outputs.length ? `<h2>What it produced</h2>
<p class="lede" style="font-size:14px">Yours to keep.</p>
<table><tr><th>File</th><th class="num">Size</th><th></th></tr>
${outputs.map((o) => `<tr><td><a href="/runs/${esc(run.id)}/outputs/${esc(o.file_id)}">${esc(o.filename)}</a></td>
<td class="num">${(o.size_bytes / 1024).toFixed(1)} KB</td>
<td><a href="/runs/${esc(run.id)}/outputs/${esc(o.file_id)}" download>download</a></td></tr>`).join("")}
</table>` : ""}
${usage ? `<h2>Where the context and the money went</h2>${usagePanel(usage)}` : ""}
${run.transcript_purged_at
  ? `<div class="note"><strong>This transcript has been deleted.</strong>
     Removed here and at the provider on ${esc(run.transcript_purged_at.slice(0, 10))}.
     What it cost is kept — that is a billing record — but what was said is gone.</div>`
  : `<h2>Keeping this transcript</h2>
     <p class="lede" style="font-size:.875rem">Deleted ${retentionDays > 0 ? `${retentionDays} days after a run finishes` : "only when you ask"}, here and at the provider. The cost record survives.</p>
     <form method="post" action="/runs/${esc(run.id)}/forget"
           onsubmit="return confirm('Delete this transcript here and at the provider? This cannot be undone.')">
       <button class="btn ghost" type="submit" title="Delete this transcript">${icon("trash", "Delete this transcript")}</button>
     </form>`}
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
    else if (e.kind === 'run.metered') body = 'charged ' + (p.points_millipoints/1000).toFixed(3) + ' points (+' + (p.delta_millipoints/1000).toFixed(3) + ') · in ' + p.input_tokens + ' · out ' + p.output_tokens + ' · ' + p.active_seconds.toFixed(1) + 's · cost us $' + (p.list_cost_cents/100).toFixed(2) + ' · author earned ' + (p.author_millicents/1000).toFixed(3) + ' points';
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

export function ledgerPage(rows: Array<{ bucket: string; delta_millipoints: number; reason: string; created_at: string; run_id: string | null }>,
  buckets: Record<string, number>, balance: number, viewer: Viewer = null): string {
  return layout("Points", `<h1>Points</h1>
<p class="lede">120 points is 5M in / 1M out on Personal. The grant expires; top-ups and earnings don't.</p>
<div class="meters">
  <div class="meter"><div class="k">Balance</div><div class="v">${esc(pts(balance))}</div></div>
  <div class="meter"><div class="k">Grant (expires)</div><div class="v">${esc(pts(buckets["grant"] ?? 0))}</div></div>
  <div class="meter"><div class="k">Top-ups</div><div class="v">${esc(pts(buckets["topup"] ?? 0))}</div></div>
  <div class="meter"><div class="k">Earnings</div><div class="v">${esc(pts(buckets["earning"] ?? 0))}</div></div>
</div>
<form method="post" action="/ledger/topup"><div class="row">
  <label>Buy points <input type="text" name="cents" value="500" size="6"></label>
  <button class="btn">Add top-up</button></div></form>
<h2>Every movement</h2>
<table><tr><th>When</th><th>Bucket</th><th>Reason</th><th class="num">Change</th></tr>
${rows.map((r) => `<tr><td>${esc(r.created_at.slice(5, 16).replace("T", " "))}</td><td><span class="tag">${esc(r.bucket)}</span></td>
<td>${esc(r.reason)}${r.run_id ? ` <a href="/runs/${esc(r.run_id)}">trace</a>` : ""}</td>
<td class="num" style="color:${r.delta_millipoints < 0 ? "var(--bad)" : "var(--good)"}">${r.delta_millipoints < 0 ? "−" : "+"}${esc(pts(Math.abs(r.delta_millipoints)))}</td></tr>`).join("")}
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
  <td class="num">${esc(pts(m.cost_cents))}</td>
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
<td class="num">${esc(pts(r.cost_cents))}</td>
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
<p class="lede">The catalog is an MCP server. Add one endpoint to the agent you already run.</p>

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
Reading only — buying and running still need the browser.</p>

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
    <label>Price <input type="text" name="pricePoints" value="${p?.price_points ?? 0}" size="7"> <span class="tag">cents, 0 = free</span></label>
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
  queue: Array<{ slug: string; name: string; author: string; tagline: string; price_points: number }>;
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
  <td>${esc(q.author)}</td><td class="num">${esc(pts(q.price_points * 1000))}</td>
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
