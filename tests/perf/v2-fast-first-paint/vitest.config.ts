import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.bench.ts"],
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },
});
