#!/usr/bin/env node
/**
 * Writes the listing nobody had time to write, seventy times.
 *
 *   ANTHROPIC_API_KEY=sk-ant-… node scripts/generate-listings.mjs --slug senior-engineer
 *   ANTHROPIC_API_KEY=sk-ant-… node scripts/generate-listings.mjs --all
 *
 * Three rules it lives under, and they are the reason it is allowed to exist:
 *
 *   1. **Derive, never reproduce.** It describes what the worker does. It does
 *      not quote or rebuild the method — a listing that pastes the pack body
 *      is lazy copy, and `saveDraft` refuses one that shares a twelve-word run
 *      with the instructions.
 *   2. **Claim only what the pack supports.** The prompt carries the pack's
 *      real skill names, its declared tools and its folder manifest, and says
 *      in as many words that anything not in them is not to be claimed.
 *   3. **A draft is the terminal state without a human.** It writes to
 *      `pack_listing_drafts` and never to `packs`. The only thing that
 *      publishes a listing is a person pressing the button on
 *      `/packs/:slug/listing`.
 *
 * The model call is the single function `anthropicPropose`, passed in as
 * `propose` — so tests drive the whole path with a stand-in and this script's
 * coverage never depends on a network, a key, or a bill.
 */
import { pathToFileURL } from "node:url";
import { initDb } from "../dist/src/app/db.js";
import { sql } from "../dist/src/app/sql.js";
import * as P from "../dist/src/app/platform.js";
import * as L from "../dist/src/app/listing.js";

/** The model that writes the copy. One call per pack, no retries. */
export const GENERATOR_MODEL = "claude-opus-5";

/** Caps, so one talkative response cannot turn a listing into an essay. */
const LIMITS = { useCases: 6, limitations: 6, faq: 8, scenarios: 3, requirements: 6 };

export class GenerationError extends Error {
  constructor(message) {
    super(message);
    this.name = "GenerationError";
  }
}

/**
 * The key, or a refusal that names what is missing.
 *
 * Checked before any pack is read, so the script either runs or says why —
 * never half-runs and leaves a catalog with drafts for the first nine packs.
 */
export function resolveApiKey(env = process.env) {
  const key = (env.ANTHROPIC_API_KEY ?? "").trim();
  if (!key) {
    throw new GenerationError(
      "ANTHROPIC_API_KEY is not set. This script calls the Anthropic API once per pack;\n"
      + "export a key (or run `ant auth login` and export one from it) and try again.");
  }
  return key;
}

// ------------------------------------------------------------ what it knows

/** Everything the prompt is allowed to know about one pack. */
export async function contextFor(pack) {
  const [files, tools, mcpServers, version] = await Promise.all([
    P.packFileSummary(pack.id),
    P.packTools(pack.id),
    P.packMcpServers(pack.id),
    P.latestVersion(pack.id),
  ]);
  const tree = files.tree.length ? files.tree : (await P.packTree(pack.id)).map((f) => f.path);
  const skills = [...new Set(tree.flatMap((p) => {
    const m = /^skills\/([^/]+)\//.exec(p);
    return m ? [m[1]] : [];
  }))];
  return { pack, tree, skills, tools, mcpServers, version: version?.version ?? null };
}

const listOr = (items, fallback) => (items.length ? items.join(", ") : fallback);

/**
 * The facts, written down once.
 *
 * Everything here is read off our own tables — the pack's name, tagline,
 * role, price, declared tools, skill directories, folder manifest and the
 * instructions themselves. Nothing is inferred and nothing is invented, so
 * the model's bound is this text.
 */
export function packBrief(context) {
  const { pack: p, tree, skills, tools, mcpServers, version } = context;
  return [
    `PACK: ${p.name}`,
    `ADDRESS: /packs/${p.slug}`,
    `TAGLINE: ${p.tagline || "(none written)"}`,
    `ROLE: ${p.role || "(none)"}`,
    `PRICE: ${p.price_points === 0 ? "free to acquire" : `${p.price_points} points once`}`,
    `DEFAULT MODEL: ${p.model}${p.effort ? ` at ${p.effort} effort` : ""}`,
    `PUBLISHED VERSION: ${version ?? "not published to the runtime yet"}`,
    `DECLARED TOOLS: ${listOr(tools.map((t) => `${t.name} (${t.policy})`), "none declared")}`,
    `MCP SERVERS: ${listOr(mcpServers.map((m) => `${m.name} → ${m.url}`), "none")}`,
    `SKILL DIRECTORIES: ${listOr(skills, "none")}`,
    `FOLDER MANIFEST (${tree.length} file${tree.length === 1 ? "" : "s"}):`,
    ...tree.slice(0, 60).map((path) => `  ${path}`),
    tree.length > 60 ? `  …and ${tree.length - 60} more` : "",
    "",
    "INSTRUCTIONS (the method — material to describe, never to quote):",
    p.instructions,
  ].filter((line) => line !== "").join("\n");
}

/** What the model is for, and what it may not do. */
export function systemPrompt() {
  return [
    "You write the listing for one worker on a marketplace of AI workers. A buyer reads it to decide whether this",
    "worker can do their job. You are writing for somebody spending their own money.",
    "",
    "Three rules, in order:",
    "",
    "1. DERIVE, DO NOT REPRODUCE. You are given the worker's instructions as material. Describe what the worker",
    "   does with them — the job, the method's shape, the output a buyer gets. Do not quote the instructions, do not",
    "   paraphrase them line by line, and never reproduce a run of their wording. A listing that pastes the method",
    "   back at the buyer tells them nothing, and it is rejected on the way in.",
    "2. CLAIM ONLY WHAT THE PACK SUPPORTS. The brief names the real tools, skills and files. If the worker has no",
    "   web access, it does not research. If there is no spreadsheet skill, it does not build spreadsheets. Nothing",
    "   the pack cannot support may appear in the listing, however good it would sound.",
    "3. BE CONCRETE AND SHORT. Specifics a buyer can check beat adjectives. No marketing voice, no exclamation",
    "   marks, no \"revolutionary\", no promises about speed or savings. Say what it does and what it does not do.",
    "",
    "Scenarios are written examples, not recorded runs: invent a plausible brief, name the steps the worker would",
    "reach for (using only its real tools and skills), and describe the shape of the output. Never imply the",
    "scenario happened, and never invent a customer, a company or a number you were not given.",
    "",
    "Limitations are not a disclaimer section — name the real edges of the method, the ones a buyer would be angry",
    "to discover afterwards.",
    "",
    "Answer with one JSON object and nothing else:",
    "",
    "{",
    '  "description": "two or three short paragraphs, plain prose, separated by a blank line",',
    '  "use_cases": ["the jobs somebody would hire it for, one line each"],',
    '  "limitations": ["what it does not do, one line each"],',
    '  "faq": [{ "q": "a question a buyer would really ask", "a": "a direct answer" }],',
    '  "scenarios": [{ "brief": "a plausible brief", "reached": ["the steps it would take"], "output": "what comes back" }],',
    '  "requirements": ["what the buyer has to bring"]',
    "}",
    "",
    `At most ${LIMITS.useCases} use cases, ${LIMITS.limitations} limitations, ${LIMITS.faq} FAQ entries,`,
    `${LIMITS.scenarios} scenarios and ${LIMITS.requirements} requirements. Leave a list empty rather than padding it.`,
  ].join("\n");
}

/** The JSON shape, handed to the API so the response comes back parseable. */
export const PROPOSAL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["description", "use_cases", "limitations", "faq", "scenarios", "requirements"],
  properties: {
    description: { type: "string" },
    use_cases: { type: "array", items: { type: "string" } },
    limitations: { type: "array", items: { type: "string" } },
    faq: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["q", "a"],
        properties: { q: { type: "string" }, a: { type: "string" } },
      },
    },
    scenarios: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["brief", "reached", "output"],
        properties: {
          brief: { type: "string" },
          reached: { type: "array", items: { type: "string" } },
          output: { type: "string" },
        },
      },
    },
    requirements: { type: "array", items: { type: "string" } },
  },
};

// --------------------------------------------------------------- the model

/**
 * The only function here that reaches the network.
 *
 * Everything else takes `propose` as an argument, which is what lets the
 * tests exercise the whole path without a key. Imported lazily so that
 * importing this module — which the tests do — never constructs a client.
 */
export async function anthropicPropose({ system, user, apiKey }) {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic(apiKey ? { apiKey } : {});
  const response = await client.messages.create({
    model: GENERATOR_MODEL,
    max_tokens: 16000,
    system,
    messages: [{ role: "user", content: user }],
    output_config: { effort: "high", format: { type: "json_schema", schema: PROPOSAL_SCHEMA } },
  });
  return response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}

// ------------------------------------------------------- reading it back in

/** The model's JSON, out of whatever it wrapped it in. */
export function parseProposal(text) {
  const raw = String(text ?? "").trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  const body = fenced ? fenced[1].trim() : raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new GenerationError(`the proposal was not JSON: ${raw.slice(0, 120) || "(empty)"}`);
  }
  try {
    const parsed = JSON.parse(body.slice(start, end + 1));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new GenerationError("the proposal was JSON, but not an object");
    }
    return parsed;
  } catch (e) {
    if (e instanceof GenerationError) throw e;
    throw new GenerationError(`the proposal was not valid JSON: ${e.message}`);
  }
}

const capped = (value, max) => (Array.isArray(value) ? value.slice(0, max) : value);

/**
 * A proposal in the shape the columns hold.
 *
 * Shape and emptiness are settled by `listingFromParts` in `listing.ts` — the
 * same function that reads a stored listing back — so a generated draft and
 * an approved one can never disagree about what a scenario is. All this adds
 * is the snake_case the model answers in, and the caps.
 */
export function listingFrom(raw) {
  const pick = (snake, camel) => (raw?.[snake] ?? raw?.[camel]);
  return L.listingFromParts({
    description: raw?.description,
    useCases: capped(pick("use_cases", "useCases"), LIMITS.useCases),
    limitations: capped(raw?.limitations, LIMITS.limitations),
    faq: capped(raw?.faq, LIMITS.faq),
    scenarios: capped(raw?.scenarios, LIMITS.scenarios),
    requirements: capped(raw?.requirements, LIMITS.requirements),
  });
}

const isEmpty = (l) => !l.description.trim() && l.useCases.length === 0 && l.limitations.length === 0
  && l.faq.length === 0 && l.scenarios.length === 0 && l.requirements.length === 0;

// ---------------------------------------------------------------- the runs

/**
 * One pack: read it, ask once, write a draft.
 *
 * Returns rather than throws, so `--all` reports seventy outcomes instead of
 * stopping at the first pack whose model call came back odd. A failure here
 * leaves nothing behind — no half-written draft, and never a word on `packs`.
 */
export async function generateForPack(slug, { propose, apiKey } = {}) {
  const pack = await P.getPack(slug);
  if (!pack) return { slug, ok: false, reason: `no pack at /packs/${slug}` };
  try {
    const context = await contextFor(pack);
    const user = packBrief(context);
    const answer = await (propose ?? anthropicPropose)({ system: systemPrompt(), user, slug, apiKey });
    const listing = listingFrom(parseProposal(answer));
    if (isEmpty(listing)) throw new GenerationError("the proposal had nothing in any of the six fields");
    // Never `saveDraft`: a generated draft starts from the FAQ that is
    // already live, so approving it cannot delete an answer a creator
    // published out of a real buyer exchange.
    await L.saveGeneratedDraft(pack.id, listing, context.version);
    return { slug, ok: true, fields: {
      useCases: listing.useCases.length, limitations: listing.limitations.length,
      faq: listing.faq.length, scenarios: listing.scenarios.length, requirements: listing.requirements.length,
    } };
  } catch (e) {
    return { slug, ok: false, reason: e.message };
  }
}

/** Every pack in the catalog, whatever its status — the backfill. */
export async function generateAll(options = {}) {
  const s = await sql();
  const rows = await s.query("SELECT slug FROM packs ORDER BY created_at");
  const results = [];
  for (const row of rows) {
    const result = await generateForPack(row.slug, options);
    options.onResult?.(result);
    results.push(result);
  }
  return results;
}

// ----------------------------------------------------------------- the CLI

const line = (r) => (r.ok
  ? `  ok    ${r.slug} — draft written (${r.fields.useCases} use cases, ${r.fields.scenarios} scenarios, `
    + `${r.fields.faq} FAQ, ${r.fields.limitations} limitations)`
  : `  FAIL  ${r.slug} — ${r.reason}`);

export async function main(argv = process.argv.slice(2)) {
  const at = argv.indexOf("--slug");
  const slug = at >= 0 ? argv[at + 1] : undefined;
  const all = argv.includes("--all");
  if (!slug && !all) {
    console.error("usage: node scripts/generate-listings.mjs [--slug <slug>] [--all]");
    return 2;
  }
  // The key first: a run that cannot finish should not start.
  let apiKey;
  try { apiKey = resolveApiKey(); }
  catch (e) { console.error(e.message); return 2; }

  await initDb();
  console.log(slug ? `Generating a listing draft for ${slug}…` : "Generating listing drafts for every pack…");
  const results = slug
    ? [await generateForPack(slug, { apiKey })].map((r) => { console.log(line(r)); return r; })
    : await generateAll({ apiKey, onResult: (r) => console.log(line(r)) });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} draft(s) written, ${failed.length} failed.`);
  console.log("Nothing is live yet. Read each one at /packs/<slug>/listing and approve it there.");
  return failed.length > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main());
}
