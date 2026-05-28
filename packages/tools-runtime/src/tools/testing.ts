/**
 * testing.ts — Test runner integration.
 * Detects the project's test framework, runs tests, parses structured failure output,
 * can re-run only failing tests, and reports coverage summaries.
 */

import { execSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { ToolDefinition } from "../types.js";
import type { ToolHandler } from "../registry.js";

// ── Framework detection ───────────────────────────────────────────────────────

type TestFramework = "vitest" | "jest" | "mocha" | "pytest" | "cargo" | "go" | "unknown";

interface DetectedFramework {
  name: TestFramework;
  runCmd: string;
  watchCmd?: string;
  coverageFlag: string;
  jsonFlag?: string;
}

function detectFramework(root: string): DetectedFramework {
  // Node / JS
  const pkgPath = join(root, "package.json");
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const scripts: Record<string, string> = pkg.scripts || {};

    if (deps["vitest"]) {
      return {
        name: "vitest",
        runCmd: "npx vitest run",
        watchCmd: "npx vitest",
        coverageFlag: "--coverage",
        jsonFlag: "--reporter=json",
      };
    }
    if (deps["jest"] || deps["@jest/core"] || scripts["test"]?.includes("jest")) {
      return {
        name: "jest",
        runCmd: "npx jest",
        watchCmd: "npx jest --watch",
        coverageFlag: "--coverage",
        jsonFlag: "--json",
      };
    }
    if (deps["mocha"]) {
      return {
        name: "mocha",
        runCmd: "npx mocha",
        coverageFlag: "--reporter spec",
      };
    }
  }

  // Python
  if (existsSync(join(root, "pytest.ini")) || existsSync(join(root, "pyproject.toml"))) {
    return {
      name: "pytest",
      runCmd: "python -m pytest",
      coverageFlag: "--cov=. --cov-report=term-missing",
      jsonFlag: "--tb=short -q",
    };
  }

  // Rust
  if (existsSync(join(root, "Cargo.toml"))) {
    return {
      name: "cargo",
      runCmd: "cargo test",
      coverageFlag: "--no-run",
    };
  }

  // Go
  if (existsSync(join(root, "go.mod"))) {
    return {
      name: "go",
      runCmd: "go test ./...",
      coverageFlag: "-cover",
    };
  }

  return { name: "unknown", runCmd: "npm test", coverageFlag: "" };
}

// ── Result parsing ────────────────────────────────────────────────────────────

interface TestFailure {
  file: string;
  testName: string;
  message: string;
  line?: number;
}

interface TestRunResult {
  passed: number;
  failed: number;
  skipped: number;
  duration: string;
  failures: TestFailure[];
  coverageSummary?: string;
  rawOutput: string;
}

function parseJestJson(raw: string, root: string): TestRunResult | null {
  const jsonMatch = raw.match(/\{[\s\S]*"numTotalTests"[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    const data = JSON.parse(jsonMatch[0]);
    const failures: TestFailure[] = [];

    for (const suite of (data.testResults || []) as any[]) {
      const relFile = relative(root, suite.testFilePath || "");
      for (const t of (suite.testResults || []) as any[]) {
        if (t.status === "failed") {
          failures.push({
            file: relFile,
            testName: t.fullName || t.title,
            message: (t.failureMessages || []).join("\n").slice(0, 500),
          });
        }
      }
    }

    return {
      passed: data.numPassedTests || 0,
      failed: data.numFailedTests || 0,
      skipped: data.numPendingTests || 0,
      duration: `${((data.testResults?.[0]?.endTime - data.startTime) / 1000).toFixed(2)}s`,
      failures,
      rawOutput: raw.slice(0, 3000),
    };
  } catch {
    return null;
  }
}

function parseTextOutput(raw: string, framework: TestFramework): TestRunResult {
  const lines = raw.split("\n");
  let passed = 0, failed = 0, skipped = 0;
  const failures: TestFailure[] = [];

  if (framework === "vitest" || framework === "jest") {
    // Vitest/Jest text output patterns
    const summaryLine = lines.find(l => /Tests?\s+\d+/.test(l));
    if (summaryLine) {
      const passM = summaryLine.match(/(\d+)\s+passed/);
      const failM = summaryLine.match(/(\d+)\s+failed/);
      const skipM = summaryLine.match(/(\d+)\s+skipped/);
      passed = parseInt(passM?.[1] || "0");
      failed = parseInt(failM?.[1] || "0");
      skipped = parseInt(skipM?.[1] || "0");
    }

    // Capture failure blocks: lines after ● or FAIL
    let captureFailure = false;
    let currentFailure: Partial<TestFailure> = {};
    let failureLines: string[] = [];

    for (const line of lines) {
      if (/^●\s+/.test(line) || /^  ● /.test(line)) {
        if (currentFailure.testName && failureLines.length) {
          failures.push({ file: currentFailure.file || "", testName: currentFailure.testName, message: failureLines.join("\n").slice(0, 400) });
        }
        currentFailure = { testName: line.replace(/^●\s+/, "").trim() };
        failureLines = [];
        captureFailure = true;
      } else if (captureFailure) {
        const atMatch = line.match(/at\s+.*\(([^:)]+):(\d+)/);
        if (atMatch && !currentFailure.file) {
          currentFailure.file = atMatch[1]!;
          currentFailure.line = parseInt(atMatch[2]!);
        }
        failureLines.push(line);
        if (failureLines.length > 20) captureFailure = false;
      }
    }
    if (currentFailure.testName && failureLines.length) {
      failures.push({ file: currentFailure.file || "", testName: currentFailure.testName, message: failureLines.join("\n").slice(0, 400) });
    }
  } else if (framework === "pytest") {
    const summaryLine = lines.find(l => /=+ .*(passed|failed|error).*=+/.test(l));
    if (summaryLine) {
      const passM = summaryLine.match(/(\d+)\s+passed/);
      const failM = summaryLine.match(/(\d+)\s+failed/);
      const skipM = summaryLine.match(/(\d+)\s+skipped/);
      passed = parseInt(passM?.[1] || "0");
      failed = parseInt(failM?.[1] || "0");
      skipped = parseInt(skipM?.[1] || "0");
    }

    // Capture FAILED lines
    for (const line of lines) {
      const m = line.match(/^FAILED\s+(.+)::(.+?)\s*(-\s*(.+))?$/);
      if (m) {
        failures.push({ file: m[1]!, testName: m[2]!, message: m[4] || "" });
      }
    }
  } else if (framework === "go") {
    for (const line of lines) {
      const passM = line.match(/ok\s+\S+\s+([\d.]+[smµ]+)/);
      const failM = line.match(/^---\s+FAIL:\s+(\S+)/);
      if (passM) passed++;
      if (failM) { failed++; failures.push({ file: "", testName: failM[1]!, message: "" }); }
    }
  } else if (framework === "cargo") {
    const summaryLine = lines.find(l => /test result/.test(l));
    if (summaryLine) {
      const passM = summaryLine.match(/(\d+)\s+passed/);
      const failM = summaryLine.match(/(\d+)\s+failed/);
      passed = parseInt(passM?.[1] || "0");
      failed = parseInt(failM?.[1] || "0");
    }
  }

  // Coverage summary extraction (shared patterns)
  let coverageSummary: string | undefined;
  const covLine = lines.find(l => /coverage|All files|Stmts/.test(l));
  if (covLine) coverageSummary = covLine.trim();

  return { passed, failed, skipped, duration: "", failures, coverageSummary, rawOutput: raw.slice(0, 4000) };
}

function formatResult(result: TestRunResult): string {
  const status = result.failed > 0 ? "❌ FAILED" : "✅ PASSED";
  const lines = [
    `${status} — ${result.passed} passed, ${result.failed} failed, ${result.skipped} skipped${result.duration ? ` (${result.duration})` : ""}`,
  ];

  if (result.coverageSummary) lines.push(`Coverage: ${result.coverageSummary}`);

  if (result.failures.length) {
    lines.push(`\nFailures (${result.failures.length}):`);
    for (const f of result.failures.slice(0, 10)) {
      lines.push(`  ✗ ${f.testName}${f.file ? ` [${f.file}${f.line ? `:${f.line}` : ""}]` : ""}`);
      if (f.message) lines.push(`    ${f.message.split("\n")[0]}`);
    }
    if (result.failures.length > 10) lines.push(`  ... and ${result.failures.length - 10} more`);
  }

  return lines.join("\n");
}

// ── Tool: run_tests ───────────────────────────────────────────────────────────

export const runTestsDef: ToolDefinition = {
  name: "run_tests",
  description: "Run the project's test suite. Detects framework (vitest/jest/pytest/cargo/go). Parses failures with file/line context. Optionally run only specific file/pattern.",
  parameters: {
    type: "object",
    properties: {
      project_root: { type: "string", description: "Project root (default: cwd)" },
      pattern: { type: "string", description: "Test name pattern/filter to run only matching tests" },
      file: { type: "string", description: "Specific test file to run" },
      coverage: { type: "boolean", description: "Include coverage report" },
      timeout: { type: "number", description: "Timeout in seconds (default: 60)" },
    },
    required: [],
  },
};

export const runTests: ToolHandler = async (args) => {
  const root = (args["project_root"] as string) || process.cwd();
  const pattern = args["pattern"] as string | undefined;
  const file = args["file"] as string | undefined;
  const coverage = args["coverage"] as boolean | undefined;
  const timeout = ((args["timeout"] as number) || 60) * 1000;

  const fw = detectFramework(root);
  let cmd = fw.runCmd;

  // Append flags
  if (coverage && fw.coverageFlag) cmd += ` ${fw.coverageFlag}`;

  if (pattern) {
    if (fw.name === "vitest" || fw.name === "jest") cmd += ` -t "${pattern}"`;
    else if (fw.name === "pytest") cmd += ` -k "${pattern}"`;
    else if (fw.name === "go") cmd += ` -run "${pattern}"`;
    else if (fw.name === "cargo") cmd += ` "${pattern}"`;
  }

  if (file) {
    if (fw.name === "vitest" || fw.name === "jest") cmd += ` "${file}"`;
    else if (fw.name === "pytest") cmd += ` "${file}"`;
  }

  // Add JSON output for structured parsing when available
  const useJson = fw.jsonFlag && !coverage;
  if (useJson && fw.name === "jest") cmd += ` ${fw.jsonFlag} 2>/dev/null`;

  try {
    const raw = execSync(cmd, {
      cwd: root,
      encoding: "utf-8",
      timeout,
      maxBuffer: 4 * 1024 * 1024,
    });

    let result: TestRunResult;
    if (useJson && fw.name === "jest") {
      result = parseJestJson(raw, root) || parseTextOutput(raw, fw.name);
    } else {
      result = parseTextOutput(raw, fw.name);
    }
    return formatResult(result);
  } catch (e: any) {
    const raw = `${e.stdout || ""}${e.stderr || ""}`;
    const result = parseTextOutput(raw, fw.name);
    return formatResult(result);
  }
};

// ── Tool: run_failing_tests ───────────────────────────────────────────────────

export const runFailingTestsDef: ToolDefinition = {
  name: "run_failing_tests",
  description: "Re-run only the previously failed tests (jest --onlyFailures, vitest --reporter=verbose filtered). Useful after a fix.",
  parameters: {
    type: "object",
    properties: {
      project_root: { type: "string" },
    },
    required: [],
  },
};

export const runFailingTests: ToolHandler = async (args) => {
  const root = (args["project_root"] as string) || process.cwd();
  const fw = detectFramework(root);

  let cmd = fw.runCmd;
  if (fw.name === "jest") cmd += " --onlyFailures";
  else if (fw.name === "vitest") cmd += " --reporter=verbose";
  else if (fw.name === "pytest") cmd += " --lf"; // last-failed

  try {
    const raw = execSync(cmd, { cwd: root, encoding: "utf-8", timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
    return formatResult(parseTextOutput(raw, fw.name));
  } catch (e: any) {
    const raw = `${e.stdout || ""}${e.stderr || ""}`;
    return formatResult(parseTextOutput(raw, fw.name));
  }
};

// ── Tool: test_coverage ───────────────────────────────────────────────────────

export const testCoverageDef: ToolDefinition = {
  name: "test_coverage",
  description: "Run tests with full coverage report. Returns per-file line/branch coverage percentages.",
  parameters: {
    type: "object",
    properties: {
      project_root: { type: "string" },
    },
    required: [],
  },
};

export const testCoverage: ToolHandler = async (args) => {
  const root = (args["project_root"] as string) || process.cwd();
  const fw = detectFramework(root);

  if (!fw.coverageFlag) return `Framework '${fw.name}' coverage not directly supported. Try run_tests with coverage=true.`;

  let cmd = `${fw.runCmd} ${fw.coverageFlag}`;
  if (fw.name === "vitest") cmd += " --reporter=verbose";

  try {
    const raw = execSync(cmd, { cwd: root, encoding: "utf-8", timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
    // Extract coverage table lines
    const lines = raw.split("\n");
    const covStart = lines.findIndex(l => /File|Stmts|coverage/.test(l));
    const covLines = covStart >= 0 ? lines.slice(covStart, covStart + 40).join("\n") : raw.slice(-2000);
    return `Coverage Report (${fw.name}):\n${covLines}`;
  } catch (e: any) {
    const raw = `${e.stdout || ""}${e.stderr || ""}`;
    return raw.slice(-3000);
  }
};
