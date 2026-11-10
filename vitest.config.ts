import { defineConfig } from "vitest/config";

// Unit tests only. Anything that touches node:sqlite runs on Node's own test
// runner against the build (`tests/node/`), because Vite's builtin list does
// not yet include node:sqlite and it tries to resolve it as a package.
export default defineConfig({
  test: { include: ["tests/**/*.test.ts"] },
});
