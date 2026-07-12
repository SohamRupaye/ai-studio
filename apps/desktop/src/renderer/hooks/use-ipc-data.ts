import { useCallback, useEffect, useRef, useState } from "react";
import type {
  IpcInvokeChannel,
  IpcInvokeRequest,
  IpcInvokeResponse,
} from "@ai-studio/event-bus";

// ─────────────────────────────────────────────────────────────────────────────
// Global refetch registry
// Every active useQuery registers its refetch fn here. A successful mutation
// (or a manual invalidateQueries() call) re-runs all of them, so lists like the
// sidebar chat tree stay in sync after create/delete without a shared cache.
// ─────────────────────────────────────────────────────────────────────────────

const refetchers = new Set<() => void>();

export function invalidateQueries(): void {
  for (const fn of refetchers) fn();
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic query hook — useQuery-style wrapper around window.ipc.invoke
// Handles loading / error / data state + manual refetch.
// ─────────────────────────────────────────────────────────────────────────────

export interface QueryState<T> {
  data: T | undefined;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

/**
 * Invoke a main-process handler and track loading/error/data.
 *
 * @example
 * const { data: orgs, loading } = useQuery("org:list", undefined);
 * const { data: projects } = useQuery("project:list", { orgId }, { enabled: !!orgId });
 */
export function useQuery<C extends IpcInvokeChannel>(
  channel: C,
  payload: IpcInvokeRequest<C>,
  options: { enabled?: boolean } = {},
): QueryState<IpcInvokeResponse<C>> {
  const { enabled = true } = options;
  const [data, setData] = useState<IpcInvokeResponse<C>>();
  const [loading, setLoading] = useState<boolean>(enabled);
  const [error, setError] = useState<Error | null>(null);

  // Serialize payload so object literals don't retrigger every render.
  const payloadKey = JSON.stringify(payload ?? null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      const result = await window.ipc.invoke(channel, payload);
      if (mounted.current) setData(result);
    } catch (err) {
      if (mounted.current) setError(err as Error);
    } finally {
      if (mounted.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, payloadKey, enabled]);

  useEffect(() => {
    run();
  }, [run]);

  // Register this query's refetch so mutations elsewhere can refresh it.
  useEffect(() => {
    if (!enabled) return;
    const fn = () => {
      run();
    };
    refetchers.add(fn);
    return () => {
      refetchers.delete(fn);
    };
  }, [run, enabled]);

  return { data, loading, error, refetch: run };
}

// ─────────────────────────────────────────────────────────────────────────────
// Mutation hook — for create/update/delete style calls
// ─────────────────────────────────────────────────────────────────────────────

export interface MutationState<C extends IpcInvokeChannel> {
  mutate: (payload: IpcInvokeRequest<C>) => Promise<IpcInvokeResponse<C>>;
  loading: boolean;
  error: Error | null;
}

/**
 * Invoke a mutating main-process handler.
 *
 * @example
 * const createOrg = useMutation("org:create");
 * await createOrg.mutate({ name: "Acme" });
 */
export function useMutation<C extends IpcInvokeChannel>(channel: C): MutationState<C> {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const mutate = useCallback(
    async (payload: IpcInvokeRequest<C>) => {
      setLoading(true);
      setError(null);
      try {
        const result = await window.ipc.invoke(channel, payload);
        // Refresh all active queries so lists reflect the change immediately.
        invalidateQueries();
        return result;
      } catch (err) {
        setError(err as Error);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [channel],
  );

  return { mutate, loading, error };
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience domain hooks
// ─────────────────────────────────────────────────────────────────────────────

export const useOrgs = () => useQuery("org:list", undefined);

export const useProjects = (orgId: string | undefined) =>
  useQuery("project:list", { orgId: orgId! }, { enabled: !!orgId });

export const useSpaces = (projectId: string | undefined) =>
  useQuery("space:list", { projectId: projectId! }, { enabled: !!projectId });

export const useChats = (projectId: string | undefined) =>
  useQuery("chat:list", { projectId: projectId! }, { enabled: !!projectId });

export const useBranches = () => useQuery("branch:list", undefined);

export const useMessages = (branchId: string | undefined) =>
  useQuery("message:list", { branchId: branchId! }, { enabled: !!branchId });

export const useArtifacts = (projectId: string | undefined) =>
  useQuery("artifact:list", { projectId: projectId! }, { enabled: !!projectId });

export const useArtifact = (id: string | undefined) =>
  useQuery("artifact:get", { id: id! }, { enabled: !!id });

export const useMemory = (scope?: string) => useQuery("memory:list", { scope });

export const useBranchMemories = (branchId: string | undefined) =>
  useQuery("memory:for-branch", { branchId: branchId! }, { enabled: !!branchId });

export const useContextStats = (branchId: string | undefined) =>
  useQuery("context:stats", { branchId: branchId! }, { enabled: !!branchId });

export const useBranchArtifacts = (branchId: string | undefined) =>
  useQuery("artifact:for-branch", { branchId: branchId! }, { enabled: !!branchId });

export const useModels = () => useQuery("models:list", undefined);

/**
 * Subscribes once (mount in App.tsx) to the main process's "models:refreshed"
 * push event, fired after a background live model-list fetch completes, and
 * refetches every active query (including models:list) so newly discovered
 * models show up without the user needing to do anything.
 */
export function useModelsRefreshListener(): void {
  useEffect(() => {
    const off = window.ipc.on("models:refreshed", () => {
      invalidateQueries();
    });
    return off;
  }, []);
}

/**
 * Subscribes once (mount in App.tsx) to "chat:titled" — pushed when a chat
 * auto-titles itself off its first exchange — and refetches every active
 * query so the sidebar tree and breadcrumb show the new name.
 */
export function useChatTitledListener(): void {
  useEffect(() => {
    const off = window.ipc.on("chat:titled", () => {
      invalidateQueries();
    });
    return off;
  }, []);
}

/**
 * Subscribes once (mount in App.tsx) to "mcp:changed" — pushed on every MCP
 * server status transition (connected/needs_auth/failed/reconnecting) — and
 * refetches mcp:list so the settings page reflects live state.
 */
export function useMCPChangedListener(): void {
  useEffect(() => {
    const off = window.ipc.on("mcp:changed", () => {
      invalidateQueries();
    });
    return off;
  }, []);
}

/**
 * Subscribes once (mount in App.tsx) to "skills:changed" — pushed when the
 * installed skills change (import, remove, an external edit to the skills
 * dir) — and refetches skills:list wherever it's mounted.
 */
export function useSkillsChangedListener(): void {
  useEffect(() => {
    const off = window.ipc.on("skills:changed", () => {
      invalidateQueries();
    });
    return off;
  }, []);
}

/**
 * Whether the window is fullscreen. macOS hides the traffic lights in
 * fullscreen, so chrome that reserves space for them should collapse it.
 */
export function useIsFullscreen(): boolean {
  const { data: initial } = useQuery("window:is-fullscreen", undefined);
  const [live, setLive] = useState<boolean | null>(null);
  useEffect(() => window.ipc.on("window:fullscreen-changed", setLive), []);
  return live ?? initial ?? false;
}

export const useCodexStatus = () => useQuery("codex:status", undefined);

export const useUser = () => useQuery("user:get", undefined);

export const useConfig = () => useQuery("config:get", undefined);

export const useBranchCosts = (branchId: string | undefined) =>
  useQuery("costs:branch", { branchId: branchId! }, { enabled: !!branchId });

export const useProjectCosts = (projectId: string | undefined) =>
  useQuery("costs:project", { projectId: projectId! }, { enabled: !!projectId });

export const useMCPServers = () => useQuery("mcp:list", undefined);

export const useSkills = () => useQuery("skills:list", undefined);

export const usePermissions = () => useQuery("permissions:list", undefined);

export const useSnapshots = (branchId: string | undefined) =>
  useQuery("snapshot:list", { branchId: branchId! }, { enabled: !!branchId });

export const usePersonas = () => useQuery("persona:list", undefined);

export const useActivePersona = (branchId: string | undefined) =>
  useQuery("persona:get-active", { branchId: branchId! }, { enabled: !!branchId });

export const useKnowledgeBase = (params?: { category?: string; tags?: string[] }) =>
  useQuery("kb:list", params ?? {});
