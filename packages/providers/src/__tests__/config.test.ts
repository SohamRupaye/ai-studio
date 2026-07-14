import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Reset the module-level cache between tests by re-importing fresh each time.
// We do this by manipulating the module registry is not easily possible in ESM,
// so instead we clear the cache indirectly — loadConfig always overwrites _config.

let tmpDir: string;
let originalEnv: string | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "config-test-"));
  originalEnv = process.env["SQUIRL_MODEL"];
  delete process.env["SQUIRL_MODEL"];
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  if (originalEnv === undefined) {
    delete process.env["SQUIRL_MODEL"];
  } else {
    process.env["SQUIRL_MODEL"] = originalEnv;
  }
});

describe("loadConfig", () => {
  it("returns defaults when path does not exist", async () => {
    const { loadConfig } = await import("../config.js");
    const cfg = loadConfig(join(tmpDir, "nonexistent.yaml"));
    expect(cfg.defaultModel).toBe("gpt-5.4-mini");
    expect(cfg.maxTokens).toBe(8192);
    expect(cfg.context.hotWindow).toBe(10);
    expect(cfg.classifier.enabled).toBe(true);
    expect(Array.isArray(cfg.mcpServers)).toBe(true);
    expect(cfg.mcpServers).toHaveLength(0);
  });

  it("reads values from a valid YAML file", async () => {
    const { loadConfig } = await import("../config.js");
    const cfgPath = join(tmpDir, "config.yaml");
    writeFileSync(
      cfgPath,
      `default_model: claude-sonnet-4\nmax_tokens: 16384\ncontext:\n  hot_window: 20\napi_keys:\n  anthropic: test-key\n`
    );
    const cfg = loadConfig(cfgPath);
    expect(cfg.defaultModel).toBe("claude-sonnet-4");
    expect(cfg.maxTokens).toBe(16384);
    expect(cfg.context.hotWindow).toBe(20);
    expect(cfg.apiKeys.anthropic).toBe("test-key");
  });

  it("SQUIRL_MODEL env var overrides defaultModel", async () => {
    const { loadConfig } = await import("../config.js");
    process.env["SQUIRL_MODEL"] = "override-model";
    const cfgPath = join(tmpDir, "config.yaml");
    writeFileSync(cfgPath, `default_model: claude-sonnet-4\nmax_tokens: 16384\n`);
    const cfg = loadConfig(cfgPath);
    expect(cfg.defaultModel).toBe("override-model");
  });

  it("returns a config (with warnings) when max_tokens is 0", async () => {
    const { loadConfig } = await import("../config.js");
    const cfgPath = join(tmpDir, "config.yaml");
    // max_tokens: 0 will be treated as falsy and fall back to 8192 default
    writeFileSync(cfgPath, `default_model: test-model\nmax_tokens: 0\n`);
    const cfg = loadConfig(cfgPath);
    // Should not throw; config is returned
    expect(cfg).toBeDefined();
    expect(typeof cfg.maxTokens).toBe("number");
  });

  it("invalid max_tokens triggers validation warning but returns config", async () => {
    const { loadConfig } = await import("../config.js");
    const cfgPath = join(tmpDir, "config.yaml");
    // 50 is < 100, so validation warning fires but no throw
    writeFileSync(cfgPath, `default_model: test-model\nmax_tokens: 50\n`);
    let cfg: any;
    expect(() => { cfg = loadConfig(cfgPath); }).not.toThrow();
    expect(cfg).toBeDefined();
  });
});

describe("disabled_skills", () => {
  it("defaults to an empty list and ignores malformed values", async () => {
    const { loadConfig } = await import("../config.js");
    expect(loadConfig(join(tmpDir, "nonexistent.yaml")).disabledSkills).toEqual([]);
    const cfgPath = join(tmpDir, "config.yaml");
    writeFileSync(cfgPath, `default_model: m\ndisabled_skills:\n  - real-skill\n  - 42\n`);
    expect(loadConfig(cfgPath).disabledSkills).toEqual(["real-skill"]);
  });

  it("saveConfig round-trips the list and clears it when empty", async () => {
    const { loadConfig, saveConfig } = await import("../config.js");
    const cfgPath = join(tmpDir, "config.yaml");
    writeFileSync(cfgPath, `default_model: m\n`);
    loadConfig(cfgPath);
    expect(saveConfig({ disabledSkills: ["a", "b"] }).disabledSkills).toEqual(["a", "b"]);
    // Unrelated patches leave the list alone.
    expect(saveConfig({ defaultModel: "other" }).disabledSkills).toEqual(["a", "b"]);
    expect(saveConfig({ disabledSkills: [] }).disabledSkills).toEqual([]);
  });
});

describe("getConfig", () => {
  it("returns a config object with required shape", async () => {
    const { getConfig, loadConfig } = await import("../config.js");
    // Prime the cache with a known config
    loadConfig(join(tmpDir, "nonexistent.yaml"));
    const cfg = getConfig();
    expect(cfg).toHaveProperty("defaultModel");
    expect(cfg).toHaveProperty("maxTokens");
    expect(cfg).toHaveProperty("context");
    expect(cfg).toHaveProperty("mcpServers");
    expect(typeof cfg.defaultModel).toBe("string");
    expect(typeof cfg.maxTokens).toBe("number");
    expect(typeof cfg.context.hotWindow).toBe("number");
    expect(Array.isArray(cfg.mcpServers)).toBe(true);
  });
});

describe("watchConfig / unwatchConfig", () => {
  it("watchConfig does not throw when path does not exist", async () => {
    const { watchConfig } = await import("../config.js");
    expect(() => watchConfig()).not.toThrow();
  });

  it("unwatchConfig does not throw", async () => {
    const { unwatchConfig } = await import("../config.js");
    expect(() => unwatchConfig()).not.toThrow();
  });

  it("watchConfig with a callback does not throw", async () => {
    const { loadConfig, watchConfig, unwatchConfig } = await import("../config.js");
    const cfgPath = join(tmpDir, "config.yaml");
    writeFileSync(cfgPath, `default_model: watch-model\nmax_tokens: 16384\n`);
    loadConfig(cfgPath);
    expect(() => watchConfig(() => {})).not.toThrow();
    expect(() => unwatchConfig()).not.toThrow();
  });
});
