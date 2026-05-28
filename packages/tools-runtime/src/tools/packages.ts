/**
 * packages.ts — Package manager integration.
 * Detects the active package manager (npm/pnpm/yarn/bun/cargo/pip/go modules)
 * and provides: listing deps, adding/removing packages, checking for outdated.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ToolDefinition } from "../types.js";
import type { ToolHandler } from "../registry.js";

// ── Detection ─────────────────────────────────────────────────────────────────

type PkgManager = "npm" | "pnpm" | "yarn" | "bun" | "cargo" | "pip" | "go";

function detectPackageManager(root: string): PkgManager {
  if (existsSync(join(root, "bun.lockb"))) return "bun";
  if (existsSync(join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(root, "yarn.lock"))) return "yarn";
  if (existsSync(join(root, "package-lock.json")) || existsSync(join(root, "package.json"))) return "npm";
  if (existsSync(join(root, "Cargo.toml"))) return "cargo";
  if (existsSync(join(root, "go.mod"))) return "go";
  if (existsSync(join(root, "requirements.txt")) || existsSync(join(root, "pyproject.toml"))) return "pip";
  return "npm";
}

function run(cmd: string, cwd: string, timeoutMs = 30_000): { stdout: string; stderr: string; ok: boolean } {
  try {
    const stdout = execSync(cmd, { cwd, encoding: "utf-8", timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 });
    return { stdout, stderr: "", ok: true };
  } catch (e: any) {
    return { stdout: e.stdout?.toString() || "", stderr: e.stderr?.toString() || e.message, ok: false };
  }
}

// ── Tool: list_dependencies ───────────────────────────────────────────────────

export const listDependenciesDef: ToolDefinition = {
  name: "list_dependencies",
  description: "List the current project's dependencies with their versions. Detects npm/pnpm/yarn/bun/cargo/pip/go automatically.",
  parameters: {
    type: "object",
    properties: {
      project_root: { type: "string", description: "Project root (default: cwd)" },
      dev: { type: "boolean", description: "Include dev dependencies (JS) — default true" },
    },
    required: [],
  },
};

export const listDependencies: ToolHandler = async (args) => {
  const root = (args["project_root"] as string) || process.cwd();
  const includeDev = args["dev"] !== false;
  const pm = detectPackageManager(root);

  if (pm === "npm" || pm === "pnpm" || pm === "yarn" || pm === "bun") {
    // Parse package.json for clean structured output
    const pkgPath = join(root, "package.json");
    if (!existsSync(pkgPath)) return "No package.json found.";
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    const deps: string[] = [];

    const prodDeps = Object.entries(pkg.dependencies || {}) as [string, string][];
    const devDeps = Object.entries(pkg.devDependencies || {}) as [string, string][];

    if (prodDeps.length) {
      deps.push("Dependencies:");
      for (const [name, ver] of prodDeps) deps.push(`  ${name.padEnd(35)} ${ver}`);
    }
    if (includeDev && devDeps.length) {
      deps.push("\nDev Dependencies:");
      for (const [name, ver] of devDeps) deps.push(`  ${name.padEnd(35)} ${ver}`);
    }

    // Also get installed versions from node_modules if possible
    const installedCmd = pm === "npm" ? "npm ls --depth=0 --json 2>/dev/null" :
      pm === "pnpm" ? "pnpm ls --depth=0 --json 2>/dev/null" :
      pm === "yarn" ? "yarn list --depth=0 --json 2>/dev/null" :
      "bun pm ls 2>/dev/null";

    const { stdout } = run(installedCmd, root, 15_000);
    if (stdout && pm !== "bun") {
      try {
        const data = JSON.parse(stdout.trim());
        const installed = data.dependencies || {};
        deps.push("\nInstalled (resolved versions):");
        for (const [name, info] of Object.entries(installed) as [string, any][]) {
          deps.push(`  ${name.padEnd(35)} ${info.version || "?"}`);
        }
      } catch {}
    }

    return deps.join("\n") || "No dependencies found.";
  }

  if (pm === "cargo") {
    const { stdout, ok } = run("cargo tree --depth 1", root, 30_000);
    return ok ? stdout.slice(0, 5000) : "Could not read Cargo dependencies.";
  }

  if (pm === "go") {
    const { stdout, ok } = run("go list -m all", root, 30_000);
    return ok ? stdout.slice(0, 5000) : "Could not read Go modules.";
  }

  if (pm === "pip") {
    const reqPath = join(root, "requirements.txt");
    if (existsSync(reqPath)) {
      return `requirements.txt:\n${readFileSync(reqPath, "utf-8")}`;
    }
    const { stdout, ok } = run("pip list --format=columns", root, 15_000);
    return ok ? stdout.slice(0, 5000) : "Could not list pip packages.";
  }

  return "Unknown package manager.";
};

// ── Tool: add_dependency ──────────────────────────────────────────────────────

export const addDependencyDef: ToolDefinition = {
  name: "add_dependency",
  description: "Add a package dependency to the project. Automatically uses the correct package manager (npm/pnpm/yarn/bun/cargo/pip).",
  parameters: {
    type: "object",
    properties: {
      package: { type: "string", description: "Package name (optionally with @version e.g. 'lodash@4.17')" },
      dev: { type: "boolean", description: "Install as dev dependency (JS only)" },
      project_root: { type: "string" },
    },
    required: ["package"],
  },
};

export const addDependency: ToolHandler = async (args) => {
  const root = (args["project_root"] as string) || process.cwd();
  const pkg = args["package"] as string;
  const dev = args["dev"] as boolean | undefined;
  const pm = detectPackageManager(root);

  let cmd = "";
  const devFlag = dev ? " --save-dev" : "";

  if (pm === "npm") cmd = `npm install${devFlag} ${pkg}`;
  else if (pm === "pnpm") cmd = `pnpm add${dev ? " -D" : ""} ${pkg}`;
  else if (pm === "yarn") cmd = `yarn add${dev ? " --dev" : ""} ${pkg}`;
  else if (pm === "bun") cmd = `bun add${dev ? " -d" : ""} ${pkg}`;
  else if (pm === "cargo") cmd = `cargo add ${pkg}`;
  else if (pm === "pip") cmd = `pip install ${pkg}`;
  else if (pm === "go") cmd = `go get ${pkg}`;
  else return "Unsupported package manager.";

  const { stdout, stderr, ok } = run(cmd, root, 120_000);
  if (ok) return `✅ Added '${pkg}'\n${stdout.slice(0, 2000)}`;
  return `❌ Failed to add '${pkg}':\n${stderr.slice(0, 2000)}`;
};

// ── Tool: remove_dependency ───────────────────────────────────────────────────

export const removeDependencyDef: ToolDefinition = {
  name: "remove_dependency",
  description: "Remove a package dependency from the project.",
  parameters: {
    type: "object",
    properties: {
      package: { type: "string", description: "Package name to remove" },
      project_root: { type: "string" },
    },
    required: ["package"],
  },
};

export const removeDependency: ToolHandler = async (args) => {
  const root = (args["project_root"] as string) || process.cwd();
  const pkg = args["package"] as string;
  const pm = detectPackageManager(root);

  let cmd = "";
  if (pm === "npm") cmd = `npm uninstall ${pkg}`;
  else if (pm === "pnpm") cmd = `pnpm remove ${pkg}`;
  else if (pm === "yarn") cmd = `yarn remove ${pkg}`;
  else if (pm === "bun") cmd = `bun remove ${pkg}`;
  else if (pm === "cargo") cmd = `cargo remove ${pkg}`;
  else if (pm === "pip") cmd = `pip uninstall -y ${pkg}`;
  else return "Unsupported package manager.";

  const { stdout, stderr, ok } = run(cmd, root, 60_000);
  if (ok) return `✅ Removed '${pkg}'\n${stdout.slice(0, 1000)}`;
  return `❌ Failed to remove '${pkg}':\n${stderr.slice(0, 2000)}`;
};

// ── Tool: outdated_dependencies ───────────────────────────────────────────────

export const outdatedDependenciesDef: ToolDefinition = {
  name: "outdated_dependencies",
  description: "Check for outdated dependencies and show available upgrades. Works with npm/pnpm/yarn/bun/cargo.",
  parameters: {
    type: "object",
    properties: {
      project_root: { type: "string" },
    },
    required: [],
  },
};

export const outdatedDependencies: ToolHandler = async (args) => {
  const root = (args["project_root"] as string) || process.cwd();
  const pm = detectPackageManager(root);

  let cmd = "";
  if (pm === "npm") cmd = "npm outdated";
  else if (pm === "pnpm") cmd = "pnpm outdated";
  else if (pm === "yarn") cmd = "yarn outdated";
  else if (pm === "bun") cmd = "bun outdated";
  else if (pm === "cargo") cmd = "cargo outdated";
  else if (pm === "pip") cmd = "pip list --outdated --format=columns";
  else if (pm === "go") return "Use 'go get -u ./...' to update all Go modules.";
  else return "Unsupported package manager.";

  const { stdout, stderr, ok } = run(cmd, root, 60_000);
  // npm outdated returns exit code 1 when there are outdated packages — that's normal
  const output = (stdout + stderr).trim();
  return output || "All dependencies are up to date.";
};
