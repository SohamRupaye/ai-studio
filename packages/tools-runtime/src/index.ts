/**
 * @ai-studio/tools-runtime - Unified tool infrastructure
 *
 * Sub-modules:
 * - mcp: Multi-transport MCP client (stdio/SSE/HTTP) with OAuth & reconnection
 * - lsp: 30+ language server manager with lazy spawning & pull+push diagnostics
 * - acp: Agent Communication Protocol for IDE integration
 * - skills: YAML frontmatter skills with remote discovery & per-agent permissions
 * - registry: Tool registry with schema validation, plugin hooks, & observability
 */

// MCP
export { MCPClient, MCPManager, MCPAuth } from "./mcp";
export type {
  MCPServerConfig,
  MCPStatus,
  MCPToolDef,
  MCPToolResult,
  MCPResource,
  MCPTransport,
  OAuthConfig,
  OAuthTokens,
} from "./mcp";

// LSP
export {
  LSPClient,
  LSPManager,
  formatDiagnostic,
  formatDiagnosticsReport,
  LANGUAGE_EXTENSIONS,
  getLanguageId,
  SERVERS,
  findServersForExtension,
  findServerById,
  findRoot,
} from "./lsp";
export type { Diagnostic, LSPServerInfo } from "./lsp";

// ACP
export { ACPService } from "./acp";
export type {
  ACPCapabilities,
  ACPSessionInfo,
  ACPMessage,
  ACPContentBlock,
  ACPToolCall,
  ACPSessionUpdate,
  ACPConnection,
  ACPServiceConfig,
  ACPConfigOption,
  ACPMCPServer,
  PermissionDecision,
  PermissionRequest,
  PromptHandler,
  SessionHandler,
} from "./acp";

// Skills
export { SkillsService } from "./skills";
export type { SkillInfo, SkillPermission, SkillsConfig } from "./skills";

// Registry
export { ToolRegistry, ValidationError } from "./registry";
export type {
  ToolDefinition,
  ToolResult,
  ToolContext,
  ToolExecutor,
  ToolHandler,
  ToolFilterContext,
  RegisteredTool,
  JSONSchema,
  TruncationConfig,
  ToolDefinitionHook,
  BeforeExecuteHook,
  AfterExecuteHook,
  PermissionAskRequest,
} from "./registry";

// Custom Tool Loader
export { loadCustomTools, watchToolDirectories } from "./custom_loader";

// Defaults
export { createDefaultRegistry, loadMCPServers, getLSPClient } from "./defaults";

// Skills (convenience re-export)
export { listSkills } from "./skills/runner";
