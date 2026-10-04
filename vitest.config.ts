import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts"],
    // Many tests run real scans, git, and worker threads; 5 s is too tight on loaded CI runners.
    testTimeout: 30_000,
  },
});
