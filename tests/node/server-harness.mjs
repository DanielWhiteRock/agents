// A small helper for HTTP-level tests: spin up the *real*, built server
// (dist/src/app/server.js) as its own process, on an ephemeral port, against
// its own throwaway SQLite file. The functions underneath each route are
// already covered by the test files alongside this one; what those tests
// cannot see is the HTTP layer itself — the session gate, redirects, status
// codes, `ownerOnly()` — because `route()` is not exported and `server.ts`
// exports nothing to call directly. Driving it with `fetch`, the way a
// browser or `curl` would, is the only way to pin that layer down.
//
// Other `tests/node/*.test.mjs` files can import `startServer` and
// `signUpCookie` from here rather than reinventing this per file.
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Ports are picked per call, spread out, so two server instances started in
// quick succession (or a stale one still releasing its socket) don't collide.
let nextPort = 49200 + Math.floor(Math.random() * 4000);

/**
 * Starts the built server on its own port and SQLite file, and waits for
 * `/healthz` to answer before handing back. `dbPath` is returned alongside
 * `baseUrl` so a caller that needs a fixture the HTTP surface has no route
 * for (a second organisation's member, say) can point its own
 * `process.env.DB_PATH` at the exact same file before importing the domain
 * modules directly — SQLite's WAL mode is built for one writer across
 * multiple processes, which is exactly this.
 *
 * Call `stop()` once done with it.
 */
export async function startServer() {
  const port = nextPort++;
  const dbPath = join(mkdtempSync(join(tmpdir(), "http-")), "t.db");
  const child = spawn(process.execPath, ["dist/src/app/server.js"], {
    cwd: ROOT,
    // DATABASE_URL is cleared explicitly: an ambient one in the parent
    // environment would otherwise point this server at a shared Postgres
    // instead of its own disposable SQLite file.
    env: { ...process.env, PORT: String(port), DB_PATH: dbPath, DATABASE_URL: "", NODE_ENV: "test" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (c) => { stderr += c; });

  const baseUrl = `http://localhost:${port}`;
  const deadline = Date.now() + 15_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`server exited early (code ${child.exitCode}): ${stderr}`);
    try {
      const res = await fetch(`${baseUrl}/healthz`);
      if (res.ok) break;
    } catch { /* not accepting connections yet */ }
    if (Date.now() > deadline) throw new Error(`server never answered /healthz on ${baseUrl}: ${stderr}`);
    await new Promise((r) => setTimeout(r, 50));
  }

  return {
    baseUrl,
    dbPath,
    stop: () => new Promise((resolve) => {
      child.once("exit", () => resolve());
      child.kill();
    }),
  };
}

/**
 * Signs up a fresh organisation through the real `POST /signup` form and
 * returns the `Cookie` header value for the owner it creates — the same
 * session a browser would get.
 */
export async function signUpCookie(baseUrl, over = {}) {
  const n = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const body = new URLSearchParams({
    name: "Test Owner", email: `owner-${n}@example.com`, orgName: `Org ${n}`,
    password: "correct-horse-battery-staple",
    ...over,
  });
  const res = await fetch(`${baseUrl}/signup`, { method: "POST", body, redirect: "manual" });
  const cookie = res.headers.get("set-cookie");
  if (!cookie) throw new Error(`signup did not set a session cookie (status ${res.status}): ${await res.text()}`);
  return cookie.split(";")[0];
}
