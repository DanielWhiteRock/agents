/**
 * One async query interface, two drivers.
 *
 * Postgres is the real target — the deployment needs it and SQLite cannot live
 * on a serverless host. SQLite stays as a zero-setup local driver so the app
 * runs with nothing installed, which is how every bug last night got found.
 *
 * SQL is written in Postgres dialect with `$1` placeholders; the SQLite driver
 * rewrites them positionally. Keeping one dialect in the source is the whole
 * point — two would rot.
 */
export type Row = Record<string, unknown>;

export interface Sql {
  readonly dialect: "postgres" | "sqlite";
  query<T = Row>(text: string, params?: unknown[]): Promise<T[]>;
  one<T = Row>(text: string, params?: unknown[]): Promise<T | undefined>;
  exec(text: string): Promise<void>;
  close(): Promise<void>;
}

// ----------------------------------------------------------------- postgres

export class PostgresSql implements Sql {
  readonly dialect = "postgres" as const;
  // Typed loosely: pg's own types are imported lazily so SQLite-only runs do
  // not need the dependency resolved at startup.
  private constructor(private readonly pool: { query: (t: string, p?: unknown[]) => Promise<{ rows: Row[] }>; end: () => Promise<void> }) {}

  /**
   * Connect, with patience.
   *
   * A managed database is not always there the moment a container is. It can
   * be finishing provisioning, failing over, or having its private route set
   * up — the first deploy of this app died on exactly that, seconds after the
   * database reported itself available. Crashing on the first refused
   * connection turns a blip into a crash loop, and leaves the logs blaming
   * the database for what is really impatience.
   *
   * So: a handful of tries with widening gaps, each one announced, and the
   * real error if it never comes up. Roughly half a minute of tolerance,
   * which covers a restart without hiding a genuine misconfiguration.
   */
  static async connect(url: string, attempts = 6): Promise<PostgresSql> {
    const { Pool } = await import("pg");
    return PostgresSql.fromPool(new Pool({ connectionString: url, max: 8, ...sslFor(url) }) as never, attempts);
  }

  /** The waiting, separated from the pool, so it can be tested without one. */
  static async fromPool(
    pool: { query: (t: string, p?: unknown[]) => Promise<{ rows: Row[] }>; end: () => Promise<void> },
    attempts = 6,
    sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)),
  ): Promise<PostgresSql> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await pool.query("SELECT 1");
        if (attempt > 1) console.log(`[db] connected on attempt ${attempt}`);
        return new PostgresSql(pool);
      } catch (e) {
        if (attempt >= attempts) {
          await pool.end().catch(() => {});
          throw e;
        }
        const wait = Math.min(8000, 500 * 2 ** (attempt - 1));
        console.log(`[db] not reachable yet (${(e as Error).message}); retrying in ${wait}ms`);
        await sleep(wait);
      }
    }
  }

  async query<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
    const r = await this.pool.query(text, params);
    return r.rows as T[];
  }
  async one<T = Row>(text: string, params: unknown[] = []): Promise<T | undefined> {
    return (await this.query<T>(text, params))[0];
  }
  async exec(text: string): Promise<void> { await this.pool.query(text); }
  async close(): Promise<void> { await this.pool.end(); }
}

/**
 * Whether to reach Postgres over TLS, and how strictly.
 *
 * A local container speaks plain TCP and a managed one requires TLS, so this
 * cannot be a constant. `DATABASE_SSL` decides it outright; otherwise the
 * connection string does, through the `sslmode` libpq already defines. The
 * default is off, which is the local container and is what every provider's
 * in-network URL also wants.
 *
 * `require` encrypts without checking who is on the other end — which is what
 * every managed provider's own instructions tell you to do, because they hand
 * out certificates signed by their private CA. It stops passive capture, not an
 * active impersonator. `verify-full` is the honest setting and needs the
 * provider's CA in the trust store; say so rather than pretending `require`
 * means verified.
 */
export function sslFor(
  url: string,
  env: Record<string, string | undefined> = process.env,
): { ssl?: { rejectUnauthorized: boolean } } {
  const mode = (env["DATABASE_SSL"] ?? sslModeFromUrl(url)).toLowerCase();
  if (mode === "off" || mode === "disable" || mode === "" || mode === "0") return {};
  return { ssl: { rejectUnauthorized: mode === "verify" || mode.startsWith("verify-") } };
}

function sslModeFromUrl(url: string): string {
  let params: URLSearchParams;
  try {
    params = new URL(url).searchParams;
  } catch {
    return "off"; // Not a URL we can read; leave the behaviour unchanged.
  }
  const mode = params.get("sslmode");
  if (mode) return mode;
  // `?ssl=true` is the non-libpq spelling several providers hand out.
  return params.get("ssl") === "true" ? "require" : "off";
}

// ------------------------------------------------------------------- sqlite

/** `$1, $2` → `?, ?` in first-appearance order, so one SQL string serves both. */
export function toSqlitePlaceholders(text: string, params: unknown[]): { text: string; params: unknown[] } {
  const order: number[] = [];
  const rewritten = text.replace(/\$(\d+)/g, (_m, n: string) => {
    order.push(Number(n) - 1);
    return "?";
  });
  return { text: rewritten, params: order.map((i) => params[i]) };
}

class SqliteSql implements Sql {
  readonly dialect = "sqlite" as const;
  private constructor(private readonly db: { prepare: (s: string) => { all: (...a: unknown[]) => unknown[]; run: (...a: unknown[]) => unknown }; exec: (s: string) => void; close: () => void }) {}

  static async open(path: string): Promise<SqliteSql> {
    const { DatabaseSync } = await import("node:sqlite");
    const { mkdirSync } = await import("node:fs");
    const { dirname } = await import("node:path");
    mkdirSync(dirname(path), { recursive: true });
    const db = new DatabaseSync(path);
    db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    return new SqliteSql(db as never);
  }

  async query<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
    const q = toSqlitePlaceholders(text, params);
    const stmt = this.db.prepare(q.text);
    const args = q.params.map(normaliseForSqlite);
    // node:sqlite has no RETURNING-aware run(); every statement goes through all().
    return stmt.all(...args) as T[];
  }
  async one<T = Row>(text: string, params: unknown[] = []): Promise<T | undefined> {
    return (await this.query<T>(text, params))[0];
  }
  async exec(text: string): Promise<void> { this.db.exec(text); }
  async close(): Promise<void> { this.db.close(); }
}

/** SQLite takes no booleans, no undefined, and no non-integer bigints. */
function normaliseForSqlite(v: unknown): unknown {
  if (v === undefined) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "bigint") return Number(v);
  return v;
}

// ------------------------------------------------------------------ factory

let current: Sql | null = null;

/**
 * Postgres when DATABASE_URL is set, SQLite otherwise. Nothing above this
 * module knows or cares which.
 */
export async function sql(): Promise<Sql> {
  if (current) return current;
  const url = process.env["DATABASE_URL"];
  current = url
    ? await PostgresSql.connect(url)
    : await SqliteSql.open(process.env["DB_PATH"] ?? "data/platform.db");
  return current;
}

export function setSql(s: Sql | null): void { current = s; }
