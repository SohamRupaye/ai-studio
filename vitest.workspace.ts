import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "packages/tokenizer/vitest.config.ts",
  "packages/providers/vitest.config.ts",
  "packages/database/vitest.config.ts",
  "packages/prompt-engine/vitest.config.ts",
  "packages/graph-engine/vitest.config.ts",
  "packages/context-engine/vitest.config.ts",
  "packages/ai-core/vitest.config.ts",
  "packages/tools-runtime/vitest.config.ts",
  "apps/desktop/vitest.config.ts",
]);
