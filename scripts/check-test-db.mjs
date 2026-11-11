/**
 * Refuse to run the integration suite against a database somebody is using.
 *
 * The suite writes fixtures directly — packs, orgs, runs, ledger rows — and
 * never cleans up, because a test that tidies after itself hides the bugs that
 * only appear on a database with history. That is fine against a database the
 * suite owns and wrong against any other: pointed at the development database
 * it left 135 fixture packs on the shelf, inflated every figure the front page
 * prints, and then failed twenty of its own assertions because the rows it
 * counted were not the rows it wrote.
 *
 * So the name has to say the database is disposable. This mirrors the seed's
 * `guardEnvironment`, which refuses a Postgres target for the same reason:
 * cheaper to be told now than to work out later which rows were real.
 */

/** Whether `url` names a database the integration suite may write to. */
export function isTestDatabase(url) {
  if (!url) return true;                       // no URL means sqlite, which is per-run
  let name;
  try {
    name = new URL(url).pathname.replace(/^\//, "");
  } catch {
    return false;                              // unparseable is not provably disposable
  }
  if (name === "") return false;
  return /(^|[_-])test([_-]|$)/.test(name) || name.endsWith("_test");
}

const url = process.env.DATABASE_URL ?? "";
if (!isTestDatabase(url)) {
  let shown = url;
  try { const u = new URL(url); u.password = ""; u.username = ""; shown = u.href; } catch { /* print as given */ }
  process.stderr.write(
    `\nThe integration suite will not run against this database:\n  ${shown}\n\n` +
    `It writes fixtures and never cleans up, so it needs a database it owns.\n` +
    `Name one with "test" in it and point DATABASE_URL at that:\n\n` +
    `  createdb agents_test\n` +
    `  DATABASE_URL=postgres://.../agents_test npm run test:integration\n\n` +
    `Or unset DATABASE_URL to run the same suite on sqlite.\n\n`);
  process.exit(1);
}
