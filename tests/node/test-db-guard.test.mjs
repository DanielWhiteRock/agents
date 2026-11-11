import test from "node:test";
import assert from "node:assert/strict";
import { isTestDatabase } from "../../scripts/check-test-db.mjs";

test("no DATABASE_URL is allowed: that run is on its own sqlite file", () => {
  assert.equal(isTestDatabase(""), true);
  assert.equal(isTestDatabase(undefined), true);
});

test("a database whose name says test is allowed", () => {
  for (const name of ["agents_test", "test_agents", "agents-test", "test", "agents_test_2"]) {
    assert.equal(isTestDatabase(`postgres://u:p@localhost:5433/${name}`), true, name);
  }
});

test("the development database is refused, which is the case that bit us", () => {
  assert.equal(isTestDatabase("postgres://agents:agents@localhost:5433/agents"), false);
});

test("a production-looking URL is refused", () => {
  assert.equal(
    isTestDatabase("postgres://u:p@dpg-abc123-a.frankfurt-postgres.render.com/agents_prod"), false);
});

test("a name that merely contains the letters test is not a test database", () => {
  assert.equal(isTestDatabase("postgres://u:p@localhost/attestations"), false);
  assert.equal(isTestDatabase("postgres://u:p@localhost/latest"), false);
});

test("an unparseable or nameless URL is refused rather than assumed safe", () => {
  assert.equal(isTestDatabase("not a url"), false);
  assert.equal(isTestDatabase("postgres://u:p@localhost:5433/"), false);
});
