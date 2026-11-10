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
  price_cents INTEGER NOT NULL DEFAULT 0,
  price_points INTEGER NOT NULL DEFAULT 0,
  tags TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT '',
  image TEXT,
  upgrade_points INTEGER NOT NULL,
  model TEXT NOT NULL,
  effort TEXT NOT NULL DEFAULT '',
  pinned_models TEXT NOT NULL DEFAULT '[]',
  -- Prebuilt skills, an advisor model and web domain pinning: things the
  -- runtime supports that a pack has to be able to ask for.
  extras TEXT NOT NULL DEFAULT '{}',
  instructions TEXT NOT NULL,
  -- draft: only the author sees it. review: submitted for curation.
  -- listed: in the catalog. unlisted: withdrawn, existing buyers unaffected.
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','review','listed','unlisted')),
  author_payout_email TEXT,
  created_at TEXT NOT NULL
);

-- A pack is a folder. These are its files, in the layout Claude Code plugins
-- use: agent.md, skills/<name>/SKILL.md, agents/, commands/, hooks/, docs/.
CREATE TABLE IF NOT EXISTS pack_files (
  pack_id TEXT NOT NULL REFERENCES packs(id),
  path TEXT NOT NULL,
  content TEXT NOT NULL,
  PRIMARY KEY (pack_id, path)
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

-- The folder as it was when this version was published, so a buyer exports
-- exactly what they bought however the author edits it afterwards.
CREATE TABLE IF NOT EXISTS pack_version_files (
  pack_version_id TEXT NOT NULL REFERENCES pack_versions(id),
  path TEXT NOT NULL,
  content TEXT NOT NULL,
  PRIMARY KEY (pack_version_id, path)
);

-- Pack files uploaded once per version and mounted into every session, so the
-- whole folder is on the machine rather than only its skills.
CREATE TABLE IF NOT EXISTS pack_version_mounts (
  pack_version_id TEXT NOT NULL REFERENCES pack_versions(id),
  path TEXT NOT NULL,
  file_id TEXT NOT NULL,
  mount_path TEXT NOT NULL,
  PRIMARY KEY (pack_version_id, path)
);

-- The platform skills uploaded for a version, so a republish does not orphan
-- them and an export can say which skills a pack shipped.
CREATE TABLE IF NOT EXISTS pack_version_skills (
  pack_version_id TEXT NOT NULL REFERENCES pack_versions(id),
  name TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  skill_version TEXT NOT NULL,
  PRIMARY KEY (pack_version_id, name)
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
  -- Thousandths of a point. A short turn costs about a hundredth of a point,
  -- so whole points would round every small run to nothing or to one.
  delta_millipoints INTEGER NOT NULL,
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
  -- A trial is a capped run on a pack the organisation does not own: the way a
  -- buyer judges a pack without the author handing it over.
  is_trial INTEGER NOT NULL DEFAULT 0,
  turn_count INTEGER NOT NULL DEFAULT 0,
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

-- Deliverables a run produced, so a pack whose output is a file has somewhere
-- to put it that the buyer can actually reach.
CREATE TABLE IF NOT EXISTS run_outputs (
  run_id TEXT NOT NULL REFERENCES runs(id),
  file_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id, file_id)
);

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

-- A standing instruction: run this pack on this brief, on this cadence. The
-- design calls recurring work the honest justification for a subscription.
CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  pack_version_id TEXT NOT NULL REFERENCES pack_versions(id),
  name TEXT NOT NULL,
  prompt TEXT NOT NULL,
  cadence TEXT NOT NULL CHECK (cadence IN ('hourly','daily','weekly')),
  -- UTC, so a schedule does not drift with anyone's clock.
  hour INTEGER NOT NULL DEFAULT 9,
  weekday INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT,
  last_run_id TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS schedules_org ON schedules(org_id);

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
  // A pack that ships a folder reads its command file, its skills and their
  // references before it answers. 50c capped a real audit mid-sentence.
  default_run_budget_cents: "150",
  topup_headroom_cents: "50",
  // The author's share of what a run costs, in basis points. 2000 = 20%.
  author_share_bps: "2000",
  "tier.personal.points_millipoints": "120000",
  "tier.personal.concurrency": "5",
  "tier.personal.seats": "1",
  "tier.team.points_millipoints": "360000",
  "tier.team.concurrency": "15",
  "tier.team.seats": "10",
  "tier.enterprise.points_millipoints": "720000",
  "tier.enterprise.concurrency": "999",
  "tier.enterprise.seats": "500",
  allowed_models: "claude-opus-5,claude-sonnet-5,claude-haiku-4-5",
  // How much context each model has, so the trace can say how full it is.
  // Adjustable, because this moves and a wrong constant here would quietly
  // mislead rather than fail.
  model_context_windows: "claude-opus-5=200000,claude-sonnet-5=200000,claude-haiku-4-5=200000",
  // How long a finished run's transcript is kept before it is deleted, here and
  // at the provider. Managed Agents keeps session transcripts until something
  // explicitly deletes them, so "we never got round to it" is a retention
  // policy of forever — which is not one anybody chose. 0 keeps them forever,
  // deliberately rather than by default.
  transcript_retention_days: "90",
  // Points per dollar, taken from the Personal tier: 120 points for $5. It is
  // the rate at which points are sold, not the rate at which they are spent —
  // a point buys a cent of compute, so the gap between 24 and 100 is the
  // subsidy §8.3 says we are choosing to pay. Adjustable like every limit.
  // Solved from the tier table: Personal is 120 points for 5M in and 1M out,
  // and output lists at five times input, so 5a + 5a = 120 gives 12 and 60.
  // Team lands on exactly 360 at the same rate. Enterprise computes to 1260
  // against a table that says 720, so that tier is 1.75x more generous — a
  // volume discount if intended, and worth checking if not.
  points_per_mtok_in: "12",
  points_per_mtok_out: "60",
  // Models that reject the `effort` field outright with a 400.
  models_without_effort: "claude-haiku-4-5,claude-sonnet-4-5-20250929",
  environment_name: "alphaceo-agents",
  // Days a buyer may ask for their money back. The author's share is held for
  // the same period, then becomes payable.
  refund_window_days: "14",
  // A trial: how many turns a buyer gets on a pack they do not own, and what it
  // may cost. Their own points pay for it, which is what stops it being free
  // compute forever.
  // What happens when an agent reaches for bash, write, edit or a spending
  // tool. always_ask pauses for a human; always_allow runs it unattended (the
  // platform's own default); auto lets the server judge each call. Takes effect
  // on a pack's NEXT publish, because it is baked into the agent config.
  destructive_tool_policy: "always_allow",
  trial_turns: "3",
  // 15c was too tight once a pack ships a folder: reading its command file, two
  // SKILL.md files and a reference costs real tokens before the agent answers.
  trial_budget_cents: "40",
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
  "ALTER TABLE runs ADD COLUMN is_trial INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE runs ADD COLUMN turn_count INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE packs ADD COLUMN extras TEXT NOT NULL DEFAULT '{}'",
  "ALTER TABLE pack_versions ADD COLUMN system_tokens INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE runs ADD COLUMN transcript_purged_at TEXT",
  // Points stopped being cents of compute and became what the tier table
  // always said they were: a share of a token allowance. An old row holding
  // 120 meant 120 points and still does — only the resolution changed, so the
  // conversion is a multiply. It must happen exactly once, which is what the
  // ledger below is for.
  "ALTER TABLE points_ledger RENAME COLUMN delta_cents TO delta_millipoints",
  "UPDATE points_ledger SET delta_millipoints = delta_millipoints * 1000",
  "ALTER TABLE runs ADD COLUMN points_millipoints INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE packs ADD COLUMN price_points INTEGER NOT NULL DEFAULT 0",
  // What a pack is for, in a buyer's words. Categories are not a second table
  // to keep in step — they are whatever authors have actually tagged, counted.
  "ALTER TABLE packs ADD COLUMN tags TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE packs ADD COLUMN image TEXT",
  // The job, not the topic. A role is a different kind of fact from a tag:
  // tags are free text an author picks and the shelf counts, a role is one of
  // a short list we commit to and can be empty. Deriving one from the other
  // was right for topics and wrong for jobs.
  "ALTER TABLE packs ADD COLUMN role TEXT NOT NULL DEFAULT ''",
  // A pack has to be affordable from the allowance it will be run on: Personal
  // is 120 points a month, so a premium worker lands near half of one and
  // leaves something to run it with.
  "UPDATE packs SET price_points = price_cents / 400 WHERE price_points = 0 AND price_cents > 0",
];

/**
 * The organisation that curates the catalog. The design says a thin curated
 * shelf beats a full unreliable one and that the owner is the taste, so
 * somebody has to be the owner — the first organisation to sign up.
 */
export async function platformOrgId(): Promise<string | null> {
  const s = await sql();
  const row = await s.one<{ value: string }>("SELECT value FROM settings WHERE key = 'platform_org_id'");
  return row?.value || null;
}

export async function claimPlatformOrg(orgId: string): Promise<void> {
  const s = await sql();
  await s.query(
    "INSERT INTO settings (key, value) VALUES ('platform_org_id', $1) ON CONFLICT (key) DO NOTHING", [orgId]);
}

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
  // Applied migrations are written down.
  //
  // They used to be re-run on every boot and swallow their own errors, which
  // is fine for `ADD COLUMN` and catastrophic for anything that changes data:
  // a one-time cleanup here deleted every row of the points ledger, and then
  // did it again on the next restart. Nothing destructive is safe without a
  // record of what has already happened.
  await s.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const done = new Set((await s.query<{ name: string }>("SELECT name FROM schema_migrations"))
    .map((r) => r.name));
  for (const [i, sqlText] of MIGRATIONS.entries()) {
    const name = `${String(i).padStart(3, "0")}:${sqlText.slice(0, 120)}`;
    if (done.has(name)) continue;
    // An ADD COLUMN that is already there still throws; that is applied, not
    // failed, so it is recorded either way.
    try { await s.exec(sqlText); } catch { /* already present */ }
    await s.query("INSERT INTO schema_migrations (name, applied_at) VALUES ($1, $2)", [name, now()]);
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
