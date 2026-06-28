import { defineConfig } from "vite";

// The preload and main entries are both named `index.ts`, which makes Vite emit
// both as `.vite/build/index.js` — the main build overwrites the preload.
// Force a distinct output filename so both survive in `.vite/build/`.
export default defineConfig({
  build: {
    rollupOptions: {
      input: "src/preload/index.ts",
      external: ["electron"],
      output: {
        format: "cjs",
        entryFileNames: "preload.js",
        chunkFileNames: "preload-[name].js",
        inlineDynamicImports: true,
      },
    },
  },
});
