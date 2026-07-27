export { Agent } from "./agent.js";
export type { AgentResult, AgentStreamEvent, AgentConfig } from "./agent.js";
export { runWithContext } from "./orchestrator.js";
export type { OrchestratorConfig, RunOptions } from "./orchestrator.js";
export { createRuntime } from "./runtime.js";
export type { SubagentEvent, SubagentEventHandler } from "./runtime.js";
export { runAgentCooperative } from "./worker.js";
export { runTurn, selectEngine } from "./engine.js";
export type { EngineName, EngineSelection, RunTurnOptions } from "./engine.js";
// Session detection lives in @squirl/providers so Router.fromEnv can gate the
// subscription catalogue entry on it; re-exported here for the desktop IPC.
export { detectLocalClaudeSession } from "@squirl/providers";
export type { LocalClaudeSession, SessionSignal } from "@squirl/providers";
export { CostTracker } from "./costs.js";
export { detectImages, encodeImage, buildMultimodalContent, stripImagePaths } from "./images.js";
export { classifyAndIndex, loadPending, resumeQueue, loadNodeCounter } from "./classifier.js";
export { zeroShotClassify } from "./local-nli.js";
export type { ClassifierResult } from "./classifier.js";
export { detectArtifacts, extractAndPersistArtifacts } from "./artifacts.js";
export { PersonaRegistry } from "./personas.js";
export type { AgentPersona } from "./personas.js";
export { processCommand, listCommands } from "./commands.js";
export type { CommandContext, CommandResult } from "./commands.js";
export { PermissionStore } from "./permissions.js";
export type { PermissionRule } from "./permissions.js";
export { runIsolatedSubagent } from "./subagent.js";
export type { SubagentConstraints } from "./subagent.js";
export { SnapshotManager } from "./snapshots.js";
export type { FileSnapshot, SessionSnapshot } from "./snapshots.js";
