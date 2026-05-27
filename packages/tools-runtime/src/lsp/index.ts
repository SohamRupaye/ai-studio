export { LSPClient, LSPManager, formatDiagnostic, formatDiagnosticsReport } from "./client";
export { LANGUAGE_EXTENSIONS, getLanguageId } from "./language";
export { SERVERS, findServersForExtension, findServerById, findRoot } from "./servers";
export type { Diagnostic } from "./client";
export type { LSPServerInfo } from "./servers";

// Legacy compat: singleton manager instance
import { LSPManager } from "./client";
const _manager = new LSPManager();
/** @deprecated Use LSPManager directly */
export async function getClient(filePath: string) { return _manager.getClientForFile(filePath); }
export { _manager as defaultManager };
