/**
 * LSP Server Definitions - 30+ language servers with auto-install, root detection
 */
import * as path from "path";
import * as fs from "fs/promises";
import { execSync } from "child_process";

export interface LSPServerInfo {
  id: string;
  extensions: string[];
  command: string;
  args?: string[];
  env?: Record<string, string>;
  rootMarkers: string[];
  initialization?: Record<string, unknown>;
  install?: () => Promise<string | null>;
}

function which(cmd: string): string | null {
  try {
    return execSync(`which ${cmd}`, { encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
}

async function findRoot(filePath: string, markers: string[]): Promise<string> {
  let dir = path.dirname(filePath);
  while (dir !== path.dirname(dir)) {
    for (const marker of markers) {
      try {
        await fs.access(path.join(dir, marker));
        return dir;
      } catch {}
    }
    dir = path.dirname(dir);
  }
  return path.dirname(filePath);
}

export { findRoot };

export const SERVERS: LSPServerInfo[] = [
  {
    id: "typescript",
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"],
    command: "typescript-language-server",
    args: ["--stdio"],
    rootMarkers: ["tsconfig.json", "jsconfig.json", "package.json"],
    initialization: { typescript: { tsdk: "node_modules/typescript/lib" } },
    install: async () => {
      try { execSync("npm install -g typescript-language-server typescript", { stdio: "pipe" }); return "typescript-language-server"; } catch { return null; }
    },
  },
  {
    id: "deno",
    extensions: [".ts", ".tsx", ".js", ".jsx"],
    command: "deno",
    args: ["lsp"],
    rootMarkers: ["deno.json", "deno.jsonc"],
  },
  {
    id: "vue",
    extensions: [".vue"],
    command: "vue-language-server",
    args: ["--stdio"],
    rootMarkers: ["package.json", "vue.config.js"],
    install: async () => {
      try { execSync("npm install -g @vue/language-server", { stdio: "pipe" }); return "vue-language-server"; } catch { return null; }
    },
  },
  {
    id: "svelte",
    extensions: [".svelte"],
    command: "svelteserver",
    args: ["--stdio"],
    rootMarkers: ["svelte.config.js", "package.json"],
    install: async () => {
      try { execSync("npm install -g svelte-language-server", { stdio: "pipe" }); return "svelteserver"; } catch { return null; }
    },
  },
  {
    id: "astro",
    extensions: [".astro"],
    command: "astro-ls",
    args: ["--stdio"],
    rootMarkers: ["astro.config.mjs", "package.json"],
  },
  {
    id: "eslint",
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
    command: "vscode-eslint-language-server",
    args: ["--stdio"],
    rootMarkers: [".eslintrc", ".eslintrc.js", ".eslintrc.json", "eslint.config.js", "eslint.config.mjs"],
  },
  {
    id: "biome",
    extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
    command: "biome",
    args: ["lsp-proxy"],
    rootMarkers: ["biome.json", "biome.jsonc"],
  },
  {
    id: "gopls",
    extensions: [".go"],
    command: "gopls",
    args: ["serve"],
    rootMarkers: ["go.mod", "go.sum"],
    install: async () => {
      try { execSync("go install golang.org/x/tools/gopls@latest", { stdio: "pipe" }); return "gopls"; } catch { return null; }
    },
  },
  {
    id: "pyright",
    extensions: [".py", ".pyi"],
    command: "pyright-langserver",
    args: ["--stdio"],
    rootMarkers: ["pyproject.toml", "setup.py", "requirements.txt", "Pipfile"],
    install: async () => {
      try { execSync("npm install -g pyright", { stdio: "pipe" }); return "pyright-langserver"; } catch { return null; }
    },
  },
  {
    id: "rust-analyzer",
    extensions: [".rs"],
    command: "rust-analyzer",
    rootMarkers: ["Cargo.toml"],
  },
  {
    id: "clangd",
    extensions: [".c", ".cpp", ".cxx", ".cc", ".h", ".hpp"],
    command: "clangd",
    rootMarkers: ["compile_commands.json", "CMakeLists.txt", ".clangd"],
  },
  {
    id: "sourcekit-lsp",
    extensions: [".swift"],
    command: "sourcekit-lsp",
    rootMarkers: ["Package.swift", ".xcodeproj"],
  },
  {
    id: "csharp",
    extensions: [".cs", ".csx"],
    command: "OmniSharp",
    args: ["--languageserver"],
    rootMarkers: [".csproj", ".sln"],
  },
  {
    id: "fsharp",
    extensions: [".fs", ".fsi", ".fsx"],
    command: "fsautocomplete",
    args: ["--adaptive-lsp-server-enabled"],
    rootMarkers: [".fsproj", ".sln"],
  },
  {
    id: "java",
    extensions: [".java"],
    command: "jdtls",
    rootMarkers: ["pom.xml", "build.gradle", "build.gradle.kts", ".classpath"],
  },
  {
    id: "kotlin",
    extensions: [".kt", ".kts"],
    command: "kotlin-language-server",
    rootMarkers: ["build.gradle.kts", "build.gradle"],
  },
  {
    id: "ruby",
    extensions: [".rb", ".rake", ".gemspec"],
    command: "rubocop",
    args: ["--lsp"],
    rootMarkers: ["Gemfile", ".rubocop.yml"],
  },
  {
    id: "elixir",
    extensions: [".ex", ".exs"],
    command: "elixir-ls",
    rootMarkers: ["mix.exs"],
  },
  {
    id: "lua",
    extensions: [".lua"],
    command: "lua-language-server",
    rootMarkers: [".luarc.json", ".luacheckrc"],
    install: async () => {
      try { execSync("brew install lua-language-server", { stdio: "pipe" }); return "lua-language-server"; } catch { return null; }
    },
  },
  {
    id: "php",
    extensions: [".php"],
    command: "intelephense",
    args: ["--stdio"],
    rootMarkers: ["composer.json"],
    install: async () => {
      try { execSync("npm install -g intelephense", { stdio: "pipe" }); return "intelephense"; } catch { return null; }
    },
  },
  {
    id: "dart",
    extensions: [".dart"],
    command: "dart",
    args: ["language-server", "--protocol=lsp"],
    rootMarkers: ["pubspec.yaml"],
  },
  {
    id: "zig",
    extensions: [".zig"],
    command: "zls",
    rootMarkers: ["build.zig", "build.zig.zon"],
  },
  {
    id: "gleam",
    extensions: [".gleam"],
    command: "gleam",
    args: ["lsp"],
    rootMarkers: ["gleam.toml"],
  },
  {
    id: "ocaml",
    extensions: [".ml", ".mli"],
    command: "ocamllsp",
    rootMarkers: ["dune-project", ".ocamlformat"],
  },
  {
    id: "haskell",
    extensions: [".hs", ".lhs"],
    command: "haskell-language-server-wrapper",
    args: ["--lsp"],
    rootMarkers: ["stack.yaml", "cabal.project", "*.cabal"],
  },
  {
    id: "scala",
    extensions: [".scala", ".sc"],
    command: "metals",
    rootMarkers: ["build.sbt", "build.sc"],
  },
  {
    id: "bash",
    extensions: [".sh", ".bash", ".zsh"],
    command: "bash-language-server",
    args: ["start"],
    rootMarkers: [".bashrc", "package.json"],
    install: async () => {
      try { execSync("npm install -g bash-language-server", { stdio: "pipe" }); return "bash-language-server"; } catch { return null; }
    },
  },
  {
    id: "terraform",
    extensions: [".tf", ".tfvars"],
    command: "terraform-ls",
    args: ["serve"],
    rootMarkers: ["main.tf", ".terraform"],
  },
  {
    id: "yaml",
    extensions: [".yaml", ".yml"],
    command: "yaml-language-server",
    args: ["--stdio"],
    rootMarkers: ["package.json"],
    install: async () => {
      try { execSync("npm install -g yaml-language-server", { stdio: "pipe" }); return "yaml-language-server"; } catch { return null; }
    },
  },
  {
    id: "prisma",
    extensions: [".prisma"],
    command: "prisma-language-server",
    args: ["--stdio"],
    rootMarkers: ["schema.prisma"],
  },
  {
    id: "docker",
    extensions: [".dockerfile"],
    command: "docker-langserver",
    args: ["--stdio"],
    rootMarkers: ["Dockerfile", "docker-compose.yml"],
  },
  {
    id: "nix",
    extensions: [".nix"],
    command: "nixd",
    rootMarkers: ["flake.nix", "default.nix"],
  },
  {
    id: "clojure",
    extensions: [".clj", ".cljs", ".cljc"],
    command: "clojure-lsp",
    rootMarkers: ["deps.edn", "project.clj"],
  },
  {
    id: "julia",
    extensions: [".jl"],
    command: "julia",
    args: ["--startup-file=no", "-e", "using LanguageServer; runserver()"],
    rootMarkers: ["Project.toml"],
  },
  {
    id: "texlab",
    extensions: [".tex", ".latex"],
    command: "texlab",
    rootMarkers: [".latexmkrc", "main.tex"],
  },
  {
    id: "typst",
    extensions: [".typ"],
    command: "tinymist",
    rootMarkers: ["*.typ"],
  },
];

/** Find the best server for a given file extension */
export function findServersForExtension(ext: string): LSPServerInfo[] {
  return SERVERS.filter((s) => s.extensions.includes(ext));
}

/** Find a server by ID */
export function findServerById(id: string): LSPServerInfo | undefined {
  return SERVERS.find((s) => s.id === id);
}
