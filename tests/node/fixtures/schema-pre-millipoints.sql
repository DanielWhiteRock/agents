-- The schema as it stood before the millipoints rename, captured verbatim from
-- `src/app/db.ts` at commit 8101fd6^ ("a point is a share of the token
-- allowance, not a cent of compute" is 8101fd6 itself).
--
-- This is the shape a long-running deployment is actually in: `points_ledger`
-- still counts `delta_cents`, `packs.price_cents` is NOT NULL with no default,
-- there is no `price_points`, and there is no `schema_migrations` table —
-- migrations used to be re-run on every boot and never written down.
--
-- `tests/node/upgrade.test.mjs` builds a database from this, puts rows in it,
-- and then points the *current* build at it. Nothing else should edit this
-- file: it is a historical record, not a schema to keep current. A new
-- migration is proved by this fixture still arriving at today's schema, which
-- is what that test asserts.
--
-- `{REAL}` and `{PK_SERIAL}` are the same per-dialect tokens `db.ts` uses.

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
