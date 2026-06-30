import { ToolRegistry } from "./registry.js";
import { MCPManager } from "./mcp/index.js";
import { LSPManager } from "./lsp/client.js";
import type { MCPServerConfig } from "./mcp/index.js";
import { readFileDef, readFile, writeFileDef, writeFile, listDirDef, listDir, editFileDef, editFile, searchFilesDef, searchFiles } from "./tools/file.js";
import { bashDef, bash } from "./tools/bash.js";
import { webSearchDef, webSearch, webFetchDef, webFetch } from "./tools/web.js";
import { gitStatusDef, gitStatus, gitDiffDef, gitDiff, gitLogDef, gitLog, gitCommitDef, gitCommit, gitAddDef, gitAdd } from "./tools/git.js";
import { patchDef, patch } from "./tools/patch.js";
import { todoCreateDef, todoCreate, todoCompleteDef, todoComplete, todoListDef, todoList } from "./tools/todo.js";
import { questionDef, question } from "./tools/question.js";
import { findDefinitionDef, findDefinition, findReferencesDef, findReferences, findCallersDef, findCallers, projectSymbolsDef, projectSymbols } from "./tools/code_intel.js";
import { runTestsDef, runTests, runFailingTestsDef, runFailingTests, testCoverageDef, testCoverage } from "./tools/testing.js";
import { listDependenciesDef, listDependencies, addDependencyDef, addDependency, removeDependencyDef, removeDependency, outdatedDependenciesDef, outdatedDependencies } from "./tools/packages.js";
import { lspDiagnosticsDef, lspDiagnostics, lspHoverDef, lspHover, lspRenameDef, lspRename, lspImplementationsDef, lspImplementations, lspCodeActionsDef, lspCodeActions } from "./tools/lsp_actions.js";
import { terminalStartDef, terminalStart, terminalReadDef, terminalRead, terminalSendDef, terminalSend, terminalKillDef, terminalKill, terminalListDef, terminalList } from "./tools/terminal.js";
import { httpRequestDef, httpRequest, httpGetDef, httpGet, httpPostDef, httpPost } from "./tools/http_client.js";
import { kbWriteDef, kbWrite, kbReadDef, kbRead, kbSearchDef, kbSearch, kbDeleteDef, kbDelete } from "./tools/knowledge_base.js";
import { checkpointCreateDef, checkpointCreate, checkpointListDef, checkpointList, checkpointDiffDef, checkpointDiff, checkpointRollbackDef, checkpointRollback, checkpointDeleteDef, checkpointDelete } from "./tools/checkpoint.js";
import { grepSearchDef, grepSearch, globFilesDef, globFiles } from "./tools/grep_glob.js";
import { thinkDef, think } from "./tools/thinking.js";
import { toolSearchDef, toolSearch, toolListDef, toolList, setToolSearchRegistry } from "./tools/tool_search.js";
import { subagentDef, subagent, delegateDef, delegate, delegateResultDef, delegateResult, delegateListDef, delegateList } from "./tools/subagent.js";

export type { ToolRegistry };

export function createDefaultRegistry(): ToolRegistry {
  const reg = new ToolRegistry();

  // File operations
  reg.register(readFileDef, readFile);
  reg.register(writeFileDef, writeFile);
  reg.register(editFileDef, editFile);
  reg.register(listDirDef, listDir);
  reg.register(searchFilesDef, searchFiles);

  // Shell
  reg.register(bashDef, bash);

  // Web
  reg.register(webSearchDef, webSearch);
  reg.register(webFetchDef, webFetch);

  // Git
  reg.register(gitStatusDef, gitStatus);
  reg.register(gitDiffDef, gitDiff);
  reg.register(gitLogDef, gitLog);
  reg.register(gitCommitDef, gitCommit);
  reg.register(gitAddDef, gitAdd);

  // Patch
  reg.register(patchDef, patch);

  // Todo
  reg.register(todoCreateDef, todoCreate);
  reg.register(todoCompleteDef, todoComplete);
  reg.register(todoListDef, todoList);

  // Clarification
  reg.register(questionDef, question);

  // Code intelligence
  reg.register(findDefinitionDef, findDefinition);
  reg.register(findReferencesDef, findReferences);
  reg.register(findCallersDef, findCallers);
  reg.register(projectSymbolsDef, projectSymbols);

  // Test runner
  reg.register(runTestsDef, runTests);
  reg.register(runFailingTestsDef, runFailingTests);
  reg.register(testCoverageDef, testCoverage);

  // Package manager
  reg.register(listDependenciesDef, listDependencies);
  reg.register(addDependencyDef, addDependency);
  reg.register(removeDependencyDef, removeDependency);
  reg.register(outdatedDependenciesDef, outdatedDependencies);

  // Advanced LSP
  reg.register(lspDiagnosticsDef, lspDiagnostics);
  reg.register(lspHoverDef, lspHover);
  reg.register(lspRenameDef, lspRename);
  reg.register(lspImplementationsDef, lspImplementations);
  reg.register(lspCodeActionsDef, lspCodeActions);

  // Terminal
  reg.register(terminalStartDef, terminalStart);
  reg.register(terminalReadDef, terminalRead);
  reg.register(terminalSendDef, terminalSend);
  reg.register(terminalKillDef, terminalKill);
  reg.register(terminalListDef, terminalList);

  // HTTP
  reg.register(httpRequestDef, httpRequest);
  reg.register(httpGetDef, httpGet);
  reg.register(httpPostDef, httpPost);

  // Knowledge base
  reg.register(kbWriteDef, kbWrite);
  reg.register(kbReadDef, kbRead);
  reg.register(kbSearchDef, kbSearch);
  reg.register(kbDeleteDef, kbDelete);

  // Checkpoint
  reg.register(checkpointCreateDef, checkpointCreate);
  reg.register(checkpointListDef, checkpointList);
  reg.register(checkpointDiffDef, checkpointDiff);
  reg.register(checkpointRollbackDef, checkpointRollback);
  reg.register(checkpointDeleteDef, checkpointDelete);

  // Grep & Glob
  reg.register(grepSearchDef, grepSearch);
  reg.register(globFilesDef, globFiles);

  // Agent intelligence
  reg.register(thinkDef, think);
  reg.register(toolSearchDef, toolSearch);
  reg.register(toolListDef, toolList);
  reg.register(subagentDef, subagent);
  reg.register(delegateDef, delegate);
  reg.register(delegateResultDef, delegateResult);
  reg.register(delegateListDef, delegateList);

  setToolSearchRegistry(reg);

  return reg;
}

// ── Convenience helpers for desktop app ───────────────────────────────────────

const _mcpManager = new MCPManager();

/** Connect MCP servers and register their tools in the given registry */
export async function loadMCPServers(configs: MCPServerConfig[], registry: ToolRegistry): Promise<void> {
  await _mcpManager.connectAll(configs);
  registerMCPTools(registry);
}

/** (Re-)register all currently-connected MCP tools into the given registry. */
function registerMCPTools(registry: ToolRegistry): void {
  for (const tool of _mcpManager.getAllTools()) {
    registry.register(
      { name: tool.namespacedName, description: tool.description ?? "", parameters: tool.inputSchema as any },
      async (args: unknown) => {
        const result = await _mcpManager.callTool(tool.namespacedName, args as Record<string, unknown>);
        return { title: tool.namespacedName, output: JSON.stringify(result) };
      },
    );
  }
}

/** Access the shared MCP manager singleton — used for management UI (add/remove/status/tools). */
export function getMCPManager(): MCPManager {
  return _mcpManager;
}

/** Add a single MCP server at runtime and register its tools in the given registry. */
export async function addMCPServer(config: MCPServerConfig, registry: ToolRegistry) {
  const entry = await _mcpManager.addServer(config);
  registerMCPTools(registry);
  return entry;
}

/** Remove a single MCP server at runtime. */
export async function removeMCPServer(name: string): Promise<void> {
  await _mcpManager.removeServer(name);
}

/** Reconnect a single MCP server and re-register its tools. */
export async function reconnectMCPServer(name: string, registry: ToolRegistry) {
  const entry = await _mcpManager.reconnectServer(name);
  registerMCPTools(registry);
  return entry;
}

const _lspManager = new LSPManager();

/** Get the singleton LSP manager (init path is ignored; uses lazy spawning) */
export function getLSPClient(_dataDir?: string): LSPManager {
  return _lspManager;
}
