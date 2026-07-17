/**
 * Tool Registry - Production-grade tool management with schema validation,
 * plugin hooks, permission flow, output truncation, observability, and dynamic descriptions
 */
import { EventEmitter } from "events";

export interface SkillPermission {
  allow?: string[];
  deny?: string[];
}

// --- Types ---

export interface JSONSchema {
  type?: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  enum?: unknown[];
  description?: string;
  default?: unknown;
  additionalProperties?: boolean | JSONSchema;
  [key: string]: unknown;
}

export interface ToolDefinition {
  id: string;
  description: string;
  parameters: JSONSchema;
  /** Dynamic description builder (e.g., skill tool lists available skills) */
  dynamicDescription?: (ctx: ToolFilterContext) => string | Promise<string>;
}

export interface ToolResult {
  title: string;
  output: string;
  metadata?: Record<string, unknown>;
  attachments?: Array<{ name: string; content: string; mimeType?: string }>;
}

export interface ToolContext {
  sessionId: string;
  messageId: string;
  callId?: string;
  agent: string;
  abort: AbortSignal;
  /** Report progress/title updates during execution */
  metadata(input: { title?: string; metadata?: Record<string, unknown> }): void;
  /** Request permission from user before dangerous operations */
  ask(request: PermissionAskRequest): Promise<void>;
}

export interface PermissionAskRequest {
  permission: string;
  description: string;
  patterns?: string[];
  always?: string[];
}

export interface ToolFilterContext {
  agent: string;
  agentPermissions?: SkillPermission;
  modelId?: string;
  providerId?: string;
}

export type ToolExecutor = (args: unknown, ctx: ToolContext) => Promise<ToolResult>;

/** Legacy handler type for backward compatibility */
export type ToolHandler = (args: Record<string, unknown>) => Promise<string>;

export interface RegisteredTool {
  definition: ToolDefinition;
  execute: ToolExecutor;
}

// --- Plugin Hooks ---

export type ToolDefinitionHook = (
  toolId: string,
  definition: { description: string; parameters: JSONSchema },
) => void | Promise<void>;

export type BeforeExecuteHook = (
  toolId: string,
  args: unknown,
  ctx: ToolContext,
) => unknown | Promise<unknown>; // return modified args

export type AfterExecuteHook = (
  toolId: string,
  result: ToolResult,
  ctx: ToolContext,
) => ToolResult | Promise<ToolResult>;

// --- Truncation ---

export interface TruncationConfig {
  maxOutputLength?: number;
  strategy?: "head" | "tail" | "middle";
}

const DEFAULT_MAX_OUTPUT = 80_000;

function truncateOutput(output: string, config: TruncationConfig = {}): { content: string; truncated: boolean } {
  const max = config.maxOutputLength ?? DEFAULT_MAX_OUTPUT;
  if (output.length <= max) return { content: output, truncated: false };
  const strategy = config.strategy ?? "tail";
  switch (strategy) {
    case "head":
      return { content: output.slice(0, max) + "\n... [truncated]", truncated: true };
    case "tail":
      return { content: "... [truncated]\n" + output.slice(-max), truncated: true };
    case "middle": {
      const half = Math.floor(max / 2);
      return { content: output.slice(0, half) + "\n... [truncated] ...\n" + output.slice(-half), truncated: true };
    }
  }
}

// --- Schema Validation ---

export class ValidationError extends Error {
  constructor(
    public tool: string,
    public detail: string,
  ) {
    super(`Tool "${tool}" called with invalid arguments: ${detail}. Please rewrite the input.`);
  }
}

/** Thrown by a before-execute hook to veto a tool call (e.g. the user denied approval). */
export class ToolVetoError extends Error {}

function validateArgs(toolId: string, args: unknown, schema: JSONSchema): unknown {
  if (schema.type !== "object") return args;
  if (args == null || typeof args !== "object") {
    if (schema.required?.length) throw new ValidationError(toolId, "Expected an object with properties");
    return {};
  }
  const obj = args as Record<string, unknown>;
  const errors: string[] = [];

  // Check required fields
  for (const key of schema.required ?? []) {
    if (!(key in obj) || obj[key] === undefined) {
      errors.push(`Missing required field: "${key}"`);
    }
  }

  // Check types for known properties
  if (schema.properties) {
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      if (!(key in obj) || obj[key] === undefined) continue;
      const val = obj[key];
      if (propSchema.type === "string" && typeof val !== "string") {
        errors.push(`"${key}" must be a string`);
      } else if (propSchema.type === "number" && typeof val !== "number") {
        errors.push(`"${key}" must be a number`);
      } else if (propSchema.type === "boolean" && typeof val !== "boolean") {
        errors.push(`"${key}" must be a boolean`);
      } else if (propSchema.type === "array" && !Array.isArray(val)) {
        errors.push(`"${key}" must be an array`);
      } else if (propSchema.enum && !propSchema.enum.includes(val)) {
        errors.push(`"${key}" must be one of: ${propSchema.enum.join(", ")}`);
      }
    }
  }

  if (errors.length > 0) throw new ValidationError(toolId, errors.join("; "));
  return args;
}

// --- Observability ---

interface ToolSpan {
  toolId: string;
  sessionId: string;
  messageId: string;
  callId?: string;
  startTime: number;
  endTime?: number;
  success?: boolean;
  error?: string;
}

// --- Registry ---

export class ToolRegistry extends EventEmitter {
  private tools = new Map<string, RegisteredTool>();
  private definitionHooks: ToolDefinitionHook[] = [];
  private beforeHooks: BeforeExecuteHook[] = [];
  private afterHooks: AfterExecuteHook[] = [];
  private spans: ToolSpan[] = [];
  private truncationConfig: TruncationConfig = {};

  /** Register a tool (supports both new {id,description,parameters} and legacy {name,description,parameters} + handler) */
  register(definition: ToolDefinition | { name: string; description: string; parameters: Record<string, unknown> }, execute: ToolExecutor | ((args: Record<string, unknown>) => Promise<string>)): void {
    const id = "id" in definition ? definition.id : (definition as any).name;
    const def: ToolDefinition = {
      id,
      description: definition.description,
      parameters: definition.parameters as JSONSchema,
      ...("dynamicDescription" in definition ? { dynamicDescription: (definition as ToolDefinition).dynamicDescription } : {}),
    };
    // Wrap legacy handlers that return string into ToolExecutor
    const exec: ToolExecutor = async (args, ctx) => {
      const result = await (execute as any)(args, ctx);
      if (typeof result === "string") return { title: "", output: result };
      return result;
    };
    this.tools.set(id, { definition: def, execute: exec });
  }

  /** Unregister a tool */
  unregister(id: string): void {
    this.tools.delete(id);
  }

  /** Register a plugin hook for modifying tool definitions before exposing to LLM */
  onDefinition(hook: ToolDefinitionHook): void {
    this.definitionHooks.push(hook);
  }

  /** Register a pre-execution hook (can modify args) */
  onBeforeExecute(hook: BeforeExecuteHook): void {
    this.beforeHooks.push(hook);
  }

  /** Register a post-execution hook (can modify results) */
  onAfterExecute(hook: AfterExecuteHook): void {
    this.afterHooks.push(hook);
  }

  /** Set output truncation config */
  setTruncation(config: TruncationConfig): void {
    this.truncationConfig = config;
  }

  /** Get all tool IDs */
  ids(): string[] {
    return Array.from(this.tools.keys());
  }

  /** Get all tools (optionally filtered by agent/model context) */
  async getTools(ctx?: ToolFilterContext): Promise<Array<{ id: string; description: string; parameters: JSONSchema }>> {
    const entries = Array.from(this.tools.values());
    const results: Array<{ id: string; description: string; parameters: JSONSchema }> = [];

    for (const { definition } of entries) {
      // Permission filtering
      if (ctx?.agentPermissions) {
        const perms = ctx.agentPermissions;
        if (perms.deny?.includes(definition.id)) continue;
        if (perms.allow && !perms.allow.includes(definition.id) && !perms.allow.includes("*")) continue;
      }

      // Build description (may include dynamic content)
      let description = definition.description;
      if (definition.dynamicDescription && ctx) {
        try {
          const dynamic = await definition.dynamicDescription(ctx);
          description = `${description}\n${dynamic}`;
        } catch {}
      }

      const output = { description, parameters: { ...definition.parameters } };

      // Run definition hooks (plugins can modify description/schema)
      for (const hook of this.definitionHooks) {
        await hook(definition.id, output);
      }

      results.push({ id: definition.id, description: output.description, parameters: output.parameters });
    }

    return results;
  }

  /** Execute a tool with full lifecycle (validate → hooks → execute → truncate → observe) */
  async execute(toolId: string, args: unknown, ctx: ToolContext): Promise<ToolResult> {
    const registered = this.tools.get(toolId);
    if (!registered) {
      return { title: "Error", output: `Unknown tool: "${toolId}". Available: ${this.ids().join(", ")}`, metadata: { error: true } };
    }

    const span: ToolSpan = {
      toolId,
      sessionId: ctx.sessionId,
      messageId: ctx.messageId,
      callId: ctx.callId,
      startTime: Date.now(),
    };

    try {
      // 1. Schema validation
      const validated = validateArgs(toolId, args, registered.definition.parameters);

      // 2. Before hooks
      let processedArgs = validated;
      for (const hook of this.beforeHooks) {
        const result = await hook(toolId, processedArgs, ctx);
        if (result !== undefined) processedArgs = result;
      }

      // 3. Execute
      let result = await registered.execute(processedArgs, ctx);

      // 4. Output truncation
      const { content, truncated } = truncateOutput(result.output, this.truncationConfig);
      if (truncated) {
        result = { ...result, output: content, metadata: { ...result.metadata, truncated: true } };
      }

      // 5. After hooks
      for (const hook of this.afterHooks) {
        result = await hook(toolId, result, ctx);
      }

      // 6. Observability
      span.endTime = Date.now();
      span.success = true;
      this.spans.push(span);
      this.emit("tool_executed", { ...span, duration: span.endTime - span.startTime });

      return result;
    } catch (err) {
      span.endTime = Date.now();
      span.success = false;
      span.error = err instanceof Error ? err.message : String(err);
      this.spans.push(span);
      this.emit("tool_error", { ...span, duration: span.endTime - span.startTime });

      if (err instanceof ToolVetoError) {
        return { title: "Declined", output: err.message, metadata: { error: true, vetoed: true } };
      }
      if (err instanceof ValidationError) {
        return { title: "Validation Error", output: err.message, metadata: { error: true, validation: true } };
      }
      return { title: "Error", output: err instanceof Error ? err.message : String(err), metadata: { error: true } };
    }
  }

  /** Get execution spans for observability */
  getSpans(limit = 100): ToolSpan[] {
    return this.spans.slice(-limit);
  }

  /** Clear span history */
  clearSpans(): void {
    this.spans = [];
  }

  /** Check if a tool exists */
  has(id: string): boolean {
    return this.tools.has(id);
  }

  /** Get a single tool's definition */
  getDefinition(id: string): ToolDefinition | undefined {
    return this.tools.get(id)?.definition;
  }

  /** Get all definitions (legacy compat) */
  getDefinitions(): Array<{ name: string; description: string; parameters: Record<string, unknown> }> {
    return Array.from(this.tools.values()).map((t) => ({
      name: t.definition.id,
      description: t.definition.description,
      parameters: t.definition.parameters as Record<string, unknown>,
    }));
  }
}
