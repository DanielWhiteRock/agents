import { fmt, fmtMilli, pts } from "../billing/points.js";
import { ROLES } from "./roles.js";
import type { PackRow, PackVersionRow, RunRow } from "./platform.js";
import { faqRemovedBy, listingToForm, type DraftAuthor, type Listing } from "../packs/listing-shape.js";
import type { CreatorRow } from "./creators.js";
import type { Rating } from "./social.js";
import type { InboxThread, MyThread } from "./messages.js";

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
/* The signed-out pair are words, not marks, so they need their own box and
   their own breathing room. */
nav a.plain{min-width:auto;padding:0 var(--s3);font-size:var(--t2)}
nav .btn{min-height:2.25rem;padding:var(--s2) var(--s4);white-space:nowrap}
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
max-width:min(7.5rem,100%);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
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

/* ---------------------------------------------------------- breadcrumb
   A nav landmark, so it has to undo what the chrome's own nav rules do to
   one: no auto margin pushing it right, and links sized as text rather than as
   44px tap targets, because a breadcrumb is a sentence you read before it is
   a control you press.                                                      */
.crumbs{display:flex;flex-wrap:wrap;align-items:center;gap:var(--s2);
margin:var(--s5) 0 0;font-size:var(--t1);color:var(--muted)}
.crumbs a{display:inline-flex;align-items:center;min-width:0;min-height:2rem;
padding:0 var(--s1);margin:0 calc(var(--s1) * -1);border-radius:var(--s1);color:var(--muted)}
.crumbs a:hover{color:var(--ink);background:none;text-decoration:underline}
.crumbs [aria-current=page]{color:var(--ink)}

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
.tag{display:inline-flex;align-items:center;min-height:2rem;font-size:var(--t1);
font-family:var(--mono);color:var(--muted);vertical-align:middle;
border:1px solid var(--line);border-radius:999px;padding:0 var(--s2)}
a.tag{color:var(--ink);text-decoration:none;
transition:background var(--dur-snappy) var(--spring)}
a.tag:hover{background:color-mix(in oklab,var(--ink) 6%,transparent);text-decoration:none}
a.tag:active{transform:scale(.97);transition:transform var(--press) ease-out}
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
/* A file manifest holds paths longer than a phone is wide, and the page is
   the thing that must not slide sideways. The path breaks; the page does not. */
.chips.paths .tag{max-width:100%;word-break:break-all}
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

/* ----------------------------------------------------------- front page
   The only page a visitor sees before they have an account, so it is the
   only page allowed to be wide, full-bleed and loud. Mobile is still the
   base case: the film is a poster until there is a screen worth 257KB.   */
.wrap.wide{max-width:84rem;padding-left:0;padding-right:0}
.wrap.wide>section{padding-left:var(--s4);padding-right:var(--s4)}
@media (min-width:48rem){.wrap.wide>section{padding-left:var(--s6);padding-right:var(--s6)}}
.wrap.wide section{margin:0 0 var(--s7)}
@media (min-width:48rem){.wrap.wide section{margin:0 0 var(--s8)}}

.hero{position:relative;overflow:hidden;border-radius:0;background:#0A0E0C;
padding:var(--s6) var(--s4) var(--s7);isolation:isolate}
@media (min-width:48rem){.hero{padding:var(--s8) var(--s6);border-radius:var(--s5);margin-top:var(--s4)}}
/* The film is decoration; the poster is the real content. Only one of them
   is ever on screen, decided by the viewport and by whether the reader asked
   for motion at all. */
.heroFilm,.heroStill{position:absolute;inset:0;width:100%;height:100%;
object-fit:cover;z-index:-2}
.heroFilm{display:none}
@media (min-width:48rem){.heroFilm{display:block}.heroStill{display:none}}
.hero::after{content:"";position:absolute;inset:0;z-index:-1;
background:linear-gradient(100deg,rgba(10,14,12,.92) 0%,rgba(10,14,12,.78) 42%,rgba(10,14,12,.28) 100%)}
.heroInk{max-width:42rem;color:#fff}
.heroInk h1{color:#fff;margin-top:0;font-size:clamp(2rem,1.2rem+4vw,3.5rem);line-height:1.02}
.heroInk .lede{color:rgba(255,255,255,.88);max-width:34rem}
.heroInk .fine{color:rgba(255,255,255,.66);font-size:var(--t1);margin:var(--s2) 0 0;max-width:34rem}

/* ---------------------------------------------------------------- funnel
   A sentence, not a form. It is the first thing on the page that does
   anything, and it answers before it asks for an account.                */
.funnel{margin:var(--s5) 0 0}
.funnel label{display:block;font-size:var(--t2);font-weight:600;color:#fff;margin:0 0 var(--s2)}
.funnel .row{gap:var(--s2);flex-wrap:nowrap}
.funnel input{flex:1;min-width:0;background:rgba(255,255,255,.96);color:var(--text);
border:1px solid transparent;border-radius:var(--s3);padding:var(--s3) var(--s4);
font:inherit;font-size:var(--t3);min-height:3.25rem;
box-shadow:0 10px 30px -12px rgba(0,0,0,.5)}
.funnel input::placeholder{color:#6B7280}
.funnel input:focus{outline:none;border-color:var(--primary);
box-shadow:0 0 0 3px color-mix(in oklab,var(--primary) 45%,transparent)}
.funnel .btn{min-height:3.25rem;padding-left:var(--s5);padding-right:var(--s5);flex:none}

/* --------------------------------------------------------------- results */
.found{scroll-margin-top:5rem}
.found .grid{margin-bottom:var(--s5)}

/* ----------------------------------------------------------------- stats */
.stats{list-style:none;margin:0 0 var(--s5);padding:0;display:grid;gap:var(--s3);
grid-template-columns:repeat(2,1fr)}
@media (min-width:48rem){.stats{grid-template-columns:repeat(5,1fr)}}
.stats li{background:var(--panel);border:1px solid var(--line);border-radius:var(--s4);
padding:var(--s4);box-shadow:var(--plane1);display:flex;flex-direction:column;gap:var(--s1)}
.stats b{font-family:var(--mono);font-size:var(--t6);line-height:1;letter-spacing:-.02em;
font-variant-numeric:tabular-nums}
.stats span{font-size:var(--t1);color:var(--muted)}

/* ------------------------------------------------------------ split rows */
.split{display:grid;gap:var(--s5);align-items:center;grid-template-columns:1fr}
@media (min-width:56rem){.split{grid-template-columns:1fr 1fr;gap:var(--s6)}
.split.flip>div{order:2}}
.split img{width:100%;height:auto;border-radius:var(--s5);box-shadow:var(--plane2);display:block}
.parts{list-style:none;margin:var(--s4) 0 0;padding:0;display:flex;flex-wrap:wrap;gap:var(--s2)}
.parts li{border:1px solid var(--line);border-radius:999px;padding:var(--s2) var(--s4);
background:var(--panel);font-size:var(--t2)}
.parts b{font-family:var(--mono);font-variant-numeric:tabular-nums}
.parts small{color:var(--muted);font-size:var(--t1);margin-left:var(--s1)}

/* ------------------------------------------------------------------ close */
.close{text-align:center;padding-top:var(--s6);padding-bottom:var(--s6);
border-top:1px solid var(--line)}
.close .lede{margin-left:auto;margin-right:auto}
.close .row{justify-content:center}

@media (prefers-reduced-motion:reduce){
/* Motion is a preference. The poster is not a fallback here, it is the
   version somebody asked for. */
.heroFilm{display:none!important}
.heroStill{display:block!important}}

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
  inbox: '<path d="M4 4h16v12H4zM4 4l8 7 8-7M4 20h16"/>',
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
  /** `front` widens the wrapper so the marketing page can go full-bleed. */
  opts: { balance?: number; viewer?: Viewer; front?: boolean } = {},
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
  <a href="/inbox" title="Inbox">${icon("inbox", "Inbox", true)}</a>
  <a href="/ledger" title="Points">${icon("points", "Points", true)}</a>
  ${opts.balance !== undefined ? `<a class="bal" href="/ledger" title="${esc(pts(opts.balance))} left">${esc(pts(opts.balance).replace(" points", "").replace(" point", ""))}</a>` : ""}
  <details class="menu"><summary>${esc(v.name)}</summary><div>
    <p class="who" title="${esc(v.email)}">${esc(v.orgName)}${v.role === "owner" ? " · owner" : ""}</p>
    <a href="/authors">Authoring</a><a href="/schedules">Schedules</a><a href="/purchases">Purchases</a>
    <a href="/tokens">MCP</a><a href="/team">Team</a>${v.role === "owner" ? `<a href="/payouts">Payouts</a><a href="/settings">Limits</a>` : ""}
    <form method="post" action="/logout"><button class="btn ghost">Sign out</button></form>
  </div></details>`
  : `<a class="plain" href="/login">Sign in</a>
     <a class="btn" href="/signup">Create an account</a>`}
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
<div class="wrap${opts.front ? " wide" : ""}">${scrollable(body)}
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

// ------------------------------------------------------------- front page

export type FrontData = {
  totals: import("./shelf.js").ShelfTotals;
  roles: Array<{ id: string; name: string; blurb: string; icon: string; count: number }>;
  anatomy: import("./shelf.js").Anatomy[];
  featured: Array<PackRow & { pricePoints: number; runs: number }>;
  /** What the visitor typed into the funnel, and what it matched. */
  asked?: string;
  matches?: Array<PackRow & { pricePoints: number }>;
};

const ASSETS = "https://pub-e651801aa8fc476c81b409baa6972944.r2.dev/agents/front";

/**
 * The page somebody sees before they have an account.
 *
 * It argues rather than announces, and every number on it is one we hold.
 * There are no ratings and no user count because we have neither; the small
 * figures are printed on purpose, which is the only version of them that is
 * worth anything. The copy follows the narrative the Storytelling Designer
 * pack wrote against our own numbers — see docs/design/front-page-copy.md.
 */
export function frontPage(d: FrontData): string {
  const { totals: t } = d;
  const shownRoles = d.roles.slice(0, 8);
  return layout("Hire a worker", `
<section class="hero">
  <video class="heroFilm" autoplay muted loop playsinline preload="none"
         poster="${ASSETS}/hero-poster.webp" aria-hidden="true" tabindex="-1">
    <source src="${ASSETS}/hero.mp4" type="video/mp4">
  </video>
  <img class="heroStill" src="${ASSETS}/hero-poster.webp" alt="" decoding="async">
  <div class="heroInk">
    <h1>More jobs than people</h1>
    <p class="lede">Hire somebody's whole method, not a file. A worker here is one
    expert's way of doing a job, packed into a folder — skills, tools, hooks,
    workflows, commands, docs. It runs on our servers against your budget, and you
    watch it work while it works.</p>

    <form class="funnel" method="get" action="/start">
      <label for="ask">What do you need done?</label>
      <div class="row">
        <input id="ask" name="q" type="text" autocomplete="off"
               value="${esc(d.asked ?? "")}"
               placeholder="a designer who does brutalism, and someone to review my code">
        <button class="btn" type="submit">${icon("search", "Find workers")}</button>
      </div>
      <p class="fine">Describe the job or the team. We will show you who on the shelf
      can do it before you make an account.</p>
    </form>
  </div>
</section>

${d.asked !== undefined ? matchBlock(d) : ""}

<section>
  <h2>The numbers, unrounded</h2>
  <ul class="stats">
    <li><b>${t.packs}</b><span>workers</span></li>
    <li><b>${t.skills}</b><span>skills they carry</span></li>
    <li><b>${t.roles}</b><span>roles filled</span></li>
    <li><b>${t.authors}</b><span>authors</span></li>
    <li><b>${t.runs}</b><span>runs</span></li>
  </ul>
  <p class="lede">${t.runs} runs. That is not a typo. We built the shelf before we
  had the traffic, and the honest version of that is a small number in plain type.
  There are no ratings, vote counts or user numbers on this page, because we do not
  have any yet. When we do, they will be the real ones.</p>
</section>

${shownRoles.length ? `<section>
  <h2>${t.roles} roles filled, one of them deeply</h2>
  <nav class="roles" aria-label="Roles">
    ${shownRoles.map((r) => `<a href="/start?q=${encodeURIComponent(r.id)}">
      ${icon(r.icon, r.name, true)}<b>${esc(r.name)}</b><small>${r.count}</small>
      <span>${esc(r.blurb)}</span></a>`).join("")}
  </nav>
  <p class="lede">The shelf is lopsided and you should see it before you hire. Design
  has enough workers that you can choose between them. The rest have one or two each,
  so read the author's notes and decide whether that one suits the job. We would
  rather you learned this here than three minutes into a run.</p>
</section>` : ""}

<section class="split">
  <div>
    <h2>A worker is not a skill</h2>
    <p class="lede">A skill is one file. You install it into your own agent, and then
    you decide when it applies, what it may touch, what runs before it and what
    happens when it fails. That deciding is the actual work.</p>
    <p class="lede">Our Senior Engineer carries eleven skills that somebody who does
    the job for a living decided belong together. On a marketplace of skills that is
    eleven separate purchases and the assembly is yours. Here it arrives assembled,
    with the reasoning intact.</p>
    ${d.anatomy.length ? `<ul class="parts">
      ${d.anatomy.map((a) => `<li><b>${a.files}</b> ${esc(a.label.toLowerCase())}
        <small>across ${a.packs} ${a.packs === 1 ? "worker" : "workers"}</small></li>`).join("")}
    </ul>
    <p class="fine">Counted from the folders on the shelf right now. The parts after
    the first are the ones a single file cannot carry.</p>` : ""}
  </div>
  <img src="${ASSETS}/anatomy.webp" alt="" loading="lazy" decoding="async" width="1000" height="750">
</section>

<section class="split flip">
  <div>
    <h2>It runs here. You see the bill.</h2>
    <p class="lede">Nothing to install and nothing to host. The worker runs on our
    servers against your budget.</p>
    <p class="lede">While it runs you watch the live trace: every step it takes, every
    tool it calls, every file it opens. When it stops you get the cost of that run to
    the token — not an estimate, and not a monthly lump you have to divide up
    afterwards. Set a cap and the run stops at the cap. When a run goes wrong, and
    some will, the trace shows you the step where it turned.</p>
  </div>
  <img src="${ASSETS}/runs-here.webp" alt="" loading="lazy" decoding="async" width="1000" height="750">
</section>

<section class="split">
  <div>
    <h2>Somebody wrote this</h2>
    <p class="lede">Every worker on the shelf has an author, and the author is the
    thing you are really buying. You can read how they work before you spend
    anything, and tell from the docs whether they have done the job or only read
    about it.</p>
    <p class="lede">${t.authors} authors so far. Some are still placeholders, carrying
    the name "Placeholder — needs a real campaigner", because we wired the shelf up
    before we filled it. They are listed as placeholders rather than dressed up as
    people.</p>
  </div>
  <img src="${ASSETS}/hired-fifty.webp" alt="" loading="lazy" decoding="async" width="1000" height="563">
</section>

<section class="split flip">
  <div>
    <h2>Or call them from where you already work</h2>
    <p class="lede">Every worker is reachable over MCP. Point your own client at one
    endpoint and they appear as tools alongside everything else you use. Same
    servers, same budget, same live trace, same bill at the end. You do not have to
    move your work onto our site for any of this to be true.</p>
  </div>
  <img src="${ASSETS}/mcp.webp" alt="" loading="lazy" decoding="async" width="1000" height="750">
</section>

<section class="split">
  <div>
    <h2>If the method is yours, so is the income</h2>
    <p class="lede">Package the way you work as a folder and put it on the shelf. You
    earn on every run, not only on the sale. A worker that gets used every week pays
    you every week, which means the incentive is to keep it working rather than to
    keep selling it. You can cash out.</p>
    <p class="lede">${t.authors} authors so far, and the gaps are obvious from the role
    counts above. If you are good at any of them, there is room nobody is competing
    for yet.</p>
    <p><a class="btn" href="/signup">Publish a worker</a></p>
  </div>
  <img src="${ASSETS}/authors.webp" alt="" loading="lazy" decoding="async" width="1000" height="750">
</section>

<section class="close">
  <h2>Start with one job</h2>
  <p class="lede">Make an account, say what you need, and watch the first run cost
  what it says on the trace.</p>
  <div class="row">
    <a class="btn" href="/signup">Create an account</a>
    <a class="btn ghost" href="/login">Sign in</a>
  </div>
</section>`, { front: true });
}

/** What the funnel found, and the one thing to do about it. */
function matchBlock(d: FrontData): string {
  const asked = (d.asked ?? "").trim();
  const found = d.matches ?? [];
  if (!asked) return "";
  return `<section class="found" id="found">
  <h2>${found.length === 0
    ? `Nothing on the shelf matches “${esc(asked)}” yet`
    : `${found.length} ${found.length === 1 ? "worker" : "workers"} for “${esc(asked)}”`}</h2>
  ${found.length === 0
    ? `<p class="lede">The shelf is curated and short on purpose, so it has gaps — and
       that one is now on the list. Try a broader word, or
       <a href="/signup">make an account</a> and tell us what you were looking for.</p>`
    : `<div class="grid">${found.slice(0, 6).map(frontCard).join("")}</div>
       <p class="lede">Make an account to hire ${found.length === 1 ? "it" : "any of them"}.
       You get ${"120"} points a month to start, which is enough to run a worker properly
       before you decide anything.</p>
       <div class="row">
         <a class="btn" href="/signup">Create an account</a>
         <a class="btn ghost" href="/login">Sign in</a>
       </div>`}
</section>`;
}

/** A pack card for somebody who cannot click through to the pack yet. */
function frontCard(p: PackRow & { pricePoints: number }): string {
  return `<div class="card gig">
  ${p.image
    ? `<img class="thumb" src="${esc(heroSrc(p.image))}" alt="" loading="lazy" decoding="async" width="640" height="360">`
    : thumb(p.slug)}
  <div class="meta">
    <p class="who">${avatar(p.author)}<span>${esc(p.author.split(" — ")[0] ?? p.author)}</span></p>
    <h3>${esc(p.name)}</h3>
    <p class="line">${esc(p.tagline)}</p>
    <p class="foot">
      <span class="proof">${esc(p.role || "worker")}</span>
      <span class="price">${p.pricePoints === 0 ? "free" : `${p.pricePoints}<small> pts</small>`}</span>
    </p>
  </div></div>`;
}

export function catalogPage(
  packs: Array<PackRow & { published: boolean; owned: boolean; pricePoints: number;
    stats: { runs: number; buyers: number; version: number };
    /** The pack's creator, when `author` is backed by a real creator record. */
    creatorHandle: string | null }>,
  balance: number, viewer: Viewer = null, query = "",
  cats: Array<{ tag: string; count: number }> = [],
  roles: Array<{ id: string; name: string; blurb: string; icon: string; count: number }> = [],
): string {
  // Name, face, one line, price. Everything else is on the pack's own page.
  //
  // The card used to be one big <a> around everything — simplest markup, and
  // right as long as every click on it meant the same thing. A byline that
  // goes to a different page breaks that: an anchor cannot nest inside
  // another anchor, so the card is a <div> instead, with an invisible anchor
  // laid over the whole thing as the default click target. The byline link,
  // when there is one, sits on top of that overlay — the inline
  // position/z-index below is what puts it there — so a click there reaches
  // the creator and nowhere else; every other pixel falls through to the pack.
  const cards = packs.map((p) => {
    const name = esc(p.author.split(" — ")[0] ?? p.author);
    const who = p.creatorHandle
      ? `<a href="/creators/${esc(p.creatorHandle)}" style="position:relative;z-index:1">${name}</a>`
      : name;
    return `<div class="card gig">
  <a href="/packs/${esc(p.slug)}" aria-label="${esc(p.name)}" style="position:absolute;inset:0;z-index:0"></a>
  ${p.image
    ? `<img class="thumb" src="${esc(heroSrc(p.image))}" alt="" loading="lazy" decoding="async" width="640" height="480">`
    : thumb(p.slug)}
  <div class="meta">
    <p class="who">${avatar(p.author)}<span>${who}</span></p>
    <h3>${esc(p.name)}</h3>
    <p class="line">${esc(p.tagline)}</p>
    <p class="foot">
      ${p.stats.runs > 0
        ? `<span class="proof" title="${p.stats.runs} runs, ${p.stats.buyers} buyers">${icon("runs", `${p.stats.runs} runs`)}</span>`
        : `<span class="proof new">new</span>`}
      <span class="price">${p.pricePoints === 0 ? "free" : `${p.pricePoints.toLocaleString("en-US")}<small> pts</small>`}</span>
    </p>
  </div></div>`;
  }).join("");
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

/**
 * Everything the pack page says that is not already a column on the pack.
 *
 * One object rather than nine more positional parameters, and deliberately
 * open: the creator card, the rating, the save and the vote land in here as
 * they are built, without this signature moving again.
 */
export type PackPageExtras = {
  /** The live listing, or null when the pack has none — `hasListing` decides. */
  listing: Listing | null;
  /** Counted from our own tables: completed non-trial runs, owning orgs, version. */
  stats: { runs: number; buyers: number; version: number };
  /** `permissionSummary(...).lines` — derived from what the pack stored, not declared. */
  permissions: string[];
  /** The manifest of the version a buyer would get. */
  files: { files: number; skills: number; tree: string[] };
  /** When the latest version was published. */
  updatedAt: string | null;
  /** Whose work this rests on, and under what licence. Not the byline. */
  builtOn: string | null;
  /** The purchase refund window, in days, so the buy card can state it. */
  refundDays: number;
  /**
   * Who `p.author` is, when that string is backed by a real creator record.
   * `null` for a pack nobody has claimed yet — the byline still shows
   * `p.author`, it just does not go anywhere.
   */
  creator: { id: string; handle: string } | null;
  /**
   * Average, count and the five-bucket spread, straight off `ratingOf`.
   * `average` stays `null` below `RATING_THRESHOLD`; the page's one rule is
   * to never go around that by computing its own average from `distribution`.
   */
  rating: Rating;
  /** Written opinions worth showing — a rating, a body, or both; newest edit first. */
  reviews: Array<{ byline: string | null; rating: number | null; body: string; createdAt: string }>;
  /** Whether this viewing organisation has a completed, non-trial run and may submit one. */
  mayReview: boolean;
  /** This organisation's own review, so the form edits it instead of handing back a blank one. */
  myReview: { rating: number | null; body: string; byline: string; anonymous: boolean } | null;
  /** How many organisations marked this useful, and whether this one already has. */
  votes: { count: number; voted: boolean };
  /** Whether this organisation has bookmarked the pack. */
  saved: boolean;
  /**
   * What changed in each version an author actually wrote a note for,
   * newest first. Empty for every pack published before this existed —
   * `changelogOf` never invents one — so the section renders nothing for
   * them, per the page's own rule.
   */
  changelog: Array<{ version: number; note: string; createdAt: string }>;
};

/** A stored timestamp as a date. The hour a curator clicked is not news. */
const day = (iso: string): string => iso.slice(0, 10);

const bullets = (items: string[], cls = ""): string =>
  `<ul${cls ? ` class="${cls}"` : ""}>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;

/** A stored block of prose, split on blank lines. Authors write paragraphs. */
const paragraphs = (text: string): string =>
  text.split(/\n{2,}/).map((t) => t.trim()).filter(Boolean)
    .map((t) => `<p>${esc(t)}</p>`).join("");

/**
 * Five filled stars down to `n`, the rest hollow — one reviewer's own
 * opinion, written down on their own review. Not an aggregate, so it is
 * never gated by `RATING_THRESHOLD`.
 */
const stars = (n: number): string => "★".repeat(n) + "☆".repeat(5 - n);

/**
 * Home › Workers › Role › Pack.
 *
 * The role segment is a link into the shelf filtered by that role, which is
 * the page it claims to be a step down from. A pack with no role loses the
 * segment rather than showing an empty one.
 */
function breadcrumb(p: PackRow): string {
  const role = ROLES.find((r) => r.id === p.role);
  const sep = ` <span aria-hidden="true">›</span> `;
  return `<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a>${sep}<span>Workers</span>${
    role ? `${sep}<a href="/?q=${encodeURIComponent(role.id)}">${esc(role.name)}</a>` : ""
  }${sep}<span aria-current="page">${esc(p.name)}</span></nav>`;
}

/**
 * What a buyer is buying.
 *
 * It used to be a name, a tagline and a price. Every block below is
 * conditional on having something to say, because almost every pack on the
 * shelf has no listing content yet and a heading over an empty box is worse
 * than no heading at all — that is the single rule this function is built
 * around, not a detail of it.
 */
export function packPage(
  p: PackRow, v: PackVersionRow | undefined, owned: boolean, models: string[], balance: number,
  err: string | undefined, viewer: Viewer,
  trial: { turns: number; budgetCents: number; used: boolean } | null,
  isAuthor: boolean,
  extras: PackPageExtras,
): string {
  const pinned: string[] = JSON.parse(p.pinned_models);
  const choices = (pinned.length ? pinned : models);
  const {
    listing, stats, permissions, files, updatedAt, builtOn, refundDays, creator,
    rating, reviews, mayReview, myReview, votes, saved, changelog,
  } = extras;
  const free = p.price_points === 0;
  return layout(p.name, `
${err ? `<div class="note bad">${esc(err)}</div>` : ""}
${breadcrumb(p)}
<h1>${esc(p.name)}</h1>
<p class="lede">${esc(p.tagline)}</p>
<div class="row" style="margin-bottom:var(--s2)">
  ${creator
    ? `<a class="tag" href="/creators/${esc(creator.handle)}">by ${esc(p.author)}</a>`
    : `<span class="tag">by ${esc(p.author)}</span>`}
  <span class="tag">${free ? "free" : esc(pts(p.price_points * 1000))} one-off</span>
  ${p.upgrade_points > 0 ? `<span class="tag">updates ${p.upgrade_points} pts</span>` : ""}
  <span class="tag">default ${esc(p.model)}</span>
  ${v ? `<span class="tag">v${v.version}</span>` : `<span class="tag">unpublished</span>`}
</div>
<div class="row" style="margin-bottom:var(--s4)">
  <form method="post" action="/packs/${esc(p.slug)}/save" class="inline">
    <button class="btn ghost" type="submit">${saved ? "Saved" : "Save"}</button>
  </form>
  <form method="post" action="/packs/${esc(p.slug)}/vote" class="inline">
    <input type="hidden" name="value" value="1">
    <button class="btn ghost" type="submit">${votes.voted ? "Marked useful" : "Looks good"}</button>
  </form>
  ${rating.average !== null ? `<span class="tag">${stars(Math.round(rating.average))} ${rating.average.toFixed(1)} (${rating.count})</span>` : ""}
</div>
${builtOn ? `<p class="lede" style="font-size:var(--t1);margin-bottom:var(--s4)">Built on ${esc(builtOn)}.</p>` : ""}
<div class="note">You see everything it does, and how it was told to do it — the method leaves with you.${isAuthor ? " You wrote this one; this is the page a buyer reads." : ""}</div>
${v ? `
<h2>${owned ? "Start a run" : "Acquire and run"}</h2>
<p class="lede" style="font-size:var(--t2)">${owned
  ? `Yours already. The runs cost points, and every run shows what it cost, to the token.`
  : free
    ? `Free. Nothing to buy — you spend points on the run, and the run shows what it cost, to the token.`
    : `${esc(pts(p.price_points * 1000))} once and it is yours; the runs cost points on top, and every run shows what it cost, to the token. Refundable for ${refundDays} days.`}</p>
${!owned && trial ? (trial.used
  ? `<p class="lede" style="font-size:var(--t2)">You have already used your trial of this pack.</p>`
  : `<div class="note" style="border-color:var(--accent);background:color-mix(in oklab,var(--accent) 9%,transparent)">
  <strong>Try it on your own brief first.</strong> ${trial.turns} turns, ${esc(fmt(trial.budgetCents))}, and you keep the output.
  <form method="post" action="/packs/${esc(p.slug)}/trial" class="inline">
    <button class="btn ghost" type="submit" style="margin-left:var(--s3)">Try it — ${trial.turns} turns</button></form>
</div>`) : ""}
<form method="post" action="${owned ? "/runs" : `/packs/${esc(p.slug)}/acquire`}">
  <input type="hidden" name="packVersionId" value="${esc(v.id)}">
  <div class="row">
    <label>Model <select name="model">${choices.map((m) => `<option value="${esc(m)}"${m === p.model ? " selected" : ""}>${esc(m)}</option>`).join("")}</select></label>
    <button class="btn" type="submit">${owned ? "Start a run" : free ? "Get it free and run" : `Buy for ${pts(p.price_points * 1000)} and run`}</button>
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
  ${pinned.length ? `<p class="lede" style="margin-top:var(--s3);font-size:var(--t2)">The author restricted this pack to ${esc(pinned.join(", "))} — every extraction refusal measured came from Opus, and a weaker model may just comply.</p>` : ""}
</form>` : `<form method="post" action="/packs/${esc(p.slug)}/publish" class="row">
  <label>What changed in this version?
    <input type="text" name="note" placeholder="optional" size="30"></label>
  <button class="btn" type="submit">Publish to the runtime</button>
</form>
<p class="lede" style="font-size:var(--t2)">A note is kept against the version it describes and never edited
afterwards, because a version is immutable. Leave it blank if there is nothing to say.</p>`}
${stats.runs > 0 || stats.buyers > 0 ? `<div class="meters" style="margin-top:var(--s5)">
  ${stats.runs > 0 ? `<div class="meter"><div class="k">${icon("runs", "Runs")}</div>
    <div class="v">${stats.runs.toLocaleString("en-US")}</div></div>` : ""}
  ${stats.buyers > 0 ? `<div class="meter"><div class="k">Owning organisations</div>
    <div class="v">${stats.buyers.toLocaleString("en-US")}</div></div>` : ""}
</div>` : ""}
<h2>Works with</h2>
<p class="lede" style="font-size:var(--t2)">It runs here, on a model you pick — nothing to install, and no vendor's
release to keep in step with. It leaves as one <code>.md</code> file that <code>ant apply</code> takes directly, so
the method is portable even though the runtime is ours. We make no claim about other people's agents, because
we do not test against them.</p>
${owned ? `<p class="row">
  <a class="btn ghost" href="/packs/${esc(p.slug)}/export?format=md" title="Download ${esc(p.slug)}.md">${icon("download", `The definition — ${p.slug}.md`)}</a>
  ${files.files > 1 ? `<a class="btn ghost" href="/packs/${esc(p.slug)}/export" title="Download ${esc(p.slug)}.tar.gz">${icon("download", `The whole folder — ${p.slug}.tar.gz`)}</a>` : ""}
</p>${files.files > 1 ? `<p class="lede" style="font-size:var(--t1)">The definition is the one file <code>ant apply</code> takes. The folder is everything in
the manifest — the skills, the docs, the hooks — as a <code>tar.gz</code>.</p>` : ""}` : ""}
${listing && listing.description.trim() ? `<h2>What it does</h2>
${paragraphs(listing.description)}` : ""}
${listing && listing.useCases.length ? `<h2>What you'd hire it for</h2>
${bullets(listing.useCases)}` : ""}
${listing && listing.scenarios.length ? `<h2>What a session looks like</h2>
<p class="lede" style="font-size:var(--t2)">Written examples, not recorded runs. Nobody's real brief, repository or
output appears here.</p>
${listing.scenarios.map((s) => `<div class="card" style="margin-bottom:var(--s4)">
  <h3>${esc(s.brief)}</h3>
  ${s.reached.length ? `<div class="chips">${s.reached.map((r) => `<span class="tag">${esc(r)}</span>`).join("")}</div>` : ""}
  ${s.output ? `<pre style="white-space:pre-wrap;word-break:break-word;font-size:var(--t2);line-height:1.5;margin:var(--s3) 0 0">${esc(s.output)}</pre>` : ""}
</div>`).join("")}` : ""}
${files.files > 0 ? `<h2>What's inside</h2>
<p class="lede" style="font-size:var(--t2)">${files.files} ${files.files === 1 ? "file" : "files"}${
  files.skills > 0 ? `, ${files.skills} ${files.skills === 1 ? "skill" : "skills"}` : ""
} in the version you would get.</p>
<div class="chips paths">${files.tree.slice(0, 40).map((path) => `<span class="tag">${esc(path)}</span>`).join("")}${
  files.tree.length > 40 ? `<span class="tag">+${files.tree.length - 40} more</span>` : ""
}</div>` : ""}
${listing && listing.limitations.length ? `<h2>Known limitations</h2>
${bullets(listing.limitations)}` : ""}
${listing && listing.faq.length ? `<h2>Questions people ask</h2>
${listing.faq.map((f) => `<details class="repo"><summary>${esc(f.q)}</summary>
  <p class="fine">${esc(f.a)}</p></details>`).join("")}` : ""}
${creator && !isAuthor ? `<h2>Ask the creator</h2>
<p class="lede" style="font-size:var(--t2)">A good exchange here is how the FAQ above gets built — from questions a
buyer actually had, not ones a generator imagined.</p>
<form method="post" action="/threads" class="card">
  <input type="hidden" name="creatorId" value="${esc(creator.id)}">
  <input type="hidden" name="packId" value="${esc(p.id)}">
  <input type="hidden" name="back" value="/packs/${esc(p.slug)}">
  <p><label>Subject<br><input type="text" name="subject" style="width:100%" required></label></p>
  <p><textarea name="body" placeholder="What do you want to know before you run it?" required></textarea></p>
  <button class="btn" type="submit">Send</button>
</form>` : ""}
${reviews.length > 0 || votes.count > 0 ? `<h2>Reviews</h2>
${rating.average !== null ? `<div class="row" style="align-items:flex-start;gap:var(--s6);margin-bottom:var(--s4)">
  <div>
    <p style="margin:0;font-family:var(--display);font-size:var(--t5)">${rating.average.toFixed(1)} / 5</p>
    <p class="lede" style="margin:0">${rating.count} ${rating.count === 1 ? "rating" : "ratings"}</p>
  </div>
  <div style="flex:1;min-width:12rem">
    ${[5, 4, 3, 2, 1].map((star) => {
      const n = rating.distribution[star - 1] ?? 0;
      const pct = rating.count ? n / rating.count : 0;
      return `<div class="row" style="gap:var(--s2);margin-bottom:var(--s1);flex-wrap:nowrap">
      <span class="tag" style="flex:none">${star}★</span>
      <div class="bar" style="flex:1"><i style="transform:scaleX(${pct.toFixed(4)})"></i></div>
      <span class="tag" style="flex:none">${n}</span>
    </div>`;
    }).join("")}
  </div>
</div>` : ""}
${votes.count > 0 ? `<p class="lede">${votes.count} ${votes.count === 1 ? "organisation" : "organisations"} marked this useful.</p>` : ""}
${reviews.map((r) => `<div class="card" style="margin-bottom:var(--s3)">
  <p class="row" style="justify-content:space-between;margin:0 0 var(--s2)">
    <strong>${esc(r.byline ?? "Anonymous")}</strong>
    ${r.rating != null ? `<span class="tag">${stars(r.rating)}</span>` : ""}
  </p>
  ${r.body.trim() ? `<p style="margin:0">${esc(r.body)}</p>` : ""}
</div>`).join("")}` : ""}
<h2>Rate it</h2>
${mayReview ? `<form method="post" action="/packs/${esc(p.slug)}/review" class="card">
  <div class="row">
    <label>Rating <select name="rating">
      ${[5, 4, 3, 2, 1].map((n) => `<option value="${n}"${(myReview?.rating ?? 5) === n ? " selected" : ""}>${n}</option>`).join("")}
    </select></label>
    <label><input type="checkbox" name="anonymous"${myReview?.anonymous ? " checked" : ""}> Post anonymously</label>
  </div>
  <p><label>Byline<br><input type="text" name="byline" value="${esc(myReview?.byline || viewer?.orgName || "")}" style="width:100%"></label></p>
  <p><textarea name="body" placeholder="What happened when you ran it?">${esc(myReview?.body ?? "")}</textarea></p>
  <button class="btn" type="submit">${myReview ? "Update your review" : "Submit your review"}</button>
</form>` : `<p class="lede">You can rate this once you have run it.</p>`}
${changelog.length > 0 ? `<h2>Changelog</h2>
<p class="lede" style="font-size:var(--t2)">What changed in each version, written by the author at publish and never edited afterwards.
Versions published before this existed carry no note.</p>
${changelog.map((c) => `<div class="card" style="margin-bottom:var(--s3)">
  <p class="row" style="justify-content:space-between;margin:0 0 var(--s2)">
    <strong>Version ${c.version}</strong><span class="tag">${esc(day(c.createdAt))}</span>
  </p>
  <p style="margin:0">${esc(c.note)}</p>
</div>`).join("")}` : ""}
<h2>Before you run it</h2>
<div class="ctx">
  <h4>Curation</h4>
  <p class="fine">${p.status === "listed"
    ? `Curated by the platform${p.listed_at ? `, reviewed and listed on ${esc(day(p.listed_at))}` : ""}. We do not run a security scan and do not claim one.`
    : `Not on the shelf — this pack is ${esc(p.status)}.`}</p>
  <h4>Price</h4>
  <p class="fine">${free ? "Free to acquire; you pay for the runs." : `${esc(pts(p.price_points * 1000))} one-off${p.upgrade_points > 0 ? `, ${p.upgrade_points} points for later versions` : ""}.`}</p>
  ${listing && listing.requirements.length ? `<h4>Requires</h4>
  ${bullets(listing.requirements, "fine")}` : ""}
  <h4>What it may do when it runs</h4>
  ${bullets(permissions, "fine")}
  <h4>Version</h4>
  <p class="fine">${v ? `Version ${v.version}` : "Not published"}${updatedAt ? `, published ${esc(day(updatedAt))}` : ""}.</p>
</div>
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
    <input type="text" name="note" placeholder="What changed in this version? (optional)" style="width:16rem">
    <button class="btn ghost">${p.version ? `Publish version ${p.version + 1}` : "Publish to the runtime"}</button></form>
  ${p.status === "draft" || p.status === "unlisted" ? `<form method="post" action="/packs/${esc(p.slug)}/submit" class="inline">
    <button class="btn">Submit for the catalog</button></form>` : ""}
  ${args.isCurator ? `<form method="post" action="/packs/${esc(p.slug)}/status" class="inline">
    <input type="hidden" name="status" value="${p.status === "listed" ? "unlisted" : "listed"}">
    <button class="btn ghost">${p.status === "listed" ? "Withdraw from the catalog" : "List it"}</button></form>` : ""}
  <form method="post" action="/packs/${esc(p.slug)}/delete" class="inline">
    <button class="btn ghost">Delete</button></form>
  <a class="btn ghost" href="/packs/${esc(p.slug)}/listing">The listing${p.listing_stale_at ? " — out of date" : ""}</a>
  <a class="btn ghost" href="/packs/${esc(p.slug)}">View as a buyer</a>
</div>
<p class="lede" style="margin-top:12px;font-size:14px">Saving changes the <em>next</em> version. Anyone who already
bought this keeps running the version they bought, because a version carries its own copy of the method — which is
what lets you fix a mistake without quietly rewriting work somebody paid for.</p>` : ""}`,
  { balance: args.balance, viewer: args.viewer });
}

/** Muted supporting text, in the tokens — `.fine` is only styled inside `.repo`/`.ctx`. */
const SECONDARY = "color:var(--muted);font-size:var(--t2);line-height:1.5";

/**
 * One listing, laid out as prose with its empty fields left out.
 *
 * Used twice on the approval screen — once for what buyers read now, once
 * for what is proposed — so the two columns are the same shape and the
 * difference between them is the content, not the layout.
 */
function listingSections(l: Listing): string {
  const block = (heading: string, body: string): string => (body ? `<h4>${heading}</h4>${body}` : "");
  return [
    block("What it does", l.description.trim() ? paragraphs(l.description) : ""),
    block("What you'd hire it for", l.useCases.length ? bullets(l.useCases) : ""),
    block("What a session looks like", l.scenarios.length
      ? `<p style="${SECONDARY}">Written examples, not recorded runs. Nobody's real brief, repository or output
  appears here — the same line a buyer reads above these on the pack page.</p>`
        + l.scenarios.map((s) => `<p style="margin:0 0 var(--s3)"><strong>${esc(s.brief)}</strong>
  ${s.reached.length ? `<br><span style="${SECONDARY}">${esc(s.reached.join(" · "))}</span>` : ""}
  ${s.output ? `<br><span style="${SECONDARY}">${esc(s.output)}</span>` : ""}</p>`).join("")
      : ""),
    block("Known limitations", l.limitations.length ? bullets(l.limitations) : ""),
    block("Questions people ask", l.faq.length
      ? l.faq.map((f) => `<p style="margin:0 0 var(--s3)"><strong>${esc(f.q)}</strong><br>
  <span style="${SECONDARY}">${esc(f.a)}</span></p>`).join("")
      : ""),
    block("Requires", l.requirements.length ? bullets(l.requirements) : ""),
  ].join("") || `<p class="lede">Nothing here yet.</p>`;
}

/**
 * The proposed listing, as fields a person can change.
 *
 * The screen used to be a single Approve button over read-only prose, which
 * made approval approve-verbatim or nothing: an author who disagreed with one
 * sentence could publish it anyway, publish nothing, or pay for another model
 * call. The spec says twice that the author "edits freely, and approves", and
 * chose per-pack approval *because* the author edits — so this is where the
 * editing happens, and the Approve button below publishes whatever was saved.
 *
 * The two list-of-objects fields are typed as labelled blocks separated by a
 * `---` line; `listingFromForm` in `src/packs/listing-shape.ts` is the other
 * half of that codec, and `listingToForm` here is the half that fills the
 * boxes, so a save with nothing changed round-trips unchanged.
 *
 * The FAQ box is the one whose help text depends on `author`, because what
 * approval does with it does: a generated draft's FAQ is merged with what is
 * live and the published answers win, a saved one's is published as it
 * stands. Saving is what moves a draft from the first case to the second, so
 * the box over a generated draft says that rather than implying an edit it
 * will not make.
 */
function listingEditor(slug: string, draft: Listing, author: DraftAuthor): string {
  const f = listingToForm(draft);
  const field = (name: string, label: string, help: string, value: string, rows: number): string =>
    `<p><label><strong>${label}</strong><br>
  <span style="${SECONDARY}">${help}</span><br>
  <textarea name="${name}" rows="${rows}" style="width:100%">${esc(value)}</textarea></label></p>`;
  return `<form method="post" action="/packs/${esc(slug)}/listing">
${field("description", "What it does", "Two or three paragraphs, separated by a blank line.", f.description, 7)}
${field("useCases", "What you'd hire it for", "One per line.", f.useCases, 5)}
${field("scenarios", "What a session looks like",
    "Written examples, not recorded runs — never a real buyer's brief. One per block, blocks separated by a line "
    + "of ---, lines labelled Brief:, Reached: (comma-separated) and Output:.", f.scenarios, 9)}
${field("limitations", "Known limitations", "One per line. The ones you would want to be told.", f.limitations, 4)}
${field("faq", "Questions people ask",
    "One per block, blocks separated by a line of ---, lines labelled Q: and A:. An answer may run over "
    + "several lines. "
    + (author === "human"
      ? "This box is the whole FAQ: an answer you change here changes on the page, and one you delete "
        + "leaves it."
      : "This draft came from the generator, so approving it as it stands keeps every answer already "
        + "published to the page, whatever this box says. Save the draft and it becomes yours — then this "
        + "box is the whole FAQ, deletions included."), f.faq, 7)}
${field("requirements", "Requires", "One per line.", f.requirements, 3)}
  <button class="btn ghost" type="submit">Save the draft</button>
  <span style="${SECONDARY};margin-left:var(--s3)">Saving changes the draft only. Nothing here reaches a buyer
  until it is approved below.</span>
</form>`;
}

/**
 * The one step between generated copy and a buyer.
 *
 * A generator writes drafts and nothing else; this screen is the only way a
 * draft becomes the listing. So it has three jobs: show what would be
 * published next to what is published now, let the author change it, and be
 * honest that until the button is pressed, nobody outside this page has seen
 * a word of it.
 */
export function listingApprovalPage(args: {
  pack: PackRow;
  /** What buyers read now, or null for a pack with no approved listing. */
  live: Listing | null;
  /** What a generator proposed, or null when there is nothing waiting. */
  draft: Listing | null;
  /** Who saved the draft last, which decides what approving it does to the FAQ. */
  draftAuthor: DraftAuthor;
  generatedAt: string | null;
  /** The published version the draft was generated from. */
  sourceVersion: number | null;
  /** The version the pack is on now — a draft older than this describes a pack that has moved. */
  currentVersion: number | null;
  /** Mirrors the route's own owner check: a member sees the facts, not a dead button or a dead form. */
  canApprove: boolean;
  /** Set after a save, so an author who changed one word is told it landed. */
  saved?: boolean;
  balance: number;
  viewer: Viewer;
  err?: string;
}): string {
  const { pack: p, live, draft } = args;
  const behind = draft !== null && args.sourceVersion !== null && args.currentVersion !== null
    && args.sourceVersion !== args.currentVersion;
  // What approving would take off the page. Only a draft its author saved can
  // remove an answer — a generated one's FAQ is merged with what is live — and
  // this is computed from `live` at render time, so an answer published out of
  // the inbox since the draft was saved shows up here too, which is the one
  // case the author could not otherwise have known about.
  // Only asked of the owner who can act on it: the copy tells them to put a
  // question back in a box a member does not have.
  const removing = draft !== null && args.canApprove && args.draftAuthor === "human" && live
    ? faqRemovedBy(live.faq, draft.faq)
    : [];
  return layout(`Listing for ${p.name}`, `
${args.err ? `<div class="note bad">${esc(args.err)}</div>` : ""}
${args.saved ? `<div class="note">Draft saved. It is still a draft — approve it below to put it in front of buyers.</div>` : ""}
<h1>The listing for ${esc(p.name)}</h1>
<p class="lede">What a buyer reads before they buy. It is drafted by a generator, edited and published by a person —
those are two different steps, and this is the second one.</p>
${p.listing_stale_at ? `<div class="note"><strong>The method changed on ${esc(day(p.listing_stale_at))}.</strong>
The live listing${p.listing_approved_at ? `, approved on ${esc(day(p.listing_approved_at))},` : ""} is out of date:
it may no longer describe what ships. Generate it again and approve what comes back.</div>` : ""}
${draft ? `<div class="note"><strong>Nothing below the heading "Proposed" is live.</strong> No buyer has seen it, and
none will until it is approved here.</div>
<div class="row" style="margin-bottom:var(--s4)">
  ${args.generatedAt ? `<span class="tag">generated ${esc(day(args.generatedAt))}</span>` : ""}
  ${args.sourceVersion !== null ? `<span class="tag">from version ${args.sourceVersion}</span>` : ""}
  ${behind ? `<span class="tag">the pack is now at version ${args.currentVersion}</span>` : ""}
</div>
${behind ? `<div class="note">This draft describes version ${args.sourceVersion}; the pack has moved on to version ${
  args.currentVersion}. Generating it again costs one model call.</div>` : ""}
<div class="grid">
  <div class="card">
    <h3>What a buyer reads now</h3>
    ${live ? listingSections(live) : `<p class="lede">Nothing. The page shows the tagline and the price, and no more.</p>`}
  </div>
  <div class="card">
    <h3>Proposed</h3>
    ${args.canApprove ? listingEditor(p.slug, draft, args.draftAuthor) : listingSections(draft)}
  </div>
</div>
${removing.length ? `<div class="note bad" style="margin-top:var(--s4)"><strong>Approving will remove ${
  removing.length === 1 ? "1 answer" : `${removing.length} answers`} now on the page.</strong>
Not in the FAQ box above, so publishing this draft takes ${removing.length === 1 ? "it" : "them"} down:
${bullets(removing.map((f) => f.q))}
Put the question back in the box if that is not what you meant.</div>` : ""}
${args.canApprove ? `<form method="post" action="/packs/${esc(p.slug)}/listing/approve" style="margin-top:var(--s4)">
  <button class="btn" type="submit">Approve and publish this listing</button>
</form>
<p class="lede" style="font-size:var(--t2)">Approving publishes the draft as it is saved above — edit it first if a
sentence promises more than the pack delivers. ${args.draftAuthor === "human"
  ? `The FAQ goes with it: the questions in that box become the whole of the pack's FAQ, so an answer you
corrected is corrected on the page and one you removed is removed from it.`
  : `This draft came from the generator, so answers you published to the FAQ out of a buyer's question are kept,
whatever it says. Save the draft first and the FAQ you saved is published instead, deletions and all.`}</p>`
  : `<p class="lede" style="margin-top:var(--s4)">Only an owner of this organisation can edit or publish a listing.
This is what would be published.</p>`}`
  : `<p class="lede">There is no draft waiting. Generate one with
<code>node scripts/generate-listings.mjs --slug ${esc(p.slug)}</code>, then come back here to read it, change what is
wrong with it, and approve it before anybody else sees it.</p>
<div class="card">
  <h3>What a buyer reads now</h3>
  ${live ? listingSections(live) : `<p class="lede">Nothing. The page shows the tagline and the price, and no more.</p>`}
</div>`}
<p class="row" style="margin-top:var(--s5)">
  <a class="btn ghost" href="/packs/${esc(p.slug)}">View as a buyer</a>
  <a class="btn ghost" href="/packs/${esc(p.slug)}/edit">Back to the pack</a>
</p>`, { balance: args.balance, viewer: args.viewer });
}

/** A stored `href` a creator typed into a free-text field, or nothing. */
const safeHref = (url: string): string => /^https?:\/\//i.test(url.trim()) ? url.trim() : "";

/** `links` as stored JSON, or an empty list for anything malformed. */
function parseLinks(json: string): Array<{ label: string; url: string }> {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

/**
 * The form behind `GET`/`POST /creators/me` — shaped like `invitePage`: one
 * route's own page, built and tested here rather than assembled ad hoc
 * inside the route handler.
 *
 * `canEdit` mirrors the route's own `ctx.role === "owner"` check. Editing the
 * organisation's public identity is an owner's call, the same as editing a
 * pack — but *looking* at what is there is not, so a member who cannot save
 * still gets the facts and a reason, never a form that would just 403 on
 * submit.
 */
export function creatorEditorPage(args: {
  creator: Pick<CreatorRow, "handle" | "display_name" | "bio" | "avatar" | "links"> | null;
  canEdit: boolean;
  balance: number;
  viewer: Viewer;
  err?: string;
}): string {
  const { creator: c, canEdit, err, balance, viewer } = args;

  if (!canEdit) {
    return layout(c ? c.display_name : "Creator profile", `
<h1>${c ? esc(c.display_name) : "No creator profile yet"}</h1>
<p class="lede">${c
    ? "Only an owner can change this organisation's creator profile."
    : "This organisation has not set up a creator profile yet — only an owner can do that."}</p>
${c ? `<p><a href="/creators/${esc(c.handle)}">View the public page</a></p>` : ""}`,
    { balance, viewer });
  }

  const linksText = c
    ? parseLinks(c.links).map((l) => `${l.label ?? ""} | ${l.url ?? ""}`).join("\n")
    : "";

  return layout(c ? `Edit ${c.display_name}` : "Set up your creator profile", `
<h1>${c ? "Edit your creator profile" : "Set up your creator profile"}</h1>
<p class="lede">This is the page your packs' byline links to.</p>
${err ? `<div class="note bad">${esc(err)}</div>` : ""}
<form method="post" action="/creators/me" class="card">
  <p><label>Handle<br><input type="text" name="handle" value="${esc(c?.handle ?? "")}" style="width:100%" required></label>
    <span class="tag">/creators/${esc(c?.handle || "your-handle")}</span></p>
  <p><label>Display name<br><input type="text" name="displayName" value="${esc(c?.display_name ?? "")}" style="width:100%" required></label></p>
  <p><label>Avatar URL<br><input type="url" name="avatar" value="${esc(c?.avatar ?? "")}" style="width:100%" placeholder="https://…"></label></p>
  <p><label>Bio<br><textarea name="bio" style="min-height:160px">${esc(c?.bio ?? "")}</textarea></label></p>
  <p><label>Links <span style="color:var(--muted);font-size:13px">(one per line: label | https://url)</span><br>
    <textarea name="links" style="min-height:100px">${esc(linksText)}</textarea></label></p>
  <button class="btn" type="submit">Save</button>
</form>
${c ? `<p class="lede" style="margin-top:var(--s4)"><a href="/creators/${esc(c.handle)}">View your public page</a></p>` : ""}`,
  { balance, viewer });
}

/**
 * A creator's own page: the record every byline on the site can now point
 * at, instead of a name nobody could click through on.
 *
 * `packPage` taught the rule this is built on — a heading over nothing to
 * say is worse than no heading — and it applies here just as much: a creator
 * who has written no bio, added no links and been attributed no packs yet
 * gets a page with no empty sections on it, not three headings over blanks.
 *
 * No rating renders here. That is Task 9's column, in a module that does not
 * exist yet; what this page can say honestly today is how many runs its
 * packs have had, so that is what stands in where a star rating will later
 * go — proof instead of a promise.
 */
export function creatorPage(
  creator: Pick<CreatorRow, "id" | "handle" | "display_name" | "bio" | "avatar" | "links" | "verified">,
  packs: Array<PackRow & { pricePoints: number; stats: { runs: number; buyers: number; version: number } }>,
  stats: { packs: number; runs: number; orgs: number },
  rating: { average: number | null; count: number },
  viewer: Viewer,
  balance: number,
  /** False for the creator's own organisation looking at its own page — there is no one there to ask. */
  canAsk = false,
  /**
   * What went wrong with the last thing posted from this page. `POST /threads`
   * redirects back here with `?err=…` when a question is refused — over the
   * daily rate limit, or with an empty body — and without this the refusal
   * was silent: the form cleared, nothing was sent, and the page said nothing
   * about either fact.
   */
  err?: string,
): string {
  const bio = creator.bio.trim();
  const links = parseLinks(creator.links);
  const image = creator.avatar ? heroSrc(creator.avatar) : "";

  return layout(creator.display_name, `
${err ? `<div class="note bad">${esc(err)}</div>` : ""}
<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> <span aria-hidden="true">›</span>
  <span aria-current="page">${esc(creator.display_name)}</span></nav>
<div class="row" style="align-items:center;margin-top:var(--s4)">
  ${image ? `<img src="${esc(image)}" alt="" width="56" height="56" loading="lazy" decoding="async"
    style="width:3.5rem;height:3.5rem;border-radius:999px;object-fit:cover;flex:none">` : avatar(creator.display_name)}
  <h1 style="margin:0">${esc(creator.display_name)}${creator.verified ? ` ${icon("check", "Verified", true)}` : ""}</h1>
</div>
<p class="lede" style="margin:var(--s1) 0 var(--s4)">@${esc(creator.handle)}</p>
<p class="row">
  ${stats.runs > 0
    ? `<span class="proof" title="${stats.runs} runs">${icon("runs", `${stats.runs.toLocaleString("en-US")} runs`)}</span>`
    : `<span class="proof new">new</span>`}
  ${rating.average !== null ? `<span class="tag">${stars(Math.round(rating.average))} ${rating.average.toFixed(1)} (${rating.count})</span>` : ""}
  ${stats.orgs > 0 ? `<span class="tag">${stats.orgs.toLocaleString("en-US")} owning ${stats.orgs === 1 ? "organisation" : "organisations"}</span>` : ""}
</p>
${bio ? paragraphs(bio) : ""}
${links.length ? `<h2>Links</h2>
<ul>${links.map((l) => {
    const href = safeHref(l.url ?? "");
    const label = esc(l.label || l.url || "");
    return `<li>${href ? `<a href="${esc(href)}">${label}</a>` : label}</li>`;
  }).join("")}</ul>` : ""}
${packs.length ? `<h2>Packs</h2>
<table><tr><th>Pack</th><th class="num">Runs</th><th class="num">Owning orgs</th><th class="num">Price</th></tr>
${packs.map((p) => `<tr>
  <td><a href="/packs/${esc(p.slug)}">${esc(p.name)}</a>${p.tagline ? `<div style="color:var(--muted);font-size:var(--t1)">${esc(p.tagline)}</div>` : ""}</td>
  <td class="num">${p.stats.runs.toLocaleString("en-US")}</td>
  <td class="num">${p.stats.buyers.toLocaleString("en-US")}</td>
  <td class="num">${p.pricePoints === 0 ? "free" : `${p.pricePoints.toLocaleString("en-US")} pts`}</td>
</tr>`).join("")}
</table>` : ""}
${canAsk ? `<h2>Ask ${esc(creator.display_name)} a question</h2>
<form method="post" action="/threads" class="card">
  <input type="hidden" name="creatorId" value="${esc(creator.id)}">
  <input type="hidden" name="back" value="/creators/${esc(creator.handle)}">
  <p><label>Subject<br><input type="text" name="subject" style="width:100%" required></label></p>
  <p><textarea name="body" placeholder="Ask about their packs, or anything else" required></textarea></p>
  <button class="btn" type="submit">Send</button>
</form>` : ""}`,
  { balance, viewer });
}

/** A relative time, coarse on purpose — "when" matters here, not "exactly when". */
function since(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.max(0, Math.round(ms / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** One thread, rendered the same way on both sides of `inboxPage` apart from who gets called "You". */
function threadCard(
  t: { id: string; subject: string; pack: { slug: string; name: string } | null;
    messages: Array<{ id: string; org_id: string; body: string; published_at: string | null; created_at: string }> },
  selfOrgId: string, otherLabel: string, publishable: boolean,
): string {
  const asker = t.messages.find((m) => m.org_id !== selfOrgId) ?? t.messages[0];
  const answers = publishable ? t.messages.filter((m) => m.org_id === selfOrgId) : [];
  return `<div class="card" style="margin-bottom:var(--s4)">
  <p class="row" style="justify-content:space-between;margin:0 0 var(--s2)">
    <strong>${esc(t.subject)}</strong>
    ${t.pack ? `<a class="tag" href="/packs/${esc(t.pack.slug)}">${esc(t.pack.name)}</a>` : `<span class="tag">general</span>`}
  </p>
  ${t.messages.map((m) => `<p style="margin:0 0 var(--s2)">
    <strong>${m.org_id === selfOrgId ? "You" : esc(otherLabel)}</strong>
    <span class="tag" style="margin-left:.5em">${esc(since(m.created_at))}</span>
    ${m.published_at ? `<span class="tag">published</span>` : ""}<br>${esc(m.body)}</p>`).join("")}
  <form method="post" action="/threads/${esc(t.id)}/reply" class="row">
    <textarea name="body" placeholder="Reply" required style="flex:1;min-height:3rem"></textarea>
    <button class="btn ghost" type="submit">Reply</button>
  </form>
  ${publishable && t.pack && asker && answers.length
    ? `<form method="post" action="/threads/${esc(t.id)}/publish" class="row" style="margin-top:var(--s2)">
    <label>Question
      <select name="questionId">${t.messages.filter((m) => m.org_id !== selfOrgId).map((m) =>
        `<option value="${esc(m.id)}"${m.id === asker.id ? " selected" : ""}>${esc(m.body.slice(0, 60))}</option>`).join("")}
      </select></label>
    <label>Answer
      <select name="answerId">${answers.map((m) =>
        `<option value="${esc(m.id)}"${m.id === answers[answers.length - 1]!.id ? " selected" : ""}>${esc(m.body.slice(0, 60))}</option>`).join("")}
      </select></label>
    <button class="btn" type="submit">Publish to FAQ</button>
  </form>` : ""}
</div>`;
}

/**
 * Every thread this organisation can see — the ones asked of its own
 * creator profile, if it has one, and the ones it has itself opened with
 * someone else's. Neither list is ever another organisation's: `threadsFor`
 * and `threadsForOrg` scope by exact ID, so there is nothing to filter here.
 *
 * Follows `packPage`'s own rule: a section with nothing in it gets no
 * heading. With both lists empty, that leaves only the page title — so one
 * line says so instead of two headings over blanks.
 */
export function inboxPage(args: {
  asked: InboxThread[];
  mine: MyThread[];
  selfOrgId: string;
  viewer: Viewer;
  balance: number;
  err?: string;
}): string {
  const { asked, mine, selfOrgId, viewer, balance, err } = args;
  return layout("Inbox", `
<h1>Inbox</h1>
<p class="lede">Questions asked of you, and questions you have asked.</p>
${err ? `<div class="note bad">${esc(err)}</div>` : ""}
${asked.length === 0 && mine.length === 0 ? `<p class="lede">No conversations yet.</p>` : ""}
${asked.length ? `<h2>Asked of you</h2>
${asked.map((t) => threadCard(t, selfOrgId, t.askerOrgName, true)).join("")}` : ""}
${mine.length ? `<h2>Your questions</h2>
${mine.map((t) => threadCard(t, selfOrgId, t.creatorName, false)).join("")}` : ""}`,
  { balance, viewer });
}

export function curatePage(args: {
  queue: Array<{ slug: string; name: string; author: string; tagline: string; price_points: number }>;
  listed: Array<{ slug: string; name: string; author: string; featured_rank: number | null }>;
  balance: number; viewer: Viewer; err?: string;
}): string {
  return layout("Curate", `
<h1>Curating the catalog</h1>
<p class="lede">A thin curated shelf beats a full unreliable one — marketplaces die of bad inventory faster than of
empty inventory. You are the taste.</p>
${args.err ? `<div class="note bad">${esc(args.err)}</div>` : ""}
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
<p class="lede">Rank sets this pack's position on the shelf, lowest first. Leave it blank to let runs, rating and
votes decide — almost every pack, for now.</p>
<table><tr><th>Pack</th><th>Author</th><th>Rank</th><th></th></tr>
${args.listed.map((l) => `<tr><td><a href="/packs/${esc(l.slug)}">${esc(l.name)}</a></td><td>${esc(l.author)}</td>
<td><form method="post" action="/packs/${esc(l.slug)}/featured-rank" class="inline">
  <input type="number" name="featuredRank" value="${l.featured_rank ?? ""}" style="width:4em">
  <button class="btn ghost" style="padding:5px 10px">Save</button></form></td>
<td><form method="post" action="/packs/${esc(l.slug)}/status" class="inline">
  <input type="hidden" name="status" value="unlisted">
  <button class="btn ghost" style="padding:5px 10px">Withdraw</button></form></td></tr>`).join("")
  || `<tr><td colspan="4">Nothing listed.</td></tr>`}
</table>`, { balance: args.balance, viewer: args.viewer });
}
