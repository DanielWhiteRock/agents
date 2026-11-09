import { DatabaseSync } from "node:sqlite";
const d = new DatabaseSync(process.env.DB_PATH ?? "data/platform.db");
const run = d.prepare("SELECT * FROM runs ORDER BY started_at DESC LIMIT 1").get();
if (!run) { console.log("no runs"); process.exit(0); }
const ev = d.prepare("SELECT kind, payload FROM run_events WHERE run_id = ? ORDER BY id").all(run.id);
const counts = {};
for (const e of ev) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
const txt = ev.filter((e) => e.kind === "agent.text").map((e) => JSON.parse(e.payload).text).join("");
if (process.argv[2] === "--answer") { console.log(txt); process.exit(0); }
console.log(JSON.stringify({
  run: run.id, status: run.status, stop: run.stop_reason,
  in_tokens: run.input_tokens, out_tokens: run.output_tokens,
  active_s: run.active_seconds, cost_cents: run.list_cost_cents, billed_cents: run.billed_cents,
  events: counts, answer_chars: txt.length,
  asks: d.prepare("SELECT name, decision FROM pending_asks WHERE run_id = ?").all(run.id),
  author_millicents: d.prepare("SELECT COALESCE(SUM(points_millicents),0) s FROM author_earnings").get().s,
  ledger: d.prepare("SELECT bucket, SUM(delta_cents) s FROM points_ledger GROUP BY bucket").all(),
}, null, 1));
