import { defineConfig } from "vitest/config";
import base from "../../tooling/vitest/base.config.ts";

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ["src/__tests__/**/*.test.ts"],
  },
});
