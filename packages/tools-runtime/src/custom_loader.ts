/**
 * Custom Tool Loader - Auto-import tools from tools/*.ts files in config directories
 * Scans for tool definitions, validates them, and registers them in the ToolRegistry.
 */
import * as fs from "fs/promises";
import * as path from "path";
import { pathToFileURL } from "url";
import type { ToolRegistry } from "./registry.js";

interface ToolDefinition { id: string; description: string; parameters: Record<string, unknown>; }
interface ToolResult { title: string; output: string; metadata?: Record<string, unknown>; }
interface ToolContext { sessionId: string; messageId: string; callId?: string; agent: string; abort: AbortSignal; metadata: (i: any) => void; ask: (r: any) => Promise<void>; }
type ToolExecutor = (args: unknown, ctx: ToolContext) => Promise<ToolResult>;

interface CustomToolModule {
  name?: string;
  description?: string;
  parameters?: Record<string, unknown>;
  execute?: (args: any, ctx?: any) => Promise<string | ToolResult>;
}

const TOOL_PATTERNS = ["tools/*.ts", "tools/*.js", "tools/*.mjs"];

/**
 * Scan directories for custom tool files and load them into the registry
 */
export async function loadCustomTools(
  registry: ToolRegistry,
  directories: string[],
): Promise<string[]> {
  const loaded: string[] = [];

  for (const dir of directories) {
    const toolsDir = path.join(dir, "tools");
    let entries;
    try {
      entries = await fs.readdir(toolsDir, { withFileTypes: true });
    } catch {
      continue; // tools/ directory doesn't exist
    }

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!/\.(ts|js|mjs)$/.test(entry.name)) continue;

      const filePath = path.join(toolsDir, entry.name);
      const namespace = path.basename(entry.name, path.extname(entry.name));

      try {
        const mod = await import(pathToFileURL(filePath).href);
        const tools = extractTools(mod, namespace);
        for (const tool of tools) {
          registry.register(tool.definition, tool.execute);
          loaded.push(tool.definition.id);
        }
      } catch (err) {
        // Log but don't crash on bad tool files
        console.warn(`[custom-tools] Failed to load ${filePath}: ${err}`);
      }
    }
  }

  return loaded;
}

function extractTools(
  mod: Record<string, unknown>,
  namespace: string,
): Array<{ definition: ToolDefinition; execute: ToolExecutor }> {
  const results: Array<{ definition: ToolDefinition; execute: ToolExecutor }> = [];

  // Check if module default export is a tool
  if (isToolModule(mod.default)) {
    results.push(wrapTool(namespace, mod.default as CustomToolModule));
  }
  // Also check if the module itself is a tool
  else if (isToolModule(mod)) {
    results.push(wrapTool(namespace, mod as unknown as CustomToolModule));
  }

  // Check named exports
  for (const [key, value] of Object.entries(mod)) {
    if (key === "default") continue;
    if (isToolModule(value)) {
      const id = key === "default" ? namespace : `${namespace}_${key}`;
      results.push(wrapTool(id, value as CustomToolModule));
    }
  }

  return results;
}

function isToolModule(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.description === "string" && typeof obj.execute === "function";
}

function wrapTool(
  id: string,
  mod: CustomToolModule,
): { definition: ToolDefinition; execute: ToolExecutor } {
  return {
    definition: {
      id,
      description: mod.description ?? "",
      parameters: (mod.parameters ?? { type: "object", properties: {} }) as any,
    },
    execute: async (args: unknown, ctx: ToolContext): Promise<ToolResult> => {
      const result = await mod.execute!(args, ctx);
      if (typeof result === "string") return { title: "", output: result };
      return result;
    },
  };
}

/**
 * Watch tool directories for changes and reload (hot-reload support)
 */
export function watchToolDirectories(
  registry: ToolRegistry,
  directories: string[],
  onChange?: (loaded: string[]) => void,
): () => void {
  const controllers: AbortController[] = [];

  for (const dir of directories) {
    const toolsDir = path.join(dir, "tools");
    const controller = new AbortController();
    controllers.push(controller);
    (async () => {
      try {
        const watcher = fs.watch(toolsDir, { signal: controller.signal });
        let timer: ReturnType<typeof setTimeout> | null = null;
        for await (const _ of watcher) {
          if (timer) clearTimeout(timer);
          timer = setTimeout(async () => {
            const loaded = await loadCustomTools(registry, [dir]);
            onChange?.(loaded);
          }, 500);
        }
      } catch {}
    })();
  }

  return () => controllers.forEach((c) => c.abort());
}
