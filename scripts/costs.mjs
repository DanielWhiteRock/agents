import { DatabaseSync } from "node:sqlite";
const d = new DatabaseSync("data/platform.db");
const rows = d.prepare(`SELECT r.model, r.output_tokens, r.active_seconds, r.list_cost_cents, p.name
  FROM runs r JOIN pack_versions v ON v.id = r.pack_version_id JOIN packs p ON p.id = v.pack_id
  ORDER BY r.started_at`).all();
for (const r of rows) {
  console.log(" ", String(r.name).padEnd(28), String(r.model).padEnd(18),
    String(r.output_tokens).padStart(5) + " out",
    (r.active_seconds.toFixed(1) + "s").padStart(7),
    "$" + (r.list_cost_cents / 100).toFixed(2));
}
const t = d.prepare("SELECT COALESCE(SUM(list_cost_cents),0) s FROM runs").get().s;
console.log("  platform runs tonight: $" + (t / 100).toFixed(2));
