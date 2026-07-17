import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    conditions: ["node"],
  },
  build: {
    rollupOptions: {
      // Node-only deps resolved from node_modules at runtime, not bundled.
      // pdf-parse is imported by subpath (pdf-parse/lib/pdf-parse.js), so match
      // the whole package with a regex.
      external: ["better-sqlite3", "electron", "electron-liquid-glass", /^pdf-parse(\/|$)/, "mammoth", "xlsx", "patchright"],
    },
  },
});
