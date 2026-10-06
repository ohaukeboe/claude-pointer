import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "../shared/**/*.test.ts"],
    testTimeout: 15_000,
    globalSetup: ["tests/support/global-setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts", "../shared/**/*.ts"],
      exclude: ["src/cli.ts", "**/*.test.ts", "../shared/fixtures.ts"],
      thresholds: { lines: 90 },
    },
  },
});
