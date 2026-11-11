// MCP-specific helpers for tests/node/*.test.mjs files that drive `/mcp`.
//
// `/mcp` authenticates with a bearer token, not a cookie (`A.orgFromApiToken`,
// `src/app/server.ts`), minted through the real `POST /tokens` form — so a
// test needs a session cookie (from `signUpCookie` in `server-harness.mjs`)
// before it can mint one, and a token before it can call a tool.
//
// This file is deliberately not named `*.test.mjs`: the integration suite
// globs `tests/node/*.test.mjs`, and a file that both exported these helpers
// and ran its own `before`/`after`/`test(...)` at module scope would start a
// second server as a side effect of merely being imported for its exports.
// Other `tests/node/*.test.mjs` files — `mcp-shelf.test.mjs` and whatever
// later MCP tool tests follow it — import `mintToken` and `callTool` from
// here rather than reinventing them per file. `startServer` and
// `signUpCookie` themselves still come straight from `server-harness.mjs`.

/** Mints a bearer token for a signed-in cookie, via the real `/tokens` form. */
export async function mintToken(baseUrl, cookie) {
  const res = await fetch(`${baseUrl}/tokens`, {
    method: "POST", redirect: "manual",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ name: "test token" }),
  });
  const loc = res.headers.get("location");
  const token = loc ? new URL(loc, baseUrl).searchParams.get("new") : null;
  if (!token) throw new Error(`no token minted (status ${res.status}, location ${loc})`);
  return token;
}

/**
 * One JSON-RPC `tools/call` over `/mcp`, authenticated with a bearer token.
 * The transport answers as Server-Sent Events even for a single request, so
 * the body is parsed for its one `data:` line rather than as plain JSON.
 */
export async function callTool(baseUrl, token, name, args = {}) {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const raw = await res.text();
  const line = raw.split("\n").find((l) => l.startsWith("data: "));
  const payload = JSON.parse(line ? line.slice(6) : raw);
  if (payload.error) throw new Error(`${name} failed (${res.status}): ${payload.error.message}`);
  return payload.result.content[0].text;
}
