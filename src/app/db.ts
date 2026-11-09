import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const DB_PATH = process.env["DB_PATH"] ?? "data/platform.db";

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Every limit is a row, not a constant: the subsidy must be dialable without a deploy.
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orgs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tier TEXT NOT NULL,
  concurrency_limit INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS packs (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  tagline TEXT NOT NULL,
  author TEXT NOT NULL,
  author_org_id TEXT,
  price_cents INTEGER NOT NULL,
  upgrade_points INTEGER NOT NULL,
  model TEXT NOT NULL,
  -- empty string means this model takes no effort setting
  effort TEXT NOT NULL DEFAULT '',
  pinned_models TEXT NOT NULL DEFAULT '[]',
  instructions TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'listed',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pack_versions (
  id TEXT PRIMARY KEY,
  pack_id TEXT NOT NULL REFERENCES packs(id),
  version INTEGER NOT NULL,
  runtime_pack_id TEXT NOT NULL,
  runtime_version TEXT NOT NULL,
  instructions TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (pack_id, version)
);

-- Owned by the organisation, never by the purchasing user.
CREATE TABLE IF NOT EXISTS entitlements (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  pack_version_id TEXT NOT NULL REFERENCES pack_versions(id),
  acquired_at TEXT NOT NULL,
  UNIQUE (org_id, pack_version_id)
);

-- Points are denominated in MONEY (cents), never tokens, so model choice cannot
-- wreck unit economics. Three buckets with different expiry and cash status.
CREATE TABLE IF NOT EXISTS points_ledger (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  bucket TEXT NOT NULL CHECK (bucket IN ('grant','topup','earning')),
  delta_cents INTEGER NOT NULL,
  reason TEXT NOT NULL,
  run_id TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  pack_version_id TEXT NOT NULL REFERENCES pack_versions(id),
  session_id TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL,
  stop_reason TEXT,
  budget_cents INTEGER NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  active_seconds REAL NOT NULL DEFAULT 0,
  list_cost_cents INTEGER NOT NULL DEFAULT 0,
  billed_cents INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  ended_at TEXT
);

-- The transcript. Billing evidence, author feedback and dispute record in one.
CREATE TABLE IF NOT EXISTS run_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES runs(id),
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS run_events_run ON run_events(run_id, id);

-- A tool call that paused for a human. The platform default is always_allow, so
-- these only exist because the pack asked for them.
CREATE TABLE IF NOT EXISTS pending_asks (
  event_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  name TEXT NOT NULL,
  input TEXT NOT NULL,
  decision TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS pending_asks_run ON pending_asks(run_id, decision);

-- Stored in MILLICENTS. A 20% share of a two-cent turn is 0.4 of a cent; in
-- whole cents that floors to nothing and the author is paid zero for real work.
CREATE TABLE IF NOT EXISTS author_earnings (
  id TEXT PRIMARY KEY,
  pack_id TEXT NOT NULL REFERENCES packs(id),
  run_id TEXT NOT NULL REFERENCES runs(id),
  points_millicents INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
`;

export type Db = DatabaseSync;

let db: Db | null = null;

export function getDb(): Db {
  if (db) return db;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec(SCHEMA);
  seedSettings(db);
  return db;
}

/** Defaults for every adjustable limit. Change the row, not the code. */
const DEFAULT_SETTINGS: Record<string, string> = {
  // What a run is allowed to cost before it pauses, in cents.
  default_run_budget_cents: "50",
  // Headroom added when a buyer tops up a capped run, in cents.
  topup_headroom_cents: "50",
  // Author's share of what a run costs, in basis points. 2000 = 20%.
  author_share_bps: "2000",
  // Monthly grant and concurrency per tier, in cents of compute.
  "tier.personal.points_cents": "120",
  "tier.personal.concurrency": "5",
  "tier.team.points_cents": "360",
  "tier.team.concurrency": "15",
  "tier.enterprise.points_cents": "720",
  "tier.enterprise.concurrency": "999",
  // Models a buyer may pick. A pack may narrow this further via pinned_models.
  allowed_models: "claude-opus-5,claude-sonnet-5,claude-haiku-4-5",
  // Models that reject the `effort` field outright (400). Effort is omitted for these.
  models_without_effort: "claude-haiku-4-5,claude-sonnet-4-5-20250929",
  environment_name: "alphaceo-agents",
};

function seedSettings(d: Db): void {
  const ins = d.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) ins.run(k, v);
}

export function setting(key: string): string {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value?: string } | undefined;
  if (row?.value === undefined) throw new Error(`missing setting: ${key}`);
  return row.value;
}

export function settingInt(key: string): number {
  const n = Number(setting(key));
  if (!Number.isFinite(n)) throw new Error(`setting ${key} is not a number`);
  return n;
}

export function putSetting(key: string, value: string): void {
  getDb().prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

export function allSettings(): Array<{ key: string; value: string }> {
  return getDb().prepare("SELECT key, value FROM settings ORDER BY key").all() as Array<{ key: string; value: string }>;
}

export const now = (): string => new Date().toISOString();
export const id = (prefix: string): string => `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
