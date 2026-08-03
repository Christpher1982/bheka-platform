import { defineConfig } from "vitest/config";

// Integration tests (src/routes/v1/agent-events.test.ts) need a real Postgres +
// Redis reachable via DATABASE_URL / REDIS_URL, same as `pnpm run dev` — see the
// repo root README/setup for how to stand those up locally. Unit tests
// (src/rules/evaluate.test.ts) have no such dependency.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
