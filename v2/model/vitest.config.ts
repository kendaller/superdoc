import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig from "../../vitest.baseConfig";

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: ["test/**/*.test.ts"],
      testTimeout: 30_000,
      environment: "node",
    },
  }),
);
