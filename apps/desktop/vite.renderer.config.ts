import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src/renderer"),
      "@renderer": resolve(__dirname, "src/renderer"),
    },
    conditions: ["browser"],
  },
  optimizeDeps: {
    // Workspace packages with runtime exports must NOT be prebundled: the
    // dep-optimizer cache doesn't invalidate when a workspace dist rebuilds
    // (no version bump), so new exports throw "does not provide an export
    // named …" until node_modules/.vite is deleted. Serving the dist
    // directly always picks up the current build. (dist is dependency-free
    // ESM, so exclusion is safe.)
    exclude: ["@ai-studio/shared"],
  },
});
