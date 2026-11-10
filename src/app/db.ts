import { sql } from "./sql.js";

/**
 * Schema in one dialect, with the two places the dialects genuinely differ
 * substituted per driver. Everything else — ON CONFLICT, CHECK, partial
 * indexes — is written once and works on both.
 */
const SCHEMA = `
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
  password_hash TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS user_sessions_user ON user_sessions(user_id);

CREATE TABLE IF NOT EXISTS invites (
  token TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','member')),
  invited_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  accepted_at TEXT
);
CREATE INDEX IF NOT EXISTS invites_org ON invites(org_id);

-- Bearer tokens for the MCP endpoint, so an agent can shop the catalog from
-- wherever it already runs. Scoped to one organisation, revocable, never shown
-- again after creation.
CREATE TABLE IF NOT EXISTS api_tokens (
  token TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS api_tokens_org ON api_tokens(org_id);

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
  effort TEXT NOT NULL DEFAULT '',
  pinned_models TEXT NOT NULL DEFAULT '[]',
  instructions TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'listed',
  author_payout_email TEXT,
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

-- Points are denominated in MONEY (cents), never tokens, so the model a buyer
-- picks cannot wreck unit economics. Earned points are cashable, which makes
-- this an accounting record: every row traces to what earned or spent it.
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
CREATE INDEX IF NOT EXISTS points_ledger_org ON points_ledger(org_id, created_at);

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
  active_seconds {REAL} NOT NULL DEFAULT 0,
  -- Latest cumulative cost observed from the platform, updated mid-turn.
  list_cost_cents INTEGER NOT NULL DEFAULT 0,
  -- How much of that has already been charged. Billing works on the gap:
  -- sharing one column would let a live snapshot overwrite the figure billing
  -- measures from, making every delta zero and charging nobody for anything.
  billed_up_to_cents INTEGER NOT NULL DEFAULT 0,
  billed_cents INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  ended_at TEXT
);
CREATE INDEX IF NOT EXISTS runs_org ON runs(org_id, started_at);

-- The transcript. Billing evidence, author feedback and dispute record in one.
CREATE TABLE IF NOT EXISTS run_events (
  id {PK_SERIAL},
  run_id TEXT NOT NULL REFERENCES runs(id),
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS run_events_run ON run_events(run_id, id);

-- A tool call that paused for a human. The platform default is always_allow,
-- so these exist only because a pack asked for them.
CREATE TABLE IF NOT EXISTS pending_asks (
  event_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  name TEXT NOT NULL,
  input TEXT NOT NULL,
  decision TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS pending_asks_run ON pending_asks(run_id);

CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  -- 'pack' buys an entitlement; 'points' buys compute. Null version for points.
  kind TEXT NOT NULL DEFAULT 'pack' CHECK (kind IN ('pack','points')),
  pack_version_id TEXT REFERENCES pack_versions(id),
  amount_cents INTEGER NOT NULL,
  provider TEXT NOT NULL,
  provider_ref TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending','paid','failed','refunded')),
  -- The refund window. The author's share is held until it closes, because a
  -- clawback after a payout is operationally painful.
  refundable_until TEXT,
  created_at TEXT NOT NULL,
  paid_at TEXT,
  refunded_at TEXT
);
CREATE INDEX IF NOT EXISTS purchases_org ON purchases(org_id, created_at);

CREATE TABLE IF NOT EXISTS payouts (
  id TEXT PRIMARY KEY,
  pack_id TEXT NOT NULL REFERENCES packs(id),
  recipient TEXT NOT NULL,
  millicents INTEGER NOT NULL,
  provider TEXT NOT NULL,
  provider_ref TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  paid_at TEXT
);

-- Stored in MILLICENTS. A 20% share of a two-cent turn is 0.4 of a cent; in
-- whole cents that floors to nothing and the author is paid zero for real work.
CREATE TABLE IF NOT EXISTS author_earnings (
  id TEXT PRIMARY KEY,
  pack_id TEXT NOT NULL REFERENCES packs(id),
  run_id TEXT NOT NULL REFERENCES runs(id),
  points_millicents INTEGER NOT NULL,
  -- Set once the earning has been paid out, so nothing is ever paid twice.
  payout_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS author_earnings_unpaid ON author_earnings(pack_id, payout_id);
`;

const SUBSTITUTIONS = {
  postgres: { "{PK_SERIAL}": "BIGSERIAL PRIMARY KEY", "{REAL}": "DOUBLE PRECISION" },
  sqlite: { "{PK_SERIAL}": "INTEGER PRIMARY KEY AUTOINCREMENT", "{REAL}": "REAL" },
} as const;

/** Defaults for every adjustable limit. Change the row, not the code. */
const DEFAULT_SETTINGS: Record<string, string> = {
  default_run_budget_cents: "50",
  topup_headroom_cents: "50",
  // The author's share of what a run costs, in basis points. 2000 = 20%.
  author_share_bps: "2000",
  "tier.personal.points_cents": "120",
  "tier.personal.concurrency": "5",
  "tier.personal.seats": "1",
  "tier.team.points_cents": "360",
  "tier.team.concurrency": "15",
  "tier.team.seats": "10",
  "tier.enterprise.points_cents": "720",
  "tier.enterprise.concurrency": "999",
  "tier.enterprise.seats": "500",
  allowed_models: "claude-opus-5,claude-sonnet-5,claude-haiku-4-5",
  // Models that reject the `effort` field outright with a 400.
  models_without_effort: "claude-haiku-4-5,claude-sonnet-4-5-20250929",
  environment_name: "alphaceo-agents",
  // Days a buyer may ask for their money back. The author's share is held for
  // the same period, then becomes payable.
  refund_window_days: "14",
};

/**
 * Additive column migrations. CREATE TABLE IF NOT EXISTS cannot add a column,
 * and SQLite has no ADD COLUMN IF NOT EXISTS, so each is attempted and a
 * failure means it is already there.
 */
const MIGRATIONS = [
  "ALTER TABLE users ADD COLUMN password_hash TEXT",
  "ALTER TABLE runs ADD COLUMN billed_up_to_cents INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE packs ADD COLUMN author_org_id TEXT",
  "ALTER TABLE author_earnings ADD COLUMN payout_id TEXT",
  "ALTER TABLE packs ADD COLUMN author_payout_email TEXT",
  "ALTER TABLE purchases ADD COLUMN kind TEXT NOT NULL DEFAULT 'pack'",
];

let ready: Promise<void> | null = null;

export async function initDb(): Promise<void> {
  if (!ready) ready = bootstrap();
  return ready;
}

async function bootstrap(): Promise<void> {
  const s = await sql();
  let schema = SCHEMA;
  for (const [token, value] of Object.entries(SUBSTITUTIONS[s.dialect])) {
    schema = schema.split(token).join(value);
  }
  await s.exec(schema);
  for (const sqlText of MIGRATIONS) {
    try { await s.exec(sqlText); } catch { /* already applied */ }
  }
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await s.query("INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING", [key, value]);
  }
}

export async function setting(key: string): Promise<string> {
  const s = await sql();
  const row = await s.one<{ value: string }>("SELECT value FROM settings WHERE key = $1", [key]);
  if (!row) throw new Error(`missing setting: ${key}`);
  return row.value;
}

export async function settingInt(key: string): Promise<number> {
  const n = Number(await setting(key));
  if (!Number.isFinite(n)) throw new Error(`setting ${key} is not a number`);
  return n;
}

export async function putSetting(key: string, value: string): Promise<void> {
  const s = await sql();
  await s.query(
    "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    [key, value]);
}

export async function allSettings(): Promise<Array<{ key: string; value: string }>> {
  const s = await sql();
  return s.query<{ key: string; value: string }>("SELECT key, value FROM settings ORDER BY key");
}

export const now = (): string => new Date().toISOString();
export const id = (prefix: string): string =>
  `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
