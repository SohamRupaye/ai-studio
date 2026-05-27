/**
 * Legacy types - kept for backward compatibility with existing tool files
 * The new canonical types are in ./registry.ts
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolResult {
  name: string;
  output: string;
  success: boolean;
}

export type ToolHandler = (args: Record<string, unknown>) => Promise<string>;
