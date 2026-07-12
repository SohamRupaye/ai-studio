/**
 * @ai-studio/tools-runtime - Unified tool infrastructure
 *
 * Sub-modules:
 * - mcp: Multi-transport MCP client (stdio/SSE/HTTP) with OAuth & reconnection
 * - lsp: 30+ language server manager with lazy spawning & pull+push diagnostics
 * - agent-session: HTTP + SSE session/streaming API for IDE integration (bespoke, not ACP-compliant)
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

// Agent Session (IDE integration; bespoke protocol, not ACP-compliant)
export { AgentSessionService } from "./agent-session";
export type {
  AgentSessionCapabilities,
  AgentSessionInfo,
  AgentSessionMessage,
  AgentContentBlock,
  AgentToolCall,
  AgentSessionUpdate,
  AgentSessionConnection,
  AgentSessionServiceConfig,
  AgentSessionConfigOption,
  AgentSessionMCPServer,
  PermissionDecision,
  PermissionRequest,
  PromptHandler,
  SessionHandler,
} from "./agent-session";

// Skills
export { SkillsService, parseSkillFile } from "./skills";
export type { SkillInfo, SkillPermission, SkillImportResult, SkillDiscovery, DiscoveredSkill, SkillsServiceOptions } from "./skills";

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
export { createDefaultRegistry, loadMCPServers, getLSPClient, getMCPManager, addMCPServer, removeMCPServer, reconnectMCPServer, authenticateMCPServer } from "./defaults";

// Subagent/delegate tools run agents via an injected runner (this package
// must not depend on ai-core) — ai-core's createRuntime injects it.
export { setSubagentDependencies } from "./tools/subagent";
export type { SubagentRunMeta } from "./tools/subagent";

// Knowledge base (IPC-friendly wrappers)
export { kbListEntries, kbSearchEntries, kbAddEntry, kbRemoveEntry } from "./tools/knowledge_base";
export type { KnowledgeEntry } from "./tools/knowledge_base";
