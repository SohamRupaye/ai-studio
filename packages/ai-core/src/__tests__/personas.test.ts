import { describe, it, expect } from "vitest";
import { PersonaRegistry } from "../personas.js";

// Pass [] to skip disk loading — pure in-memory test
const registry = new PersonaRegistry([]);

describe("PersonaRegistry", () => {
  it("get('default') returns a persona with systemPrompt", () => {
    const p = registry.get("default");
    expect(p).toBeDefined();
    expect(typeof p!.systemPrompt).toBe("string");
    expect(p!.systemPrompt.length).toBeGreaterThan(0);
  });

  it("get('coder') has allowedTools list and systemPrompt", () => {
    const p = registry.get("coder");
    expect(p).toBeDefined();
    expect(Array.isArray(p!.allowedTools)).toBe(true);
    expect(p!.allowedTools!.length).toBeGreaterThan(0);
    expect(typeof p!.systemPrompt).toBe("string");
  });

  it("get('researcher') is defined", () => {
    expect(registry.get("researcher")).toBeDefined();
  });

  it("get('architect') is defined", () => {
    expect(registry.get("architect")).toBeDefined();
  });

  it("get('nonexistent') returns undefined", () => {
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  it("list() returns at least 4 built-in personas", () => {
    expect(registry.list().length).toBeGreaterThanOrEqual(4);
  });

  it("register() adds a custom persona and get() returns it", () => {
    registry.register({ name: "custom", systemPrompt: "You are custom." });
    const p = registry.get("custom");
    expect(p).toBeDefined();
    expect(p!.systemPrompt).toBe("You are custom.");
  });

  it("register() with existing name overrides the persona", () => {
    const reg = new PersonaRegistry([]);
    reg.register({ name: "default", systemPrompt: "Overridden." });
    const p = reg.get("default");
    expect(p!.systemPrompt).toBe("Overridden.");
  });

  it("isToolAllowed: coder persona allows 'bash'", () => {
    const coder = registry.get("coder")!;
    expect(registry.isToolAllowed(coder, "bash")).toBe(true);
  });

  it("isToolAllowed: coder persona does not allow 'web_search'", () => {
    const coder = registry.get("coder")!;
    expect(registry.isToolAllowed(coder, "web_search")).toBe(false);
  });

  it("isToolAllowed: persona with no allowedTools allows all tools", () => {
    const reg = new PersonaRegistry([]);
    reg.register({ name: "open", systemPrompt: "Open persona." });
    const p = reg.get("open")!;
    expect(reg.isToolAllowed(p, "bash")).toBe(true);
    expect(reg.isToolAllowed(p, "anything")).toBe(true);
  });

  it("isToolAllowed: persona with deniedTools returns false for denied tool", () => {
    const reg = new PersonaRegistry([]);
    reg.register({ name: "restricted", systemPrompt: "Restricted.", deniedTools: ["bash"] });
    const p = reg.get("restricted")!;
    expect(reg.isToolAllowed(p, "bash")).toBe(false);
    expect(reg.isToolAllowed(p, "read_file")).toBe(true);
  });

  it("isToolAllowed: deniedTools takes priority over allowedTools", () => {
    const reg = new PersonaRegistry([]);
    reg.register({
      name: "conflict",
      systemPrompt: "Conflict.",
      allowedTools: ["bash", "read_file"],
      deniedTools: ["bash"],
    });
    const p = reg.get("conflict")!;
    expect(reg.isToolAllowed(p, "bash")).toBe(false);
    expect(reg.isToolAllowed(p, "read_file")).toBe(true);
  });
});
