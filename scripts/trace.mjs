import { DatabaseSync } from "node:sqlite";
const d = new DatabaseSync("data/platform.db");
const runId = process.argv[2] ?? d.prepare("SELECT id FROM runs ORDER BY started_at DESC LIMIT 1").get().id;
const run = d.prepare("SELECT * FROM runs WHERE id = ?").get(runId);
for (const e of d.prepare("SELECT kind, payload, created_at FROM run_events WHERE run_id = ? ORDER BY id").all(runId)) {
  const p = JSON.parse(e.payload);
  const t = e.created_at.slice(11, 19);
  let line;
  switch (e.kind) {
    case "user.message": line = `“${p.text.slice(0, 80)}…”`; break;
    case "agent.text": line = `${p.text.slice(0, 80).replace(/\n/g, " ")}…`; break;
    case "agent.thinking": line = "thinking"; break;
    case "tool.use": line = `${p.name} [${p.permission}] ${JSON.stringify(p.input).slice(0, 70)}`; break;
    case "tool.result": line = `${p.name} ${p.isError ? "FAILED" : "ok"} ${String(p.preview).slice(0, 60)}`; break;
    case "model.usage": line = `in ${p.inputTokens} · out ${p.outputTokens} · cache read ${p.cacheReadTokens} · cache write ${p.cacheCreationTokens}`; break;
    case "status": line = `${p.status}${p.stopReason ? ` (${p.stopReason})` : ""}`; break;
    case "user.decision": line = `${p.result.toUpperCase()} ${p.name}${p.deny_message ? ` — “${p.deny_message}”` : ""}`; break;
    case "run.metered": line = `cost $${(p.list_cost_cents / 100).toFixed(2)} (+$${(p.delta_cents / 100).toFixed(2)}) · billed $${(p.billed_cents / 100).toFixed(2)} · author $${(p.author_millicents / 100000).toFixed(4)} · in ${p.input_tokens} out ${p.output_tokens} · ${p.active_seconds.toFixed(1)}s`; break;
    case "usage.snapshot": line = `platform total $${(Number(p.usage.listCost.amount) / 100).toFixed(2)} · in ${p.usage.inputTokens} out ${p.usage.outputTokens} · ${p.usage.activeSeconds.toFixed(1)}s${p.budget ? ` · budget $${(Number(p.budget.amount) / 100).toFixed(2)}` : ""}`; break;
    case "model.request_start": line = "model request started"; break;
    case "thread.status": line = `${p.agentName ?? "thread"}: ${p.status}${p.stopReason ? ` (${p.stopReason})` : ""}`; break;
    case "echo": line = `${p.of}${p.text ? ` — “${String(p.text).slice(0, 50)}…”` : ""}`; break;
    case "raw": line = `(${p.payload?.type ?? "unmapped"})`; break;
    default: line = JSON.stringify(p).slice(0, 80);
  }
  console.log(`  ${t}  ${e.kind.padEnd(14)} ${line}`);
}
console.log(`\n  TOTALS  in ${run.input_tokens} · out ${run.output_tokens} · ${run.active_seconds.toFixed(1)}s active · cost $${(run.list_cost_cents / 100).toFixed(2)} of $${(run.budget_cents / 100).toFixed(2)} budget · billed $${(run.billed_cents / 100).toFixed(2)}`);
