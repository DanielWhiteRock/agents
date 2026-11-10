import { Pool } from "pg";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const runId = process.argv[2];
const { rows: [r] } = await pool.query("SELECT * FROM runs WHERE id = $1", [runId]);
const { rows: ev } = await pool.query("SELECT kind, payload FROM run_events WHERE run_id = $1 ORDER BY id", [runId]);
const counts = {};
for (const e of ev) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
const txt = ev.filter((e) => e.kind === "agent.text").map((e) => JSON.parse(e.payload).text).join("");
const { rows: [a] } = await pool.query("SELECT COALESCE(SUM(points_millicents),0) s FROM author_earnings");
const { rows: led } = await pool.query("SELECT bucket, SUM(delta_cents) s FROM points_ledger GROUP BY bucket ORDER BY bucket");
console.log(JSON.stringify({ status: r?.status, stop: r?.stop_reason, out: r?.output_tokens,
  active_s: r?.active_seconds, cost_c: r?.list_cost_cents, billed_up_to: r?.billed_up_to_cents,
  billed_c: r?.billed_cents, events: counts, answer_chars: txt.length,
  author_millicents: Number(a.s), ledger: led }, null, 1));
if (process.argv[3] === "--answer") console.log("\n" + txt.slice(0, 500));
await pool.end();
